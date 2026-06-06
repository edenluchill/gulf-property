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
import crypto from 'crypto'
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { createSession, ensureAgent } from './session-builder'
import { draftConfig } from './auto-config'
import { matchProperties } from './auto-match'
import { buildClientReport } from './auto-report'
import { reviseNarration } from './revise'
import { generateSessionAudio } from './audio-pipeline'

const router = Router()

const DEMO_AGENT_EMAIL = process.env.LT_AGENT_EMAIL || 'demo-agent@luna.tour'

/**
 * In-memory generation jobs (keyed by share_code). Tour generation (AI script)
 * takes ~30–60s — far longer than the proxy timeout — so /create returns a
 * share_code IMMEDIATELY and runs the build in the background; the client polls
 * /gen-status. Single API instance (INITIAL_INSTANCES=1) so this map is
 * consistent; a restart just makes an in-flight poll fall back to the DB row.
 */
type GenJob = {
  status: 'generating' | 'ready' | 'failed'
  error?: string
  stops?: string[]
  audioTotal?: number
}
const genJobs = new Map<string, GenJob>()

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

/** Short, human-friendly random code (no ambiguous chars like 0/o/1/l). */
function randomCode(len = 6): string {
  const alpha = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += alpha[bytes[i] % alpha.length]
  return s
}

/** Generate a share code not already used by any session. */
async function uniqueShareCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(6)
    const { rowCount } = await pool.query('SELECT 1 FROM lt_demo_sessions WHERE share_code=$1', [code])
    if (rowCount === 0) return code
  }
  return randomCode(8)
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
 * Search residential projects for the create-tour picker.
 * GET /projects/search?q=...  → up to 12 matches by name / area / developer.
 * Only projects with coords (usable in a tour) are returned.
 */
router.get('/projects/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim()
    if (q.length < 1) return res.json({ projects: [] })
    const like = `%${q.replace(/[%_]/g, '')}%`
    const { rows } = await pool.query(
      `SELECT id::text, project_name, area, developer, primary_image, min_price, max_price
         FROM residential_projects
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND (project_name ILIKE $1 OR area ILIKE $1 OR developer ILIKE $1)
        ORDER BY (project_name ILIKE $1) DESC, project_name
        LIMIT 12`,
      [like]
    )
    res.json({ projects: rows })
  } catch (err) {
    console.error('[luna] project search error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * AI match: pick best-fit projects for a client profile + explain each.
 * body: { client?, one_liner? }  → { matches: [{ id, project_name, area, reason }] }
 */
router.post('/match', async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const oneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''
    if (!oneLiner.trim() && !Object.keys(client).length) {
      return res.status(400).json({ error: '需要客户画像或一句话' })
    }
    const matches = await matchProperties(client, oneLiner, 3)
    res.json({ matches })
  } catch (err) {
    console.error('[luna] agent match error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * AI client report: match best-fit projects + 5yr ROI projection + scenarios.
 * body: { client?, one_liner? }  → ClientReport
 */
router.post('/report', async (req: Request, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>
    const client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const oneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''
    if (!oneLiner.trim() && !Object.keys(client).length) {
      return res.status(400).json({ error: '需要客户画像或一句话' })
    }
    const report = await buildClientReport(client, oneLiner, 3)
    res.json({ report })
  } catch (err) {
    console.error('[luna] agent report error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * Create (generate) a tour for the given projects.
 * body: { project_ids[], share_code?, title?, client?, one_liner? }
 * share_code/title are auto-generated when omitted (editable afterwards).
 * If one_liner/client provided, AI drafts the config (auto-config); else default.
 */
router.post('/sessions/create', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId()
    const b = (req.body || {}) as Record<string, unknown>
    const projectIds = Array.isArray(b.project_ids) ? (b.project_ids as unknown[]).map(String) : []
    if (projectIds.length < 2) {
      return res.status(400).json({ error: '至少需要选择 2 个楼盘' })
    }
    const shareCodeRaw = String(b.share_code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const shareCode = shareCodeRaw || (await uniqueShareCode())
    const client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const clientName = typeof client.name === 'string' ? client.name.trim() : ''
    const defaultTitle = clientName
      ? `为 ${clientName} 精选的 ${projectIds.length} 个家`
      : `Luna 为你精选的 ${projectIds.length} 个家`
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : defaultTitle
    const oneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''

    // Kick off the heavy build (AI config + script + audio) in the BACKGROUND and
    // return the share_code now, so the request can't hit the proxy timeout. The
    // client polls /sessions/:code/gen-status for structure + audio progress.
    genJobs.set(shareCode, { status: 'generating' })
    res.json({ ok: true, shareCode, status: 'generating', watch_url: `/?toursession=${shareCode}` })

    void (async () => {
      try {
        let config
        if (oneLiner || Object.keys(client).length) config = await draftConfig(client, oneLiner)
        const result = await createSession({ shareCode, projectIds, title, agentId, client, config })
        genJobs.set(shareCode, { status: 'ready', stops: result.stops, audioTotal: result.audioTotal })
      } catch (err) {
        console.error('[luna] agent create (bg) error:', err)
        genJobs.set(shareCode, { status: 'failed', error: err instanceof Error ? err.message : 'create failed' })
      }
    })()
  } catch (err) {
    console.error('[luna] agent create error:', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'create failed' })
  }
})

type ScriptBeat = { id?: string; kind?: string; narration?: string; audio_url?: string }
type ScriptShape = {
  intro?: ScriptBeat
  outro?: ScriptBeat
  acts?: Array<{ property_id?: string; beats?: ScriptBeat[] }>
}

/**
 * Read a session's tour flow for editing: title + the ordered beats
 * (intro → each property's beats → outro) and the property names.
 */
/**
 * Generation status for the create node-diagram: build phase → ready (with the
 * tour structure) → audio backfill. Merges the in-memory job (status/stops) with
 * live audio counts from the DB. Accepts share_code OR session id.
 */
router.get('/sessions/:id/gen-status', async (req: Request, res: Response) => {
  try {
    const key = req.params.id
    const job = genJobs.get(key)
    const sres = await pool.query<{ id: string }>(
      `SELECT id FROM lt_demo_sessions WHERE id::text=$1 OR share_code=$1 LIMIT 1`,
      [key]
    )
    const sessionId = sres.rows[0]?.id
    let audioReady = 0
    if (sessionId) {
      const r = await pool.query<{ ready: string }>(
        `SELECT count(*) FILTER (WHERE status='ready') AS ready FROM lt_audio_assets WHERE session_id=$1`,
        [sessionId]
      )
      audioReady = Number(r.rows[0]?.ready ?? 0)
    }
    // status: prefer the live job; fall back to the DB (job lost after restart).
    const status: 'generating' | 'ready' | 'failed' = job?.status ?? (sessionId ? 'ready' : 'generating')
    res.json({
      status,
      stops: job?.stops ?? null,
      audioTotal: job?.audioTotal ?? null,
      audioReady,
      error: job?.error ?? null,
    })
  } catch (err) {
    console.error('[luna] gen-status error:', err)
    res.status(500).json({ error: 'gen-status failed' })
  }
})

// ──────────────────────────────────────────────────────────────────────────
// E2 — comment-driven AI editing
// ──────────────────────────────────────────────────────────────────────────

async function resolveSessionId(idOrCode: string): Promise<string | null> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM lt_demo_sessions WHERE id::text=$1 OR share_code=$1 LIMIT 1`,
    [idOrCode]
  )
  return r.rows[0]?.id ?? null
}

/** Walk every beat (intro → act beats → outro) in a stored script. */
function eachBeat(script: ScriptShape, fn: (b: ScriptBeat) => void) {
  if (script.intro) fn(script.intro)
  for (const act of script.acts || []) for (const b of act.beats || []) fn(b)
  if (script.outro) fn(script.outro)
}

/** Leave a comment anchored to a beat (for later AI revise). */
router.post('/sessions/:id/comments', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const b = (req.body || {}) as Record<string, unknown>
    const beatId = String(b.beat_id || '').trim()
    const body = String(b.body || '').trim()
    if (!beatId || !body) return res.status(400).json({ error: 'beat_id and body required' })
    const atMs = Number.isFinite(Number(b.at_ms)) ? Math.round(Number(b.at_ms)) : null
    const r = await pool.query(
      `INSERT INTO lt_edit_comments (session_id, beat_id, at_ms, body) VALUES ($1,$2,$3,$4) RETURNING id`,
      [sessionId, beatId, atMs, body]
    )
    res.json({ ok: true, id: r.rows[0].id })
  } catch (err) {
    console.error('[luna] comment add error:', err)
    res.status(500).json({ error: 'comment failed' })
  }
})

/** List a session's open comments. */
router.get('/sessions/:id/comments', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const r = await pool.query(
      `SELECT id, beat_id, at_ms, body, status, created_at
         FROM lt_edit_comments WHERE session_id=$1 AND status='open' ORDER BY created_at`,
      [sessionId]
    )
    res.json({ comments: r.rows })
  } catch (err) {
    console.error('[luna] comment list error:', err)
    res.status(500).json({ error: 'comment list failed' })
  }
})

/** Dismiss (or otherwise update) a comment. */
router.patch('/sessions/:id/comments/:cid', async (req: Request, res: Response) => {
  try {
    const status = String((req.body || {}).status || 'dismissed')
    if (!['open', 'dismissed', 'applied'].includes(status)) return res.status(400).json({ error: 'bad status' })
    await pool.query(`UPDATE lt_edit_comments SET status=$1 WHERE id=$2`, [status, req.params.cid])
    res.json({ ok: true })
  } catch (err) {
    console.error('[luna] comment patch error:', err)
    res.status(500).json({ error: 'comment patch failed' })
  }
})

/**
 * Apply open comments with AI: rewrite the commented beats' narration, snapshot a
 * version (undo), persist, regenerate ONLY the changed beats' audio (background),
 * and mark the comments applied.
 */
router.post('/sessions/:id/revise', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    const cmtRes = await pool.query<{ beat_id: string; body: string }>(
      `SELECT beat_id, body FROM lt_edit_comments WHERE session_id=$1 AND status='open'`,
      [sessionId]
    )
    if (!cmtRes.rows.length) return res.json({ ok: true, applied: 0, message: '没有待应用的评论' })

    const beats: { beat_id: string; narration: string }[] = []
    eachBeat(scriptRow.script, (b) => beats.push({ beat_id: b.id || '', narration: b.narration || '' }))
    const patches = await reviseNarration(beats, cmtRes.rows)
    if (!patches.length) return res.json({ ok: true, applied: 0, message: 'AI 未产生改动,可换种说法再试' })

    // snapshot the current script for undo
    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), `AI 改稿前 · ${patches.length} 段`]
    )

    // apply patches: set narration + clear audio_url so only those beats re-synth
    const changed = new Set(patches.map((p) => p.beat_id))
    const patchById = new Map(patches.map((p) => [p.beat_id, p.narration]))
    eachBeat(scriptRow.script, (b) => {
      if (b.id && changed.has(b.id)) {
        b.narration = patchById.get(b.id)!
        b.audio_url = undefined
      }
    })
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    // drop stale audio rows for changed beats so status reflects the re-gen
    await pool.query(`DELETE FROM lt_audio_assets WHERE session_id=$1 AND beat_id = ANY($2::text[])`, [
      sessionId,
      [...changed],
    ])
    await pool.query(`UPDATE lt_edit_comments SET status='applied' WHERE session_id=$1 AND status='open'`, [sessionId])

    // regenerate only the cleared beats' audio in the background
    void generateSessionAudio(sessionId).catch((e) =>
      console.warn('[luna] revise audio regen failed:', e instanceof Error ? e.message : e)
    )

    res.json({ ok: true, applied: patches.length, changed_beats: [...changed] })
  } catch (err) {
    console.error('[luna] revise error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'revise failed' })
  }
})

/** List script versions (for undo). */
router.get('/sessions/:id/versions', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const r = await pool.query(
      `SELECT id, note, created_at FROM lt_tour_script_versions WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [sessionId]
    )
    res.json({ versions: r.rows })
  } catch (err) {
    console.error('[luna] versions error:', err)
    res.status(500).json({ error: 'versions failed' })
  }
})

/** Revert the script to a saved version (regenerates any now-missing audio). */
router.post('/sessions/:id/revert', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const versionId = String((req.body || {}).version_id || '')
    if (!versionId) return res.status(400).json({ error: 'version_id required' })
    const vRes = await pool.query<{ script: ScriptShape; script_id: string }>(
      `SELECT script, script_id FROM lt_tour_script_versions WHERE id=$1 AND session_id=$2`,
      [versionId, sessionId]
    )
    const v = vRes.rows[0]
    if (!v) return res.status(404).json({ error: 'version not found' })
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(v.script), v.script_id])
    void generateSessionAudio(sessionId).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    console.error('[luna] revert error:', err)
    res.status(500).json({ error: 'revert failed' })
  }
})

router.get('/sessions/:id/script', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId()
    const id = String(req.params.id)
    const s = await pool.query(`SELECT title FROM lt_demo_sessions WHERE id=$1 AND agent_id=$2`, [id, agentId])
    if (s.rowCount === 0) return res.status(404).json({ error: 'not found' })

    const sc = await pool.query<{ script: ScriptShape }>(
      `SELECT script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [id]
    )
    const props = await pool.query<{ project_id: string; name: string }>(
      `SELECT project_id::text, snapshot->>'name' AS name
         FROM lt_session_properties WHERE session_id=$1 ORDER BY sort_order`,
      [id]
    )
    const nameById = new Map(props.rows.map((p) => [p.project_id, p.name]))
    const script = sc.rows[0]?.script

    const flow: Array<{ id: string; group: string; kind: string; narration: string }> = []
    if (script) {
      if (script.intro?.id) flow.push({ id: script.intro.id, group: '开场', kind: 'intro', narration: script.intro.narration || '' })
      for (const act of script.acts || []) {
        const gname = (act.property_id && nameById.get(act.property_id)) || '楼盘'
        for (const beat of act.beats || []) {
          if (beat?.id) flow.push({ id: beat.id, group: gname, kind: beat.kind || 'beat', narration: beat.narration || '' })
        }
      }
      if (script.outro?.id) flow.push({ id: script.outro.id, group: '结尾', kind: 'outro', narration: script.outro.narration || '' })
    }
    res.json({ title: s.rows[0].title, flow })
  } catch (err) {
    console.error('[luna] agent script error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * Update a session's title and/or beat narration (MVP edit).
 * body: { title?, narration?: { [beatId]: text } }
 * Editing narration clears that beat's pre-generated audio_url so the player
 * falls back to browser TTS reading the NEW text (avoids audio/text desync).
 */
router.patch('/sessions/:id', async (req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const agentId = await currentAgentId()
    const id = String(req.params.id)
    const own = await client.query(`SELECT 1 FROM lt_demo_sessions WHERE id=$1 AND agent_id=$2`, [id, agentId])
    if (own.rowCount === 0) {
      client.release()
      return res.status(404).json({ error: 'not found' })
    }
    const b = (req.body || {}) as Record<string, unknown>
    const title = typeof b.title === 'string' ? b.title.trim() : undefined
    const narration =
      b.narration && typeof b.narration === 'object' ? (b.narration as Record<string, unknown>) : null

    await client.query('BEGIN')
    if (title) await client.query(`UPDATE lt_demo_sessions SET title=$1 WHERE id=$2`, [title, id])

    if (narration && Object.keys(narration).length) {
      const sc = await client.query<{ id: string; script: ScriptShape }>(
        `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1`,
        [id]
      )
      for (const row of sc.rows) {
        const script = row.script
        let changed = false
        const apply = (beat?: ScriptBeat) => {
          if (!beat?.id) return
          const next = narration[beat.id]
          if (typeof next === 'string' && next.trim() && next !== beat.narration) {
            beat.narration = next.trim()
            beat.audio_url = '' // stale audio → browser TTS reads new text
            changed = true
          }
        }
        apply(script.intro)
        for (const act of script.acts || []) for (const beat of act.beats || []) apply(beat)
        apply(script.outro)
        if (changed) {
          await client.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(script), row.id])
        }
      }
    }
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    console.error('[luna] agent patch error:', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'update failed' })
  } finally {
    client.release()
  }
})

export default router
