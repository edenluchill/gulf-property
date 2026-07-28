/**
 * 功能建议 —— 客户在 /changelog 页面提，公开列出，**永不暴露是谁提的**。
 *
 *   GET   /api/feature-requests        公开列表(无提交人)
 *   POST  /api/feature-requests        提交一条                      [requireAuth]
 *   GET   /api/feature-requests/mine   我提过的(带状态)              [requireAuth]
 *   PATCH /api/feature-requests/:id    改状态 / 写公开回复            [requireOwner]
 *
 * 🔴 **匿名是产品承诺,不是实现细节。**
 * 库里存 user_id / user_email(要能防刷、要能回访提议人),但**任何公开返回里都不许
 * 出现它们**。所以对外只走 `publicShape()` 这一个出口 —— 不要在别处手拼对象,
 * 手拼迟早会把 email 带出去,而这种泄露一旦发生就收不回来(页面会被爬、被缓存)。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth } from '../middleware/auth'
import { requireOwner } from '../middleware/requireOwner'

const router = Router()

/** 合法状态。open=待评估 planned=计划中 shipped=已上线 declined=暂不做 */
const STATUSES = ['open', 'planned', 'shipped', 'declined'] as const
type Status = (typeof STATUSES)[number]

const TITLE_MAX = 120
const BODY_MAX = 1000
/** 每人每天最多提几条 —— 防刷,也防一个人把公开列表刷屏。 */
const PER_DAY = 5

interface PublicRow {
  id: number
  created_at: string
  title: string
  body: string | null
  status: Status
  reply: string | null
}

/** 对外的**唯一**出口:只有这几个字段能出去。 */
function publicShape(r: Record<string, unknown>): PublicRow {
  return {
    id: Number(r.id),
    created_at: String(r.created_at),
    title: String(r.title),
    body: (r.body as string) ?? null,
    status: (STATUSES as readonly string[]).includes(String(r.status)) ? (r.status as Status) : 'open',
    reply: (r.reply as string) ?? null,
  }
}

// ── 公开列表 ───────────────────────────────────────────────────────────────
// 排序:已上线的置顶(证明"提了真的会做"是这个页面存在的全部意义),然后计划中,
// 最后按时间倒序。declined 沉底但**不隐藏** —— 悄悄消失比说「暂不做」更伤人。
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100))
    const { rows } = await pool.query(
      `SELECT id, created_at, title, body, status, reply
         FROM feature_requests
        ORDER BY CASE status WHEN 'shipped' THEN 0 WHEN 'planned' THEN 1
                             WHEN 'open' THEN 2 ELSE 3 END,
                 created_at DESC
        LIMIT $1`,
      [limit]
    )
    res.json({ requests: rows.map(publicShape) })
  } catch (err) {
    console.error('[feature-requests] list failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 提交(要登录)─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const email = (req.user?.email || '').toLowerCase().trim()
  if (!email) return res.status(401).json({ error: 'auth required' })

  const title = String(req.body?.title || '').trim().slice(0, TITLE_MAX)
  const body = String(req.body?.body || '').trim().slice(0, BODY_MAX) || null
  if (title.length < 4) {
    return res.status(400).json({ error: 'too_short', message: '标题太短了,说清楚想要什么。' })
  }

  try {
    const { rows: cnt } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM feature_requests
        WHERE lower(user_email) = $1 AND created_at > now() - interval '1 day'`,
      [email]
    )
    if (Number(cnt[0]?.n || 0) >= PER_DAY) {
      return res.status(429).json({ error: 'rate_limited', message: `每天最多提 ${PER_DAY} 条,明天再来。` })
    }

    const { rows } = await pool.query(
      `INSERT INTO feature_requests (user_id, user_email, title, body)
       VALUES ($1,$2,$3,$4)
       RETURNING id, created_at, title, body, status, reply`,
      [req.user?.id ?? null, email, title, body]
    )
    res.status(201).json({ request: publicShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] create failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 我提过的(让提议人能追踪自己那条的状态,而列表上仍然匿名)──────────────
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  const email = (req.user?.email || '').toLowerCase().trim()
  if (!email) return res.status(401).json({ error: 'auth required' })
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, title, body, status, reply
         FROM feature_requests WHERE lower(user_email) = $1
        ORDER BY created_at DESC LIMIT 50`,
      [email]
    )
    res.json({ requests: rows.map(publicShape) })
  } catch (err) {
    console.error('[feature-requests] mine failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 改状态 / 写公开回复(owner)──────────────────────────────────────────
router.patch('/:id', requireOwner, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
  const status = String(req.body?.status || '')
  const reply = req.body?.reply === undefined ? undefined : String(req.body.reply).trim().slice(0, BODY_MAX)
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return res.status(400).json({ error: 'bad status' })
  }
  try {
    const { rows } = await pool.query(
      `UPDATE feature_requests
          SET status = COALESCE(NULLIF($2,''), status),
              reply  = COALESCE($3, reply),
              updated_at = now()
        WHERE id = $1
      RETURNING id, created_at, title, body, status, reply`,
      [id, status, reply ?? null]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    res.json({ request: publicShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] patch failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
