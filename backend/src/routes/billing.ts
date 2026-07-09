/**
 * Stripe billing — 经纪台订阅 (设计稿: docs/stripe-billing-spec.md)。
 *
 * 托管方案:Checkout(新订阅)+ Billing Portal(改套餐/取消/换卡)。前端零敏感代码。
 * 真相源 = Stripe;DB(lt_subscriptions)通过 webhook 镜像。配额读 DB(sessionUsage 已有)。
 *
 *   GET  /api/billing/plans     → 套餐目录(营销报价页 + 台内升级页共用)        [公开]
 *   POST /api/billing/checkout  → 建/复用 Customer + Checkout Session,返回 url  [requireAuth+已审批]
 *   POST /api/billing/portal    → Billing Portal session,返回 url               [requireAuth]
 *   GET  /api/billing/me        → 当前套餐 + 状态 + 本月用量 vs 额度             [requireAuth]
 *   POST /api/billing/webhook   → Stripe 事件回写(在 index.ts 用 express.raw 单独挂) [Stripe 验签]
 *
 * ⚠️ webhook 必须 raw body 且挂在全局 express.json 之前(见 index.ts)。
 * ⚠️ STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET 必须加进 docker-compose 映射。
 */
import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import pool from '../db/pool'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { isOwnerEmail } from '../middleware/requireOwner'
import { ensureAgent } from '../luna-tour/session-builder'
import { creditBalance, featureCatalog } from '../luna-tour/credits'
import { clearAgentGate } from '../middleware/mapMeter'

const router = Router()

const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'

// ── Stripe client(惰性;未配置时端点优雅 503,不影响 dev 启动)──────────
let _stripe: Stripe | null = null
function getStripe(): Stripe | null {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  _stripe = new Stripe(key)
  return _stripe
}

// 只卖月付/年付(年付=收10个月,送2个月);历史季付(_Q)订阅 webhook 仍认得。
export type BillingInterval = 'month' | 'year'

const PAID_PLANS = ['rookie', 'agent', 'founder', 'developer'] as const
const PLAN_RANK: Record<string, number> = { explore: 0, rookie: 1, agent: 2, founder: 3, developer: 4 }

// ── 套餐+周期 ↔ Stripe price 映射(env 优先,回退 DB 列)────────────────
// 月付列 stripe_price_id / 年付列 stripe_price_id_year(scripts/setup-stripe-prices.ts 回填)。
function envPriceId(planId: string, interval: BillingInterval): string | undefined {
  if (!(PAID_PLANS as readonly string[]).includes(planId)) return undefined
  const suffix = interval === 'year' ? '_Y' : ''
  return process.env[`STRIPE_PRICE_${planId.toUpperCase()}${suffix}`]
}

async function priceIdForPlan(planId: string, interval: BillingInterval): Promise<string | null> {
  const fromEnv = envPriceId(planId, interval)
  if (fromEnv) return fromEnv
  const col = interval === 'year' ? 'stripe_price_id_year' : 'stripe_price_id'
  const { rows } = await pool.query<{ price: string | null }>(
    `SELECT ${col} AS price FROM lt_subscription_plans WHERE id = $1`,
    [planId]
  )
  return rows[0]?.price || null
}

/** Stripe price id → 我们的 plan id(反查,webhook 用;月/季/年付都认)。 */
async function planForPriceId(priceId: string): Promise<string | null> {
  if (!priceId) return null
  for (const p of PAID_PLANS) {
    const P = p.toUpperCase()
    const ids = [process.env[`STRIPE_PRICE_${P}`], process.env[`STRIPE_PRICE_${P}_Q`], process.env[`STRIPE_PRICE_${P}_Y`]]
    if (ids.includes(priceId)) return p
  }
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM lt_subscription_plans
      WHERE stripe_price_id = $1 OR stripe_price_id_year = $1 LIMIT 1`,
    [priceId]
  )
  return rows[0]?.id || null
}

/** Founder 加席 price(env 优先,回退 DB founder 行)。 */
async function seatPriceId(): Promise<string | null> {
  if (process.env.STRIPE_PRICE_FOUNDER_SEAT) return process.env.STRIPE_PRICE_FOUNDER_SEAT
  const { rows } = await pool.query<{ p: string | null }>(
    `SELECT stripe_price_id_seat AS p FROM lt_subscription_plans WHERE id = 'founder'`
  )
  return rows[0]?.p || null
}

// ── 当前经纪身份(requireAuth 已挂 req.user)→ lt_agents.id + 审批状态 ──────
async function currentAgent(
  req: Request
): Promise<{ id: string; email: string; name: string; approved: boolean } | null> {
  const email = (req.user?.email || '').toLowerCase().trim()
  if (!email) return null
  const name = (req.user?.user_metadata?.name as string) || email.split('@')[0]
  const id = await ensureAgent({
    email,
    displayName: name,
    authUserId: req.user?.id,
    brand: { title: '认证顾问', accent: '#00E0B8' },
  })
  let approved = isOwnerEmail(email)
  if (!approved) {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM agents WHERE email = $1`,
      [email]
    )
    approved = rows[0]?.status === 'approved'
  }
  return { id, email, name, approved }
}

/** 读/建该经纪的永久 Stripe customer,回写 lt_agents.stripe_customer_id。 */
async function ensureCustomer(
  stripe: Stripe,
  agent: { id: string; email: string; name: string }
): Promise<string> {
  const { rows } = await pool.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM lt_agents WHERE id = $1`,
    [agent.id]
  )
  const existing = rows[0]?.stripe_customer_id
  if (existing) return existing

  const customer = await stripe.customers.create({
    email: agent.email,
    name: agent.name,
    metadata: { lt_agent_id: agent.id },
  })
  await pool.query(`UPDATE lt_agents SET stripe_customer_id = $2 WHERE id = $1`, [
    agent.id,
    customer.id,
  ])
  return customer.id
}

// ============================================================
// GET /plans — 套餐目录(公开)
// ============================================================
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, COALESCE(price_usd_month, 0) AS price_usd_month,
              COALESCE(price_usd_year, COALESCE(price_usd_month, 0) * 10) AS price_usd_year, limits
         FROM lt_subscription_plans
        ORDER BY COALESCE(price_usd_month, 0) ASC`
    )
    res.json({ success: true, plans: rows })
  } catch (err) {
    console.error('[billing] /plans failed:', err)
    res.status(500).json({ success: false })
  }
})

// ============================================================
// GET /features — 积分功能目录 + 各套餐积分额度(价格页/台内自动渲染消耗表)
// 功能成本来自代码配置 credits.ts(单一真相源);套餐积分来自 DB。
// ============================================================
router.get('/features', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{ id: string; credits_month: number | null; cost_multiplier: number | null }>(
      `SELECT id, (limits->>'credits_month')::int AS credits_month, (limits->>'cost_multiplier')::float AS cost_multiplier
         FROM lt_subscription_plans ORDER BY (limits->>'credits_month')::int ASC NULLS FIRST`
    )
    res.json({
      success: true,
      features: featureCatalog(), // [{ key, label, credits, minPlan }]
      plans: rows.map((r) => ({
        id: r.id,
        creditsMonth: Number(r.credits_month ?? 0),
        multiplier: Number(r.cost_multiplier ?? 1),
      })),
    })
  } catch (err) {
    console.error('[billing] /features failed:', err)
    res.status(500).json({ success: false })
  }
})

// ============================================================
// GET /promo — 创始发布优惠已下线(2026-07-03):原价售卖,只保留年付送 2 个月。
// 端点保留返回 inactive,兼容老缓存的前端 bundle。
// ============================================================
router.get('/promo', async (_req: Request, res: Response) => {
  res.json({ active: false })
})

// ============================================================
// POST /checkout — 新订阅
// ============================================================
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ success: false, error: 'Billing not configured' })

  const planId = String(req.body?.planId || '')
  if (!(PAID_PLANS as readonly string[]).includes(planId)) {
    return res.status(400).json({ success: false, error: 'Invalid plan' })
  }
  const interval: BillingInterval = req.body?.interval === 'year' ? 'year' : 'month'

  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  // 自助开通:不再要求预先审批 —— 付款成功即 webhook 自动 approve(付费本身就是准入,
  // owner 仍可在后台撤销)。审批流保留为质量管控工具,不再是购买前置。

  const price = await priceIdForPlan(planId, interval)
  if (!price) {
    return res.status(503).json({ success: false, error: `No Stripe price for plan ${planId} (${interval})` })
  }

  try {
    const customerId = await ensureCustomer(stripe, agent)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        // 7 天免费试用(需绑卡,试用期内取消不扣费)。自助档(Starter/Pro/开发商)都给。
        trial_period_days: planId === 'rookie' || planId === 'agent' || planId === 'developer' ? 7 : undefined,
        metadata: { lt_agent_id: agent.id, plan_id: planId, interval },
      },
      payment_method_collection: 'always', // 试用也收卡
      allow_promotion_codes: true, // 无自动折扣;有促销码可手填
      client_reference_id: agent.id,
      success_url: `${APP_URL}/agent/billing?status=success`,
      cancel_url: `${APP_URL}/agent/billing?status=cancel`,
    })
    res.json({ success: true, url: session.url })
  } catch (err) {
    console.error('[billing] checkout failed:', err)
    res.status(500).json({ success: false, error: 'Checkout failed' })
  }
})

// ============================================================
// POST /portal — 管理已有订阅(改套餐/取消/换卡/发票)
// ============================================================
router.post('/portal', requireAuth, async (req: Request, res: Response) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ success: false, error: 'Billing not configured' })

  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })

  try {
    const { rows } = await pool.query<{ stripe_customer_id: string | null }>(
      `SELECT stripe_customer_id FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    const customerId = rows[0]?.stripe_customer_id
    if (!customerId) {
      return res.status(404).json({ success: false, error: 'No subscription to manage' })
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/agent/billing`,
      // 显式指定 portal 配置(若提供),免去依赖 Stripe dashboard 手动激活默认配置
      ...(process.env.STRIPE_PORTAL_CONFIG ? { configuration: process.env.STRIPE_PORTAL_CONFIG } : {}),
    })
    res.json({ success: true, url: session.url })
  } catch (err) {
    console.error('[billing] portal failed:', err)
    res.status(500).json({ success: false, error: 'Portal failed' })
  }
})

// ============================================================
// GET /me — 当前套餐 + 状态 + 本月用量
// ============================================================
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })

  try {
    // 席位成员(billing_agent_id 指向 founder)看到的是团队的套餐与共享池。
    const b = await pool.query<{ billing_agent_id: string | null }>(
      `SELECT billing_agent_id FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    const billingId = b.rows[0]?.billing_agent_id || agent.id
    const sub = await pool.query<{
      plan_id: string
      status: string
      current_period_end: Date | null
    }>(
      `SELECT plan_id, status, current_period_end FROM lt_subscriptions
         WHERE agent_id = $1 AND status IN ('active', 'trialing', 'past_due')
         ORDER BY created_at DESC LIMIT 1`,
      [billingId]
    )
    const planId = sub.rows[0]?.plan_id || 'explore'
    const status = sub.rows[0]?.status || 'none'

    const planRow = await pool.query<{ name: string; limits: Record<string, number> }>(
      `SELECT name, limits FROM lt_subscription_plans WHERE id = $1`,
      [planId]
    )
    const limits = planRow.rows[0]?.limits || {}

    // 积分制:本月余额(creditsMonth - 已花),-1 = 无限(owner)
    const credits = await creditBalance(agent.id)

    res.json({
      success: true,
      approved: agent.approved,
      plan: { id: planId, name: planRow.rows[0]?.name || 'Explore', limits },
      status,
      current_period_end: sub.rows[0]?.current_period_end || null,
      teamMember: billingId !== agent.id, // true = founder 席位成员(套餐由团队承担)
      credits: {
        month: credits.creditsMonth,   // 月额度(-1=无限)
        used: credits.used,            // 本月已花
        balance: credits.balance,      // 余额(-1=无限)
      },
    })
  } catch (err) {
    console.error('[billing] /me failed:', err)
    res.status(500).json({ success: false })
  }
})

// ============================================================
// Founder 团队席位:limits.seats(=3,含本人)+ extra_seats(加席另购)。
// 成员通过 lt_agents.billing_agent_id 指向 founder → credits.ts 共享积分池。
// ============================================================

/** 当前经纪的生效"带席位套餐"订阅(经纪公司版/开发商版;团队端点共用的守卫)。 */
async function teamSubOf(agentId: string): Promise<{ subId: string; extraSeats: number; seats: number; planId: string } | null> {
  const { rows } = await pool.query<{ stripe_subscription_id: string | null; extra_seats: number; plan_id: string }>(
    `SELECT stripe_subscription_id, extra_seats, plan_id FROM lt_subscriptions
      WHERE agent_id = $1 AND plan_id IN ('founder','developer') AND status IN ('active','trialing')
      ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  )
  if (!rows[0]) return null
  const lim = await pool.query<{ seats: number | null }>(
    `SELECT (limits->>'seats')::int AS seats FROM lt_subscription_plans WHERE id = $1`,
    [rows[0].plan_id]
  )
  return {
    subId: rows[0].stripe_subscription_id || '',
    extraSeats: rows[0].extra_seats ?? 0,
    seats: Number(lim.rows[0]?.seats ?? 3),
    planId: rows[0].plan_id,
  }
}

// GET /team — 团队面板(founder 视角:成员+席位;成员视角:归属的团队)
router.get('/team', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  try {
    const mine = await pool.query<{ billing_agent_id: string | null }>(
      `SELECT billing_agent_id FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    if (mine.rows[0]?.billing_agent_id) {
      const owner = await pool.query<{ email: string; display_name: string }>(
        `SELECT email, display_name FROM lt_agents WHERE id = $1`,
        [mine.rows[0].billing_agent_id]
      )
      return res.json({ success: true, role: 'member', owner: owner.rows[0] || null })
    }
    const sub = await teamSubOf(agent.id)
    if (!sub) return res.json({ success: true, role: 'none' })
    const members = await pool.query<{ id: string; email: string; display_name: string }>(
      `SELECT id, email, display_name FROM lt_agents WHERE billing_agent_id = $1 ORDER BY created_at`,
      [agent.id]
    )
    // seats 含本人 → 可邀成员数 = seats + extra - 1
    const memberLimit = sub.seats + sub.extraSeats - 1
    res.json({
      success: true,
      role: 'owner',
      members: members.rows,
      seatLimit: sub.seats + sub.extraSeats,
      memberLimit,
      extraSeats: sub.extraSeats,
    })
  } catch (err) {
    console.error('[billing] /team failed:', err)
    res.status(500).json({ success: false })
  }
})

// POST /team/invite { email } — 拉成员进团队(占一席,共享积分池,自动审批准入)
router.post('/team/invite', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  const email = String(req.body?.email || '').toLowerCase().trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ success: false, error: '请输入有效邮箱' })
  }
  if (email === agent.email) return res.status(400).json({ success: false, error: '不需要邀请自己' })
  try {
    const sub = await teamSubOf(agent.id)
    if (!sub) return res.status(403).json({ success: false, error: '团队席位是 Founder 创始版的功能' })
    const members = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM lt_agents WHERE billing_agent_id = $1`,
      [agent.id]
    )
    const memberLimit = sub.seats + sub.extraSeats - 1
    if (Number(members.rows[0].n) >= memberLimit) {
      return res.status(409).json({
        success: false, code: 'seats_full',
        error: `席位已满(${memberLimit} 名成员)。可在团队页购买加席。`,
      })
    }
    const target = await ensureAgent({ email, displayName: email.split('@')[0], brand: { title: '认证顾问', accent: '#00E0B8' } })
    if (target === agent.id) return res.status(400).json({ success: false, error: '不需要邀请自己' })
    const t = await pool.query<{ billing_agent_id: string | null }>(
      `SELECT billing_agent_id FROM lt_agents WHERE id = $1`,
      [target]
    )
    if (t.rows[0]?.billing_agent_id && t.rows[0].billing_agent_id !== agent.id) {
      return res.status(409).json({ success: false, error: '对方已在其他团队中' })
    }
    const own = await pool.query(
      `SELECT 1 FROM lt_subscriptions WHERE agent_id = $1 AND status IN ('active','trialing') LIMIT 1`,
      [target]
    )
    if (own.rows.length) {
      return res.status(409).json({ success: false, error: '对方已有自己的订阅,无需占用席位' })
    }
    await pool.query(`UPDATE lt_agents SET billing_agent_id = $2 WHERE id = $1`, [target, agent.id])
    await autoApprovePaid(email, email.split('@')[0]) // 团队(经纪公司/开发商)背书 → 准入直接放行
    await logPlanChange({
      agentId: agent.id, agentEmail: agent.email, action: 'seat_invited',
      toPlan: sub.planId, metadata: { member: email },
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[billing] /team/invite failed:', err)
    res.status(500).json({ success: false })
  }
})

// DELETE /team/:memberId — 移出团队(该成员跌回 explore)
router.delete('/team/:memberId', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  try {
    const { rows } = await pool.query<{ email: string }>(
      `UPDATE lt_agents SET billing_agent_id = NULL
        WHERE id = $1 AND billing_agent_id = $2 RETURNING email`,
      [req.params.memberId, agent.id]
    )
    if (!rows.length) return res.status(404).json({ success: false, error: '不是你团队的成员' })
    const sub = await teamSubOf(agent.id)
    await logPlanChange({
      agentId: agent.id, agentEmail: agent.email, action: 'seat_removed',
      toPlan: sub?.planId || 'founder', metadata: { member: rows[0].email },
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[billing] /team remove failed:', err)
    res.status(500).json({ success: false })
  }
})

// POST /seats { extraSeats } — 调整加席数(Stripe 订阅第二 line item quantity,按比例计费)
router.post('/seats', requireAuth, async (req: Request, res: Response) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ success: false, error: 'Billing not configured' })
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  const extra = Math.max(0, Math.min(50, Math.floor(Number(req.body?.extraSeats ?? NaN))))
  if (!Number.isFinite(extra)) return res.status(400).json({ success: false, error: 'extraSeats required' })
  try {
    const sub = await teamSubOf(agent.id)
    if (!sub || !sub.subId) return res.status(403).json({ success: false, error: '加席是 Founder 创始版的功能' })
    const members = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM lt_agents WHERE billing_agent_id = $1`,
      [agent.id]
    )
    if (Number(members.rows[0].n) > sub.seats + extra - 1) {
      return res.status(409).json({ success: false, error: '先移除成员才能减少席位' })
    }
    const seatPrice = await seatPriceId()
    if (!seatPrice) return res.status(503).json({ success: false, error: 'Seat price not configured' })
    const stripeSub = await stripe.subscriptions.retrieve(sub.subId)
    const seatItem = stripeSub.items.data.find((i) => i.price?.id === seatPrice)
    let items: Stripe.SubscriptionUpdateParams.Item[]
    if (extra === 0) {
      if (!seatItem) return res.json({ success: true, extraSeats: 0 })
      items = [{ id: seatItem.id, deleted: true }]
    } else if (seatItem) {
      items = [{ id: seatItem.id, quantity: extra }]
    } else {
      items = [{ price: seatPrice, quantity: extra }]
    }
    await stripe.subscriptions.update(sub.subId, { items, proration_behavior: 'create_prorations' })
    // extra_seats 由 subscription.updated webhook 镜像回 DB(含审计 seats_changed)。
    res.json({ success: true, extraSeats: extra })
  } catch (err) {
    console.error('[billing] /seats failed:', err)
    res.status(500).json({ success: false, error: 'Seat update failed' })
  }
})

// ============================================================
// GET /admin/plan-changes — 套餐变更审计(谁升谁降、为什么取消 → 方便回访)
// ============================================================
router.get('/admin/plan-changes', requireAdmin, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    const email = typeof req.query.email === 'string' ? req.query.email.toLowerCase().trim() : ''
    const { rows } = await pool.query(
      `SELECT l.id, l.agent_id, COALESCE(l.agent_email, a.email) AS agent_email,
              a.display_name, l.action, l.from_plan, l.to_plan, l.from_status, l.to_status,
              l.reason, l.metadata, l.created_at
         FROM plan_change_log l
         LEFT JOIN lt_agents a ON a.id = l.agent_id
        WHERE ($2 = '' OR lower(COALESCE(l.agent_email, a.email)) LIKE '%' || $2 || '%')
        ORDER BY l.created_at DESC
        LIMIT $1`,
      [limit, email]
    )
    res.json({ success: true, changes: rows })
  } catch (err) {
    console.error('[billing] /admin/plan-changes failed:', err)
    res.status(500).json({ success: false })
  }
})

// ============================================================
// Webhook handler(在 index.ts 用 express.raw 单独挂,先于 express.json)
// ============================================================
/** Stripe cancellation_details → 可读原因(feedback 枚举 + 用户留言)。 */
function cancellationReason(sub: Stripe.Subscription): string | null {
  const cd = (sub as unknown as { cancellation_details?: { feedback?: string | null; comment?: string | null } })
    .cancellation_details
  if (!cd) return null
  const parts = [cd.feedback, cd.comment].filter(Boolean)
  return parts.length ? parts.join(' — ') : null
}

/** 套餐变更审计:一条变更一行,谁/何时/从哪到哪/为什么。失败只告警不阻断 webhook。 */
async function logPlanChange(row: {
  agentId: string
  agentEmail: string | null
  action: string
  fromPlan?: string | null
  toPlan?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  reason?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO plan_change_log
         (agent_id, agent_email, action, from_plan, to_plan, from_status, to_status, reason, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.agentId, row.agentEmail, row.action,
        row.fromPlan ?? null, row.toPlan ?? null,
        row.fromStatus ?? null, row.toStatus ?? null,
        row.reason ?? null, JSON.stringify(row.metadata ?? {}),
      ]
    )
  } catch (err) {
    console.error('[billing] plan_change_log insert failed:', err)
  }
}

/** 付费订阅生效即自动审批(付费=准入;owner 后台可撤销),并把角色同步为经纪。 */
async function autoApprovePaid(email: string | null, name: string | null): Promise<void> {
  if (!email) return
  try {
    await pool.query(
      `INSERT INTO agents (email, name, status, decided_at, decided_by)
       VALUES ($1, $2, 'approved', now(), 'stripe:auto')
       ON CONFLICT (email) DO UPDATE
         SET status = 'approved', decided_at = now(), decided_by = 'stripe:auto'
       `,
      [email, name]
    )
    // 买了经纪订阅的人就是经纪 —— role 同步,避免「买家身份持有经纪订阅」的错位
    await pool.query(
      `UPDATE user_profiles SET role = 'agent', updated_at = now()
        WHERE lower(email) = lower($1) AND (role IS NULL OR role = 'buyer')`,
      [email]
    )
    clearAgentGate()
  } catch (err) {
    console.error('[billing] paid auto-approve failed:', err)
  }
}

/** 以 Stripe subscription 对象为唯一真相,幂等 upsert 到 lt_subscriptions + 变更审计。 */
async function upsertSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const a = await pool.query<{ id: string; email: string | null; display_name: string | null }>(
    `SELECT id, email, display_name FROM lt_agents WHERE stripe_customer_id = $1`,
    [customerId]
  )
  const agentId = a.rows[0]?.id
  const agentEmail = a.rows[0]?.email || null
  if (!agentId) {
    console.warn('[billing] webhook: no agent for customer', customerId)
    return
  }

  // 多 line item:套餐项(price 能映射到 plan)+ 可选的 founder 加席项。
  const seatPrice = await seatPriceId()
  let planId: string | null = null
  let planItem: Stripe.SubscriptionItem | undefined
  let extraSeats = 0
  for (const item of sub.items?.data || []) {
    const pid = item.price?.id || ''
    if (seatPrice && pid === seatPrice) {
      extraSeats = item.quantity ?? 0
      continue
    }
    const mapped = await planForPriceId(pid)
    if (mapped && !planId) {
      planId = mapped
      planItem = item
    }
  }
  planId = planId || sub.metadata?.plan_id || null
  if (!planId) {
    console.warn('[billing] webhook: cannot map price to plan', sub.items?.data?.map((i) => i.price?.id))
    return
  }

  // current_period_end:旧 API 在 subscription 上,Basil 移到 item 上 — 两处都试。
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (planItem as unknown as { current_period_end?: number })?.current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number })?.current_period_end ??
    null
  const periodEndIso = periodEnd ? new Date(periodEnd * 1000).toISOString() : null
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end

  // 旧状态(审计对比用)
  const prevQ = await pool.query<{
    plan_id: string; status: string; extra_seats: number; cancel_at_period_end: boolean
  }>(
    `SELECT plan_id, status, extra_seats, cancel_at_period_end
       FROM lt_subscriptions WHERE stripe_subscription_id = $1`,
    [sub.id]
  )
  const prev = prevQ.rows[0] || null

  await pool.query(
    `INSERT INTO lt_subscriptions
       (agent_id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, extra_seats, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL DO UPDATE
       SET plan_id = EXCLUDED.plan_id,
           status = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end,
           extra_seats = EXCLUDED.extra_seats,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           updated_at = now()`,
    [agentId, planId, sub.status, customerId, sub.id, periodEndIso, extraSeats, cancelAtPeriodEnd]
  )

  // ── 变更审计(一条变更一行)──────────────────────────────
  const base = {
    agentId, agentEmail,
    fromPlan: prev?.plan_id ?? null, toPlan: planId,
    fromStatus: prev?.status ?? null, toStatus: sub.status,
  }
  const reason = cancellationReason(sub)
  if (!prev) {
    await logPlanChange({ ...base, action: sub.status === 'trialing' ? 'trial_started' : 'subscribed' })
  } else {
    if (prev.plan_id !== planId) {
      const up = (PLAN_RANK[planId] ?? 0) > (PLAN_RANK[prev.plan_id] ?? 0)
      await logPlanChange({ ...base, action: up ? 'upgraded' : 'downgraded', reason })
    }
    if (!prev.cancel_at_period_end && cancelAtPeriodEnd) {
      await logPlanChange({ ...base, action: 'cancel_scheduled', reason })
    }
    if (prev.cancel_at_period_end && !cancelAtPeriodEnd && sub.status !== 'canceled') {
      await logPlanChange({ ...base, action: 'cancel_reverted' })
    }
    if (prev.status !== sub.status) {
      if (sub.status === 'canceled') await logPlanChange({ ...base, action: 'canceled', reason })
      else if (sub.status === 'past_due') await logPlanChange({ ...base, action: 'past_due' })
      else if (prev.status === 'past_due' && sub.status === 'active') await logPlanChange({ ...base, action: 'recovered' })
      else if (prev.status === 'trialing' && sub.status === 'active') await logPlanChange({ ...base, action: 'trial_converted' })
    }
    if ((prev.extra_seats ?? 0) !== extraSeats) {
      await logPlanChange({
        ...base, action: 'seats_changed',
        metadata: { fromSeats: prev.extra_seats ?? 0, toSeats: extraSeats },
      })
    }
  }

  // 付费订阅生效 → 自动审批(经纪台准入;任何档,含之前被拒的账号 —— 付费即准入)。
  if (sub.status === 'active' || sub.status === 'trialing') {
    await autoApprovePaid(agentEmail, a.rows[0]?.display_name || null)

    // 付费才定身份:选付费角色时前端不预写 role(没付款下次刷新还会再问,
    // 免得被付费墙锁死)。订阅生效后这里按套餐落角色(前端回跳页兜底 INSERT)。
    if (agentEmail) {
      const ROLE_BY_PLAN: Record<string, string> = { rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer' }
      const role = ROLE_BY_PLAN[planId]
      if (role) {
        await pool.query(
          `UPDATE user_profiles SET role = $2, role_chosen_at = now(), updated_at = now()
            WHERE lower(email) = lower($1)`,
          [agentEmail, role]
        ).catch((e) => console.error('[billing] role sync failed:', e))
      }
    }
  }
  // 订阅状态变了 → 地图计量的「经纪需付费」判定立即刷新(缓存按 userId,这里拿不到,全清,60s 内重建)
  clearAgentGate()
}

export async function billingWebhookHandler(req: Request, res: Response): Promise<void> {
  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret) {
    res.status(503).json({ error: 'Billing not configured' })
    return
  }

  let event: Stripe.Event
  try {
    const sig = req.headers['stripe-signature'] as string
    event = stripe.webhooks.constructEvent(req.body, sig, secret)
  } catch (err) {
    console.error('[billing] webhook signature verify failed:', (err as Error).message)
    res.status(400).send(`Webhook Error: ${(err as Error).message}`)
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const subId =
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id
          const sub = await stripe.subscriptions.retrieve(subId)
          await upsertSubscription(sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object as Stripe.Subscription)
        break
      }
      default:
        break
    }
    res.json({ received: true })
  } catch (err) {
    console.error('[billing] webhook handler error:', err)
    res.status(500).json({ error: 'Webhook handler failed' })
  }
}

export default router
