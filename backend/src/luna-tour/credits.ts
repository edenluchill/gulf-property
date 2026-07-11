/**
 * 积分制计费 —— 单一真相源 + 统一扣费/检查。
 *
 * 设计目标:clean & 解耦,加/删/改功能都只动这一个文件。
 *   - 加功能:在 FEATURES 加一行,然后在该功能代码处调一次 checkCredits+spend。
 *   - 删功能:删 FEATURES 那一行(call site 也删)。
 *   - 改价:改那一行的 credits 数字。
 *
 * 套餐级参数(每月积分 credits_month、Founder 折扣 cost_multiplier)存
 * lt_subscription_plans.limits;本月已花存 lt_usage_counters.credits_used,
 * 按 (agent, period_month) 分行 → 新月自动归零刷新,无需定时任务。
 * OWNER_EMAILS 视为无限,且不计费。
 */
import pool from '../db/pool'
import { isOwnerEmail } from '../middleware/requireOwner'

type PlanId = 'explore' | 'rookie' | 'agent' | 'founder' | 'developer'

// ── 无限额度白名单 ────────────────────────────────────────
// 与 OWNER(计费/结算/审批特权)和 ADMIN(数据后台/PII 访问)刻意解耦:
// 这里只赋予"不计费 + 无限积分",不带任何后台或审批权限。内部运营员工
// (帮忙上传楼书/生成报告)放这里最合适。
// ⭐ 手动给某人开无限:把邮箱加进下面数组(或设 UNLIMITED_EMAILS env,逗号分隔),
//    然后部署 API(quick-deploy.ps1 -SkipWorker)。要发"定量"积分而非无限,
//    改用 scripts/grant-credits.ts。
const UNLIMITED_EMAILS = (process.env.UNLIMITED_EMAILS || 'shelldubai26@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

function emailUnlimited(email?: string | null): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  return isOwnerEmail(e) || UNLIMITED_EMAILS.includes(e)
}

// ── 功能目录(单一真相源)──────────────────────────────────
// credits = 标准每次成本;minPlan = 至少需要的套餐(低于则需升级,与积分无关)。
// Starter(rookie)可用报告/楼书(200分/月≈10份报告),live/luna tour 是 Pro 以上专属。
export const FEATURES = {
  reports: { label: '买家意向报告', labelEn: 'Buyer proposal', credits: 20, minPlan: 'rookie' as PlanId },   // 常用 → 最便宜
  brochures: { label: 'AI 楼书解析', labelEn: 'AI brochure parsing', credits: 40, minPlan: 'rookie' as PlanId },  // 常用 → 便宜
  live_tours: { label: '实时带看', labelEn: 'Live tour', credits: 60, minPlan: 'agent' as PlanId },    // 居中
  luna_tours: { label: 'Luna 智能导览', labelEn: 'Luna AI tour', credits: 100, minPlan: 'agent' as PlanId }, // 重度 AI 生成 → 最贵
  // Sales Offer 报价单:5 分/份(2026-07-07 用户定),60 天有效(过期页转联系顾问)
  payplan: { label: 'Sales Offer 报价单', labelEn: 'Sales offer', credits: 5, minPlan: 'rookie' as PlanId },
} as const

export type Feature = keyof typeof FEATURES

const PLAN_RANK: Record<string, number> = { explore: 0, rookie: 1, agent: 2, founder: 3, developer: 4 }

/** 免绑卡试用的积分池(与套餐自身的 credits_month 解耦,见 planFor)。 */
export const TRIAL_CREDITS = Number(process.env.FREE_TRIAL_CREDITS || 200)

/**
 * 计费归属:Founder 席位成员(lt_agents.billing_agent_id 指向 founder)的
 * 套餐/积分全部解析到 founder 头上 → 共享积分池、共享折扣。NULL = 自己。
 */
async function billingAgentOf(agentId: string): Promise<string> {
  const r = await pool.query<{ billing_agent_id: string | null }>(
    `SELECT billing_agent_id FROM lt_agents WHERE id = $1`,
    [agentId]
  )
  return r.rows[0]?.billing_agent_id || agentId
}

interface PlanCfg { plan: string; status: string; creditsMonth: number; multiplier: number; freeTrial: boolean }

/**
 * 该经纪当前生效套餐 + 积分参数(无生效订阅 → explore)。
 *
 * 免绑卡试用(source='free_trial')没有 Stripe webhook 来关它,过期必须由我们判定。
 * freeTrialSweep 每 5 分钟把过期行翻成 canceled(让 DB 状态对所有读取方都是真的),
 * 但钱相关的门不能容忍这 5 分钟窗口 → 这里再加一道即时的过期谓词。
 */
async function planFor(agentId: string): Promise<PlanCfg> {
  const sub = await pool.query<{ plan_id: string; status: string; source: string }>(
    `SELECT plan_id, status, source FROM lt_subscriptions
       WHERE agent_id = $1 AND status IN ('active','trialing')
         AND (source <> 'free_trial' OR current_period_end > now())
       ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  )
  const plan = sub.rows[0]?.plan_id || 'explore'
  const status = sub.rows[0]?.status || 'none'
  const freeTrial = sub.rows[0]?.source === 'free_trial'

  // 免绑卡试用:给 Pro 档的**功能权限**(否则试不到实时带看/Luna 导览这些
  // minPlan='agent' 的旗舰功能,试用就没意义了),但积分独立锁死在 200 —— 不吃
  // Pro 的 1200。200 分 ≈ 2 场实时带看 或 2 次 Luna 导览,够尝到味道,不够白嫖。
  if (freeTrial) {
    return { plan, status, creditsMonth: TRIAL_CREDITS, multiplier: 1, freeTrial: true }
  }

  const lim = await pool.query<{ cm: number | null; mult: number | null }>(
    `SELECT (limits->>'credits_month')::int AS cm, (limits->>'cost_multiplier')::float AS mult
       FROM lt_subscription_plans WHERE id = $1`,
    [plan]
  )
  return { plan, status, creditsMonth: Number(lim.rows[0]?.cm ?? 0), multiplier: Number(lim.rows[0]?.mult ?? 1), freeTrial }
}

async function usedThisMonth(agentId: string): Promise<number> {
  const r = await pool.query<{ u: number }>(
    `SELECT COALESCE(credits_used,0) AS u FROM lt_usage_counters
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
  return Number(r.rows[0]?.u ?? 0)
}

/** owner 或无限白名单 → 无限额度、免计费。 */
async function isUnlimited(agentId: string): Promise<boolean> {
  const a = await pool.query<{ email: string | null }>(`SELECT email FROM lt_agents WHERE id = $1`, [agentId])
  return emailUnlimited(a.rows[0]?.email)
}

export interface CreditCheck {
  allowed: boolean
  cost: number          // 本次实扣(含 Founder 折扣)
  balance: number       // 当前余额(-1 = 无限/owner)
  creditsMonth: number  // 套餐月额度(-1 = 无限)
  used: number
  plan: string
  status: string
  reason?: 'subscription_required' | 'insufficient'
  owner: boolean
  freeTrial: boolean    // true = 当前跑在免绑卡试用上(402 文案要改成"订阅即恢复")
}

/** 检查某功能是否可用(套餐门 + 积分余额),不扣费。 */
export async function checkCredits(agentId: string, feature: Feature): Promise<CreditCheck> {
  const f = FEATURES[feature]
  if (await isUnlimited(agentId)) {
    return { allowed: true, cost: 0, balance: -1, creditsMonth: -1, used: 0, plan: 'founder', status: 'owner', owner: true, freeTrial: false }
  }
  agentId = await billingAgentOf(agentId) // 席位成员 → founder 的套餐+共享池
  const p = await planFor(agentId)
  const cost = Math.round(f.credits * p.multiplier)
  // 套餐等级门:explore / 低于 minPlan → 需订阅(与积分无关)
  if (PLAN_RANK[p.plan] < (PLAN_RANK[f.minPlan] ?? 1)) {
    return { allowed: false, cost, balance: 0, creditsMonth: p.creditsMonth, used: 0, plan: p.plan, status: p.status, reason: 'subscription_required', owner: false, freeTrial: p.freeTrial }
  }
  const used = await usedThisMonth(agentId)
  const balance = p.creditsMonth - used
  return {
    allowed: balance >= cost, cost, balance, creditsMonth: p.creditsMonth, used,
    plan: p.plan, status: p.status, reason: balance >= cost ? undefined : 'insufficient', owner: false,
    freeTrial: p.freeTrial,
  }
}

/** 逐笔流水关联对象(可选):让「使用记录」能点回原件、显示项目/客户名。 */
export interface SpendRef { type?: string; id?: string; label?: string }

/**
 * 成功执行某功能后扣积分(月度聚合 upsert)+ 记一行逐笔流水(lt_credit_ledger)。
 * owner/无限白名单不计费,但仍记一行 credits=0 的流水,方便他们也能看历史。
 * actorAgentId = 实际操作人;计费落到 billingAgentOf(founder 共享池)。
 */
export async function spend(actorAgentId: string, feature: Feature, ref?: SpendRef): Promise<void> {
  const unlimited = await isUnlimited(actorAgentId)
  const billingId = await billingAgentOf(actorAgentId) // 席位成员扣 founder 的共享池
  const p = await planFor(billingId)
  const cost = unlimited ? 0 : Math.round(FEATURES[feature].credits * p.multiplier)

  // 逐笔流水:总是记一行(含 owner/无限的 0),历史可查、可点回原件。失败不阻断主流程。
  await pool.query(
    `INSERT INTO lt_credit_ledger (agent_id, actor_agent_id, feature, credits, ref_type, ref_id, ref_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [billingId, actorAgentId, feature, cost, ref?.type ?? null, ref?.id ?? null, ref?.label ?? null]
  ).catch((e) => console.error('[credits] ledger insert failed:', e))

  if (unlimited || cost <= 0) return

  const upd = await pool.query(
    `UPDATE lt_usage_counters SET credits_used = credits_used + $2
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [billingId, cost]
  )
  if (!upd.rowCount) {
    await pool.query(
      `INSERT INTO lt_usage_counters (agent_id, period_month, credits_used)
         VALUES ($1, date_trunc('month', now())::date, $2)`,
      [billingId, cost]
    )
  }
}

/** 当前余额(给 /me 与后台展示)。 */
export async function creditBalance(agentId: string) {
  if (await isUnlimited(agentId)) {
    return { creditsMonth: -1, used: 0, balance: -1, plan: 'founder', status: 'owner', multiplier: 0.6, owner: true, freeTrial: false }
  }
  agentId = await billingAgentOf(agentId) // 席位成员看到的是团队共享池
  const p = await planFor(agentId)
  const used = await usedThisMonth(agentId)
  return { creditsMonth: p.creditsMonth, used, balance: p.creditsMonth - used, plan: p.plan, status: p.status, multiplier: p.multiplier, owner: false, freeTrial: p.freeTrial }
}

/**
 * 订阅生效时把试用期已花的积分清零 —— 否则同月内「付了钱余额还是空的」。
 * 不直接抹掉历史:写一条负数补偿流水,使用记录里能看到「订阅生效 · 试用积分清零」。
 */
export async function resetCreditsOnConversion(agentId: string): Promise<void> {
  const u = await pool.query<{ credits_used: number }>(
    `SELECT credits_used FROM lt_usage_counters
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
  const used = Number(u.rows[0]?.credits_used ?? 0)
  if (used <= 0) return
  await pool.query(
    `INSERT INTO lt_credit_ledger (agent_id, actor_agent_id, feature, credits, ref_type, ref_label)
       VALUES ($1, $1, 'trial_reset', $2, 'billing', '订阅生效 · 试用期积分清零')`,
    [agentId, -used]
  )
  await pool.query(
    `UPDATE lt_usage_counters SET credits_used = 0
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
}

/** 功能目录(给 /api/billing/features → 价格页/台内自动渲染消耗表)。 */
export function featureCatalog() {
  return (Object.keys(FEATURES) as Feature[]).map((key) => ({
    key, label: FEATURES[key].label, labelEn: FEATURES[key].labelEn, credits: FEATURES[key].credits, minPlan: FEATURES[key].minPlan,
  }))
}

/** 统一的"积分不足/需订阅"响应(402)。 */
export function creditError(feature: Feature, c: CreditCheck): { status: number; body: Record<string, unknown> } {
  const label = FEATURES[feature].label
  const minPlanName = FEATURES[feature].minPlan === 'agent' ? 'Pro 专业版' : 'Starter 启程版'
  let reason: string
  if (c.reason === 'insufficient') {
    // 试用期烧完的人是最热的线索 —— 别拿"下月刷新"打发他,告诉他订阅立刻恢复。
    reason = c.freeTrial
      ? `试用积分已用完:${label}需 ${c.cost} 积分,当前余额 ${c.balance}。订阅后积分立即恢复。`
      : `本月积分不足:${label}需 ${c.cost} 积分,当前余额 ${c.balance}。升级套餐或下月刷新。`
  } else {
    reason = `${label}是 ${minPlanName} 及以上的功能,升级即可解锁。`
  }
  return {
    status: 402,
    body: {
      success: false, error: reason,
      code: c.reason === 'insufficient' ? 'insufficient_credits' : 'subscription_required',
      feature, cost: c.cost, balance: c.balance, freeTrial: c.freeTrial, upgradeUrl: '/agent/billing',
    },
  }
}
