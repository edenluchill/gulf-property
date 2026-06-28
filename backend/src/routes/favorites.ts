/**
 * Favorites — server-side persistence for a logged-in user's saved projects.
 *
 * Mounted at /api/favorites. All routes require auth: favorites belong to a
 * Supabase user.id (req.user.id). Anonymous visitors keep using localStorage
 * (frontend/src/lib/favorites.ts); on login the client POSTs its local picks to
 * /merge, which folds them in and returns the unified set. See user-favorites.sql.
 *
 * Wire shape (matches the frontend FavoritesData v2 exactly so the client can
 * drop the response straight into state):
 *   { version: 2, projects: [{ projectId, addedAt, unitTypeIds: string[] }] }
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth } from '../middleware/auth'

const router = Router()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WireProject {
  projectId: string
  addedAt: number
  unitTypeIds: string[]
}

/** Read all of this user's favorites, grouped into the v2 wire shape. */
async function loadUserFavorites(userId: string): Promise<{ version: 2; projects: WireProject[] }> {
  const r = await pool.query(
    `SELECT project_id, unit_type_id, added_at
       FROM user_favorites WHERE user_id = $1
      ORDER BY added_at ASC`,
    [userId]
  )
  const byProject = new Map<string, WireProject>()
  for (const row of r.rows) {
    const pid = String(row.project_id)
    let p = byProject.get(pid)
    if (!p) {
      p = { projectId: pid, addedAt: new Date(row.added_at).getTime(), unitTypeIds: [] }
      byProject.set(pid, p)
    }
    // The project-level row (unit_type_id = '') anchors addedAt; unit rows append.
    if (row.unit_type_id) p.unitTypeIds.push(row.unit_type_id)
    else p.addedAt = new Date(row.added_at).getTime()
  }
  return { version: 2, projects: [...byProject.values()] }
}

/** GET /api/favorites — the user's full saved set. */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await loadUserFavorites(req.user!.id)
    res.json(data)
  } catch (err) {
    console.error('[favorites] list error:', err)
    res.status(500).json({ error: 'failed to load favorites' })
  }
})

/**
 * POST /api/favorites — add one favorite.
 * Body: { project_id, unit_type_id? }. unit_type_id omitted → project-level.
 * Adding a unit also ensures the project-level row exists (mirrors the client).
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const projectId = String(b.project_id || '').trim()
    if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'valid project_id required' })
    const unitTypeId = typeof b.unit_type_id === 'string' ? b.unit_type_id.slice(0, 128) : ''

    if (unitTypeId) {
      // Ensure the project row exists too, so the UI shows the parent as favorited.
      await pool.query(
        `INSERT INTO user_favorites (user_id, project_id, unit_type_id)
         VALUES ($1, $2, ''), ($1, $2, $3)
         ON CONFLICT (user_id, project_id, unit_type_id) DO NOTHING`,
        [req.user!.id, projectId, unitTypeId]
      )
    } else {
      await pool.query(
        `INSERT INTO user_favorites (user_id, project_id, unit_type_id)
         VALUES ($1, $2, '')
         ON CONFLICT (user_id, project_id, unit_type_id) DO NOTHING`,
        [req.user!.id, projectId]
      )
    }
    res.status(204).end()
  } catch (err) {
    console.error('[favorites] add error:', err)
    res.status(500).json({ error: 'failed to add favorite' })
  }
})

/**
 * DELETE /api/favorites — remove a favorite.
 * Body: { project_id, unit_type_id? }. Removing a project (unit_type_id omitted)
 * cascades to its unit rows too — matching the localStorage behaviour where
 * un-favoriting a project drops its saved unit types.
 */
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const projectId = String(b.project_id || '').trim()
    if (!UUID_RE.test(projectId)) return res.status(400).json({ error: 'valid project_id required' })
    const unitTypeId = typeof b.unit_type_id === 'string' ? b.unit_type_id.slice(0, 128) : ''

    if (unitTypeId) {
      await pool.query(
        `DELETE FROM user_favorites WHERE user_id = $1 AND project_id = $2 AND unit_type_id = $3`,
        [req.user!.id, projectId, unitTypeId]
      )
    } else {
      // Drop the project AND all its unit-type rows.
      await pool.query(
        `DELETE FROM user_favorites WHERE user_id = $1 AND project_id = $2`,
        [req.user!.id, projectId]
      )
    }
    res.status(204).end()
  } catch (err) {
    console.error('[favorites] remove error:', err)
    res.status(500).json({ error: 'failed to remove favorite' })
  }
})

/**
 * POST /api/favorites/merge — fold the client's localStorage favorites into the
 * server set, then return the unified set. Idempotent (ON CONFLICT DO NOTHING),
 * so calling it on every login is safe. Body: the v2 shape
 *   { projects: [{ projectId, addedAt?, unitTypeIds?: [] }] }.
 */
router.post('/merge', requireAuth, async (req: Request, res: Response) => {
  const conn = await pool.connect()
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const projects = Array.isArray(b.projects) ? b.projects : []

    await conn.query('BEGIN')
    for (const raw of projects.slice(0, 500)) {
      const p = (raw || {}) as Record<string, unknown>
      const projectId = String(p.projectId || '').trim()
      if (!UUID_RE.test(projectId)) continue
      const addedAt = typeof p.addedAt === 'number' && isFinite(p.addedAt)
        ? new Date(p.addedAt) : new Date()
      // Project-level row carries the client's addedAt (so order/recency survives).
      await conn.query(
        `INSERT INTO user_favorites (user_id, project_id, unit_type_id, added_at)
         VALUES ($1, $2, '', $3)
         ON CONFLICT (user_id, project_id, unit_type_id) DO NOTHING`,
        [req.user!.id, projectId, addedAt]
      )
      const unitIds = Array.isArray(p.unitTypeIds) ? p.unitTypeIds : []
      for (const u of unitIds.slice(0, 200)) {
        const unitTypeId = typeof u === 'string' ? u.slice(0, 128) : ''
        if (!unitTypeId) continue
        await conn.query(
          `INSERT INTO user_favorites (user_id, project_id, unit_type_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, project_id, unit_type_id) DO NOTHING`,
          [req.user!.id, projectId, unitTypeId]
        )
      }
    }
    await conn.query('COMMIT')

    const data = await loadUserFavorites(req.user!.id)
    res.json(data)
  } catch (err) {
    try { await conn.query('ROLLBACK') } catch { /* ignore */ }
    console.error('[favorites] merge error:', err)
    res.status(500).json({ error: 'failed to merge favorites' })
  } finally {
    conn.release()
  }
})

export default router
