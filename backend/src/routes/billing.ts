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
import { creditBalance, featureCatalog, resetCreditsOnConversion, DEV_TRIAL_CREDITS, DEV_TRIAL_DAYS } from '../luna-tour/credits'
import { clearAgentGate } from '../middleware/mapMeter'
import { sendAlertEmail } from '../services/notify'

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
    brand: { title: '置业顾问', accent: '#00E0B8' },
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

/** 渲染"新订阅"通知邮件:带 Pinzos logo 的品牌化 HTML + 纯文本兜底。 */
function renderSubscriptionEmail(d: {
  who: string
  planName: string
  amount: number
  ccy: string
  intervalCn: string
  trialing: boolean
  subId: string
}): { subject: string; text: string; html: string } {
  const stripeUrl = `https://dashboard.stripe.com/subscriptions/${d.subId}`
  const priceLine = `$${d.amount} ${d.ccy} / ${d.intervalCn}`
  const statusText = d.trialing ? '7 天免费试用中(7 天后首次扣款)' : '已立即扣款'
  const statusColor = d.trialing ? '#0284c7' : '#16a34a'
  const subject = `🎉 新订阅:${d.planName} — ${d.who}`
  const text = `${d.who} 刚订阅了 ${d.planName}(${priceLine}),${statusText}。\n\nStripe 订阅详情:${stripeUrl}`
  const row = (label: string, value: string, color = '#0f172a') =>
    `<tr><td style="padding:11px 0;border-top:1px solid #eef0f2;color:#64748b;font-size:14px;">${label}</td>` +
    `<td style="padding:11px 0;border-top:1px solid #eef0f2;text-align:right;color:${color};font-size:14px;font-weight:600;">${value}</td></tr>`
  const html = `<div style="background:#f4f5f7;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;">
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(15,23,42,0.08);">
        <tr><td style="padding:20px 28px;border-bottom:1px solid #eef0f2;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle;"><img src="https://www.pinzos.com/icon-192.png" width="30" height="30" alt="Pinzos" style="display:block;border-radius:7px;"></td>
            <td style="vertical-align:middle;padding-left:10px;font-size:18px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">Pinzos</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px;">
          <div style="font-size:12px;font-weight:700;color:#0d9488;letter-spacing:0.06em;">🎉 新订阅</div>
          <div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:8px;line-height:1.3;word-break:break-all;">${d.who}</div>
          <div style="font-size:15px;color:#475569;margin-top:4px;">订阅了 <b style="color:#0f172a;">${d.planName}</b></div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
            ${row('套餐', d.planName)}
            ${row('价格', priceLine)}
            ${row('状态', statusText, statusColor)}
          </table>
          <a href="${stripeUrl}" style="display:block;margin-top:24px;background:#0d9488;color:#ffffff;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-size:15px;font-weight:600;">在 Stripe 查看订阅 →</a>
        </td></tr>
      </table>
      <div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:16px;">Pinzos · 迪拜期房购买新方式</div>
    </td></tr>
  </table>
</div>`
  return { subject, text, html }
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
        // 2026-07-11:Stripe 侧不再给 trial_period_days。试用改走「免绑卡试用」
        // (POST /trial/start,7 天 200 积分,零摩擦),到这一步的人是真心要付费的
        // → 立即扣款生效。留着 Stripe trial 会让"免绑卡试 7 天 + 绑卡再送 7 天"变成 14 天白嫖。
        metadata: { lt_agent_id: agent.id, plan_id: planId, interval },
      },
      payment_method_collection: 'always',
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
// POST /trial/start — 免绑卡试用(2026-07-11)
//
// 从业者角色(经纪/经纪公司/开发商)零摩擦开 7 天 Starter 试用:不跳 Stripe、不收卡。
// 试用行 source='free_trial',plan=rookie(200 积分)。到期/积分用完 → 回落 explore。
// 插进 lt_subscriptions 之后,下面这些全是免费搭车的:
//   credits.planFor → 200 积分 / mapMeter.agentNeedsPlan → 地图解锁 / agents.ts → 自动审批
// ============================================================
const TRIAL_DAYS = Number(process.env.FREE_TRIAL_DAYS || 7)
// 试用发 Pro(agent)档的**功能权限** —— 发 Starter 的话实时带看/Luna 导览
// (minPlan='agent')试不到,旗舰功能试不到的试用等于没试。
// 积分不吃 Pro 的 1200:credits.planFor 对 free_trial 硬锁 TRIAL_CREDITS=200。
const TRIAL_PLAN = 'agent'
const TRIAL_ROLES = ['agent', 'agency', 'developer'] as const

router.post('/trial/start', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })

  try {
    // 角色:选付费角色时前端不预写 role(见 RoleSelectPage) → 允许请求带上想要的角色。
    // 开试用是足够强的意图信号,这里把 role 落定。
    const prof = await pool.query<{ role: string | null }>(
      `SELECT role FROM user_profiles WHERE lower(email) = lower($1)`,
      [agent.email]
    )
    const wanted = String(req.body?.role || '')
    const existing = prof.rows[0]?.role || ''
    const role = (TRIAL_ROLES as readonly string[]).includes(existing)
      ? existing
      : (TRIAL_ROLES as readonly string[]).includes(wanted) ? wanted : ''
    if (!role) {
      return res.status(403).json({ success: false, code: 'not_agent', error: '免费试用面向经纪/经纪公司/开发商。' })
    }

    // 一人一次(靠 lt_agents 上的戳,不靠订阅行 —— 删掉行就能反复重开)
    const a = await pool.query<{ free_trial_started_at: Date | null }>(
      `SELECT free_trial_started_at FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    if (a.rows[0]?.free_trial_started_at) {
      return res.status(409).json({ success: false, code: 'trial_used', error: '免费试用已用过,订阅即可继续使用。' })
    }

    // 已有生效订阅(含团队席位/comp 授予)→ 没必要试用
    const billingRow = await pool.query<{ billing_agent_id: string | null }>(
      `SELECT billing_agent_id FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    const billingId = billingRow.rows[0]?.billing_agent_id || agent.id
    const live = await pool.query(
      `SELECT 1 FROM lt_subscriptions
        WHERE agent_id = $1 AND status IN ('active','trialing')
          AND (source <> 'free_trial' OR current_period_end > now())
        LIMIT 1`,
      [billingId]
    )
    if (live.rows.length) {
      return res.status(409).json({ success: false, code: 'already_subscribed', error: '你已有生效的套餐。' })
    }

    const endsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString()
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
         VALUES ($1, $2, 'trialing', 'free_trial', $3)`,
      [agent.id, TRIAL_PLAN, endsAt]
    )
    await pool.query(`UPDATE lt_agents SET free_trial_started_at = now() WHERE id = $1`, [agent.id])

    // role 落定。⚠️ 必须 upsert:选付费角色的用户前端不预写 role,可能连 user_profiles
    // 行都还没有 —— autoApprovePaid 里那句 UPDATE 会是空操作。这里按 user_id(主键)写。
    const userId = req.user?.id || req.ctx?.userId
    if (userId) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, email, role, role_chosen_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
           SET role = EXCLUDED.role,
               email = COALESCE(EXCLUDED.email, user_profiles.email),
               role_chosen_at = now(),
               updated_at = now()`,
        [userId, agent.email, role]
      )
    }

    // 试用即准入(与付费同款):审批门放行
    await autoApprovePaid(agent.email, agent.name, role)
    clearAgentGate(userId)
    await logPlanChange({
      agentId: agent.id, agentEmail: agent.email, action: 'free_trial_started',
      fromPlan: 'explore', toPlan: TRIAL_PLAN, fromStatus: 'none', toStatus: 'trialing',
      metadata: { role, days: TRIAL_DAYS },
    })

    const credits = await creditBalance(agent.id)
    res.json({
      success: true,
      trial: { plan: TRIAL_PLAN, endsAt, days: TRIAL_DAYS, credits: credits.creditsMonth },
    })
  } catch (err) {
    console.error('[billing] trial/start failed:', err)
    res.status(500).json({ success: false, error: '开通试用失败,请重试' })
  }
})

// ============================================================
// 开发商验证 → 加长试用 (2026-07-11)
//
// 策略:开发商提供的是**供给**(楼盘/户型/付款计划),那是买家和经纪来这儿的理由。
// 先把他们喂饱、用习惯、成为行业标准。7 天对一个要走内部流程整理楼书的开发商太短。
//
// 但 /choose-role 上人人都能点「我是开发商」→ 若开发商自助就能拿 30 天而经纪只有
// 7 天,所有经纪都会去点开发商。所以:
//   自助开试用   = 7 天 / 200 分(所有角色一样,含开发商)
//   开发商验证后 = 30 天 / 600 分(owner 在 admin 一键批;楼书 40 分/份 → 600≈15 份)
// ============================================================

// POST /developer/verify-request { company, website?, note? } — 申请开发商验证
router.post('/developer/verify-request', requireAuth, async (req: Request, res: Response) => {
  const agent = await currentAgent(req)
  if (!agent) return res.status(401).json({ success: false, error: 'Auth required' })

  const company = String(req.body?.company || '').trim().slice(0, 200)
  const website = String(req.body?.website || '').trim().slice(0, 300) || null
  const note = String(req.body?.note || '').trim().slice(0, 1000) || null
  if (!company) return res.status(400).json({ success: false, error: '请填写公司名称' })

  try {
    const userId = req.user?.id || req.ctx?.userId || null
    await pool.query(
      `INSERT INTO developer_verifications (agent_id, user_id, email, company, website, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT (agent_id) DO UPDATE
         SET company = EXCLUDED.company, website = EXCLUDED.website, note = EXCLUDED.note,
             status = 'pending', decided_by = NULL, decided_at = NULL, created_at = now()`,
      [agent.id, userId, agent.email, company, website, note]
    )
    await sendAlertEmail(
      `开发商验证申请:${company}`,
      `${agent.email}(${company})申请开发商验证。网站:${website || '未填'}\n说明:${note || '无'}\n\n去 /admin/analytics 的「开发商验证」审批。`
    ).catch(() => { /* best-effort */ })
    res.json({ success: true })
  } catch (err) {
    console.error('[billing] developer verify-request failed:', err)
    res.status(500).json({ success: false, error: '提交失败,请重试' })
  }
})

// GET /admin/developer-verifications — 待审列表
router.get('/admin/developer-verifications', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.agent_id, v.email, v.company, v.website, v.note, v.status,
              v.decided_by, v.decided_at, v.created_at,
              a.display_name, a.developer_verified_at,
              s.current_period_end AS trial_ends_at, s.trial_credits
         FROM developer_verifications v
         LEFT JOIN lt_agents a ON a.id = v.agent_id
         LEFT JOIN lt_subscriptions s
           ON s.agent_id = v.agent_id AND s.source = 'free_trial' AND s.status = 'trialing'
        ORDER BY (v.status = 'pending') DESC, v.created_at DESC
        LIMIT 200`
    )
    res.json({ success: true, verifications: rows })
  } catch (err) {
    console.error('[billing] developer-verifications list failed:', err)
    res.status(500).json({ success: false })
  }
})

// POST /admin/developer-verifications/:id/decide { action: 'approve'|'reject' }
// approve → 发一条**全新的** 30 天 / 600 分试用(从审批日起算,语义干净),并落 developer 角色
router.post('/admin/developer-verifications/:id/decide', requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const action = String(req.body?.action || '')
  if (!Number.isFinite(id) || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'bad request' })
  }
  const decidedBy = (req.user?.email as string) || 'admin'

  try {
    const v = await pool.query<{ agent_id: string; user_id: string | null; email: string; company: string }>(
      `SELECT agent_id, user_id, email, company FROM developer_verifications WHERE id = $1`,
      [id]
    )
    if (!v.rows[0]) return res.status(404).json({ success: false, error: 'not found' })
    const { agent_id: agentId, user_id: userId, email, company } = v.rows[0]

    await pool.query(
      `UPDATE developer_verifications SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
      [id, action === 'approve' ? 'approved' : 'rejected', decidedBy]
    )

    if (action === 'reject') {
      // 拒绝不动他现有的 7 天自助试用 —— 他仍然是个可能付费的用户,别把人赶走
      return res.json({ success: true, status: 'rejected' })
    }

    // ── 通过 ────────────────────────────────────────────────
    const endsAt = new Date(Date.now() + DEV_TRIAL_DAYS * 86400_000).toISOString()
    // 换发新试用行:旧的 7 天/200 分行删掉,新行 created_at=now → 用量从今天重新算
    // (usedFor 按 trialStart 累计流水,不按自然月)
    await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id = $1 AND source = 'free_trial'`, [agentId])
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end, trial_credits)
         VALUES ($1, $2, 'trialing', 'free_trial', $3, $4)`,
      [agentId, TRIAL_PLAN, endsAt, DEV_TRIAL_CREDITS]
    )
    await pool.query(
      `UPDATE lt_agents SET developer_verified_at = now(),
              free_trial_started_at = COALESCE(free_trial_started_at, now())
        WHERE id = $1`,
      [agentId]
    )

    // role=developer 是 can-upload 的前提(agents.ts:168)—— 没有它,验证过的开发商
    // 仍然传不了楼书。按 user_id(主键)upsert;没有 user_id 时退回按 email 更新。
    if (userId) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, email, role, role_chosen_at)
           VALUES ($1, $2, 'developer', now())
         ON CONFLICT (user_id) DO UPDATE
           SET role = 'developer', role_chosen_at = now(), updated_at = now()`,
        [userId, email]
      )
    } else {
      await pool.query(
        `UPDATE user_profiles SET role = 'developer', updated_at = now() WHERE lower(email) = lower($1)`,
        [email]
      )
    }

    await autoApprovePaid(email, company, 'developer')
    await logPlanChange({
      agentId, agentEmail: email, action: 'developer_verified',
      fromPlan: 'explore', toPlan: TRIAL_PLAN, fromStatus: 'none', toStatus: 'trialing',
      metadata: { company, days: DEV_TRIAL_DAYS, credits: DEV_TRIAL_CREDITS, by: decidedBy },
    })
    clearAgentGate()

    res.json({ success: true, status: 'approved', trial: { endsAt, days: DEV_TRIAL_DAYS, credits: DEV_TRIAL_CREDITS } })
  } catch (err) {
    console.error('[billing] developer verify decide failed:', err)
    res.status(500).json({ success: false, error: '操作失败' })
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
/**
 * 打开账单页时向 Stripe 拉最新订阅状态自愈到 DB(webhook 可能漏/延迟 → 正规 SaaS 不能只靠 webhook)。
 * 拿该经纪最近一条有 stripe_subscription_id 的订阅,retrieve 后走 upsertSubscription 同步
 * (status / cancel_at_period_end / current_period_end)。best-effort,失败不阻断 /me。
 */
async function syncLatestSubFromStripe(agentId: string): Promise<void> {
  const stripe = getStripe()
  if (!stripe) return
  const r = await pool.query<{ stripe_subscription_id: string | null }>(
    `SELECT stripe_subscription_id FROM lt_subscriptions
       WHERE agent_id = $1 AND stripe_subscription_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  )
  const subId = r.rows[0]?.stripe_subscription_id
  if (!subId) return
  try {
    const sub = await stripe.subscriptions.retrieve(subId)
    await upsertSubscription(sub)
  } catch (e) {
    console.warn('[billing] lazy sync failed:', (e as Error).message)
  }
}

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

    // 先向 Stripe 拉实时状态自愈(修「取消了但 DB 没更新」)。
    await syncLatestSubFromStripe(billingId).catch(() => { /* best-effort */ })

    const sub = await pool.query<{
      plan_id: string
      status: string
      current_period_end: Date | null
      cancel_at_period_end: boolean
      source: string
    }>(
      `SELECT plan_id, status, current_period_end, cancel_at_period_end, source FROM lt_subscriptions
         WHERE agent_id = $1 AND status IN ('active', 'trialing', 'past_due')
           AND (source <> 'free_trial' OR current_period_end > now())
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

    // 下次积分重置 = 下月 1 日 0 点 UTC(lt_usage_counters 按 period_month 分行,新月归零)。
    const now = new Date()
    const creditsResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()

    // 免绑卡试用状态(试用是个人的 → 看 agent.id,不是团队的 billingId)。
    // used=true 的人不能再开试用,定价页 CTA 要回落成「立即订阅」。
    const ftRow = await pool.query<{ free_trial_started_at: Date | null; developer_verified_at: Date | null }>(
      `SELECT free_trial_started_at, developer_verified_at FROM lt_agents WHERE id = $1`,
      [agent.id]
    )
    const onFreeTrial = sub.rows[0]?.source === 'free_trial' && status === 'trialing'
    const trialEnd = onFreeTrial ? sub.rows[0]?.current_period_end || null : null
    const trialUsed = !!ftRow.rows[0]?.free_trial_started_at

    // 当前身份(前端付款回跳的 role 兜底要用:只在没有 role 时才写,
    // 否则开发商买 Pro 会被兜底改写成 agent → 丢掉楼书上传权限)
    const roleRow = await pool.query<{ role: string | null }>(
      `SELECT role FROM user_profiles WHERE lower(email) = lower($1)`,
      [agent.email]
    )
    const myRole = roleRow.rows[0]?.role || null

    // 「还没领免费试用」—— 老用户(选完角色就走 / 早于试用上线注册的)在产品里
    // 看不到任何入口,只会看到一张"未订阅 · 剩 0/0 积分"的死卡片。前端据此
    // 在个人中心和经纪台顶部长出「一键领取」。
    const trial = {
      active: onFreeTrial,
      used: trialUsed,
      eligible:
        !trialUsed &&
        status === 'none' &&                                        // 没有任何生效订阅
        !!myRole && TRIAL_ROLES.includes(myRole as typeof TRIAL_ROLES[number]),
      endsAt: trialEnd,
      daysLeft: trialEnd
        ? Math.max(0, Math.ceil((new Date(trialEnd).getTime() - now.getTime()) / 86400_000))
        : null,
    }

    // 开发商验证状态(前端据此展示「申请验证 → 30 天/600 分」入口或"审核中"）
    const dv = await pool.query<{ status: string }>(
      `SELECT status FROM developer_verifications WHERE agent_id = $1`,
      [agent.id]
    )
    const developer = {
      verified: !!ftRow.rows[0]?.developer_verified_at,
      verification: dv.rows[0]?.status || null,   // null | pending | approved | rejected
    }

    res.json({
      success: true,
      approved: agent.approved,
      plan: { id: planId, name: planRow.rows[0]?.name || 'Explore', limits },
      status,
      trial,
      developer,
      role: myRole,
      current_period_end: sub.rows[0]?.current_period_end || null,
      cancel_at_period_end: !!sub.rows[0]?.cancel_at_period_end, // true = 已约定期末取消,期内仍可用
      credits_reset_at: creditsResetAt,
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
    const target = await ensureAgent({ email, displayName: email.split('@')[0], brand: { title: '置业顾问', accent: '#00E0B8' } })
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

/**
 * 订阅(付费或免绑卡试用)生效即自动审批(=准入;owner 后台可撤销),并把角色同步。
 * role 默认 'agent';免绑卡试用会传入用户选的 agency/developer。
 */
async function autoApprovePaid(email: string | null, name: string | null, role = 'agent'): Promise<void> {
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
    // 持有经纪订阅的人就是经纪 —— role 同步,避免「买家身份持有经纪订阅」的错位
    await pool.query(
      `UPDATE user_profiles SET role = $2, role_chosen_at = COALESCE(role_chosen_at, now()), updated_at = now()
        WHERE lower(email) = lower($1) AND (role IS NULL OR role = 'buyer')`,
      [email, role]
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

  // ── 免绑卡试用 → 付费转化 ────────────────────────────────
  // 试用行的 stripe_subscription_id 是 NULL,匹配不上下面的 ON CONFLICT(它按
  // stripe_subscription_id 去重)→ 不删的话同一个 agent 会留下两行订阅。
  // ⚠️ 只在订阅真正生效时删:subscription.created 可能先带 incomplete 状态(3DS 验证中),
  //    那时就删会在付款还没成功时干掉人家的试用 —— 付款再失败就两头空。
  const live = sub.status === 'active' || sub.status === 'trialing'
  let cameFromTrial = false
  if (live) {
    const ft = await pool.query(
      `DELETE FROM lt_subscriptions WHERE agent_id = $1 AND source = 'free_trial' RETURNING id`,
      [agentId]
    )
    cameFromTrial = (ft.rowCount ?? 0) > 0
  }

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
    const action = cameFromTrial
      ? 'trial_converted'                                       // 免绑卡试用 → 掏钱(最想看的那个数)
      : sub.status === 'trialing' ? 'trial_started' : 'subscribed'
    await logPlanChange({ ...base, action, fromPlan: cameFromTrial ? TRIAL_PLAN : null })
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

  // 免绑卡试用 → 付费:把试用期花掉的积分清零,否则同月内「付了钱余额还是空的」。
  if (live && cameFromTrial) {
    await resetCreditsOnConversion(agentId).catch((e) => console.error('[billing] trial credit reset failed:', e))
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
        // ⚠️ 绝不能把 developer/agency 降级成 agent。开发商买 Pro($49,plan=agent)是
        // 允许的(定价页给了这个便宜入口),但 role 一旦被改写成 'agent',
        // agents.ts 的 can-upload(要求 role='developer')就会把他的楼书上传权限没收。
        // 所以:plan 推出的 role 是 'agent' 时,只在当前身份是 null/buyer/agent 时才写。
        await pool.query(
          `UPDATE user_profiles SET role = $2, role_chosen_at = now(), updated_at = now()
            WHERE lower(email) = lower($1)
              AND ($2 <> 'agent' OR role IS NULL OR role IN ('buyer', 'agent'))`,
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
          // Notify owner + partner of a new subscription (best-effort; no-op if email unconfigured).
          try {
            const item = sub.items.data[0]
            const priceId = item?.price?.id
            let planName = '套餐'
            if (priceId) {
              const { rows } = await pool.query<{ name: string }>(
                `SELECT name FROM lt_subscription_plans WHERE stripe_price_id = $1 OR stripe_price_id_year = $1 LIMIT 1`,
                [priceId]
              )
              planName = rows[0]?.name || (await planForPriceId(priceId)) || '套餐'
            }
            const interval = item?.price?.recurring?.interval || 'month'
            const { subject, text, html } = renderSubscriptionEmail({
              who: session.customer_details?.email || session.customer_email || '未知邮箱',
              planName,
              amount: (item?.price?.unit_amount ?? 0) / 100,
              ccy: (item?.price?.currency || 'usd').toUpperCase(),
              intervalCn: interval === 'year' ? '年' : '月',
              trialing: sub.status === 'trialing',
              subId: sub.id,
            })
            await sendAlertEmail(subject, text, html)
          } catch (e) {
            console.error('[billing] subscribe notify failed:', e)
          }
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
