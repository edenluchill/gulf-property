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
import { GoogleGenAI } from '@google/genai'
import pool from '../db/pool'
import { getMarketEvidence } from './evidence'

const router = Router()

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

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
      // payload column is NOT NULL DEFAULT '{}' — pass '{}' when we have none.
      [sessionId, visitorId, eventType, projectId, dwellMs, payload ?? '{}', ua || null, ipHash]
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

// ---------------------------------------------------------------------------
// Live Q&A token (§4.6). Issues an ephemeral Gemini Live token + a system
// instruction PARAMETERIZED with the agent identity, the property currently in
// view, and what's been narrated so far — so Luna answers in-context with the
// same voice (Aoede). Reuses the exact Live mechanism as the main voice
// assistant; only the system instruction is tour-specific. Best-effort; usage
// minutes are metered client-side via /event (ask) + can roll up to
// usage_counters later. Delete with the rest of luna-tour to remove.
// ---------------------------------------------------------------------------

function buildTourSystemInstruction(opts: {
  agentName?: string
  language?: string
  propertyName?: string
  propertyArea?: string
  spokenSoFar?: string
}): string {
  const lang =
    opts.language === 'en'
      ? 'Respond in English, concise and natural.'
      : opts.language === 'ar'
      ? 'أجب بالعربية، بإيجاز وبشكل طبيعي.'
      : '用中文回复，简洁自然。'
  const agent = opts.agentName || 'David'
  const prop = opts.propertyName
    ? `客户当前正在看的房源:「${opts.propertyName}」${opts.propertyArea ? `(${opts.propertyArea})` : ''}。`
    : ''
  const said = opts.spokenSoFar ? `导览里已经讲过:${opts.spokenSoFar.slice(0, 500)}。避免重复。` : ''
  return `你是 Luna,迪拜房产经纪 ${agent} 的 AI 助手,正在一段为客户定制的看房导览里实时回答客户的提问。
${prop}
${said}
${lang}
要求:
- 你就是导览里那个声音的延续,语气温柔、专业、像真人,不要像客服。
- 客户问到位置/距离/配套/价格/投资时,优先调用地图工具把答案画在地图上(measure_distance / amenity_spokes / fly_to / toggle_transport 等),边说边展示。
- 只基于真实数据回答;不要承诺或保证回报率/升值;不要说「抱歉/对不起/无法」,而是正面引导。
- 回答简短,结束后可以问客户「还想看下一个吗?」`
}

router.post('/public/v/:code/live-token', async (req: Request, res: Response) => {
  try {
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
    const code = String(req.params.code || '').trim()
    const b = (req.body || {}) as Record<string, unknown>

    // resolve session for agent identity + language (only public-safe fields)
    const sres = await pool.query(
      `SELECT s.title, a.display_name AS agent_name,
              (SELECT language FROM lt_tour_scripts WHERE session_id = s.id ORDER BY (language='zh') DESC LIMIT 1) AS language
         FROM lt_demo_sessions s JOIN lt_agents a ON a.id = s.agent_id
        WHERE s.share_code = $1 AND s.is_published = true LIMIT 1`,
      [code]
    )
    if (sres.rowCount === 0) return res.status(404).json({ error: 'not found' })
    const row = sres.rows[0]

    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const token = await client.authTokens.create({
      config: { uses: 1, expireTime, newSessionExpireTime, httpOptions: { apiVersion: 'v1alpha' } },
    })

    res.json({
      token: token.name,
      expiresAt: expireTime,
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      systemInstruction: buildTourSystemInstruction({
        agentName: row.agent_name,
        language: row.language || 'zh',
        propertyName: typeof b.property_name === 'string' ? b.property_name : undefined,
        propertyArea: typeof b.property_area === 'string' ? b.property_area : undefined,
        spokenSoFar: typeof b.spoken_so_far === 'string' ? b.spoken_so_far : undefined,
      }),
    })
  } catch (err) {
    console.error('[luna] live-token error:', err)
    res.status(500).json({ error: 'Failed to generate live token' })
  }
})

/**
 * Image proxy with CORS — lets the tour map load property thumbnails as WebGL
 * textures (R2 public URLs don't send Access-Control-Allow-Origin, so a browser
 * canvas/GL can't use them directly). Only proxies the known R2 public host.
 *   GET /api/luna/public/img?u=<encoded R2 url>
 */
router.get('/public/img', async (req: Request, res: Response) => {
  try {
    const url = String(req.query.u || '')
    if (!/^https:\/\/pub-[a-z0-9]+\.r2\.dev\/[^\s]+$/i.test(url)) {
      return res.status(400).json({ error: 'invalid image url' })
    }
    const upstream = await fetch(url)
    if (!upstream.ok) return res.status(upstream.status).end()
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Cache-Control', 'public, max-age=86400')
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.send(buf)
  } catch (err) {
    console.error('[luna] img proxy error:', err)
    res.status(502).end()
  }
})

/**
 * E1 evidence: real, citable DLD market data for a property (last-30d sales
 * volume, median AED/sqft, recent comparables). Project-first, area fallback.
 *   GET /api/luna/public/evidence?project=<name>&area=<name>&windowDays=30
 */
router.get('/public/evidence', async (req: Request, res: Response) => {
  try {
    const projectName = req.query.project ? String(req.query.project) : null
    const areaName = req.query.area ? String(req.query.area) : null
    if (!projectName && !areaName) return res.status(400).json({ error: 'project or area required' })
    const windowDays = Math.min(180, Math.max(7, Number(req.query.windowDays) || 30))
    const ev = await getMarketEvidence({ projectName, areaName, windowDays })
    res.set('Cache-Control', 'public, max-age=3600')
    res.json({ evidence: ev })
  } catch (err) {
    console.error('[luna] evidence error:', err)
    res.status(500).json({ error: 'evidence failed' })
  }
})

export default router
