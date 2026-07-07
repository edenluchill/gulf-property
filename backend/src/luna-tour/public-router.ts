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
import { createHash, randomBytes } from 'crypto'
import { GoogleGenAI } from '@google/genai'
import pool from '../db/pool'
import { optionalAuth } from '../middleware/auth'
import { isOwnerEmail } from '../middleware/requireOwner'
import { checkCredits, spend, creditError } from './credits'
import { getMarketEvidence } from './evidence'
import { getProjectInsights, getProjectTransactions } from '../services/projectInsights'

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

/**
 * Public agent-branded project report → /r/:code.
 * Bundles agent branding + project detail + insights + recent DLD comps + area
 * supply pipeline. No auth.
 */
router.get('/public/project-report/:code', async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code)
    const rr = await pool.query(
      `SELECT pr.project_id, pr.title,
              a.display_name AS agent_name, a.photo_url AS agent_photo,
              a.phone AS agent_phone, a.whatsapp AS agent_whatsapp, a.brand AS agent_brand
         FROM lt_project_reports pr JOIN lt_agents a ON a.id = pr.agent_id
        WHERE pr.share_code = $1 AND pr.is_published = true LIMIT 1`,
      [code]
    )
    if (rr.rowCount === 0) return res.status(404).json({ error: 'report not found' })
    const rep = rr.rows[0]
    pool.query('UPDATE lt_project_reports SET view_count=view_count+1 WHERE share_code=$1', [code]).catch(() => {})

    const pr = await pool.query(
      `SELECT id, project_name, area, developer, status, latitude, longitude,
              starting_price, min_price, max_price, min_bedrooms, max_bedrooms,
              completion_date, primary_image, project_images, amenities
         FROM residential_projects WHERE id = $1`,
      [rep.project_id]
    )
    if (pr.rowCount === 0) return res.status(404).json({ error: 'project not found' })
    const project = pr.rows[0]

    const [insights, tx] = await Promise.all([
      getProjectInsights(rep.project_id).catch(() => null),
      getProjectTransactions(rep.project_id).catch(() => null),
    ])

    // Area supply pipeline (the new signal) for the project's matched area.
    let supply: any = null
    const areaId = insights?.area?.id
    if (areaId) {
      const s = await pool.query(
        `SELECT pipeline_projects, units_pipeline, avg_completion_pct, units_handover_1y, units_handover_1_3y
           FROM v_area_supply WHERE dubai_area_id = $1`, [areaId]
      ).catch(() => null)
      supply = s?.rows?.[0] || null
    }

    res.set('Cache-Control', 'public, max-age=600')
    res.json({
      report: { title: rep.title },
      agent: {
        name: rep.agent_name, photo: rep.agent_photo,
        phone: rep.agent_phone, whatsapp: rep.agent_whatsapp, brand: rep.agent_brand || {},
      },
      project,
      insights,
      transactions: tx,
      supply,
    })
  } catch (err) {
    console.error('[luna] project-report error:', err)
    res.status(500).json({ error: 'report failed' })
  }
})

// ---------------------------------------------------------------------------
// 付款计划分享(/pp/:code)——经纪选户型 + 填实际报价,客户免登录查看。
// 开发商开盘只给起价,不同楼层/朝向价格不同,所以总价由经纪手填。
// ---------------------------------------------------------------------------

/** Short, human-friendly random code (no ambiguous chars like 0/o/1/l). */
function payShareCode(len = 6): string {
  const alpha = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += alpha[bytes[i] % alpha.length]
  return s
}

/** 户型快照字段白名单(客户端传来的展示值,只收敛类型与长度,不回查户型表:
 *  报价单要的是"生成那一刻"的快照,户型价格/图后续改动不应影响已发出的 offer)。 */
function sanitizeUnitSnapshot(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  const snap = {
    name: str(u.name, 120),
    bedrooms: num(u.bedrooms) ?? (u.bedrooms === 0 ? 0 : null),
    area: str(u.area, 40),                 // 保留原字符串(可能带 "sq.ft" 等)
    builtUpArea: str(u.builtUpArea, 40),
    balconyArea: str(u.balconyArea, 40),
    view: str(u.view, 120),
    floorPlanImage: str(u.floorPlanImage, 500),
    image: str(u.image, 500),
  }
  return Object.values(snap).some((v) => v != null) ? snap : null
}

/** 自定义付款周期(可谈):[{name, pct, months}],months = 距上一期的月数
 *  (首期 0 = 签约时;null = 未填)。比例合计必须 ≈100 才接受。
 *  经纪在弹窗里从项目默认计划改出来的快照;无效返回 null 由调用方 400。 */
function sanitizePlanSnapshot(raw: unknown): Array<{ name: string; pct: number; months: number | null }> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) return null
  const rows = raw
    .map((r) => {
      const o = (r || {}) as Record<string, unknown>
      const pct = Number(o.pct)
      const months = Number(o.months)
      return {
        name: typeof o.name === 'string' ? o.name.trim().slice(0, 120) : '',
        pct: Math.round(pct * 100) / 100,
        months: Number.isFinite(months) && months >= 0 && months <= 240 ? Math.round(months) : null,
      }
    })
    .filter((r) => Number.isFinite(r.pct) && r.pct > 0 && r.pct <= 100)
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.pct, 0)
  if (Math.abs(total - 100) > 0.51) return null
  return rows
}

/** 生成付款计划 Sales Offer。body: { projectId, unitName?, bedrooms?, price, originalPrice?, unit?, plan?, lang? }
 *  2026-07-06 起为订阅经纪专属(minPlan rookie,owner 豁免)——不再匿名可建。
 *  optionalAuth 必带:attachContext 只在配了 SUPABASE_JWT_SECRET 时本地填
 *  ctx.email,否则 token 挂在 _deferredToken 上——不远程回退就会把已登录
 *  用户 401(2026-07-07 实锤)。 */
router.post('/public/payplan', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { projectId, unitName, bedrooms, price, originalPrice, unit, plan, lang } = req.body || {}
    const p = Number(price)
    if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(projectId))) {
      return res.status(400).json({ error: 'invalid projectId' })
    }
    if (!Number.isFinite(p) || p < 10_000 || p > 5_000_000_000) {
      return res.status(400).json({ error: 'invalid price' })
    }

    // 订阅门:登录 → lt_agents → checkCredits(套餐门,0 积分)。
    const email = (req.ctx?.email || '').toLowerCase()
    if (!email) {
      return res.status(401).json({ error: '请先登录经纪账户', code: 'login_required' })
    }
    const a = await pool.query(`SELECT id FROM lt_agents WHERE lower(email) = $1 LIMIT 1`, [email])
    const agentId: string | null = a.rows[0]?.id || null
    if (!agentId) {
      return res.status(402).json({
        success: false, error: 'Sales Offer 报价单是订阅经纪功能,选择套餐即可解锁。',
        code: 'subscription_required', upgradeUrl: '/pricing',
      })
    }
    const check = await checkCredits(agentId, 'payplan')
    if (!check.allowed) {
      const e = creditError('payplan', check)
      return res.status(e.status).json(e.body)
    }

    const proj = await pool.query(
      `SELECT 1 FROM residential_projects WHERE id = $1 AND payment_plan IS NOT NULL`,
      [projectId]
    )
    if (proj.rowCount === 0) return res.status(404).json({ error: 'project not found' })

    // 原价:仅在有效且高于实际报价时保留(分享页据此渲染折扣行;≤ 报价则无意义)
    const op = Number(originalPrice)
    const origPrice = Number.isFinite(op) && op > p && op <= 5_000_000_000 ? Math.round(op) : null

    // 自定义付款周期:传了就必须合法(合计 100%),否则明确报错而非静默丢弃
    let planSnapshot: ReturnType<typeof sanitizePlanSnapshot> = null
    if (plan != null) {
      planSnapshot = sanitizePlanSnapshot(plan)
      if (!planSnapshot) {
        return res.status(400).json({ error: '付款周期不合法:各期比例合计需为 100%' })
      }
    }
    const unitSnap = sanitizeUnitSnapshot(unit)
    const cleanUnitName = String(unitName || '').slice(0, 120) || null

    // 去重:同经纪 + 同项目 + 同参数的报价单直接复用已有链接(经纪来回点
    // "重新生成"不炸表也不重复扣分;参数任一变化才建新行)。只复用未过期的
    // ——过期报价单是历史记录,重新生成应给一份新的 60 天有效期。
    const dup = await pool.query<{ share_code: string }>(
      `SELECT share_code FROM lt_payment_shares
        WHERE agent_id = $1 AND project_id = $2 AND price = $3
          AND unit_name IS NOT DISTINCT FROM $4
          AND original_price IS NOT DISTINCT FROM $5
          AND plan_snapshot IS NOT DISTINCT FROM $6::jsonb
          AND unit_snapshot IS NOT DISTINCT FROM $7::jsonb
          AND created_at > now() - interval '60 days'
        ORDER BY created_at DESC LIMIT 1`,
      [agentId, projectId, Math.round(p), cleanUnitName, origPrice,
        planSnapshot ? JSON.stringify(planSnapshot) : null,
        unitSnap ? JSON.stringify(unitSnap) : null]
    )
    if (dup.rows[0]?.share_code) {
      return res.json({ code: dup.rows[0].share_code, reused: true })
    }

    let code = payShareCode(6)
    for (let i = 0; i < 8; i++) {
      const { rowCount } = await pool.query(`SELECT 1 FROM lt_payment_shares WHERE share_code = $1`, [code])
      if (rowCount === 0) break
      code = i === 7 ? payShareCode(8) : payShareCode(6)
    }

    await pool.query(
      `INSERT INTO lt_payment_shares (share_code, project_id, agent_id, unit_name, bedrooms, price, original_price, unit_snapshot, plan_snapshot, lang, created_by_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        code,
        projectId,
        agentId,
        cleanUnitName,
        Number.isFinite(Number(bedrooms)) ? Math.round(Number(bedrooms)) : null,
        Math.round(p),
        origPrice,
        unitSnap,
        planSnapshot ? JSON.stringify(planSnapshot) : null,
        lang === 'en' ? 'en' : 'zh',
        email || null,
      ]
    )
    await spend(agentId, 'payplan')  // credits 0 → no-op,留着与其它功能一致
    res.json({ code })
  } catch (err) {
    console.error('[luna] payplan create error:', err)
    res.status(500).json({ error: 'create failed' })
  }
})

/** Public payment-plan quote → /pp/:code. */
router.get('/public/payplan/:code', async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code)
    const r = await pool.query(
      `SELECT ps.project_id, ps.agent_id, ps.unit_name, ps.bedrooms, ps.price, ps.original_price, ps.unit_snapshot,
              ps.plan_snapshot, ps.lang, ps.created_at,
              a.display_name AS agent_name, a.photo_url AS agent_photo,
              a.phone AS agent_phone, a.whatsapp AS agent_whatsapp,
              a.email AS agent_email, a.billing_agent_id AS agent_billing_id
         FROM lt_payment_shares ps
         LEFT JOIN lt_agents a ON a.id = ps.agent_id
        WHERE ps.share_code = $1 LIMIT 1`,
      [code]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' })
    const s = r.rows[0]

    // 60 天过期(2026-07-07 用户定):行保留作生成记录,页面转"联系顾问获取
    // 最新报价"——价格本就随时调整,过期反而是经纪的回访机会。
    const ageDays = (Date.now() - new Date(s.created_at).getTime()) / 86_400_000
    if (ageDays > 60) {
      const pn = await pool.query<{ project_name: string }>(
        `SELECT project_name FROM residential_projects WHERE id = $1`, [s.project_id]
      )
      return res.status(410).json({
        expired: true,
        lang: s.lang,
        projectName: pn.rows[0]?.project_name || null,
        agent: s.agent_name
          ? { name: s.agent_name, photo: s.agent_photo, phone: s.agent_phone, whatsapp: s.agent_whatsapp }
          : null,
      })
    }

    pool.query('UPDATE lt_payment_shares SET view_count=view_count+1 WHERE share_code=$1', [code]).catch(() => {})

    const pr = await pool.query(
      `SELECT id, project_name, developer, area, status, completion_date, handover_date,
              primary_image, project_images, payment_plan
         FROM residential_projects WHERE id = $1`,
      [s.project_id]
    )
    if (pr.rowCount === 0) return res.status(404).json({ error: 'project not found' })
    const project = pr.rows[0]

    // 经纪段位 → 报价单上的认证盖章(rookie=认证经纪人 / agent=金牌PRO /
    // founder=认证经纪公司 / developer=认证开发商;owner 视同 founder;
    // 席位成员看团队的套餐)。查当前生效订阅,无订阅 = 不盖章。
    let agentTier: string | null = null
    if (s.agent_id) {
      if (isOwnerEmail(s.agent_email)) {
        agentTier = 'founder'
      } else {
        const billingId = s.agent_billing_id || s.agent_id
        const sub = await pool.query<{ plan_id: string }>(
          `SELECT plan_id FROM lt_subscriptions
             WHERE agent_id = $1 AND status IN ('active','trialing')
             ORDER BY created_at DESC LIMIT 1`,
          [billingId]
        )
        agentTier = sub.rows[0]?.plan_id || null
      }
    }

    res.set('Cache-Control', 'public, max-age=300')
    res.json({
      share: {
        unitName: s.unit_name,
        bedrooms: s.bedrooms,
        price: Number(s.price),
        originalPrice: s.original_price != null ? Number(s.original_price) : null,
        unitSnapshot: s.unit_snapshot || null,
        planSnapshot: s.plan_snapshot || null,
        code,
        lang: s.lang,
        createdAt: s.created_at,
      },
      project: {
        id: project.id,
        name: project.project_name,
        developer: project.developer,
        area: project.area,
        status: project.status,
        completionDate: project.completion_date,
        handoverDate: project.handover_date,
        image: project.primary_image || project.project_images?.[0] || null,
        paymentPlan: project.payment_plan || [],
      },
      agent: s.agent_name
        ? { name: s.agent_name, photo: s.agent_photo, phone: s.agent_phone, whatsapp: s.agent_whatsapp, tier: agentTier }
        : null,
    })
  } catch (err) {
    console.error('[luna] payplan read error:', err)
    res.status(500).json({ error: 'read failed' })
  }
})

/** Public comprehensive client investment proposal → /cr/:code. */
router.get('/public/client-report/:code', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT cr.status, cr.report, cr.client_name,
              a.display_name AS agent_name, a.photo_url AS agent_photo, a.phone AS agent_phone, a.whatsapp AS agent_whatsapp
         FROM lt_client_reports cr JOIN lt_agents a ON a.id = cr.agent_id
        WHERE cr.share_code = $1 LIMIT 1`,
      [req.params.code]
    )
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' })
    const row = r.rows[0]
    if (row.status !== 'ready') return res.json({ status: row.status })
    pool.query('UPDATE lt_client_reports SET view_count=view_count+1 WHERE share_code=$1', [req.params.code]).catch(() => {})
    res.set('Cache-Control', 'public, max-age=300')
    res.json({
      status: 'ready',
      agent: { name: row.agent_name, photo: row.agent_photo, phone: row.agent_phone, whatsapp: row.agent_whatsapp },
      report: row.report,
    })
  } catch (err) {
    console.error('[luna] client-report error:', err)
    res.status(500).json({ error: 'report failed' })
  }
})

export default router
