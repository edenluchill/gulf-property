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
import { requireAuth } from '../middleware/auth'
import { isOwnerEmail } from '../middleware/requireOwner'
import { ensureAgent } from '../luna-tour/session-builder'

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

export type BillingInterval = 'month' | 'quarter' | 'year'

// ── 套餐+周期 ↔ Stripe price 映射(env 优先,月付回退 DB 的 stripe_price_id 列)──
// 月付:STRIPE_PRICE_{PLAN};季付(3月一付):*_Q;年付(送2个月):*_Y。月单价不变。
function envPriceId(planId: string, interval: BillingInterval): string | undefined {
  const P = planId.toUpperCase()
  const suffix = interval === 'year' ? '_Y' : interval === 'quarter' ? '_Q' : ''
  if (planId === 'agent' || planId === 'founder') return process.env[`STRIPE_PRICE_${P}${suffix}`]
  return undefined
}

async function priceIdForPlan(planId: string, interval: BillingInterval): Promise<string | null> {
  const fromEnv = envPriceId(planId, interval)
  if (fromEnv) return fromEnv
  if (interval !== 'month') return null // 季付/年付仅 env 配置,无 DB 回退
  const { rows } = await pool.query<{ stripe_price_id: string | null }>(
    `SELECT stripe_price_id FROM lt_subscription_plans WHERE id = $1`,
    [planId]
  )
  return rows[0]?.stripe_price_id || null
}

/** Stripe price id → 我们的 plan id(反查,webhook 用;月/季/年付都认)。 */
async function planForPriceId(priceId: string): Promise<string | null> {
  if (!priceId) return null
  const agentIds = [process.env.STRIPE_PRICE_AGENT, process.env.STRIPE_PRICE_AGENT_Q, process.env.STRIPE_PRICE_AGENT_Y]
  const founderIds = [process.env.STRIPE_PRICE_FOUNDER, process.env.STRIPE_PRICE_FOUNDER_Q, process.env.STRIPE_PRICE_FOUNDER_Y]
  if (agentIds.includes(priceId)) return 'agent'
  if (founderIds.includes(priceId)) return 'founder'
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM lt_subscription_plans WHERE stripe_price_id = $1 LIMIT 1`,
    [priceId]
  )
  return rows[0]?.id || null
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
      `SELECT id, name, COALESCE(price_usd_month, 0) AS price_usd_month, limits
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
// POST /checkout — 新订阅
// ============================================================
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ success: false, error: 'Billing not configured' })

  const planId = String(req.body?.planId || '')
  if (!['agent', 'founder'].includes(planId)) {
    return res.status(400).json({ success: false, error: 'Invalid plan' })
  }
  const reqInterval = req.body?.interval
  const interval: BillingInterval = reqInterval === 'year' ? 'year' : reqInterval === 'month' ? 'month' : 'quarter'

  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })
  if (!agent.approved) {
    return res.status(403).json({ success: false, error: 'Agent not approved yet' })
  }

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
        // 15 天免费试用(需绑卡,试用期内取消不扣费)。Agent 主推自助档。
        trial_period_days: planId === 'agent' ? 15 : undefined,
        metadata: { lt_agent_id: agent.id, plan_id: planId, interval },
      },
      payment_method_collection: 'always', // 试用也收卡
      allow_promotion_codes: true,
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
    const sub = await pool.query<{
      plan_id: string
      status: string
      current_period_end: Date | null
    }>(
      `SELECT plan_id, status, current_period_end FROM lt_subscriptions
         WHERE agent_id = $1 AND status IN ('active', 'trialing', 'past_due')
         ORDER BY created_at DESC LIMIT 1`,
      [agent.id]
    )
    const planId = sub.rows[0]?.plan_id || 'explore'
    const status = sub.rows[0]?.status || 'none'

    const planRow = await pool.query<{ name: string; limits: Record<string, number> }>(
      `SELECT name, limits FROM lt_subscription_plans WHERE id = $1`,
      [planId]
    )
    const limits = planRow.rows[0]?.limits || {}

    const usage = await pool.query<{
      sessions_created: number
      live_tours_created: number
      reports_created: number
    }>(
      `SELECT COALESCE(sessions_created, 0)   AS sessions_created,
              COALESCE(live_tours_created, 0) AS live_tours_created,
              COALESCE(reports_created, 0)    AS reports_created
         FROM lt_usage_counters
        WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
      [agent.id]
    )

    res.json({
      success: true,
      approved: agent.approved,
      plan: { id: planId, name: planRow.rows[0]?.name || 'Explore', limits },
      status,
      current_period_end: sub.rows[0]?.current_period_end || null,
      usage: {
        luna_tours: Number(usage.rows[0]?.sessions_created ?? 0),
        live_tours: Number(usage.rows[0]?.live_tours_created ?? 0),
        reports: Number(usage.rows[0]?.reports_created ?? 0),
      },
    })
  } catch (err) {
    console.error('[billing] /me failed:', err)
    res.status(500).json({ success: false })
  }
})

// ============================================================
// Webhook handler(在 index.ts 用 express.raw 单独挂,先于 express.json)
// ============================================================
/** 以 Stripe subscription 对象为唯一真相,幂等 upsert 到 lt_subscriptions。 */
async function upsertSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const a = await pool.query<{ id: string }>(
    `SELECT id FROM lt_agents WHERE stripe_customer_id = $1`,
    [customerId]
  )
  const agentId = a.rows[0]?.id
  if (!agentId) {
    console.warn('[billing] webhook: no agent for customer', customerId)
    return
  }

  const priceId = sub.items?.data?.[0]?.price?.id || ''
  const planId = (await planForPriceId(priceId)) || sub.metadata?.plan_id || null
  if (!planId) {
    console.warn('[billing] webhook: cannot map price to plan', priceId)
    return
  }

  // current_period_end:旧 API 在 subscription 上,Basil 移到 item 上 — 两处都试。
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number })?.current_period_end ??
    null
  const periodEndIso = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

  await pool.query(
    `INSERT INTO lt_subscriptions
       (agent_id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL DO UPDATE
       SET plan_id = EXCLUDED.plan_id,
           status = EXCLUDED.status,
           current_period_end = EXCLUDED.current_period_end,
           updated_at = now()`,
    [agentId, planId, sub.status, customerId, sub.id, periodEndIso]
  )
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
