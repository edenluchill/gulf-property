/**
 * 功能建议 —— 客户在 /changelog 页面提、投票、跟帖；**永不暴露是谁提的**。
 *
 *   GET    /api/feature-requests            公开列表(票数/楼层数/角色标记;登录了带 voted)
 *   POST   /api/feature-requests            提交一条                          [requireAuth]
 *   GET    /api/feature-requests/:id/thread 某条的楼层                        公开
 *   POST   /api/feature-requests/:id/vote   点赞/取消(幂等 toggle)            [requireAuth]
 *   POST   /api/feature-requests/:id/reply  跟一层楼                          [requireAuth]
 *   PATCH  /api/feature-requests/:id        改状态 / 写公开回复                [requireOwner]
 *
 * 🔴 **匿名是产品承诺,不是实现细节。**
 * 库里存 user_email(要防刷、要能去回访提议人、投票要去重),但**任何公开返回里都
 * 不许出现它**。所以对外只走 publicShape()/commentShape() 这两个出口 —— 别处手拼
 * 对象迟早会把 email 带出去,而这种泄露一旦发生就收不回来(页面会被爬、被缓存)。
 *
 * 「角色」是例外且是有意的:显示「经纪 / 买家 / 开发商」让别人知道这条诉求来自谁那
 * 一侧的人 —— 那是**群体属性,不是身份**,指认不到具体的人。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth } from '../middleware/auth'
import { requireOwner, isOwnerEmail } from '../middleware/requireOwner'
import { isAdminEmail } from '../lib/adminEmails'

const router = Router()

const STATUSES = ['open', 'planned', 'shipped', 'declined'] as const
type Status = (typeof STATUSES)[number]

const TITLE_MAX = 120
const BODY_MAX = 1000
const REPLY_MAX = 800
/** 每人每天最多提几条 —— 防刷,也防一个人把公开列表刷屏。 */
const PER_DAY = 5

/** 显示用的角色(群体属性)。取不到就 null,**绝不猜**。 */
async function roleOf(email: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ role: string | null }>(
      `SELECT role FROM user_profiles WHERE lower(email) = $1`, [email]
    )
    return rows[0]?.role || null
  } catch { return null }
}

const isStaff = (email: string) => isOwnerEmail(email) || isAdminEmail(email)

interface PublicRow {
  id: number
  created_at: string
  title: string
  body: string | null
  status: Status
  reply: string | null
  role: string | null
  votes: number
  comments: number
  voted: boolean
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
    role: (r.role as string) ?? null,
    votes: Number(r.votes ?? 0),
    comments: Number(r.comments ?? 0),
    voted: !!r.voted,
  }
}

function commentShape(r: Record<string, unknown>) {
  return {
    id: Number(r.id),
    created_at: String(r.created_at),
    body: String(r.body),
    role: (r.role as string) ?? null,
    is_staff: !!r.is_staff,
  }
}

/**
 * 已登录就取 email;没登录返回 ''。**不强制登录**。
 *
 * ⚠️ 公开列表没挂 requireAuth,所以 `req.user` 是空的 —— 要读 `req.ctx.email`
 * (全局 attachContext 本地验签填的,见 middleware/context)。写成 req.user 的话
 * 「我赞过没」对所有人恒为 false,而且**不会报错**,只是心永远是空的。
 */
function softEmail(req: Request): string {
  return (req.ctx?.email || req.user?.email || '').toLowerCase().trim()
}

// ── 公开列表 ───────────────────────────────────────────────────────────────
// 排序:已上线置顶(证明"提了真的会做"是这页存在的全部意义),然后计划中,
// 组内按票数再按时间。declined 沉底但**不隐藏** —— 悄悄消失比说「暂不做」更伤人。
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 200))
    const me = softEmail(req)
    const { rows } = await pool.query(
      `SELECT r.id, r.created_at, r.title, r.body, r.status, r.reply, r.role,
              COALESCE(v.n, 0)  AS votes,
              COALESCE(c.n, 0)  AS comments,
              ($2 <> '' AND mv.user_email IS NOT NULL) AS voted
         FROM feature_requests r
         LEFT JOIN (SELECT request_id, count(*) n FROM feature_request_votes GROUP BY 1) v
                ON v.request_id = r.id
         LEFT JOIN (SELECT request_id, count(*) n FROM feature_request_comments GROUP BY 1) c
                ON c.request_id = r.id
         LEFT JOIN feature_request_votes mv
                ON mv.request_id = r.id AND mv.user_email = $2
        ORDER BY CASE r.status WHEN 'shipped' THEN 0 WHEN 'planned' THEN 1
                               WHEN 'open' THEN 2 ELSE 3 END,
                 COALESCE(v.n, 0) DESC,
                 r.created_at DESC
        LIMIT $1`,
      [limit, me]
    )
    res.json({ requests: rows.map(publicShape) })
  } catch (err) {
    console.error('[feature-requests] list failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 提交(要登录)─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const email = softEmail(req)
  if (!email) return res.status(401).json({ error: 'auth required' })

  const title = String(req.body?.title || '').trim().slice(0, TITLE_MAX)
  const body = String(req.body?.body || '').trim().slice(0, BODY_MAX) || null
  if (title.length < 4) {
    return res.status(400).json({ error: 'too_short', message: '标题太短了，说清楚想要什么。' })
  }

  try {
    const { rows: cnt } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM feature_requests
        WHERE lower(user_email) = $1 AND created_at > now() - interval '1 day'`,
      [email]
    )
    if (Number(cnt[0]?.n || 0) >= PER_DAY) {
      return res.status(429).json({ error: 'rate_limited', message: `每天最多提 ${PER_DAY} 条，明天再来。` })
    }

    const role = await roleOf(email)
    const { rows } = await pool.query(
      `INSERT INTO feature_requests (user_id, user_email, title, body, role)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, created_at, title, body, status, reply, role`,
      [req.user?.id ?? null, email, title, body, role]
    )
    res.status(201).json({ request: publicShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] create failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 点赞(toggle,幂等)───────────────────────────────────────────────────
// 用「有没有那一行」表示赞过,不存计数器 —— 计数器会在并发/重试下漂,而这张表
// 的主键(request_id, user_email)天然保证一人一票,数出来的永远是真的。
router.post('/:id/vote', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const email = softEmail(req)
  if (!Number.isFinite(id) || !email) return res.status(400).json({ error: 'bad request' })
  try {
    const del = await pool.query(
      `DELETE FROM feature_request_votes WHERE request_id = $1 AND user_email = $2`, [id, email]
    )
    if (!del.rowCount) {
      await pool.query(
        `INSERT INTO feature_request_votes (request_id, user_email) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, email]
      )
    }
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM feature_request_votes WHERE request_id = $1`, [id]
    )
    res.json({ votes: Number(rows[0]?.n || 0), voted: !del.rowCount })
  } catch (err) {
    console.error('[feature-requests] vote failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 楼层 ───────────────────────────────────────────────────────────────────
router.get('/:id/thread', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, body, role, is_staff
         FROM feature_request_comments WHERE request_id = $1
        ORDER BY created_at ASC LIMIT 200`,
      [id]
    )
    res.json({ comments: rows.map(commentShape) })
  } catch (err) {
    console.error('[feature-requests] thread failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

router.post('/:id/reply', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const email = softEmail(req)
  const body = String(req.body?.body || '').trim().slice(0, REPLY_MAX)
  if (!Number.isFinite(id) || !email) return res.status(400).json({ error: 'bad request' })
  if (body.length < 2) return res.status(400).json({ error: 'too_short', message: '说点什么吧。' })
  try {
    const staff = isStaff(email)
    const role = staff ? null : await roleOf(email)
    const { rows } = await pool.query(
      `INSERT INTO feature_request_comments (request_id, user_email, role, is_staff, body)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, created_at, body, role, is_staff`,
      [id, email, role, staff, body]
    )
    res.status(201).json({ comment: commentShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] reply failed:', err)
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
      RETURNING id, created_at, title, body, status, reply, role`,
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
