/**
 * Luna Tour — public, read-only watch endpoint.
 *
 * ISOLATION: mounted in index.ts with a single line:
 *   app.use('/api/luna', lunaPublicRouter)
 * Delete this file + that line to remove. Only reads lt_* tables. Returns a
 * narrow, client-safe shape — never internal columns (agent email, configs…).
 *
 * GET /api/luna/public/v/:code
 *   → { session, agent, properties[], script }   (200)
 *   → 404 if no published session with that share_code
 *   → 410 if expired
 *   → 401 { passcode_required:true } if passcode set and not matched (?pc=)
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

router.get('/public/v/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code || '').trim()
  if (!code) return res.status(400).json({ error: 'missing share code' })

  try {
    const sessionRes = await pool.query(
      `SELECT s.id, s.title, s.share_code, s.theme, s.data_as_of,
              s.og_image_url, s.reveal_snapshot_url, s.passcode, s.expires_at,
              s.agent_id, s.client_id,
              a.display_name AS agent_name, a.photo_url AS agent_photo,
              a.phone AS agent_phone, a.whatsapp AS agent_whatsapp, a.brand AS agent_brand,
              c.name AS client_name
         FROM lt_demo_sessions s
         JOIN lt_agents a ON a.id = s.agent_id
         LEFT JOIN lt_clients c ON c.id = s.client_id
        WHERE s.share_code = $1 AND s.is_published = true
        LIMIT 1`,
      [code]
    )
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ error: 'not found' })
    }
    const s = sessionRes.rows[0]

    if (s.expires_at && new Date(s.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'expired' })
    }
    if (s.passcode) {
      const provided = String(req.query.pc || '')
      if (provided !== s.passcode) {
        return res.status(401).json({ passcode_required: true })
      }
    }

    const [propsRes, scriptRes] = await Promise.all([
      pool.query(
        `SELECT id, project_id, sort_order, agent_pitch, emphasis, snapshot
           FROM lt_session_properties
          WHERE session_id = $1
          ORDER BY sort_order ASC`,
        [s.id]
      ),
      pool.query(
        `SELECT language, voice, script, total_ms
           FROM lt_tour_scripts
          WHERE session_id = $1
          ORDER BY (language = 'zh') DESC, created_at ASC
          LIMIT 1`,
        [s.id]
      ),
    ])

    if (scriptRes.rowCount === 0) {
      return res.status(404).json({ error: 'no script for session' })
    }

    res.json({
      session: {
        id: s.id,
        title: s.title,
        share_code: s.share_code,
        theme: s.theme,
        data_as_of: s.data_as_of,
        og_image_url: s.og_image_url,
        reveal_snapshot_url: s.reveal_snapshot_url,
        client_name: s.client_name,
      },
      agent: {
        name: s.agent_name,
        photo_url: s.agent_photo,
        phone: s.agent_phone,
        whatsapp: s.agent_whatsapp,
        brand: s.agent_brand,
      },
      properties: propsRes.rows.map((p) => ({
        id: p.id,
        project_id: p.project_id,
        sort_order: p.sort_order,
        agent_pitch: p.agent_pitch,
        emphasis: p.emphasis,
        snapshot: p.snapshot,
      })),
      script: scriptRes.rows[0].script,
      voice: scriptRes.rows[0].voice,
      language: scriptRes.rows[0].language,
    })
  } catch (err) {
    console.error('[luna] public watch error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
