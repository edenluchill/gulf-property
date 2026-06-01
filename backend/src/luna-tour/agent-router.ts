/**
 * Luna Tour — agent-facing API (dashboard + analytics + create).
 *
 * ISOLATION: mounted in index.ts as `app.use('/api/luna/agent', lunaAgentRouter)`.
 * Phase 2 MVP: NO auth yet — operates on the demo agent (or LT_AGENT_EMAIL). When
 * real agent auth lands, gate these with requireAgent middleware. Delete this file
 * + the mount + luna-tour/ to remove.
 *
 *   GET  /api/luna/agent/sessions              → agent's sessions + engagement
 *   GET  /api/luna/agent/sessions/:id/events   → one session's behaviour timeline
 *   POST /api/luna/agent/sessions/create       → generate a tour for given projects
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { createSession, ensureAgent } from './session-builder'
import { draftConfig } from './auto-config'

const router = Router()

const DEMO_AGENT_EMAIL = process.env.LT_AGENT_EMAIL || 'demo-agent@luna.tour'

/** Resolve the working agent (MVP: the demo agent). */
async function currentAgentId(): Promise<string> {
  return ensureAgent({
    email: DEMO_AGENT_EMAIL,
    displayName: 'David Chen',
    phone: '+971500000000',
    whatsapp: '971500000000',
    photoUrl: 'https://i.pravatar.cc/200?img=12',
    brand: { title: 'Emaar 认证顾问', whatsapp: '971500000000', accent: '#00E0B8' },
  })
}

/** List the agent's sessions with engagement rollups (read-only). */
router.get('/sessions', async (_req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId()
    const { rows } = await pool.query(
      `SELECT s.id, s.title, s.share_code, s.status, s.is_published, s.created_at,
              c.name AS client_name,
              count(e.*) FILTER (WHERE e.event_type='open')          AS opens,
              count(e.*) FILTER (WHERE e.event_type='tour_play')     AS plays,
              count(e.*) FILTER (WHERE e.event_type='tour_complete') AS completes,
              count(e.*) FILTER (WHERE e.event_type IN ('cta_whatsapp','cta_call')) AS cta_clicks,
              count(e.*) FILTER (WHERE e.event_type='feedback')      AS loves,
              coalesce(sum(e.dwell_ms),0)::bigint                    AS total_dwell_ms,
              max(e.created_at)                                      AS last_seen_at
         FROM lt_demo_sessions s
         LEFT JOIN lt_clients c ON c.id = s.client_id
         LEFT JOIN lt_engagement_events e ON e.session_id = s.id
        WHERE s.agent_id = $1
        GROUP BY s.id, c.name
        ORDER BY s.created_at DESC`,
      [agentId]
    )
    res.json({
      sessions: rows.map((r) => ({
        ...r,
        opens: Number(r.opens),
        plays: Number(r.plays),
        completes: Number(r.completes),
        cta_clicks: Number(r.cta_clicks),
        loves: Number(r.loves),
        total_dwell_ms: Number(r.total_dwell_ms),
        // simple lead score (same weights as the matview)
        lead_score:
          Number(r.opens) * 1 +
          Number(r.completes) * 5 +
          Number(r.cta_clicks) * 10 +
          Math.min(Number(r.total_dwell_ms) / 60000, 20),
      })),
    })
  } catch (err) {
    console.error('[luna] agent sessions error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** One session's behaviour timeline (most recent events first). */
router.get('/sessions/:id/events', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId()
    const sessionId = String(req.params.id)
    // verify the session belongs to this agent
    const own = await pool.query(`SELECT 1 FROM lt_demo_sessions WHERE id=$1 AND agent_id=$2`, [sessionId, agentId])
    if (own.rowCount === 0) return res.status(404).json({ error: 'not found' })

    const { rows } = await pool.query(
      `SELECT e.event_type, e.visitor_id, e.project_id, e.dwell_ms, e.created_at,
              sp.snapshot->>'name' AS project_name
         FROM lt_engagement_events e
         LEFT JOIN lt_session_properties sp
           ON sp.session_id = e.session_id AND sp.project_id = e.project_id
        WHERE e.session_id = $1
        ORDER BY e.created_at DESC
        LIMIT 500`,
      [sessionId]
    )
    res.json({ events: rows })
  } catch (err) {
    console.error('[luna] agent events error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * Create (generate) a tour for the given projects.
 * body: { share_code, project_ids[], title?, client?, one_liner? }
 * If one_liner/client provided, AI drafts the config (auto-config); else default.
 */
router.post('/sessions/create', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId()
    const b = (req.body || {}) as Record<string, unknown>
    const shareCode = String(b.share_code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const projectIds = Array.isArray(b.project_ids) ? (b.project_ids as unknown[]).map(String) : []
    if (!shareCode || projectIds.length < 2) {
      return res.status(400).json({ error: 'need share_code + ≥2 project_ids' })
    }
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : 'Luna 为你精选的家'
    const client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const oneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''

    // AI auto-config when a brief/client is given
    let config
    if (oneLiner || Object.keys(client).length) {
      config = await draftConfig(client, oneLiner)
    }

    const result = await createSession({
      shareCode,
      projectIds,
      title,
      agentId,
      client,
      config,
    })
    res.json({ ok: true, ...result, watch_url: `/?toursession=${result.shareCode}` })
  } catch (err) {
    console.error('[luna] agent create error:', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'create failed' })
  }
})

export default router
