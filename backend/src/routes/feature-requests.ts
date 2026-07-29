/**
 * 功能建议 —— 客户在 /requests 提、投票、跟帖；**永不暴露是谁提的**。
 *
 *   GET    /api/feature-requests            公开列表(票数/楼层数/角色标记;登录了带 voted)
 *   GET    /api/feature-requests/:id        单条(每条建议有自己的页面 /requests/:id)  公开
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

/**
 * 受众 —— 这条建议该给谁看。
 *   'all'    所有人(地图、成交数据、账号…买家也碰得到的东西)
 *   'agent'  只给经纪侧(带看、报价单、楼书解析、CRM…)
 *
 * 默认按**提议人的角色**推:经纪提的建议九成在讲经纪侧的功能,买家读到只会觉得
 * 这版块跟自己无关。推错了 owner 能在后台 PATCH 改 —— 所以这是个可覆盖的默认值。
 *
 * ⚠️ 这是**展示层**分流,不是权限:建议内容本来就是公开的,拿 id 直接访问
 *    /requests/:id 一样看得到(下面单条接口有意不过滤 —— 别人把链接发给你,
 *    点开却说"没有这条"比看到一条不相干的建议更糟)。
 */
const AUDIENCES = ['all', 'agent'] as const
type Audience = (typeof AUDIENCES)[number]
const AGENT_ROLES = new Set(['agent', 'agency', 'developer'])

const TITLE_MAX = 120
const BODY_MAX = 1000
const REPLY_MAX = 800

/**
 * 每人**每周**能提几条 —— 滚动 7 天窗口(不是自然周:自然周会让周日注册的人当天就只剩
 * 一点点额度,而滚动窗口对谁都一样)。
 *
 * 分档的用意不是把反馈做成付费墙 —— 免费额度**要足够宽**,一个真心提建议的人一辈子
 * 也撞不到;它拦的是刷屏的。付费客户额度更高是因为他们在真用产品,意见密度更高。
 * ⚠️ 别把 FREE 调到 1~2:那会让「我们听用户的」变成一句空话。
 */
const PER_WEEK_FREE = 3
const PER_WEEK_PAID = 10
const PER_WEEK_STAFF = 50

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

/** 看的人是不是经纪侧(经纪/经纪公司/开发商,或我们自己)。没登录 = 否。 */
async function viewerIsAgentSide(email: string): Promise<boolean> {
  if (!email) return false
  if (isStaff(email)) return true
  return AGENT_ROLES.has((await roleOf(email)) || '')
}

/** 有生效订阅(含试用中和扣款失败 —— 后者仍是付费客户,别顺手降级他)。 */
async function isPaying(email: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM lt_agents a
         JOIN lt_subscriptions s ON s.agent_id = COALESCE(a.billing_agent_id, a.id)
        WHERE lower(a.email) = $1
          AND s.status IN ('active','trialing','past_due')
        LIMIT 1`,
      [email]
    )
    return rows.length > 0
  } catch { return false }
}

/** 这个人一周能提几条。 */
async function weeklyQuota(email: string): Promise<number> {
  if (isStaff(email)) return PER_WEEK_STAFF
  return (await isPaying(email)) ? PER_WEEK_PAID : PER_WEEK_FREE
}

interface PublicRow {
  id: number
  created_at: string
  title: string
  body: string | null
  status: Status
  reply: string | null
  role: string | null
  audience: Audience
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
    audience: (AUDIENCES as readonly string[]).includes(String(r.audience)) ? (r.audience as Audience) : 'all',
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
    // 买家(和未登录访客)看不到经纪侧的建议 —— 那些诉求他既没法评判也用不上
    const seesAgent = await viewerIsAgentSide(me)
    const { rows } = await pool.query(
      `SELECT r.id, r.created_at, r.title, r.body, r.status, r.reply, r.role, r.audience,
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
        WHERE ($3 OR r.audience = 'all')
        ORDER BY CASE r.status WHEN 'shipped' THEN 0 WHEN 'planned' THEN 1
                               WHEN 'open' THEN 2 ELSE 3 END,
                 COALESCE(v.n, 0) DESC,
                 r.created_at DESC
        LIMIT $1`,
      [limit, me, seesAgent]
    )
    res.json({ requests: rows.map(publicShape) })
  } catch (err) {
    console.error('[feature-requests] list failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 单条(每条建议有自己的页面 /requests/:id,需要能单独取)──────────────────
// ⚠️ 路径参数**必须限定成数字**(:id(\d+))。写成裸 `/:id` 的话,以后任何新增的
//    字面量子路径(/mine、/search…)只要声明在它后面,就会被它当成 id 吞掉 ——
//    而且不报错,只是 404,查起来很费劲。限定数字之后,非数字路径直接落到后面的路由。
router.get('/:id(\\d+)', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
  try {
    const me = softEmail(req)
    const { rows } = await pool.query(
      // 单条**有意不按受众过滤**:别人把链接发给你,点开说「没有这条」比读到一条
      // 不相干的建议糟得多。分流是为了不吵人,不是为了藏东西。
      `SELECT r.id, r.created_at, r.title, r.body, r.status, r.reply, r.role, r.audience,
              (SELECT count(*) FROM feature_request_votes v WHERE v.request_id = r.id)    AS votes,
              (SELECT count(*) FROM feature_request_comments c WHERE c.request_id = r.id) AS comments,
              ($2 <> '' AND EXISTS (SELECT 1 FROM feature_request_votes mv
                                     WHERE mv.request_id = r.id AND mv.user_email = $2))  AS voted
         FROM feature_requests r WHERE r.id = $1`,
      [id, me]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    res.json({ request: publicShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] get one failed:', err)
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
    const [{ rows: cnt }, quota, paying] = await Promise.all([
      pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM feature_requests
          WHERE lower(user_email) = $1 AND created_at > now() - interval '7 days'`,
        [email]
      ),
      weeklyQuota(email),
      isPaying(email),
    ])
    const used = Number(cnt[0]?.n || 0)
    if (used >= quota) {
      // 提示要把**下一步**说清楚:多久恢复、以及(免费用户)升级能多多少。
      // 只写「超限了」等于把人挡在门外还不告诉他门什么时候开。
      return res.status(429).json({
        error: 'rate_limited',
        quota, used, paying,
        message: paying
          ? `每周最多提 ${quota} 条建议，已经用完了。过几天再来 —— 额度按最近 7 天滚动恢复。`
          : `每周最多提 ${quota} 条建议，已经用完了。额度按最近 7 天滚动恢复；订阅用户每周 ${PER_WEEK_PAID} 条。`,
      })
    }

    const role = await roleOf(email)
    // 受众默认跟提议人走(经纪提的 → 经纪侧)。owner 可以在后台 PATCH 改 ——
    // 经纪提的「地图能不能按学校筛」其实买家也该看到,那种就手动放回 'all'。
    const audience: Audience = AGENT_ROLES.has(role || '') ? 'agent' : 'all'
    const { rows } = await pool.query(
      `INSERT INTO feature_requests (user_id, user_email, title, body, role, audience)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, created_at, title, body, status, reply, role, audience`,
      [req.user?.id ?? null, email, title, body, role, audience]
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
  // 受众按角色推的默认值经常需要人来纠 —— 经纪提的「地图加个学校筛选」买家也该看到
  const audience = String(req.body?.audience || '')
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return res.status(400).json({ error: 'bad status' })
  }
  if (audience && !(AUDIENCES as readonly string[]).includes(audience)) {
    return res.status(400).json({ error: 'bad audience' })
  }
  try {
    const { rows } = await pool.query(
      `UPDATE feature_requests
          SET status   = COALESCE(NULLIF($2,''), status),
              reply    = COALESCE($3, reply),
              audience = COALESCE(NULLIF($4,''), audience),
              updated_at = now()
        WHERE id = $1
      RETURNING id, created_at, title, body, status, reply, role, audience`,
      [id, status, reply ?? null, audience]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    res.json({ request: publicShape(rows[0]) })
  } catch (err) {
    console.error('[feature-requests] patch failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
