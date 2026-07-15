/**
 * 经纪推荐计划 — 核心逻辑(2026-07-14)
 * Spec: docs/referral-program-spec.md
 * 行业标准查证: docs/reports/2026-07-14-referral-attribution-standards.md
 *
 * 经纪分享 /i/:code → 新经纪注册并**真实付费** → 每 3 个合格推荐,推荐人得 1 个月订阅费抵扣。
 *
 * 归因是两段式的(全行业做法,四家主流平台一致):
 *   1) cookie 阶段 —— 60 天窗口,last-click 可覆盖。活在前端 localStorage,只负责把人送到注册。
 *   2) 注册即锁定 —— attach() 把 token 写进 lt_referral_attributions,UNIQUE(referee_agent_id)
 *      物理保证一人只能被归因一次。此后 cookie 过期、再点别人的链接,都抢不走。
 *      (Tapfiliate 原话:"permanently attributed … regardless of cookies or future links")
 *
 * 钱的判据只有一个:**Stripe 的 invoice.paid 且 amount_paid > 0**。
 * ⚠️ 绝不能用 `stripe_subscription_id IS NULL` 判断是否付过费 —— 后台 comp 授予也是 NULL
 *    (见 db/free-trial-migration.sql:9 的警告)。免费试用的 $0 发票同样不算。
 */
import crypto from 'crypto'
import type Stripe from 'stripe'
import pool from '../db/pool'

// ── 参数(全部对齐行业标准,见查证报告)────────────────────────────────
/** cookie 窗口:点击 → 注册。Rewardful / FirstPromoter 默认都是 60 天。 */
export const COOKIE_WINDOW_DAYS = Number(process.env.REFERRAL_COOKIE_DAYS || 60)
/** 转化死线:注册 → 首次付费。奖励是**一次性**的免费月,没有 recurring 佣金那种
 *  「12 个月封顶」的自然衰减,不设死线的话两年后才付费的人也会触发发奖。 */
export const CONVERSION_WINDOW_DAYS = Number(process.env.REFERRAL_CONVERSION_DAYS || 180)
/** clawback hold:付费 → 计入进度。行业基准 30 天(跨过退款/拒付窗口)。 */
export const HOLD_DAYS = Number(process.env.REFERRAL_HOLD_DAYS || 30)
/** 几个合格推荐换一个月。 */
export const REFERRALS_PER_REWARD = Number(process.env.REFERRAL_PER_REWARD || 3)
/** 发放速率上限(防刷):每自然年最多几个免费月。超出 → reward 记 blocked,转人工。 */
export const MAX_REWARDS_PER_YEAR = Number(process.env.REFERRAL_MAX_PER_YEAR || 6)
/** 被推荐人只有账号足够新才能被归因(防止老用户被「抢注」)。 */
export const MAX_ACCOUNT_AGE_DAYS = Number(process.env.REFERRAL_MAX_ACCOUNT_AGE_DAYS || 30)

/** 被推荐人的首月折扣券(Stripe coupon id;由 scripts/setup-referral-coupon.ts 创建)。 */
export const REFERRAL_COUPON_ID = process.env.STRIPE_REFERRAL_COUPON || 'REFERRED_FIRST_MONTH_20'

export type AttrStatus = 'attached' | 'pending' | 'qualified' | 'expired' | 'revoked'

export interface AttachResult {
  ok: boolean
  code?:
    | 'bad_code'          // 码不存在
    | 'self_referral'     // 推自己
    | 'already_attached'  // 已被归因过(含被别人归因)
    | 'existing_customer' // 已付过费的老用户,不能被抢注
    | 'account_too_old'   // 账号太老,不是新用户
}

// ============================================================================
// 推荐码
// ============================================================================

/** 短码:去掉 0/o/1/l 这类易混字符(与 agent-router 的 share code 同构)。 */
function randomCode(len = 6): string {
  const alpha = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) s += alpha[bytes[i] % alpha.length]
  return s
}

/** 读该经纪的推荐码,没有就懒生成。并发安全:靠部分唯一索引 + 冲突重试。 */
export async function ensureReferralCode(agentId: string): Promise<string> {
  const { rows } = await pool.query<{ referral_code: string | null }>(
    `SELECT referral_code FROM lt_agents WHERE id = $1`,
    [agentId]
  )
  if (rows[0]?.referral_code) return rows[0].referral_code

  for (let i = 0; i < 8; i++) {
    const code = randomCode(6)
    try {
      // WHERE referral_code IS NULL:并发时只有一个能写进去,输家下一轮读到赢家的码
      const upd = await pool.query<{ referral_code: string }>(
        `UPDATE lt_agents SET referral_code = $2
          WHERE id = $1 AND referral_code IS NULL
          RETURNING referral_code`,
        [agentId, code]
      )
      if (upd.rowCount) return upd.rows[0].referral_code
      // 没更新到 = 并发时别人先写了 → 读回来
      const again = await pool.query<{ referral_code: string | null }>(
        `SELECT referral_code FROM lt_agents WHERE id = $1`,
        [agentId]
      )
      if (again.rows[0]?.referral_code) return again.rows[0].referral_code
    } catch (e) {
      // 唯一索引冲突(撞码)→ 换一个再试
      if ((e as { code?: string }).code !== '23505') throw e
    }
  }
  throw new Error('[referral] failed to allocate a unique code after 8 tries')
}

// ============================================================================
// 「付过钱吗」—— 这个判据全站没有,必须新写
// ============================================================================

/**
 * 该经纪**产生过真实付款**吗?
 *
 * ⚠️ 三个都不能用:
 *   - `stripe_subscription_id IS NULL` → 后台 comp 授予也是 NULL(会把 comp 当成付费)
 *   - `status IN ('active','trialing')` → 免绑卡试用也是 trialing
 *   - `source <> 'free_trial'`         → 把 comp 算进来了,comp 没付过钱
 *
 * 唯一可靠:source='stripe' 且有真实 subscription id。付费历史(含已取消的)也算 ——
 * 曾经付过钱的人就是老客户,不能被当成「新推荐」抢注。
 */
export async function hasEverPaid(agentId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM lt_subscriptions
      WHERE agent_id = $1 AND source = 'stripe' AND stripe_subscription_id IS NOT NULL
      LIMIT 1`,
    [agentId]
  )
  if (rowCount) return true
  // 兜底:订阅行可能被清理过,但审计流水是永久的
  const { rowCount: logged } = await pool.query(
    `SELECT 1 FROM plan_change_log
      WHERE agent_id = $1 AND action IN ('subscribed','trial_converted')
      LIMIT 1`,
    [agentId]
  )
  return !!logged
}

// ============================================================================
// attach —— 归因落地(注册即锁定)
// ============================================================================

/**
 * 把新经纪钉到推荐人身上。幂等:重复调用返回 already_attached,不会改归属。
 *
 * 校验顺序有讲究:先查「已归因」再查其它 —— 重复调用是最常见的路径(前端每次
 * SIGNED_IN 都会试),它应该走最短的分支。
 */
export async function attach(opts: {
  code: string
  refereeAgentId: string
  refereeUserId?: string | null
  refereeEmail?: string | null
  ip?: string | null
}): Promise<AttachResult> {
  const code = String(opts.code || '').trim().toLowerCase()
  if (!code) return { ok: false, code: 'bad_code' }

  // 已经被归因过 → 永久锁定,谁也抢不走(含「被别人归因」的情况)
  const { rowCount: already } = await pool.query(
    `SELECT 1 FROM lt_referral_attributions WHERE referee_agent_id = $1`,
    [opts.refereeAgentId]
  )
  if (already) return { ok: false, code: 'already_attached' }

  // 码 → 推荐人
  const ref = await pool.query<{ id: string; email: string | null }>(
    `SELECT id, email FROM lt_agents WHERE referral_code = $1`,
    [code]
  )
  const referrer = ref.rows[0]
  if (!referrer) return { ok: false, code: 'bad_code' }

  // 不能推自己(agent id / email 双查;DB CHECK 是最后兜底)
  const refereeEmail = (opts.refereeEmail || '').toLowerCase().trim()
  if (
    referrer.id === opts.refereeAgentId ||
    (refereeEmail && (referrer.email || '').toLowerCase().trim() === refereeEmail)
  ) {
    return { ok: false, code: 'self_referral' }
  }

  // 老客户不能被抢注 —— 没有任何 affiliate 平台默认提供这条规则,必须自己写
  // (Tapfiliate 官方原话:"You must implement custom logic")
  if (await hasEverPaid(opts.refereeAgentId)) {
    return { ok: false, code: 'existing_customer' }
  }

  // 必须是新用户:老账号今天点了个链接就算别人推荐的,那是白送
  const age = await pool.query<{ too_old: boolean }>(
    `SELECT (created_at < now() - ($2 || ' days')::interval) AS too_old
       FROM lt_agents WHERE id = $1`,
    [opts.refereeAgentId, String(MAX_ACCOUNT_AGE_DAYS)]
  )
  if (age.rows[0]?.too_old) return { ok: false, code: 'account_too_old' }

  // 风控打标(不拦,只标记 —— sweep 到 qualified 时会挡住带 flag 的,转人工)
  const riskFlags: string[] = []
  if (opts.ip) {
    const sameIp = await pool.query(
      `SELECT 1 FROM lt_referral_attributions
        WHERE referrer_agent_id = $1 AND attach_ip = $2 LIMIT 1`,
      [referrer.id, opts.ip]
    )
    if (sameIp.rowCount) riskFlags.push('same_ip_as_prior_referral')
  }

  try {
    await pool.query(
      `INSERT INTO lt_referral_attributions
         (referrer_agent_id, referee_agent_id, referee_user_id, referee_email, code,
          status, expires_at, attach_ip, risk_flags)
       VALUES ($1, $2, $3, $4, $5, 'attached', now() + ($6 || ' days')::interval, $7, $8::jsonb)`,
      [
        referrer.id, opts.refereeAgentId, opts.refereeUserId || null, refereeEmail || null, code,
        String(CONVERSION_WINDOW_DAYS), opts.ip || null, JSON.stringify(riskFlags),
      ]
    )
  } catch (e) {
    // 并发双写 → UNIQUE(referee_agent_id) 挡住,和「已归因」是同一个结果
    if ((e as { code?: string }).code === '23505') return { ok: false, code: 'already_attached' }
    throw e
  }
  console.log(`[referral] attached: ${refereeEmail || opts.refereeAgentId} ← ${code}`)
  return { ok: true }
}

// ============================================================================
// qualify —— 真实付款把 attached 推进 pending(30 天 hold 起算)
// ============================================================================

/**
 * webhook 收到 invoice.paid 时调。**只认第一笔真钱**:
 *   amount_paid > 0（$0 试用发票不算）+ status='attached'（已 pending/qualified 的不重复推进）
 * first_invoice_id 让同一张发票重放保持幂等。
 */
export async function markPaid(agentId: string, invoiceId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE lt_referral_attributions
        SET status = 'pending', first_paid_at = now(), first_invoice_id = $2, updated_at = now()
      WHERE referee_agent_id = $1
        AND status = 'attached'
        AND expires_at > now()`,   // 超过转化死线的不再算数
    [agentId, invoiceId]
  )
  if (rowCount) {
    console.log(`[referral] referee ${agentId} paid (invoice ${invoiceId}) → hold ${HOLD_DAYS}d`)
    return true
  }
  return false
}

/**
 * 退款 / 拒付 → 撤销。
 *
 * 已发放的奖励**不追回**(Stripe 余额可能已被消费),但 qualified 计数下降会让下一档
 * milestone 推迟到达 —— 天然完成 clawback,不需要额外逻辑。
 */
export async function revoke(agentId: string, reason: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE lt_referral_attributions
        SET status = 'revoked', revoked_at = now(), revoked_reason = $2, updated_at = now()
      WHERE referee_agent_id = $1
        AND status IN ('pending', 'qualified')`,
    [agentId, reason]
  )
  if (rowCount) console.warn(`[referral] revoked referral of ${agentId}: ${reason}`)
  return !!rowCount
}

// ============================================================================
// 发奖
// ============================================================================

/**
 * hold 期满的 pending → qualified。带风控 flag 的**不自动放行**,留给人工。
 * 返回受影响的推荐人 id(去重),交给 grantDueRewards 结算。
 */
export async function promoteHeldReferrals(): Promise<string[]> {
  const { rows } = await pool.query<{ referrer_agent_id: string }>(
    `UPDATE lt_referral_attributions
        SET status = 'qualified', qualified_at = now(), updated_at = now()
      WHERE status = 'pending'
        AND first_paid_at <= now() - ($1 || ' days')::interval
        AND risk_flags = '[]'::jsonb
      RETURNING referrer_agent_id`,
    [String(HOLD_DAYS)]
  )
  return [...new Set(rows.map((r) => r.referrer_agent_id))]
}

/** attached 超过转化死线仍未付费 → expired。 */
export async function expireStaleReferrals(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE lt_referral_attributions
        SET status = 'expired', updated_at = now()
      WHERE status = 'attached' AND expires_at <= now()`
  )
  return rowCount ?? 0
}

/**
 * 按 qualified 数结算 milestone。
 *
 * UNIQUE(agent_id, milestone_index) 是**防重复发奖的唯一防线** —— 并发的 sweep 与
 * webhook 同时算出「第 2 档达标」时,只有一个能 INSERT 成功,另一个 ON CONFLICT 落空。
 * 比「先 SELECT 再 INSERT」的检查安全得多。
 */
export async function grantDueRewards(agentId: string): Promise<number> {
  const q = await pool.query<{ id: string }>(
    `SELECT id FROM lt_referral_attributions
      WHERE referrer_agent_id = $1 AND status = 'qualified'
      ORDER BY qualified_at ASC`,
    [agentId]
  )
  const qualified = q.rows
  const targetMilestones = Math.floor(qualified.length / REFERRALS_PER_REWARD)
  if (targetMilestones < 1) return 0

  // 今年已发几个(速率上限)
  const yr = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM lt_referral_rewards
      WHERE agent_id = $1 AND status IN ('pending','applied')
        AND created_at >= date_trunc('year', now())`,
    [agentId]
  )
  let grantedThisYear = Number(yr.rows[0]?.n || 0)

  let created = 0
  for (let m = 1; m <= targetMilestones; m++) {
    // 这一档是哪几个人凑的(可回溯)
    const slice = qualified.slice((m - 1) * REFERRALS_PER_REWARD, m * REFERRALS_PER_REWARD)
    const overLimit = grantedThisYear >= MAX_REWARDS_PER_YEAR
    const ins = await pool.query<{ id: string }>(
      `INSERT INTO lt_referral_rewards (agent_id, milestone_index, kind, status, attribution_ids)
       VALUES ($1, $2, 'free_month', $3, $4::bigint[])
       ON CONFLICT (agent_id, milestone_index) DO NOTHING
       RETURNING id`,
      [agentId, m, overLimit ? 'blocked' : 'pending', slice.map((r) => r.id)]
    )
    if (ins.rowCount) {
      created++
      if (!overLimit) grantedThisYear++
      console.log(
        `[referral] milestone #${m} reached by agent ${agentId}` +
        (overLimit ? ' → BLOCKED (rate limit, needs manual review)' : '')
      )
    }
  }
  return created
}

/**
 * 把未落账的 reward 打进 Stripe customer balance(负数余额 = credit,下张发票自动抵扣)。
 *
 * 为什么不直接改 lt_subscriptions.current_period_end:那样会和 Stripe 的真实计费周期
 * 脱节 —— Stripe 照样在原日期扣款,DB 说「免费到下个月」,两边打架。让 Stripe 当唯一真相源。
 *
 * 金额**在这里现算**,不在达标时算:
 *   月付 → unit_amount;年付 → round(unit_amount / 12)
 * 这样币种绝对正确(直接取 Stripe price 的 currency),且年付用户拿不到月付牌价的套利。
 *
 * 还没订阅的人(试用中/无 customer)→ 保持 pending,等 checkout.session.completed 再来调。
 */
export async function applyPendingRewards(stripe: Stripe, agentId: string): Promise<number> {
  const { rows } = await pool.query<{ id: string; milestone_index: number }>(
    `SELECT id, milestone_index FROM lt_referral_rewards
      WHERE agent_id = $1 AND status IN ('pending','failed')
      ORDER BY milestone_index ASC`,
    [agentId]
  )
  if (!rows.length) return 0

  const a = await pool.query<{ stripe_customer_id: string | null }>(
    `SELECT stripe_customer_id FROM lt_agents WHERE id = $1`,
    [agentId]
  )
  const customerId = a.rows[0]?.stripe_customer_id
  if (!customerId) return 0 // 还没订阅 → 留着 pending,等他付费时 flush

  const price = await currentMonthlyPrice(stripe, agentId)
  if (!price) return 0 // 有 customer 但没活跃订阅 → 算不出「一个月值多少钱」,等他订阅

  let applied = 0
  for (const r of rows) {
    try {
      const txn = await stripe.customers.createBalanceTransaction(
        customerId,
        {
          amount: -price.amountCents, // 负数 = 给客户的 credit
          currency: price.currency,
          description: `Referral reward — milestone #${r.milestone_index} (${REFERRALS_PER_REWARD} paid referrals)`,
          metadata: { reward_id: r.id, lt_agent_id: agentId },
        },
        { idempotencyKey: `ref_reward_${r.id}` } // 重试安全:同一个 reward 永远只打一笔
      )
      await pool.query(
        `UPDATE lt_referral_rewards
            SET status = 'applied', amount_cents = $2, currency = $3,
                stripe_balance_txn_id = $4, applied_at = now(), last_error = NULL
          WHERE id = $1`,
        [r.id, price.amountCents, price.currency, txn.id]
      )
      applied++
      console.log(
        `[referral] 🎁 reward #${r.milestone_index} applied to agent ${agentId}: ` +
        `${(price.amountCents / 100).toFixed(2)} ${price.currency.toUpperCase()} credit`
      )
    } catch (e) {
      await pool.query(
        `UPDATE lt_referral_rewards
            SET status = 'failed', attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [r.id, String((e as Error).message).slice(0, 500)]
      )
      console.error(`[referral] reward ${r.id} apply failed:`, e)
    }
  }
  return applied
}

/** 该经纪当前订阅折算成「一个月值多少钱」(币种直接取 Stripe price,不猜)。 */
async function currentMonthlyPrice(
  stripe: Stripe,
  agentId: string
): Promise<{ amountCents: number; currency: string } | null> {
  const { rows } = await pool.query<{ stripe_subscription_id: string | null }>(
    `SELECT stripe_subscription_id FROM lt_subscriptions
      WHERE agent_id = $1 AND source = 'stripe' AND stripe_subscription_id IS NOT NULL
        AND status IN ('active','trialing','past_due')
      ORDER BY updated_at DESC LIMIT 1`,
    [agentId]
  )
  const subId = rows[0]?.stripe_subscription_id
  if (!subId) return null

  const sub = await stripe.subscriptions.retrieve(subId)
  const item = sub.items?.data?.[0]
  const unit = item?.price?.unit_amount
  const currency = item?.price?.currency
  const interval = item?.price?.recurring?.interval
  const count = item?.price?.recurring?.interval_count || 1
  if (!unit || !currency) return null

  // 年付 → 按 1/12 折算。否则 $249/年的人能拿到 $25 的月付牌价(套利)。
  let amountCents = unit
  if (interval === 'year') amountCents = Math.round(unit / (12 * count))
  else if (interval === 'month') amountCents = Math.round(unit / count) // 历史季付(_Q, count=3)
  else if (interval === 'week') amountCents = Math.round((unit / count) * 4.345)
  else if (interval === 'day') amountCents = Math.round((unit / count) * 30)

  return { amountCents, currency }
}

// ============================================================================
// 展示层
// ============================================================================

export type BadgeTier = 'none' | 'connector' | 'ambassador' | 'gold'

/**
 * 成就 badge —— 从 qualified 数**纯派生**,不需要新表新列。
 *
 * 🔴 只在经纪侧显示(推广面板/经纪台)。**绝不出现在客户可见的页面上**
 *    (/r/ 报告、/pp/ 报价单、/t/ /v/ tour、/cr/ 客户报告)。
 *    客户会把平台 badge 读成「这经纪被平台认证过专业度」,而它的实际含义是
 *    「这人拉了 3 个同行注册」—— 那是拿平台信誉给与专业度无关的行为背书,
 *    且一旦被识破,客户对页面上所有平台标识(包括真实资质)的信任都会一起打折。
 *    将来要做客户可见的信任 badge,条件必须换成成交量/评价/牌照,与拉人头解耦。
 */
export function computeBadge(qualifiedCount: number): { tier: BadgeTier; label: string; zh: string } {
  if (qualifiedCount >= 10) return { tier: 'gold', label: 'Gold Advocate', zh: '金牌推广' }
  if (qualifiedCount >= 3) return { tier: 'ambassador', label: 'Ambassador', zh: '推广大使' }
  if (qualifiedCount >= 1) return { tier: 'connector', label: 'Connector', zh: '引荐人' }
  return { tier: 'none', label: '', zh: '' }
}

/** 邮箱脱敏:推广面板给推荐人看进度,但不该把同行的完整邮箱端出去。 */
export function maskEmail(email: string | null): string {
  if (!email) return '—'
  const [user, domain] = email.split('@')
  if (!domain) return '—'
  const head = user.slice(0, 1)
  return `${head}${'*'.repeat(Math.max(2, Math.min(user.length - 1, 5)))}@${domain}`
}

export interface ReferralStats {
  code: string
  link: string
  clicks: number
  signups: number       // attached + pending + qualified(所有真的注册了的)
  paid: number          // pending + qualified
  qualified: number     // 计入进度的
  towardNext: number    // 距离下一个免费月还差几人
  progress: number      // 当前档进度 0..REFERRALS_PER_REWARD
  perReward: number
  badge: ReturnType<typeof computeBadge>
  referrals: Array<{
    email: string
    status: AttrStatus
    attachedAt: string
    holdUntil: string | null   // pending 时:还有多久生效
    expiresAt: string | null   // attached 时:转化死线
  }>
  rewards: Array<{
    milestone: number
    status: string
    amount: number | null
    currency: string | null
    createdAt: string
    appliedAt: string | null
  }>
}

export async function getStats(agentId: string, appUrl: string): Promise<ReferralStats> {
  const code = await ensureReferralCode(agentId)

  const attrs = await pool.query<{
    referee_email: string | null
    status: AttrStatus
    attached_at: Date
    first_paid_at: Date | null
    expires_at: Date
  }>(
    `SELECT referee_email, status, attached_at, first_paid_at, expires_at
       FROM lt_referral_attributions
      WHERE referrer_agent_id = $1
      ORDER BY attached_at DESC`,
    [agentId]
  )

  const rewards = await pool.query<{
    milestone_index: number
    status: string
    amount_cents: number | null
    currency: string | null
    created_at: Date
    applied_at: Date | null
  }>(
    `SELECT milestone_index, status, amount_cents, currency, created_at, applied_at
       FROM lt_referral_rewards WHERE agent_id = $1 ORDER BY milestone_index ASC`,
    [agentId]
  )

  // 点击数走 app_events(埋点),不单独计数
  const clickQ = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM app_events
      WHERE event_type = 'referral_click' AND payload->>'code' = $1`,
    [code]
  ).catch(() => ({ rows: [{ n: '0' }] }))

  const live = attrs.rows.filter((r) => r.status !== 'revoked' && r.status !== 'expired')
  const paid = attrs.rows.filter((r) => r.status === 'pending' || r.status === 'qualified')
  const qualified = attrs.rows.filter((r) => r.status === 'qualified').length

  const progress = qualified % REFERRALS_PER_REWARD
  const holdMs = HOLD_DAYS * 86400_000

  return {
    code,
    link: `${appUrl}/i/${code}`,
    clicks: Number(clickQ.rows[0]?.n || 0),
    signups: live.length,
    paid: paid.length,
    qualified,
    progress,
    perReward: REFERRALS_PER_REWARD,
    towardNext: REFERRALS_PER_REWARD - progress,
    badge: computeBadge(qualified),
    referrals: attrs.rows.map((r) => ({
      email: maskEmail(r.referee_email),
      status: r.status,
      attachedAt: r.attached_at.toISOString(),
      holdUntil:
        r.status === 'pending' && r.first_paid_at
          ? new Date(r.first_paid_at.getTime() + holdMs).toISOString()
          : null,
      expiresAt: r.status === 'attached' ? r.expires_at.toISOString() : null,
    })),
    rewards: rewards.rows.map((r) => ({
      milestone: r.milestone_index,
      status: r.status,
      amount: r.amount_cents != null ? r.amount_cents / 100 : null,
      currency: r.currency,
      createdAt: r.created_at.toISOString(),
      appliedAt: r.applied_at?.toISOString() ?? null,
    })),
  }
}

/** checkout 时问:这个人是被推荐来的、且还没用过首月折扣券吗? */
export async function pendingDiscount(agentId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM lt_referral_attributions
      WHERE referee_agent_id = $1 AND status = 'attached' AND discount_applied = false
        AND expires_at > now()
      LIMIT 1`,
    [agentId]
  )
  return !!rowCount
}

/** 折扣券已挂到 checkout session 上 → 标记用掉(防止取消后反复白嫖新券)。 */
export async function markDiscountUsed(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE lt_referral_attributions SET discount_applied = true, updated_at = now()
      WHERE referee_agent_id = $1 AND discount_applied = false`,
    [agentId]
  )
}

// ============================================================================
// 首次分享 +7 天 —— 即时动力(与推荐奖励是两条腿)
// ============================================================================

/** 分享奖励:延试用天数 + 额外积分(可配置)。 */
export const SHARE_REWARD_DAYS = Number(process.env.REFERRAL_SHARE_DAYS || 7)
export const SHARE_REWARD_CREDITS = Number(process.env.REFERRAL_SHARE_CREDITS || 200)
const TRIAL_CREDITS_DEFAULT = Number(process.env.TRIAL_CREDITS || 200)

export interface ShareRewardResult {
  ok: boolean
  days?: number
  credits?: number
  code?: 'already_claimed' | 'no_trial_to_extend'
  extendedTo?: string | null
}

/**
 * 首次分享奖励:一辈子一次,给 +7 天试用。
 *
 * ⚠️ 微信/朋友圈/小红书/抖音的分享**技术上无法验证**(这些平台没有分享回调)。
 *    所以"分享送 7 天"在代码层面只能是"点了分享 → 送",天然可被反复点。
 *    唯一的防线就是**一辈子一次**:原子占位在 lt_agents.share_reward_claimed_at,
 *    并发双击只有一个能拿到行(同 adminGrant 的理由)。
 *    真正可验证、可累加的增长走另一条腿:海报里的 /i/:code → 推荐奖励(免费月)。
 *
 * 奖励落在**免绑卡试用行**上:current_period_end += 7 天。海报是注册/登录成功那一刻弹的,
 * 绝大多数分享者正处在 7 天试用里 → 直接续成 14 天。
 * 已经付费的人没有 trialing 的 free_trial 行 → 占位照样烧掉(分享动作已发生),
 * 但没有试用可延 → 返回 no_trial_to_extend(前端提示"已是订阅用户,无需试用")。
 */
export async function claimShareReward(agentId: string): Promise<ShareRewardResult> {
  // 原子占位:一辈子一次
  const claim = await pool.query(
    `UPDATE lt_agents SET share_reward_claimed_at = now()
      WHERE id = $1 AND share_reward_claimed_at IS NULL
      RETURNING id`,
    [agentId]
  )
  if (!claim.rowCount) return { ok: false, code: 'already_claimed' }

  // 延长当前免绑卡试用 +7 天,并把积分额度 +200(trial_credits 是余额的额度上限,加它=多给 200 分)
  const ext = await pool.query<{ current_period_end: Date }>(
    `UPDATE lt_subscriptions
        SET current_period_end = current_period_end + ($2 || ' days')::interval,
            trial_credits = COALESCE(trial_credits, $4) + $3,
            updated_at = now()
      WHERE agent_id = $1 AND source = 'free_trial' AND status = 'trialing'
      RETURNING current_period_end`,
    [agentId, String(SHARE_REWARD_DAYS), SHARE_REWARD_CREDITS, TRIAL_CREDITS_DEFAULT]
  )
  if (!ext.rowCount) {
    // 没有可延长的试用(已付费/试用已过期)。占位保持烧掉:分享动作只认一次。
    return { ok: true, days: 0, credits: 0, code: 'no_trial_to_extend' }
  }

  await pool.query(
    `INSERT INTO plan_change_log (agent_id, action, reason)
       VALUES ($1, 'share_reward', $2)`,
    [agentId, `首次分享 +${SHARE_REWARD_DAYS} 天试用 +${SHARE_REWARD_CREDITS} 积分`]
  ).catch((e) => console.error('[referral] share reward audit failed:', e))

  console.log(`[referral] 🎁 share reward: agent ${agentId} +${SHARE_REWARD_DAYS}d +${SHARE_REWARD_CREDITS}cr`)
  return { ok: true, days: SHARE_REWARD_DAYS, credits: SHARE_REWARD_CREDITS, extendedTo: ext.rows[0].current_period_end.toISOString() }
}

/** 前端问:分享奖励领过了吗(决定分享按钮旁显不显示"再得 7 天")。 */
export async function shareRewardClaimed(agentId: string): Promise<boolean> {
  const { rows } = await pool.query<{ claimed: boolean }>(
    `SELECT (share_reward_claimed_at IS NOT NULL) AS claimed FROM lt_agents WHERE id = $1`,
    [agentId]
  )
  return !!rows[0]?.claimed
}
