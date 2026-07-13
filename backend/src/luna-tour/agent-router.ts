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
import path from 'path'
import multer from 'multer'
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { uploadBufferToR2 } from '../services/r2-storage'
import { createSession, ensureAgent } from './session-builder'
import { generateClientReport, generateCompareReport, initialProgress } from './client-report-builder'
import { draftConfig } from './auto-config'
import { matchProperties } from './auto-match'
import { buildClientReport } from './auto-report'
import { reviseNarration } from './revise'
import { generateSessionAudio } from './audio-pipeline'
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase'
import { checkCredits, spend, creditError, creditBalance, featureCatalog } from './credits'
import { coachProfile, saveProfile, loadProfile, profileToOneLiner, type ExtractedProfile } from './client-profile-coach'

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

// Media upload (sea-view / interior clips) → R2. Memory storage, 60MB cap (fits
// under the api.pinzos.com Cloudflare 100MB limit); video + image only.
const MEDIA_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}
const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, !!MEDIA_EXT[file.mimetype]),
})

async function demoAgentId(): Promise<string> {
  return ensureAgent({
    email: DEMO_AGENT_EMAIL,
    displayName: 'David Chen',
    phone: '+971500000000',
    whatsapp: '971500000000',
    photoUrl: 'https://i.pravatar.cc/200?img=12',
    brand: { title: 'Emaar 置业顾问', whatsapp: '971500000000', accent: '#00E0B8' },
  })
}

/**
 * Resolve the working agent. If a valid Supabase token is present → that agent
 * (find-or-create by email, linked to auth_user_id), so each logged-in agent
 * only sees their own data. Otherwise → the shared demo agent (anonymous / demo
 * / Supabase off), keeping the public demo working. Soft = backward compatible.
 */
async function currentAgentId(req: Request): Promise<string> {
  if (isSupabaseConfigured) {
    const h = req.headers.authorization
    const token = h && h.startsWith('Bearer ') ? h.substring(7) : null
    if (token) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token)
        if (user?.email) {
          return ensureAgent({
            email: user.email,
            displayName: (user.user_metadata?.name as string) || user.email.split('@')[0],
            authUserId: user.id,
            brand: { title: '置业顾问', accent: '#00E0B8' },
          })
        }
      } catch {
        /* fall through to demo */
      }
    }
  }
  return demoAgentId()
}

/** 该请求是否为真实登录经纪(共享 demo 经纪豁免配额)。 */
function isLoggedIn(req: Request): boolean {
  return isSupabaseConfigured && !!req.headers.authorization?.startsWith('Bearer ')
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

/** Share code unique within lt_project_reports. */
async function uniqueReportCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(6)
    const { rowCount } = await pool.query('SELECT 1 FROM lt_project_reports WHERE share_code=$1', [code])
    if (rowCount === 0) return code
  }
  return randomCode(8)
}

// ── Agent-branded per-project shareable reports ────────────────────────────
/** Create (or fetch the existing) shareable report for a project → /r/:code. */
router.post('/project-reports', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const projectId = String(req.body?.projectId || '').trim()
    if (!projectId) return res.status(400).json({ success: false, error: 'projectId required' })
    const p = await pool.query('SELECT id, project_name FROM residential_projects WHERE id=$1', [projectId])
    if (p.rowCount === 0) return res.status(404).json({ success: false, error: 'project not found' })

    const existing = await pool.query('SELECT share_code FROM lt_project_reports WHERE agent_id=$1 AND project_id=$2', [agentId, projectId])
    let code: string
    if (existing.rowCount && existing.rows[0]) {
      code = existing.rows[0].share_code // 复用已生成的报告 — 不计额度
    } else {
      // 新建报告才走配额门 + 计量(共享 demo 经纪豁免)
      const loggedIn = isLoggedIn(req)
      if (loggedIn) {
        const q = await checkCredits(agentId, 'reports')
        if (!q.allowed) { const e = creditError('reports', q); return res.status(e.status).json(e.body) }
      }
      code = await uniqueReportCode()
      await pool.query(
        'INSERT INTO lt_project_reports (agent_id, project_id, share_code, title) VALUES ($1,$2,$3,$4)',
        [agentId, projectId, code, p.rows[0].project_name]
      )
      if (loggedIn) await spend(agentId, 'reports', { type: 'project_report', id: code, label: p.rows[0].project_name }).catch(() => {})
    }
    res.json({ success: true, shareCode: code, url: `/r/${code}` })
  } catch (err) {
    console.error('[agent/project-reports] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

// ── Client profiles (lightweight CRM) ─────────────────────────────────────
router.post('/clients', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, string>
    const name = String(b.name || '').trim()
    if (!name) return res.status(400).json({ success: false, error: '客户姓名必填' })
    const r = await pool.query(
      `INSERT INTO lt_clients (agent_id, name, avatar_url, background, budget, expectations, traits)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [agentId, name, b.avatar_url || null, b.background || null, b.budget || null, b.expectations || null, b.traits || null]
    )
    res.json({ success: true, id: r.rows[0].id })
  } catch (err) { console.error('[agent/clients create]', err); res.status(500).json({ success: false, error: 'internal error' }) }
})

router.put('/clients/:id', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, string>
    await pool.query(
      `UPDATE lt_clients SET name=COALESCE(NULLIF($3,''),name), avatar_url=$4, background=$5, budget=$6,
              expectations=$7, traits=$8, updated_at=now() WHERE id=$2 AND agent_id=$1`,
      [agentId, req.params.id, b.name || '', b.avatar_url || null, b.background || null, b.budget || null, b.expectations || null, b.traits || null]
    )
    res.json({ success: true })
  } catch (err) { res.status(500).json({ success: false, error: 'internal error' }) }
})

/**
 * 画像教练:自由笔记 → 结构化画像 + 「还缺什么」(带可点选项)。
 *
 * **手动触发**(经纪点「AI 检查画像」),不是每次输入都调 —— LLM 只在这里用一次
 * (Gemini Flash 抽取,~几百 token)。问题和选项是模板,0 LLM。
 * 缺信息只提醒,**不阻塞生成** —— 画像糙则报告糙,那是经纪的选择。
 *
 * 不扣积分:成本 < $0.001,而它的整个目的是让后面那份 20 积分的报告更准 ——
 * 为几厘钱去阻止一个提升主产品质量的动作,不划算。节流兜底(见下)。
 */
const coachThrottle = new Map<string, number>()
router.post('/clients/profile-coach', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const { text, client_id } = (req.body || {}) as { text?: string; client_id?: string }

    // 节流:同一经纪 5 秒一次(防连点/脚本刷)。零成本,够用。
    const last = coachThrottle.get(agentId) || 0
    if (Date.now() - last < 5000) return res.status(429).json({ success: false, error: '慢一点，5 秒后再试' })
    coachThrottle.set(agentId, Date.now())

    // 已有画像:已经知道的不再问(问过一次就别再烦他)
    const existing = client_id ? await loadProfile(client_id, agentId) : {}
    const r = await coachProfile(String(text || ''), existing)
    res.json({ success: true, ...r })
  } catch (err) {
    console.error('[agent/profile-coach]', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** 保存画像(结构化字段 + 笔记)→ 回写 lt_clients。软字段深合并进 preferences。 */
router.put('/clients/:id/profile', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const { profile, note } = (req.body || {}) as { profile?: Record<string, unknown>; note?: string }
    await saveProfile(req.params.id, agentId, (profile || {}) as any, note)
    res.json({ success: true })
  } catch (err) {
    console.error('[agent/clients profile save]', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** 读回完整画像(硬列 + preferences 软字段)—— 报告页选客户时带出来。 */
router.get('/clients/:id/profile', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const p = await loadProfile(req.params.id, agentId)
    res.json({ success: true, profile: p })
  } catch (err) { res.status(500).json({ success: false, error: 'internal error' }) }
})

router.get('/clients', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    // Heat = the client's engagement rolled up across their tour sessions
    // (lt_session_lead_scores: opens/completes/cta/dwell). Turns the list from a
    // static address book into a "who's hot, who to chase" board. Optional ?stage
    // and ?q filters. Matview may lag a refresh cycle — acceptable for a list view.
    const stage = typeof req.query.stage === 'string' ? req.query.stage : ''
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const r = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM lt_client_reports cr WHERE cr.client_id=c.id)         AS report_count,
              (SELECT COUNT(*) FROM lt_client_interactions i WHERE i.client_id=c.id)       AS interaction_count,
              (SELECT MAX(i.created_at) FROM lt_client_interactions i WHERE i.client_id=c.id) AS last_interaction_at,
              (SELECT MIN(i.next_followup_at) FROM lt_client_interactions i
                 WHERE i.client_id=c.id AND i.next_followup_at IS NOT NULL AND i.next_followup_at > now()) AS next_followup_at,
              COALESCE(h.heat,0)::int AS heat,
              h.last_activity_at
         FROM lt_clients c
         LEFT JOIN (
           SELECT client_id, SUM(lead_score) AS heat, MAX(last_seen_at) AS last_activity_at
             FROM lt_session_lead_scores WHERE agent_id=$1 AND client_id IS NOT NULL
            GROUP BY client_id
         ) h ON h.client_id = c.id
        WHERE c.agent_id=$1
          AND ($2='' OR c.pipeline_stage=$2)
          AND ($3='' OR c.name ILIKE '%'||$3||'%' OR COALESCE(c.email,'') ILIKE '%'||$3||'%' OR COALESCE(c.phone,'') ILIKE '%'||$3||'%')
        ORDER BY COALESCE(h.heat,0) DESC, c.updated_at DESC`,
      [agentId, stage, q]
    )
    res.json({ success: true, clients: r.rows })
  } catch (err) { console.error('[agent/clients list]', err); res.status(500).json({ success: false, error: 'internal error' }) }
})

router.get('/clients/:id', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const c = await pool.query('SELECT * FROM lt_clients WHERE id=$1 AND agent_id=$2', [req.params.id, agentId])
    if (c.rowCount === 0) return res.status(404).json({ success: false, error: 'not found' })
    const cid = req.params.id

    const [reports, interactions, heatRow, sessionEvents] = await Promise.all([
      pool.query(
        `SELECT share_code, status, view_count, created_at FROM lt_client_reports WHERE client_id=$1 ORDER BY created_at DESC`,
        [cid]
      ),
      pool.query(
        `SELECT id, kind, note, outcome, next_followup_at, created_at
           FROM lt_client_interactions WHERE client_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [cid, agentId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(lead_score),0)::int AS heat, MAX(last_seen_at) AS last_activity_at,
                COALESCE(SUM(opens),0)::int AS opens, COALESCE(SUM(tour_completes),0)::int AS completes,
                COALESCE(SUM(cta_clicks),0)::int AS cta
           FROM lt_session_lead_scores WHERE agent_id=$1 AND client_id=$2`,
        [agentId, cid]
      ),
      // What the client actually did inside this agent's tours — the engagement
      // signal, joined to project names, for the activity timeline.
      pool.query(
        `SELECT e.event_type, e.created_at, e.dwell_ms, rp.project_name
           FROM lt_engagement_events e
           JOIN lt_demo_sessions s ON s.id = e.session_id AND s.client_id=$1 AND s.agent_id=$2
           LEFT JOIN residential_projects rp ON rp.id = e.project_id
          ORDER BY e.created_at DESC LIMIT 80`,
        [cid, agentId]
      ),
    ])
    res.json({
      success: true,
      client: c.rows[0],
      reports: reports.rows,
      interactions: interactions.rows,
      heat: heatRow.rows[0] || { heat: 0 },
      engagement: sessionEvents.rows,
    })
  } catch (err) { console.error('[agent/clients detail]', err); res.status(500).json({ success: false, error: 'internal error' }) }
})

// Log a follow-up (call/whatsapp/meeting/viewing/note). Optionally schedule the
// next chase + advance the pipeline stage in one shot. agent-isolated.
router.post('/clients/:id/interactions', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const own = await pool.query('SELECT 1 FROM lt_clients WHERE id=$1 AND agent_id=$2', [req.params.id, agentId])
    if (own.rowCount === 0) return res.status(403).json({ success: false, error: 'not authorized' })
    const b = (req.body || {}) as Record<string, unknown>
    const kind = ['note', 'call', 'whatsapp', 'email', 'meeting', 'viewing'].includes(String(b.kind)) ? String(b.kind) : 'note'
    const nextAt = b.next_followup_at ? new Date(String(b.next_followup_at)) : null
    const r = await pool.query(
      `INSERT INTO lt_client_interactions (client_id, agent_id, kind, note, outcome, next_followup_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [req.params.id, agentId, kind, b.note ? String(b.note).slice(0, 4000) : null, b.outcome ? String(b.outcome) : null, nextAt]
    )
    // Optional: advance pipeline stage alongside the interaction.
    if (typeof b.stage === 'string' && b.stage) {
      await pool.query('UPDATE lt_clients SET pipeline_stage=$3, updated_at=now() WHERE id=$1 AND agent_id=$2',
        [req.params.id, agentId, b.stage])
    }
    res.json({ success: true, id: r.rows[0].id, created_at: r.rows[0].created_at })
  } catch (err) { console.error('[agent/clients interaction]', err); res.status(500).json({ success: false, error: 'internal error' }) }
})

// Move a client along the pipeline (new|engaged|viewing|offer|closed|lost).
router.post('/clients/:id/stage', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const stage = String((req.body as Record<string, unknown>)?.stage || '')
    if (!['new', 'engaged', 'viewing', 'offer', 'closed', 'lost'].includes(stage))
      return res.status(400).json({ success: false, error: 'invalid stage' })
    const r = await pool.query('UPDATE lt_clients SET pipeline_stage=$3, updated_at=now() WHERE id=$1 AND agent_id=$2',
      [req.params.id, agentId, stage])
    if (r.rowCount === 0) return res.status(403).json({ success: false, error: 'not authorized' })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ success: false, error: 'internal error' }) }
})

// ── Comprehensive client investment proposals (async + progress + shareable) ──
async function uniqueClientCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode(6)
    const { rowCount } = await pool.query('SELECT 1 FROM lt_client_reports WHERE share_code=$1', [code])
    if (rowCount === 0) return code
  }
  return randomCode(8)
}

/** Assemble a one-liner brief from a client profile (for report/tour matching). */
async function briefFromClient(agentId: string, clientId: string): Promise<{ name: string; brief: string } | null> {
  const c = await pool.query('SELECT name, background, budget, expectations, traits FROM lt_clients WHERE id=$1 AND agent_id=$2', [clientId, agentId])
  if (c.rowCount === 0) return null
  const r = c.rows[0]
  const brief = [r.background, r.budget && `预算 ${r.budget}`, r.expectations && `期待 ${r.expectations}`, r.traits].filter(Boolean).join('，')
  return { name: r.name, brief }
}

/** Kick off a client investment proposal — returns a share code immediately,
 *  builds in the background (poll /client-reports/:code/status for progress). */
router.post('/client-reports', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, unknown>
    let client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    let oneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''

    // ⭐ 结构化画像 —— 「为什么适合他」的全部依据。没有它,AI 只能写套话。
    let profile: ExtractedProfile = (b.profile && typeof b.profile === 'object' ? b.profile : {}) as ExtractedProfile

    // 选了 CRM 客户 → **画像直接从库里带出来**(经纪不用重填)
    const clientId = typeof b.client_id === 'string' ? b.client_id : null
    if (clientId) {
      const [cb, saved] = await Promise.all([
        briefFromClient(agentId, clientId),
        loadProfile(clientId, agentId),
      ])
      if (cb) { client = { name: cb.name }; oneLiner = cb.brief }
      // 请求里带的画像(经纪刚在 wizard 里补的)优先于库里的旧值
      profile = { ...saved, ...profile }
    }

    // 经纪**手选**的项目。他心里早知道要推哪个 —— 缺的是「怎么说服客户这个值得」。
    // 不传才回落到 AI 选盘(可选兵器,给不确定推什么的新人)。
    const projectIds = Array.isArray(b.project_ids)
      ? (b.project_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined

    if (!oneLiner.trim() && !Object.keys(client).length && !Object.keys(profile).length) {
      return res.status(400).json({ success: false, error: '需要客户画像或一句话' })
    }
    // 配额门 + 计量(共享 demo 经纪豁免)
    const loggedIn = isLoggedIn(req)
    if (loggedIn) {
      const q = await checkCredits(agentId, 'reports')
      if (!q.allowed) { const e = creditError('reports', q); return res.status(e.status).json(e.body) }
    }
    const code = await uniqueClientCode()
    const clientName = typeof client.name === 'string' ? client.name : ''
    const r = await pool.query(
      `INSERT INTO lt_client_reports (agent_id, share_code, client_name, brief, status, progress, client_id)
       VALUES ($1,$2,$3,$4,'generating',$5,$6) RETURNING id`,
      [agentId, code, clientName, oneLiner, JSON.stringify(initialProgress()), clientId]
    )
    if (loggedIn) await spend(agentId, 'reports', { type: 'client_report', id: code, label: clientName || undefined }).catch(() => {})
    // fire-and-forget background build
    generateClientReport(r.rows[0].id, client, oneLiner, profile, projectIds)
    res.json({ success: true, shareCode: code, url: `/cr/${code}` })
  } catch (err) {
    console.error('[agent/client-reports] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** Kick off an agent-branded COMPARISON report for a client over hand-picked
 *  projects (2-4). Same async + share_code + /cr/:code page as the proposal,
 *  but kind='compare'. Body: { client_id?, client_name?, project_ids: [] }. */
router.post('/client-reports/compare', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, unknown>
    const projectIds = Array.isArray(b.project_ids) ? b.project_ids.filter((x) => typeof x === 'string').slice(0, 4) as string[] : []
    if (projectIds.length < 2) return res.status(400).json({ success: false, error: '请选择 2-4 个项目对比' })
    const clientId = typeof b.client_id === 'string' ? b.client_id : null

    // Resolve client name + budget from the saved (agent-owned) profile.
    let clientName = typeof b.client_name === 'string' ? b.client_name : ''
    let profile: { budget?: { min: number; max: number } } = {}
    if (clientId) {
      const c = await pool.query('SELECT name, budget_min, budget_max FROM lt_clients WHERE id=$1 AND agent_id=$2', [clientId, agentId])
      if (c.rowCount === 0) return res.status(403).json({ success: false, error: 'not authorized' })
      clientName = c.rows[0].name || clientName
      if (c.rows[0].budget_min || c.rows[0].budget_max)
        profile = { budget: { min: Number(c.rows[0].budget_min) || 0, max: Number(c.rows[0].budget_max) || 0 } }
    }

    const loggedIn = isLoggedIn(req)
    if (loggedIn) {
      const q = await checkCredits(agentId, 'reports')
      if (!q.allowed) { const e = creditError('reports', q); return res.status(e.status).json(e.body) }
    }
    const code = await uniqueClientCode()
    const r = await pool.query(
      `INSERT INTO lt_client_reports (agent_id, share_code, client_name, brief, status, progress, client_id, kind)
       VALUES ($1,$2,$3,$4,'generating',$5,$6,'compare') RETURNING id`,
      [agentId, code, clientName, `对比 ${projectIds.length} 个项目`, JSON.stringify(initialProgress()), clientId]
    )
    if (loggedIn) await spend(agentId, 'reports', { type: 'client_report', id: code, label: clientName || `对比 ${projectIds.length} 个项目` }).catch(() => {})
    generateCompareReport(r.rows[0].id, clientName, projectIds, profile)
    res.json({ success: true, shareCode: code, url: `/cr/${code}` })
  } catch (err) {
    console.error('[agent/client-reports/compare] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** This agent's client proposals (grouped/found by client) — to re-open & re-share. */
router.get('/client-reports', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const r = await pool.query(
      `SELECT share_code, client_name, brief, status, view_count, created_at
         FROM lt_client_reports WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [agentId]
    )
    res.json({ success: true, reports: r.rows })
  } catch (err) {
    console.error('[agent/client-reports list] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** Poll generation status + progress. */
router.get('/client-reports/:code/status', async (req: Request, res: Response) => {
  try {
    const r = await pool.query(
      'SELECT status, progress, client_name FROM lt_client_reports WHERE share_code=$1', [req.params.code]
    )
    if (r.rowCount === 0) return res.status(404).json({ success: false })
    res.json({ success: true, status: r.rows[0].status, progress: r.rows[0].progress, clientName: r.rows[0].client_name })
  } catch (err) {
    res.status(500).json({ success: false })
  }
})

/** List this agent's Sales Offer 报价单生成记录(60 天有效,过期行保留可查)。 */
router.get('/payplans', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const r = await pool.query(
      `SELECT ps.share_code, ps.unit_name, ps.price, ps.original_price, ps.view_count, ps.created_at,
              (ps.created_at < now() - interval '60 days') AS expired,
              rp.project_name
         FROM lt_payment_shares ps
         JOIN residential_projects rp ON rp.id = ps.project_id
        WHERE ps.agent_id = $1
        ORDER BY ps.created_at DESC
        LIMIT 200`,
      [agentId]
    )
    res.json({ success: true, offers: r.rows })
  } catch (err) {
    console.error('[agent/payplans list] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** List this agent's project reports (for the dashboard). */
router.get('/project-reports', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const r = await pool.query(
      `SELECT pr.share_code, pr.title, pr.project_id, pr.view_count, pr.created_at,
              rp.project_name, rp.area, rp.primary_image
         FROM lt_project_reports pr
         JOIN residential_projects rp ON rp.id = pr.project_id
        WHERE pr.agent_id = $1 ORDER BY pr.created_at DESC`,
      [agentId]
    )
    res.json({ success: true, reports: r.rows })
  } catch (err) {
    console.error('[agent/project-reports list] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** This agent's current brand/contact (to prefill the card editor). */
router.get('/profile', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const r = await pool.query('SELECT display_name, phone, whatsapp, photo_url, public_email FROM lt_agents WHERE id=$1', [agentId])
    res.json({ success: true, agent: r.rows[0] || null })
  } catch (err) {
    console.error('[agent/profile get] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** Update this agent's brand/contact (name, phone, whatsapp, photo URL). */
router.post('/profile', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const { display_name, phone, whatsapp, photo_url, public_email } = req.body || {}
    // 公开邮箱:传了就整体覆盖(传空串 = 清掉不显示);格式不像邮箱则拒
    let pubEmail: string | null | undefined = undefined
    if (public_email !== undefined) {
      const v = String(public_email || '').trim().slice(0, 160)
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return res.status(400).json({ success: false, error: '邮箱格式不正确' })
      }
      pubEmail = v || null
    }
    await pool.query(
      `UPDATE lt_agents SET
         display_name = COALESCE(NULLIF($2,''), display_name),
         phone = COALESCE($3, phone), whatsapp = COALESCE($4, whatsapp),
         photo_url = COALESCE(NULLIF($5,''), photo_url),
         public_email = CASE WHEN $6 THEN $7 ELSE public_email END,
         updated_at = now()
       WHERE id = $1`,
      [agentId, display_name ?? '', phone ?? null, whatsapp ?? null, photo_url ?? '', pubEmail !== undefined, pubEmail ?? null]
    )
    const r = await pool.query('SELECT display_name, phone, whatsapp, photo_url, public_email FROM lt_agents WHERE id=$1', [agentId])
    res.json({ success: true, agent: r.rows[0] })
  } catch (err) {
    console.error('[agent/profile] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** Upload an agent avatar → R2 → lt_agents.photo_url. */
router.post('/avatar', multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file'), async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const f = (req as any).file
    if (!f?.buffer) return res.status(400).json({ success: false, error: 'no file' })
    if (!/^image\/(jpeg|png|webp)$/.test(f.mimetype)) return res.status(400).json({ success: false, error: 'jpeg/png/webp only' })
    const ext = f.mimetype.split('/')[1].replace('jpeg', 'jpg')
    const url = await uploadBufferToR2(`agent-photos/${agentId}.${ext}`, f.buffer, f.mimetype)
    await pool.query('UPDATE lt_agents SET photo_url=$2, updated_at=now() WHERE id=$1', [agentId, url])
    res.json({ success: true, photoUrl: url })
  } catch (err) {
    console.error('[agent/avatar] error:', err)
    res.status(500).json({ success: false, error: 'upload failed' })
  }
})

// ── 可验证证书登记(证书二维码 → 公开 /verify 页)──────────────
// credential_id 由 姓名|档位 派生(与前端 roleBadge.certNumber 同算法)。
const CERT_TITLES: Record<string, string> = {
  rookie: 'Pinzos Member',
  agent: 'Pinzos Pro Member',
  founder: 'Pinzos Agency Partner',
  developer: 'Pinzos Developer Partner',
}
function certHash(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return String(h % 1000000).padStart(6, '0')
}

/** 登记/更新当前经纪的认证凭证(打开证书弹窗时前端调用;幂等)。返回 credentialId。 */
router.post('/certificate', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const a = await pool.query<{ display_name: string | null }>('SELECT display_name FROM lt_agents WHERE id=$1', [agentId])
    const name = (a.rows[0]?.display_name || 'Agent').trim()
    const sub = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM lt_subscriptions WHERE agent_id=$1 AND status IN ('active','trialing') ORDER BY created_at DESC LIMIT 1`,
      [agentId]
    )
    const plan = sub.rows[0]?.plan_id || 'rookie'
    const title = CERT_TITLES[plan] || 'Pinzos Member'
    const credentialId = `PZ-${new Date().getFullYear()}-${certHash(`${name}|${plan}`)}`
    await pool.query(
      `INSERT INTO lt_certificates (credential_id, agent_id, holder_name, plan_id, cert_title)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (credential_id) DO UPDATE SET holder_name=EXCLUDED.holder_name, cert_title=EXCLUDED.cert_title, plan_id=EXCLUDED.plan_id`,
      [credentialId, agentId, name, plan, title]
    )
    res.json({ success: true, credentialId, holderName: name, certTitle: title })
  } catch (err) {
    console.error('[agent/certificate] error:', err)
    res.status(500).json({ success: false, error: 'internal error' })
  }
})

/** This agent's monthly usage (for the dashboard quota meter). */
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    res.json(await creditBalance(agentId)) // { creditsMonth, used, balance, plan, status, multiplier }
  } catch (err) {
    console.error('[luna] usage error:', err)
    res.status(500).json({ error: 'usage failed' })
  }
})

/**
 * 逐笔积分使用记录(「使用记录」tab)。
 * 展示规则(用户定):席位成员只看自己(actor_agent_id=我);
 * 团队 owner(billing_agent_id IS NULL)看整个共享池(agent_id=我,带操作人名字)。
 * query: ?feature=luna_tours&limit=100
 */
router.get('/ledger', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    // 我是席位成员吗?成员 → billing_agent_id 指向 founder。
    const me = await pool.query<{ billing_agent_id: string | null }>(
      `SELECT billing_agent_id FROM lt_agents WHERE id = $1`, [agentId]
    )
    const isMember = !!me.rows[0]?.billing_agent_id
    // 成员:仅自己;owner/独立:整个计费归属池(agent_id = 我 = founder 池)
    const scopeCol = isMember ? 'l.actor_agent_id' : 'l.agent_id'

    const feature = typeof req.query.feature === 'string' ? req.query.feature : null
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
    const params: unknown[] = [agentId]
    let where = `${scopeCol} = $1`
    if (feature) { params.push(feature); where += ` AND l.feature = $${params.length}` }
    params.push(limit)

    const { rows } = await pool.query(
      `SELECT l.id, l.feature, l.credits, l.ref_type, l.ref_id, l.ref_label, l.created_at,
              l.actor_agent_id, a.display_name AS actor_name
         FROM lt_credit_ledger l
         LEFT JOIN lt_agents a ON a.id = l.actor_agent_id
        WHERE ${where}
        ORDER BY l.created_at DESC
        LIMIT $${params.length}`,
      params
    )
    // pool=true → 展示"操作人"列(owner 看团队);feature 目录给前端做图标/中文名
    res.json({ success: true, pool: !isMember, entries: rows, features: featureCatalog() })
  } catch (err) {
    console.error('[luna] ledger error:', err)
    res.status(500).json({ success: false, error: 'ledger failed' })
  }
})

// ── 共享线索池 + 认领(shared leads pool + claim)──────────────────────
// 单一经纪公司运营,不做自动分发:所有经纪看到未认领池,认领归自己,再转客户。

/** 线索池:未认领的 + 我已认领的(未转客户的)。按分数高→低。 */
router.get('/leads', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, whatsapp, source, intent, lead_score, status,
              last_seen_at, created_at, assigned_agent_id, assigned_at, converted_client_id
         FROM leads
        WHERE converted_client_id IS NULL
          AND (assigned_agent_id IS NULL OR assigned_agent_id = $1)
        ORDER BY (assigned_agent_id = $1) ASC, lead_score DESC, created_at DESC
        LIMIT 200`,
      [agentId]
    )
    res.json({ success: true, leads: rows })
  } catch (err) {
    console.error('[luna] leads list error:', err)
    res.status(500).json({ success: false, error: 'leads failed' })
  }
})

/** 认领一条线索(仅未认领时;并发下已被别人领走则 409)。 */
router.post('/leads/:id/claim', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const r = await pool.query(
      `UPDATE leads SET assigned_agent_id = $1, assigned_at = now()
         WHERE id = $2 AND assigned_agent_id IS NULL
       RETURNING id`,
      [agentId, req.params.id]
    )
    if (!r.rowCount) return res.status(409).json({ success: false, error: '该线索已被认领' })
    res.json({ success: true })
  } catch (err) {
    console.error('[luna] lead claim error:', err)
    res.status(500).json({ success: false, error: 'claim failed' })
  }
})

/** 释放(退回池子);仅退我自己认领的。 */
router.post('/leads/:id/release', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    await pool.query(
      `UPDATE leads SET assigned_agent_id = NULL, assigned_at = NULL
         WHERE id = $2 AND assigned_agent_id = $1 AND converted_client_id IS NULL`,
      [agentId, req.params.id]
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ success: false, error: 'release failed' })
  }
})

/** 转为客户:从线索建 lt_clients,回填 converted_client_id + 标记 qualified。 */
router.post('/leads/:id/convert', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    // 只能转未被别人认领的(未认领或我认领的)且未转过的线索
    const lead = await pool.query<{
      id: number; name: string | null; email: string | null; phone: string | null;
      whatsapp: string | null; intent: Record<string, unknown> | null; lead_score: number;
    }>(
      `SELECT id, name, email, phone, whatsapp, intent, lead_score FROM leads
        WHERE id = $2 AND converted_client_id IS NULL
          AND (assigned_agent_id IS NULL OR assigned_agent_id = $1)`,
      [agentId, req.params.id]
    )
    if (!lead.rowCount) return res.status(404).json({ success: false, error: '线索不存在或已转/被他人认领' })
    const l = lead.rows[0]
    const name = (l.name || l.email || l.phone || '新客户').toString().slice(0, 120)
    // 意向摘要 → 客户备注(区域/项目/搜索/研究痕迹)
    const it = l.intent || {}
    const parts: string[] = []
    const areas = Array.isArray((it as Record<string, unknown>).areas) ? (it as { areas: unknown[] }).areas : []
    if (areas.length) parts.push(`关注区域: ${areas.slice(0, 5).join(', ')}`)
    const pv = (it as Record<string, unknown>).property_views
    if (pv) parts.push(`浏览房源 ${pv} 次`)
    if ((it as Record<string, unknown>).opened_luna) parts.push('用过 Luna')
    const notes = `由线索转入。${parts.join(' · ')}`.slice(0, 500)

    const c = await pool.query(
      `INSERT INTO lt_clients (agent_id, name, email, phone, whatsapp, notes, lead_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [agentId, name, l.email, l.phone, l.whatsapp, notes, l.lead_score || 0]
    )
    const clientId = c.rows[0].id
    await pool.query(
      `UPDATE leads SET assigned_agent_id = $1, assigned_at = COALESCE(assigned_at, now()),
              converted_client_id = $3, status = 'qualified'
         WHERE id = $2`,
      [agentId, req.params.id, clientId]
    )
    res.json({ success: true, clientId })
  } catch (err) {
    console.error('[luna] lead convert error:', err)
    res.status(500).json({ success: false, error: 'convert failed' })
  }
})

/** List the agent's sessions with engagement rollups (read-only). */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
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

/** Delete a whole tour (session) + its data. Scoped to the owning agent. */
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  const client = await pool.connect()
  try {
    const agentId = await currentAgentId(req)
    const id = String(req.params.id)
    const own = await client.query(`SELECT 1 FROM lt_demo_sessions WHERE id=$1 AND agent_id=$2`, [id, agentId])
    if (own.rowCount === 0) return res.status(404).json({ error: 'not found' })
    await client.query('BEGIN')
    // explicit child deletes (don't rely on FK cascade being set everywhere)
    for (const t of [
      'lt_engagement_events',
      'lt_edit_comments',
      'lt_tour_script_versions',
      'lt_audio_assets',
      'lt_session_news_items',
      'lt_tour_scripts',
      'lt_session_properties',
    ]) {
      await client.query(`DELETE FROM ${t} WHERE session_id=$1`, [id]).catch(() => {})
    }
    await client.query(`DELETE FROM lt_demo_sessions WHERE id=$1`, [id])
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[luna] delete session error:', err)
    res.status(500).json({ error: 'delete failed' })
  } finally {
    client.release()
  }
})

/** One session's behaviour timeline (most recent events first). */
router.get('/sessions/:id/events', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
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
/**
 * client_id → 这个客户的**结构化画像**(lt_clients),拼成给 prompt 用的描述。
 *
 * ⚠️ AI 导览页原来让经纪**手打一句话画像**(「香港投资客, 预算300万, 重回报」)——
 *    而 CRM 里早就有全套结构化字段。同一个客户,经纪要在报告页做一遍画像、
 *    再到导览页手打一遍,两边还对不上。现在两边读**同一份画像**。
 *
 * 拿不到画像(没选客户 / 客户不属于这个经纪)就原样返回调用方传的东西 —— 不阻塞。
 */
async function resolveClient(
  agentId: string,
  clientId: string | null,
  fallbackClient: Record<string, unknown>,
  fallbackOneLiner: string
): Promise<{ client: Record<string, unknown>; oneLiner: string }> {
  if (!clientId) return { client: fallbackClient, oneLiner: fallbackOneLiner }
  try {
    const p = await loadProfile(clientId, agentId)
    if (!p || !Object.keys(p).length) return { client: fallbackClient, oneLiner: fallbackOneLiner }
    const line = profileToOneLiner(p)
    return {
      client: {
        ...fallbackClient,
        ...(p.name ? { name: p.name } : {}),
        ...(p.nationality ? { nationality: p.nationality } : {}),
        ...(p.goal ? { goal: p.goal } : {}),
        persona: line,
      },
      // 经纪额外写的备注**接在画像后面**,不覆盖 —— 他补充的是画像没有的东西
      oneLiner: [line, fallbackOneLiner.trim()].filter(Boolean).join('。'),
    }
  } catch {
    return { client: fallbackClient, oneLiner: fallbackOneLiner }
  }
}

router.post('/match', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, unknown>
    const rawClient = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const rawOneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''
    const clientId = typeof b.client_id === 'string' && b.client_id ? b.client_id : null
    const { client, oneLiner } = await resolveClient(agentId, clientId, rawClient, rawOneLiner)
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
    const agentId = await currentAgentId(req)
    const b = (req.body || {}) as Record<string, unknown>
    const projectIds = Array.isArray(b.project_ids) ? (b.project_ids as unknown[]).map(String) : []
    if (projectIds.length < 2) {
      return res.status(400).json({ error: '至少需要选择 2 个楼盘' })
    }
    const shareCodeRaw = String(b.share_code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    const shareCode = shareCodeRaw || (await uniqueShareCode())
    const rawClient = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
    const clientId = typeof b.client_id === 'string' && b.client_id ? b.client_id : null
    const rawOneLiner = typeof b.one_liner === 'string' ? b.one_liner : ''
    // 选了客户 → 直接读他在 CRM 里的画像(经纪不用再手打一遍)
    const { client, oneLiner } = await resolveClient(agentId, clientId, rawClient, rawOneLiner)
    const clientName = typeof client.name === 'string' ? client.name.trim() : ''
    const defaultTitle = clientName
      ? `为 ${clientName} 精选的 ${projectIds.length} 个家`
      : `Luna 为你精选的 ${projectIds.length} 个家`
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : defaultTitle
    // Explicit language override (zh/en/ar/ru) — for international Dubai clients.
    const langOverride = ['zh', 'en', 'ar', 'ru'].includes(String(b.language)) ? String(b.language) : undefined

    // Quota gate — only for real logged-in agents (the shared demo is exempt).
    const loggedIn = isLoggedIn(req)
    if (loggedIn) {
      const q = await checkCredits(agentId, 'luna_tours')
      if (!q.allowed) { const e = creditError('luna_tours', q); return res.status(e.status).json(e.body) }
    }

    // Kick off the heavy build (AI config + script + audio) in the BACKGROUND and
    // return the share_code now, so the request can't hit the proxy timeout. The
    // client polls /sessions/:code/gen-status for structure + audio progress.
    genJobs.set(shareCode, { status: 'generating' })
    res.json({ ok: true, shareCode, status: 'generating', watch_url: `/?toursession=${shareCode}` })

    void (async () => {
      try {
        let config
        if (oneLiner || Object.keys(client).length) config = await draftConfig(client, oneLiner)
        if (langOverride) config = { ...(config || {}), language: langOverride } // explicit pick wins
        /**
         * 🔴 **草稿** —— 只出剧本,不烧语音,不发布。
         *
         * 旧流程是一口气生成 + 立刻 TTS:经纪第一次看到成品时,**语音的钱已经花了**,
         * 唯一的补救是事后改文案再烧一遍。他在整个过程里没有一个「我说了算」的时刻。
         *
         * 现在:先给他一条能看能改的时间线 → 他确认 → 才 /render(那时才扣额度、烧语音)。
         */
        const result = await createSession({ shareCode, projectIds, title, agentId, clientId, client, config, draft: true })
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

type CameraCue = {
  type?: string
  degrees?: number
  zoom?: number
  pitch?: number
  duration_ms?: number
  at_ms?: number
  bearing?: number
  center?: [number, number]
  from?: [number, number]
  to?: [number, number]
}
type OverlayCue = {
  type?: string
  at_ms?: number
  duration_ms?: number
  property_id?: string
  url?: string
  media_kind?: string
  label?: string
  data?: { growth_pct?: number }
}
type ScriptBeat = {
  id?: string
  kind?: string
  narration?: string
  audio_url?: string
  duration_ms?: number
  camera?: CameraCue[]
  overlays?: OverlayCue[]
}
type ScriptAct = {
  id?: string
  property_id?: string
  beats?: ScriptBeat[]
  transition_out?: { type?: string; duration_ms?: number }
  place?: { name: string; coords: [number, number] }
}
type ScriptShape = {
  intro?: ScriptBeat
  outro?: ScriptBeat
  acts?: ScriptAct[]
}

/** Estimate spoken seconds from narration text (CJK ~4.2 chars/s + latin ~2.6
 *  words/s + 0.7s tail) — so the timeline duration tracks the TEXT (edit the line
 *  → duration updates), not a stale authored value. Mirrors the engine's speakMs. */
function estimateSeconds(text: string): number {
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length
  const latin = text.replace(/[一-鿿　-〿＀-￯]/g, ' ').trim()
  const words = latin ? latin.split(/\s+/).filter(Boolean).length : 0
  return Math.max(3, Math.round(cjk / 4.2 + words / 2.6 + 0.7))
}

const OVERLAY_ZH: Record<string, string> = {
  title: '标题',
  progress_dots: '进度点',
  property_card: '房源卡',
  roi_card: 'ROI 投资卡',
  distance_line: '距离线',
  amenity_spokes: '配套放射',
  highlight_all_pins: '高亮全部',
  favorite_picker: '收藏',
  cta: '联系',
  media: '📹 视频/图',
}

// camera "style" presets the agent can pick (zoom/pitch the engine honours +
// constant gentle rotation). Friendly, no jargon.
const CAMERA_STYLES: Record<string, { zoom: number; pitch: number; label: string }> = {
  orbit: { zoom: 14, pitch: 50, label: '🔄 环绕展示' },
  push: { zoom: 16, pitch: 55, label: '🔍 推近' },
  aerial: { zoom: 11.5, pitch: 70, label: '🦅 俯瞰全景' },
}
/** Friendly one-word camera move for a beat (no zoom jargon). The engine adds a
 *  constant gentle rotation to every beat regardless. */
function cameraSummary(cam: CameraCue[] | undefined): string {
  if (!Array.isArray(cam) || !cam.length) return '环绕展示'
  const hasFly = cam.some((c) => c?.type === 'flyover')
  const key = cam.find((c) => !c?.type && c?.zoom != null) // the keyframe
  const z = key?.zoom
  if (z != null && z >= 15.5) return hasFly ? '飞入 · 推近' : '推近'
  if (z != null && z <= 12) return '俯瞰全景'
  if (hasFly) return '飞入 · 环绕'
  return '环绕展示'
}
/** Which preset a beat's camera currently matches (for the editor's style picker). */
function cameraStyle(cam: CameraCue[] | undefined): string {
  const z = (Array.isArray(cam) ? cam : []).find((c) => !c?.type && c?.zoom != null)?.zoom
  if (z != null && z >= 15.5) return 'push'
  if (z != null && z <= 12) return 'aerial'
  return 'orbit'
}

interface OverlayViz { idx: number; type: string; label: string; at: number; dur: number; image?: string; value?: string }
/** Overlay cards on a beat with their timing (when + how long) AND a visual hint
 *  so the editor can SHOW content: property image, ROI %, media thumbnail. idx =
 *  position in the beat's overlay array (targets edits without losing fields). */
function overlaySummary(ov: OverlayCue[] | undefined, imageById?: Map<string, string>): OverlayViz[] {
  if (!Array.isArray(ov)) return []
  return ov.map((o, idx) => {
    const v: OverlayViz = {
      idx,
      type: o.type || '',
      // distance_line carries its own target+km label (e.g. "地铁 0.4 km") → show
      // "到 地铁 0.4 km"; everything else uses a plain friendly name.
      label: o.type === 'distance_line' && o.label ? `到 ${o.label}` : OVERLAY_ZH[o.type || ''] || o.type || '卡片',
      at: Math.round((o.at_ms ?? 0) / 1000),
      dur: Math.round((o.duration_ms ?? 0) / 1000),
    }
    if (o.type === 'property_card' && o.property_id) v.image = imageById?.get(o.property_id)
    else if (o.type === 'media' && o.media_kind === 'image' && o.url) v.image = o.url
    else if (o.type === 'roi_card' && o.data?.growth_pct != null) v.value = `+${o.data.growth_pct}%`
    return v
  })
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
/**
 * 两段式生成的**第二段** —— 经纪在时间线上确认之后,才渲染语音并发布。
 *
 * 额度在**这里**扣,不在 create 扣:草稿没花语音的钱,不该算他一次。
 * 生成语音是整条链路里最贵、最不可逆的一步 —— 它必须发生在人点头之后。
 */
router.post('/sessions/:id/render', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const key = req.params.id
    const sres = await pool.query<{ id: string; share_code: string; title: string; status: string }>(
      `SELECT id, share_code, title, status FROM lt_demo_sessions
        WHERE (id::text=$1 OR share_code=$1) AND agent_id=$2 LIMIT 1`,
      [key, agentId]
    )
    const sess = sres.rows[0]
    if (!sess) return res.status(404).json({ error: 'session not found' })
    if (sess.status !== 'draft') {
      // 已经渲染过 —— 不再重复扣额度(重烧语音走 PATCH 那条路)
      return res.json({ ok: true, alreadyRendered: true, shareCode: sess.share_code })
    }

    const loggedIn = isLoggedIn(req)
    if (loggedIn) {
      const q = await checkCredits(agentId, 'luna_tours')
      if (!q.allowed) { const e = creditError('luna_tours', q); return res.status(e.status).json(e.body) }
    }

    await pool.query(
      `UPDATE lt_demo_sessions SET status='published', is_published=true, published_at=now() WHERE id=$1`,
      [sess.id]
    )
    if (loggedIn) {
      await spend(agentId, 'luna_tours', { type: 'tour', id: sess.share_code, label: sess.title }).catch(() => {})
    }

    genJobs.set(sess.share_code, { status: 'generating' })
    res.json({ ok: true, shareCode: sess.share_code, watch_url: `/?toursession=${sess.share_code}` })

    // 语音在后台烧(11+ 拍 × Gemini TTS + R2,60-120s —— 超过 CF 代理超时)
    void generateSessionAudio(sess.id)
      .then((audio) => {
        genJobs.set(sess.share_code, { status: 'ready', audioTotal: audio.total })
        console.log(`[luna] render ${sess.share_code}: ${audio.ready}/${audio.total} audio ready`)
      })
      .catch((err) => {
        console.error('[luna] render audio failed:', err)
        genJobs.set(sess.share_code, { status: 'ready', audioTotal: 0 })
      })
  } catch (err) {
    console.error('[luna] render error:', err)
    res.status(500).json({ error: 'render failed' })
  }
})

/**
 * 预演用的语音 —— **不发布、不扣额度**，只是把 Gemini 声音烧出来。
 *
 * 🔴 为什么必须有这个:两段式生成里草稿是不烧语音的,于是经纪点「先预演一遍」
 *    听到的是**浏览器机器音** —— 他根本没法判断 Luna 讲得好不好,还以为坏了
 *   (owner 实测:「怎么是用 browser 机器人语音说话的?」)。
 *    **预演听不到真声,预演就没有意义。**
 *
 * 成本上安全:generateSessionAudio 是**幂等**的(已有 audio_url 的拍会跳过),
 * 所以确认渲染时不会重复烧;经纪改过的那几拍会自动重生成。
 */
router.post('/sessions/:id/preview-audio', async (req: Request, res: Response) => {
  try {
    const agentId = await currentAgentId(req)
    const sres = await pool.query<{ id: string; share_code: string }>(
      `SELECT id, share_code FROM lt_demo_sessions
        WHERE (id::text=$1 OR share_code=$1) AND agent_id=$2 LIMIT 1`,
      [req.params.id, agentId]
    )
    const sess = sres.rows[0]
    if (!sess) return res.status(404).json({ error: 'session not found' })

    genJobs.set(sess.share_code, { status: 'generating' })
    res.json({ ok: true, shareCode: sess.share_code })

    void generateSessionAudio(sess.id)
      .then((a) => {
        genJobs.set(sess.share_code, { status: 'ready', audioTotal: a.total })
        console.log(`[luna] preview audio ${sess.share_code}: ${a.ready}/${a.total} (skipped ${a.skipped})`)
      })
      .catch((err) => {
        console.error('[luna] preview audio failed:', err)
        genJobs.set(sess.share_code, { status: 'ready', audioTotal: 0 })
      })
  } catch (err) {
    console.error('[luna] preview-audio error:', err)
    res.status(500).json({ error: 'preview-audio failed' })
  }
})

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

/**
 * E5 analytics→edit loop: turn engagement telemetry into an actionable hint —
 * which stop held attention least / completion rate — so the agent knows what to
 * improve. Reads lt_engagement_events (already flowing). Accepts id or share_code.
 */
router.get('/sessions/:id/insights', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const tot = await pool.query<{ opens: string; plays: string; completes: string }>(
      `SELECT count(*) FILTER (WHERE event_type='open') AS opens,
              count(*) FILTER (WHERE event_type='tour_play') AS plays,
              count(*) FILTER (WHERE event_type='tour_complete') AS completes
         FROM lt_engagement_events WHERE session_id=$1`,
      [sessionId]
    )
    const per = await pool.query<{ project_id: string; dwell_ms: string; loves: string; views: string }>(
      `SELECT project_id::text,
              COALESCE(sum(dwell_ms) FILTER (WHERE event_type='property_dwell'), 0) AS dwell_ms,
              count(*) FILTER (WHERE event_type='feedback') AS loves,
              count(*) FILTER (WHERE event_type='property_view') AS views
         FROM lt_engagement_events WHERE session_id=$1 AND project_id IS NOT NULL
         GROUP BY project_id`,
      [sessionId]
    )
    const names = await pool.query<{ project_id: string; name: string }>(
      `SELECT project_id::text, snapshot->>'name' AS name FROM lt_session_properties WHERE session_id=$1`,
      [sessionId]
    )
    const nameById = new Map(names.rows.map((n) => [n.project_id, n.name]))
    const props = per.rows.map((r) => ({
      project_id: r.project_id,
      name: nameById.get(r.project_id) || '楼盘',
      dwell_ms: Number(r.dwell_ms),
      loves: Number(r.loves),
      views: Number(r.views),
    }))
    const t = tot.rows[0]
    const plays = Number(t?.plays ?? 0)
    const completes = Number(t?.completes ?? 0)
    const completionPct = plays ? Math.round((completes / plays) * 100) : null

    let suggestion = '数据还不够(等更多客户观看后再看洞察)。'
    if (plays >= 3) {
      if (completionPct != null && completionPct < 50) {
        suggestion = `完看率偏低(${completionPct}%)。开场或第一处可能太长——试试「短一点」或加段海景视频抓住注意力。`
      } else if (props.length) {
        const weakest = [...props].sort((a, b) => a.dwell_ms - b.dwell_ms)[0]
        suggestion = `客户在「${weakest.name}」停留最短。考虑精简该段旁白、或加张实拍卡片让它更吸引。`
      } else {
        suggestion = '表现不错,完看率健康。可继续观察 ❤️ 与联系转化。'
      }
    }
    res.json({
      opens: Number(t?.opens ?? 0),
      plays,
      completes,
      completionPct,
      props: props.sort((a, b) => b.dwell_ms - a.dwell_ms),
      suggestion,
    })
  } catch (err) {
    console.error('[luna] insights error:', err)
    res.status(500).json({ error: 'insights failed' })
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

/**
 * Edit a beat's overlay CARDS (timing / removal) by index — preserves each card's
 * data fields (we only change at_ms / duration_ms or drop it). Snapshots a version.
 * body: { beat_id, edits: [{ index, duration_ms?, at_ms?, remove? }] }
 */
router.post('/sessions/:id/beat-overlays', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const b = (req.body || {}) as { beat_id?: string; edits?: { index: number; duration_ms?: number; at_ms?: number; remove?: boolean }[] }
    const beatId = String(b.beat_id || '')
    const edits = Array.isArray(b.edits) ? b.edits : []
    if (!beatId || !edits.length) return res.status(400).json({ error: 'beat_id and edits required' })

    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })

    let target: ScriptBeat | undefined
    eachBeat(scriptRow.script, (bt) => {
      if (bt.id === beatId) target = bt
    })
    if (!target || !Array.isArray(target.overlays)) return res.status(404).json({ error: 'beat/overlays not found' })

    // snapshot for undo
    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), '卡片改动前']
    )

    const removeIdx = new Set<number>()
    for (const e of edits) {
      const ov = target.overlays[e.index]
      if (!ov) continue
      if (e.remove) removeIdx.add(e.index)
      else {
        if (Number.isFinite(e.duration_ms)) ov.duration_ms = Math.max(0, Math.round(e.duration_ms as number))
        if (Number.isFinite(e.at_ms)) ov.at_ms = Math.max(0, Math.round(e.at_ms as number))
      }
    }
    if (removeIdx.size) target.overlays = target.overlays.filter((_, i) => !removeIdx.has(i))

    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true, overlays: overlaySummary(target.overlays) })
  } catch (err) {
    console.error('[luna] beat-overlays error:', err)
    res.status(500).json({ error: 'beat-overlays failed' })
  }
})

/**
 * Attach real footage (sea view / interior) to a beat — a media overlay shown
 * during the beat. External URL for now (R2 upload is a later slice). Snapshots.
 * body: { beat_id, media_kind:'video'|'image', url, caption?, at_ms?, duration_ms? }
 */
router.post('/sessions/:id/beat-media', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const b = (req.body || {}) as Record<string, unknown>
    const beatId = String(b.beat_id || '')
    const url = String(b.url || '').trim()
    const kind = b.media_kind === 'image' ? 'image' : 'video'
    if (!beatId || !/^https?:\/\/\S+$/i.test(url)) return res.status(400).json({ error: 'beat_id and a valid url required' })

    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    let target: ScriptBeat | undefined
    eachBeat(scriptRow.script, (bt) => {
      if (bt.id === beatId) target = bt
    })
    if (!target) return res.status(404).json({ error: 'beat not found' })

    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), '加媒体前']
    )
    const overlay: OverlayCue & Record<string, unknown> = {
      type: 'media',
      media_kind: kind,
      url,
      at_ms: Number.isFinite(Number(b.at_ms)) ? Math.max(0, Math.round(Number(b.at_ms))) : 1000,
      duration_ms: Number.isFinite(Number(b.duration_ms)) ? Math.max(1000, Math.round(Number(b.duration_ms))) : 8000,
      fit: 'cover',
    }
    if (typeof b.caption === 'string' && b.caption.trim()) overlay.caption = b.caption.trim()
    if (!Array.isArray(target.overlays)) target.overlays = []
    target.overlays.push(overlay)
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true, overlays: overlaySummary(target.overlays) })
  } catch (err) {
    console.error('[luna] beat-media error:', err)
    res.status(500).json({ error: 'beat-media failed' })
  }
})

/**
 * Upload a sea-view / interior clip (or photo) to R2 and return its public URL,
 * which the agent then attaches to a beat via /beat-media. ≤60MB, video/image.
 */
router.post('/media-upload', mediaUpload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file) return res.status(400).json({ error: '没有文件,或类型/大小不支持(视频/图,≤60MB)' })
    const ext = MEDIA_EXT[file.mimetype] || path.extname(file.originalname) || '.bin'
    const key = `luna-media/${crypto.randomUUID()}${ext}`
    const url = await uploadBufferToR2(key, file.buffer, file.mimetype)
    res.json({ ok: true, url, media_kind: file.mimetype.startsWith('video') ? 'video' : 'image' })
  } catch (err) {
    console.error('[luna] media-upload error:', err)
    res.status(500).json({ error: 'media-upload failed' })
  }
})

/** Search real Dubai places (from dubai_pois) to add as a tour stop. */
router.get('/place-search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ places: [] })
    const r = await pool.query<{ name: string; category: string; lng: string; lat: string }>(
      `SELECT name, category, ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
         FROM dubai_pois WHERE name ILIKE $1 ORDER BY name LIMIT 10`,
      [`%${q}%`]
    )
    res.json({ places: r.rows.map((p) => ({ name: p.name, category: p.category, lng: Number(p.lng), lat: Number(p.lat) })) })
  } catch (err) {
    console.error('[luna] place-search error:', err)
    res.status(500).json({ error: 'place-search failed' })
  }
})

/**
 * Add a non-property STOP (beach / landmark / any place) to the tour: appends a
 * place act (camera flies there + gentle orbit) before the outro. Snapshots a
 * version; the new beat's audio regenerates in the background. Agent can then
 * attach a sea-view video (beat-media) and refine the narration.
 * body: { name, lng, lat, narration? }
 */
router.post('/sessions/:id/add-stop', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const b = (req.body || {}) as Record<string, unknown>
    const name = String(b.name || '').trim()
    const lng = Number(b.lng)
    const lat = Number(b.lat)
    if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return res.status(400).json({ error: 'name, lng, lat required' })

    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })

    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), `加地点「${name}」前`]
    )

    const coords: [number, number] = [lng, lat]
    const beatId = `place_${randomCode(5)}`
    const narration = (typeof b.narration === 'string' && b.narration.trim()) || `接下来,我们来到${name}。`
    const beat: ScriptBeat = {
      id: beatId,
      narration,
      duration_ms: 9000,
      camera: [
        { type: 'flyover', at_ms: 0, from: coords, to: coords, duration_ms: 3000 },
        { type: 'orbit', at_ms: 3000, center: coords, degrees: 60, duration_ms: 6000 },
      ],
      overlays: [],
    }
    const act: ScriptAct = {
      id: `act_${randomCode(4)}`,
      property_id: '',
      place: { name, coords },
      beats: [beat],
      transition_out: { type: 'flyover', duration_ms: 2500 },
    }
    scriptRow.script.acts = scriptRow.script.acts || []
    scriptRow.script.acts.push(act)
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    void generateSessionAudio(sessionId).catch(() => {})
    res.json({ ok: true, beat_id: beatId, name })
  } catch (err) {
    console.error('[luna] add-stop error:', err)
    res.status(500).json({ error: 'add-stop failed' })
  }
})

/** Remove a stop (act) by index. Snapshots a version. */
router.post('/sessions/:id/delete-stop', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const actIndex = Number((req.body || {}).act_index)
    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    const acts = scriptRow.script.acts || []
    if (!Number.isInteger(actIndex) || actIndex < 0 || actIndex >= acts.length) return res.status(400).json({ error: 'bad act_index' })
    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), '删除停靠点前']
    )
    acts.splice(actIndex, 1)
    scriptRow.script.acts = acts
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[luna] delete-stop error:', err)
    res.status(500).json({ error: 'delete-stop failed' })
  }
})

/** Set a beat's camera STYLE (环绕/推近/俯瞰) — a friendly preset (zoom+pitch the
 *  engine honours). body: { beat_id, style:'orbit'|'push'|'aerial' } */
router.post('/sessions/:id/beat-camera', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const beatId = String((req.body || {}).beat_id || '')
    const style = String((req.body || {}).style || '')
    const preset = CAMERA_STYLES[style]
    if (!beatId || !preset) return res.status(400).json({ error: 'beat_id and valid style required' })
    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    let target: ScriptBeat | undefined
    eachBeat(scriptRow.script, (bt) => { if (bt.id === beatId) target = bt })
    if (!target) return res.status(404).json({ error: 'beat not found' })
    target.camera = [{ at_ms: 0, zoom: preset.zoom, pitch: preset.pitch, bearing: 0, duration_ms: target.duration_ms || 8000 }]
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true, camera: cameraSummary(target.camera), cameraStyle: style })
  } catch (err) {
    console.error('[luna] beat-camera error:', err)
    res.status(500).json({ error: 'beat-camera failed' })
  }
})

/** Edit a stop's outgoing transition (the node BEFORE the next stop).
 *  body: { act_index, type:'flyover'|'cut', duration_ms } */
router.post('/sessions/:id/stop-transition', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const actIndex = Number((req.body || {}).act_index)
    const type = (req.body || {}).type === 'cut' ? 'cut' : 'flyover'
    const durRaw = Number((req.body || {}).duration_ms)
    const duration_ms = Number.isFinite(durRaw) ? Math.max(0, Math.min(8000, Math.round(durRaw))) : 2500
    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    const acts = scriptRow.script.acts || []
    if (!Number.isInteger(actIndex) || actIndex < 0 || actIndex >= acts.length) return res.status(400).json({ error: 'bad act_index' })
    acts[actIndex].transition_out = { type, duration_ms }
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[luna] stop-transition error:', err)
    res.status(500).json({ error: 'stop-transition failed' })
  }
})

/** Reorder a stop (act): swap with its neighbour. body: { act_index, dir: -1|1 } */
router.post('/sessions/:id/move-stop', async (req: Request, res: Response) => {
  try {
    const sessionId = await resolveSessionId(req.params.id)
    if (!sessionId) return res.status(404).json({ error: 'not found' })
    const actIndex = Number((req.body || {}).act_index)
    const dir = Number((req.body || {}).dir) < 0 ? -1 : 1
    const scRes = await pool.query<{ id: string; script: ScriptShape }>(
      `SELECT id, script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [sessionId]
    )
    const scriptRow = scRes.rows[0]
    if (!scriptRow) return res.status(404).json({ error: 'no script' })
    const acts = scriptRow.script.acts || []
    const j = actIndex + dir
    if (!Number.isInteger(actIndex) || actIndex < 0 || actIndex >= acts.length || j < 0 || j >= acts.length)
      return res.status(400).json({ error: 'bad move' })
    await pool.query(
      `INSERT INTO lt_tour_script_versions (script_id, session_id, script, note) VALUES ($1,$2,$3,$4)`,
      [scriptRow.id, sessionId, JSON.stringify(scriptRow.script), '重排停靠点前']
    )
    ;[acts[actIndex], acts[j]] = [acts[j], acts[actIndex]]
    scriptRow.script.acts = acts
    await pool.query(`UPDATE lt_tour_scripts SET script=$1 WHERE id=$2`, [JSON.stringify(scriptRow.script), scriptRow.id])
    res.json({ ok: true })
  } catch (err) {
    console.error('[luna] move-stop error:', err)
    res.status(500).json({ error: 'move-stop failed' })
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
    const agentId = await currentAgentId(req)
    const id = String(req.params.id)
    const s = await pool.query(`SELECT title, share_code FROM lt_demo_sessions WHERE id=$1 AND agent_id=$2`, [id, agentId])
    if (s.rowCount === 0) return res.status(404).json({ error: 'not found' })

    const sc = await pool.query<{ script: ScriptShape }>(
      `SELECT script FROM lt_tour_scripts WHERE session_id=$1 ORDER BY language LIMIT 1`,
      [id]
    )
    const props = await pool.query<{ project_id: string; name: string; image: string | null }>(
      `SELECT project_id::text, snapshot->>'name' AS name, snapshot->>'image' AS image
         FROM lt_session_properties WHERE session_id=$1 ORDER BY sort_order`,
      [id]
    )
    const nameById = new Map(props.rows.map((p) => [p.project_id, p.name]))
    const imageById = new Map(props.rows.filter((p) => p.image).map((p) => [p.project_id, p.image as string]))
    const script = sc.rows[0]?.script

    type FlowItem = {
      id: string
      group: string
      kind: string
      narration: string
      seconds: number
      camera: string
      cameraStyle: string
      overlays: OverlayViz[]
      transition?: string
      transitionType?: string
      actIndex: number
      isPlace?: boolean
    }
    const beatItem = (b: ScriptBeat, group: string, kind: string, actIndex: number, transition?: string, isPlace?: boolean, transitionType?: string): FlowItem => ({
      id: b.id || '',
      group,
      kind,
      narration: b.narration || '',
      seconds: estimateSeconds(b.narration || ''),
      camera: cameraSummary(b.camera),
      cameraStyle: cameraStyle(b.camera),
      overlays: overlaySummary(b.overlays, imageById),
      actIndex,
      ...(transitionType ? { transitionType } : {}),
      ...(isPlace ? { isPlace: true } : {}),
      ...(transition ? { transition } : {}),
    })

    const flow: FlowItem[] = []
    if (script) {
      if (script.intro?.id) flow.push(beatItem(script.intro, '开场', 'intro', -1))
      ;(script.acts || []).forEach((act, ai) => {
        const gname = (act.property_id && nameById.get(act.property_id)) || act.place?.name || '楼盘'
        const isPlace = !act.property_id && !!act.place
        const prevTransType = ai > 0 ? script.acts?.[ai - 1]?.transition_out?.type : undefined
        ;(act.beats || []).forEach((beat, bi) => {
          if (!beat?.id) return
          // first beat of acts after the first carries the inter-stop transition
          const transition = ai > 0 && bi === 0 ? `挑高抛远飞向 ${gname}` : undefined
          flow.push(beatItem(beat, gname, beat.kind || 'beat', ai, transition, isPlace, bi === 0 ? prevTransType : undefined))
        })
      })
      if (script.outro?.id) flow.push(beatItem(script.outro, '结尾', 'outro', -1))
    }
    res.json({ title: s.rows[0].title, share_code: s.rows[0].share_code, flow })
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
    const agentId = await currentAgentId(req)
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
