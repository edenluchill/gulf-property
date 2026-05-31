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
import { createHash } from 'crypto'
import pool from '../db/pool'

const router = Router()

// ---------------------------------------------------------------------------
// Telemetry (see docs/luna-tour-telemetry-spec.md). FULLY DECOUPLED: best-effort,
// never affects the read path above, ALWAYS returns 204 (even on bad input/error)
// so a misbehaving client/DB can never surface to the customer. Delete this block
// + the frontend telemetry.ts to remove.
// ---------------------------------------------------------------------------

const ALLOWED_EVENTS = new Set([
  'open',
  'tour_play',
  'property_dwell',
  'chart_view',
  'tour_complete',
  'tour_replay',
  'cta_whatsapp',
  'feedback',
  'ask',
  'property_view',
])
const IP_SALT = process.env.LT_IP_SALT || 'luna-tour-static-salt'

function hashIp(req: Request): string | null {
  const raw =
    (req.headers['cf-connecting-ip'] as string) ||
    ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
    req.ip ||
    ''
  if (!raw) return null
  return createHash('sha256').update(raw + IP_SALT).digest('hex').slice(0, 32)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

router.post('/public/v/:code/event', async (req: Request, res: Response) => {
  // Respond immediately; persistence is fire-and-forget. Client ignores body.
  res.status(204).end()
  try {
    const code = String(req.params.code || '').trim()
    const b = (req.body || {}) as Record<string, unknown>
    const eventType = String(b.event_type || '')
    if (!code || !ALLOWED_EVENTS.has(eventType)) return

    const visitorId = String(b.visitor_id || '').slice(0, 128)
    if (!visitorId) return

    const projectId = typeof b.project_id === 'string' && UUID_RE.test(b.project_id) ? b.project_id : null
    const dwellMs =
      typeof b.dwell_ms === 'number' && isFinite(b.dwell_ms)
        ? Math.max(0, Math.min(Math.round(b.dwell_ms), 86_400_000))
        : null
    let payload: string | null = null
    if (b.payload && typeof b.payload === 'object') {
      const s = JSON.stringify(b.payload)
      if (s.length <= 4000) payload = s
    }
    const ua = (req.headers['user-agent'] as string || '').slice(0, 300)
    const ipHash = hashIp(req)

    // Resolve session by share_code (indexed). Miss → drop silently (e.g. after
    // a re-seed the old session_id is gone; never write a dangling FK).
    const sres = await pool.query(
      `SELECT id FROM lt_demo_sessions WHERE share_code = $1 AND is_published = true LIMIT 1`,
      [code]
    )
    const sessionId = sres.rows[0]?.id
    if (!sessionId) return

    await pool.query(
      `INSERT INTO lt_engagement_events
         (session_id, visitor_id, event_type, project_id, dwell_ms, payload, ua, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [sessionId, visitorId, eventType, projectId, dwellMs, payload, ua || null, ipHash]
    )

    if (eventType === 'feedback') {
      const reaction = typeof b.reaction === 'string' ? b.reaction.slice(0, 16) : 'love'
      await pool.query(
        `INSERT INTO lt_client_feedback (session_id, project_id, visitor_id, reaction)
         VALUES ($1,$2,$3,$4)`,
        [sessionId, projectId, visitorId, reaction]
      )
    }
  } catch (err) {
    // Swallow — telemetry must never disrupt anything.
    console.error('[luna] telemetry insert failed (ignored):', err instanceof Error ? err.message : err)
  }
})

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
