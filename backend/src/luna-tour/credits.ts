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
import { counter } from '../telemetry'
import { ENTITLED_SQL } from '../lib/subscriptionStatus'

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

export function emailUnlimited(email?: string | null): boolean {
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
  // 实时带看(地图协作)= **免费,不限场次**(2026-07-12 owner 定)。
  // 成本是 $0 —— 纯 WebSocket,跑我们自己的服务器。收费没有依据,且限制它 =
  // 限制核心价值主张(带看越多 → 客户越可能续费)。真正花钱的是通话/视频,
  // 由 call 额度封顶。credits: 0 但保留条目 → minPlan 门(agent 以上)仍然生效。
  live_tours: { label: '实时带看', labelEn: 'Live tour', credits: 0, minPlan: 'agent' as PlanId },
  luna_tours: { label: 'Luna 智能导览', labelEn: 'Luna AI tour', credits: 100, minPlan: 'agent' as PlanId }, // 重度 AI 生成 → 最贵
  // Sales Offer 报价单:5 分/份(2026-07-07 用户定),60 天有效(过期页转联系顾问)
  payplan: { label: 'Sales Offer 报价单', labelEn: 'Sales offer', credits: 5, minPlan: 'rookie' as PlanId },
  // 通话与视频 —— **计量型**,不是按次。见 §「通话计费」。
  // 单位是 call unit(= Agora Standard 分钟):语音 1 user-min = 1,视频 1 viewer-min = 4。
  // 套餐内含免费额度(limits.call_units_month),超出按 CALL_UNITS_PER_CREDIT 折算扣积分。
  // 不走 spend()/checkCredits(),走 settleCallUsage()/checkCallQuota()。
  live_call: { label: '通话与视频', labelEn: 'Voice & video', credits: 1, minPlan: 'agent' as PlanId },
} as const

export type Feature = keyof typeof FEATURES

// ── 通话计费的换算常量 ────────────────────────────────────────────────────
//
// 口径就是 Agora 自己的 **Standard 分钟**(音频 1×,HD 视频 4×)—— 正好是成本比,
// 所以额度消耗和真实账单永远同步,不会漂移。
//   语音 1 user-分钟   = 1 unit  ($0.00099)
//   视频 1 viewer-分钟 = 4 units ($0.00396)
//   4 units = 1 积分($0.041)   → 10× 加价,与其他功能的加价率一致

/** 1 viewer-分钟视频 = 几个 unit。Agora HD 视频单价是音频的 4 倍。 */
export const VIDEO_UNIT_WEIGHT = 4
/** 几个 unit 折 1 积分(超出免费额度后)。 */
export const CALL_UNITS_PER_CREDIT = 4
/** 试用的免费通话额度 —— **刻意与套餐解耦**,理由同 TRIAL_VIDEO_MINUTES。 */
export const TRIAL_CALL_UNITS = Number(process.env.TRIAL_CALL_UNITS || 120) // = 2h 1对1 语音 或 30 min 视频

const PLAN_RANK: Record<string, number> = { explore: 0, rookie: 1, agent: 2, founder: 3, developer: 4 }

/**
 * 免绑卡试用的积分池默认值(与套餐自身的 credits_month 解耦,见 planFor)。
 * 单条试用可以在 lt_subscriptions.trial_credits 上覆盖(后台「赠 Pro 30 天」就这么做)。
 *
 * 🪦 2026-08-17:原来这里还有 DEV_TRIAL_CREDITS=600 / DEV_TRIAL_DAYS=30,
 * 给「已验证开发商」用的。整条开发商验证链路已删(理由见 routes/billing.ts 的墓碑
 * 注释:那道审批守的门是假的,唯一通过的人交付了 0 个楼盘)。要给谁加长试用,
 * 走后台通用的「赠 Pro 30 天」(1200 分),见 services/adminGrant.ts。
 */
export const TRIAL_CREDITS = Number(process.env.FREE_TRIAL_CREDITS || 200)

/**
 * 试用期的免费通话额度(call units)—— **刻意与套餐解耦**,见 TRIAL_CALL_UNITS。
 *
 * ⚠️ 不能让试用读 limits.call_units_month:planFor() 里试用返回的 plan 就是
 * 订阅行上的 plan_id(DB 里确实有 agent/trialing 的账号)→ 会直接继承 Pro 的 1200 units。
 * 而试用是**零收入 + 免绑卡**,注册成本近乎为零 → 100 个邮箱刷试用 = 白烧几百刀。
 * 120 units(= 2h 1对1 语音 或 30 min 视频)够试出效果,把白嫖面砍到 $0.12/账号。
 *
 * (常量定义在 FEATURES 下方的「通话计费换算常量」区。)
 */

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

interface PlanCfg {
  plan: string
  status: string
  creditsMonth: number
  multiplier: number
  freeTrial: boolean
  trialStart: Date | null   // 试用起点(用量按它算,不按自然月 —— 见 usedFor)
}

/**
 * 该经纪当前生效套餐 + 积分参数(无生效订阅 → explore)。
 *
 * 免绑卡试用(source='free_trial')没有 Stripe webhook 来关它,过期必须由我们判定。
 * freeTrialSweep 每 5 分钟把过期行翻成 canceled(让 DB 状态对所有读取方都是真的),
 * 但钱相关的门不能容忍这 5 分钟窗口 → 这里再加一道即时的过期谓词。
 */
async function planFor(agentId: string): Promise<PlanCfg> {
  const sub = await pool.query<{ plan_id: string; status: string; source: string; trial_credits: number | null; created_at: Date }>(
    `SELECT plan_id, status, source, trial_credits, created_at FROM lt_subscriptions
       WHERE agent_id = $1 AND status IN ${ENTITLED_SQL}
         AND (source <> 'free_trial' OR current_period_end > now())
       ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  )
  const plan = sub.rows[0]?.plan_id || 'explore'
  const status = sub.rows[0]?.status || 'none'
  const freeTrial = sub.rows[0]?.source === 'free_trial'

  // 免绑卡试用:给 Pro 档的**功能权限**(否则试不到实时带看/Luna 导览这些
  // minPlan='agent' 的旗舰功能,试用就没意义了),但积分独立锁死 —— 不吃 Pro 的 1200。
  // 积分池按行取(已验证开发商 600,其余默认 200):200 ≈ 2 场实时带看 或 2 次 Luna 导览。
  if (freeTrial) {
    const cm = sub.rows[0]?.trial_credits ?? TRIAL_CREDITS
    return {
      plan, status, creditsMonth: Number(cm), multiplier: 1, freeTrial: true,
      trialStart: sub.rows[0]?.created_at ?? null,
    }
  }

  const lim = await pool.query<{ cm: number | null; mult: number | null }>(
    `SELECT (limits->>'credits_month')::int AS cm, (limits->>'cost_multiplier')::float AS mult
       FROM lt_subscription_plans WHERE id = $1`,
    [plan]
  )
  return {
    plan, status, creditsMonth: Number(lim.rows[0]?.cm ?? 0),
    multiplier: Number(lim.rows[0]?.mult ?? 1), freeTrial, trialStart: null,
  }
}

async function usedThisMonth(agentId: string): Promise<number> {
  const r = await pool.query<{ u: number }>(
    `SELECT COALESCE(credits_used,0) AS u FROM lt_usage_counters
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
  return Number(r.rows[0]?.u ?? 0)
}

/**
 * 该套餐口径下的「已用积分」。
 *
 * ⚠️ 付费订阅按自然月(lt_usage_counters 按 period_month 分行,新月自动归零),
 * 但**试用不能按自然月算** —— 7 天试用从月底开始就会跨月,一到月初 credits_used
 * 归零 → 200 分白送第二遍;30 天的开发商试用必然跨月,600 直接变 1200。
 * 试用用量改按「试用开始至今」的逐笔流水累计,与日历月无关。
 * (credits > 0 排除掉转化时写的负数 trial_reset 补偿行。)
 */
async function usedFor(agentId: string, p: PlanCfg): Promise<number> {
  if (p.freeTrial && p.trialStart) {
    const r = await pool.query<{ u: string }>(
      `SELECT COALESCE(SUM(credits), 0) AS u FROM lt_credit_ledger
         WHERE agent_id = $1 AND created_at >= $2 AND credits > 0`,
      [agentId, p.trialStart]
    )
    return Number(r.rows[0]?.u ?? 0)
  }
  return usedThisMonth(agentId)
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
  const used = await usedFor(agentId, p)
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

  // 全站每一次扣费都经过这里 → 一处埋点覆盖所有功能的实际消耗。
  counter('credits.spent', { feature }).inc(cost)
  counter('credits.spend.count', { feature }).inc()

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
  const used = await usedFor(agentId, p)
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

/**
 * 功能目录(给 /api/billing/features → 价格页/台内自动渲染消耗表)。
 *
 * unit 区分三类,不标的话 UI 会把它们全渲染成「每次 N 积分」:
 *   once      —— 按次(报告/楼书/报价单/Luna 导览)
 *   free      —— 免费不限(实时带看:成本 $0)
 *   call_unit —— 计量型(通话与视频:语音 4 分钟 / 视频 1 分钟 = 1 积分,且套餐送额度)
 */
export function featureCatalog() {
  // ⚠️ 不再送 label/labelEn。定价页是**面向客户**的,而 label 恒为中文 ——
  // 阿语/俄语/法语用户在定价表里会看到「AI 楼书解析」。labelEn 从来没人读
  // (PricingPage 直接渲染 f.label),等于摆了个没接线的开关。
  // 现在只送 key,前端按 key 出 t('pricing:feature.<key>') —— 5 语言齐。
  // (FEATURES[].label 保留:它还用在 creditError 的中文文案和 DB 流水 label 上。)
  return (Object.keys(FEATURES) as Feature[]).map((key) => ({
    key,
    credits: FEATURES[key].credits, minPlan: FEATURES[key].minPlan,
    unit: key === 'live_call' ? ('call_unit' as const)
      : FEATURES[key].credits === 0 ? ('free' as const)
      : ('once' as const),
    // 计量型才有意义:1 积分能买多少语音分钟 / 视频分钟
    ...(key === 'live_call' ? {
      audioMinutesPerCredit: CALL_UNITS_PER_CREDIT,                      // 4 分钟语音 = 1 积分
      videoMinutesPerCredit: CALL_UNITS_PER_CREDIT / VIDEO_UNIT_WEIGHT,  // 1 分钟视频 = 1 积分
    } : {}),
  }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 通话计费(语音 + 视频统一 —— 计量型,与上面的「按次」体系并行)
//
// 口径 = Agora 自己的 **Standard 分钟**(音频 1×,HD 视频 4×),正好是成本比:
//   语音 1 user-分钟   = 1 unit    ($0.00099)
//   视频 1 viewer-分钟 = 4 units   ($0.00396)
//   4 units = 1 积分($0.041)      → 10× 加价
//
// ⚠️ 为什么语音必须按 **user**-分钟:Agora 按人头收费。旧实现的日额度算的是
//    voice_sessions.duration_seconds(会话墙钟秒,**不乘人数**)→ 6 人房间的成本
//    是 1 人的 6 倍,额度消耗却一模一样,而且语音一个积分都不扣。
//    最坏:3h/天 × 6人 × 30天 = 32,400 user-min = $32/月(vs $49 月费)。这是个真敞口。
//
// 账本策略:**一场一行 ledger,heartbeat 不断 UPDATE 它**(ref_id = sessionId,
// 有 partial unique index 兜底)。这样:
//   • 账本不会被 30s 一行刷爆
//   • 本月已用量 = SUM(units) 天然包含**进行中**的场 → 额度实时准确
//   • 结算幂等:每次都按「本场累计用量」重算应扣总额,减去已扣,只补差额
//     → 重放/崩溃/重复 heartbeat 都不会重复扣
// ═══════════════════════════════════════════════════════════════════════════

/** 把音频/视频秒数折算成 call units(Agora Standard 分钟)。 */
export function toCallUnits(audioUserSeconds: number, videoViewerSeconds: number): number {
  const audioMin = Math.max(0, audioUserSeconds) / 60
  const videoMin = Math.max(0, videoViewerSeconds) / 60
  return Math.ceil(audioMin + videoMin * VIDEO_UNIT_WEIGHT)
}

/** 该套餐的免费通话额度(call units/月)。试用走独立常量,**绝不继承套餐**。 */
async function callQuotaOf(p: PlanCfg): Promise<number> {
  if (p.freeTrial) return TRIAL_CALL_UNITS  // ⚠️ 见 TRIAL_CALL_UNITS 注释
  const r = await pool.query<{ cu: number | null }>(
    `SELECT (limits->>'call_units_month')::int AS cu FROM lt_subscription_plans WHERE id = $1`,
    [p.plan]
  )
  return Number(r.rows[0]?.cu ?? 0)
}

/**
 * 本月已用的 call units(排除本场)。
 * 从 ledger 的 units 列累计 —— 免费额度内的行 credits=0 但 units>0,
 * 所以免费用量在账本上是可见的(这正是加 units 列的原因)。
 */
async function callUnitsUsed(billingId: string, p: PlanCfg, exceptSessionId?: string): Promise<number> {
  // 试用按「试用开始至今」累计(与 usedFor 同理:试用跨月不能被自然月归零白送第二遍)
  const since = p.freeTrial && p.trialStart ? p.trialStart : null
  const r = await pool.query<{ u: string }>(
    `SELECT COALESCE(SUM(units), 0) AS u FROM lt_credit_ledger
       WHERE agent_id = $1 AND feature = 'live_call'
         AND created_at >= ${since ? '$2' : `date_trunc('month', now())`}
         ${exceptSessionId ? `AND ref_id IS DISTINCT FROM $${since ? 3 : 2}` : ''}`,
    since
      ? (exceptSessionId ? [billingId, since, exceptSessionId] : [billingId, since])
      : (exceptSessionId ? [billingId, exceptSessionId] : [billingId])
  )
  return Number(r.rows[0]?.u ?? 0)
}

/** billedUnits → 积分(含 founder 折扣)。⚠️ 折扣必须在**总量**上取整。 */
function unitsToCredits(billedUnits: number, multiplier: number): number {
  // Math.round(1 * 0.6) 逐单位取整 = 1 → founder 的 40% 折扣会被整个吃掉。
  return Math.round((billedUnits / CALL_UNITS_PER_CREDIT) * multiplier)
}

export interface CallQuota {
  /** 还剩多少免费 call units(**-1 = 无限**,owner/白名单) */
  freeLeft: number
  /** 套餐/试用的月度免费额度(-1 = 无限) */
  freeQuota: number
  /** 当前积分余额(-1 = 无限) */
  creditBalance: number
  /** 免费额度和积分**都**空了 → 不能开通话/摄像头 */
  exhausted: boolean
  /** 低于 minPlan(explore/rookie)→ 需升级,与额度无关 */
  needsUpgrade: boolean
  freeTrial: boolean
}

/** 开通话/摄像头前的预检(给前端点亮/置灰按钮)。 */
export async function checkCallQuota(agentId: string): Promise<CallQuota> {
  if (await isUnlimited(agentId)) {
    // ⚠️ owner/UNLIMITED_EMAILS 无刹车(积分永远扣不完 → stop 恒 false)。
    // 刻意不堵:内部人可控,堵了妨碍演示。兜底是单场 30min token TTL。
    //
    // ⚠️ 用 -1 表示无限,**不能用 Infinity** —— JSON.stringify(Infinity) === 'null',
    // 前端 `?? 0` 会把它读成 0 → 按钮显示「剩余 0 分钟」。与 creditBalance:-1 同约定。
    return { freeLeft: -1, freeQuota: -1, creditBalance: -1, exhausted: false, needsUpgrade: false, freeTrial: false }
  }
  const billingId = await billingAgentOf(agentId)
  const p = await planFor(billingId)
  if (PLAN_RANK[p.plan] < PLAN_RANK[FEATURES.live_call.minPlan]) {
    return { freeLeft: 0, freeQuota: 0, creditBalance: 0, exhausted: true, needsUpgrade: true, freeTrial: p.freeTrial }
  }
  const [freeQuota, used, spent] = await Promise.all([
    callQuotaOf(p),
    callUnitsUsed(billingId, p),
    usedFor(billingId, p),
  ])
  const freeLeft = Math.max(0, freeQuota - used)
  const creditBalance = p.creditsMonth - spent
  return {
    freeLeft, freeQuota, creditBalance,
    // 免费额度空了,且积分连 1 个 unit 都买不起 → 通话/视频停
    exhausted: freeLeft <= 0 && creditBalance < 1,
    needsUpgrade: false,
    freeTrial: p.freeTrial,
  }
}

export interface CallSettlement {
  /** 本场累计 call units */
  sessionUnits: number
  /** 本场落在免费额度里的部分 */
  freeUsed: number
  /** 本场实扣的积分总额(累计,非增量) */
  credits: number
  /** 月度免费额度剩余 */
  freeLeft: number
  /** 积分余额(-1 = 无限) */
  creditBalance: number
  /** ⭐ 额度耗尽 → 前端必须立即撤视频轨(先砍贵的:视频是音频的 4 倍) */
  stopVideo: boolean
  /** ⭐ 连语音都撑不住了 → 挂断整场通话 */
  stopCall: boolean
}

/**
 * ⭐ 通话用量实时结算(heartbeat 每 30s 调一次)。
 *
 * 传入本场**累计**的 audio user-秒 和 video viewer-秒(不是增量)
 * → 幂等重算应扣总额 → 只补差额。
 *
 * ⚠️ **绝不能改成「会话结束时统一结算」** —— 那是纸糊的护栏:100 人围观 30 分钟,
 * 钱早花完了才发现,事后扣积分只是记账,拦不住任何东西。刹车必须跟着 heartbeat 走。
 *
 * 两级刹车:额度见底先撤**视频**(单价 4×,砍它最有效),语音继续 —— 带看不中断。
 * 视频撤了还是不够(纯语音也超了)→ stopCall 挂断整场。
 */
export async function settleCallUsage(
  actorAgentId: string,
  sessionId: string,
  audioUserSeconds: number,
  videoViewerSeconds: number,
  alreadySpent: number,
  ref?: SpendRef
): Promise<CallSettlement> {
  const sessionUnits = toCallUnits(audioUserSeconds, videoViewerSeconds)
  // 通话是**唯一真正花钱**的东西(Agora)。units 就是 Agora Standard 分钟 = 成本本身。
  counter('call.units', { kind: videoViewerSeconds > 0 ? 'video' : 'audio' }).inc(sessionUnits)
  const unlimited = await isUnlimited(actorAgentId)
  const billingId = await billingAgentOf(actorAgentId)   // 席位成员 → founder 共享池+共享额度
  const p = await planFor(billingId)

  const [freeQuota, usedElsewhere] = await Promise.all([
    callQuotaOf(p),
    callUnitsUsed(billingId, p, sessionId),   // 排除本场,避免把自己算两遍
  ])

  const freeLeftBefore = Math.max(0, freeQuota - usedElsewhere)
  const freeUsed = Math.min(sessionUnits, freeLeftBefore)
  const billedUnits = sessionUnits - freeUsed
  const credits = unlimited ? 0 : unitsToCredits(billedUnits, p.multiplier)

  // 一场一行 ledger:heartbeat 反复 UPDATE 同一行(ref_id = sessionId)。
  // credits=0 的免费行也要写 —— units 是月度额度的唯一真相源。
  await pool.query(
    `INSERT INTO lt_credit_ledger (agent_id, actor_agent_id, feature, credits, units, ref_type, ref_id, ref_label)
       VALUES ($1,$2,'live_call',$3,$4,$5,$6,$7)
     ON CONFLICT (ref_id) WHERE feature = 'live_call'
       DO UPDATE SET credits = EXCLUDED.credits, units = EXCLUDED.units, ref_label = EXCLUDED.ref_label`,
    [billingId, actorAgentId, credits, sessionUnits, ref?.type ?? 'live', sessionId, ref?.label ?? null]
  ).catch((e) => console.error('[credits] live_call ledger upsert failed:', e))

  // 月度聚合只补差额(alreadySpent = voice_sessions.video_credits_spent)→ 幂等
  const delta = credits - Math.max(0, alreadySpent)
  if (!unlimited && delta > 0) {
    const upd = await pool.query(
      `UPDATE lt_usage_counters SET credits_used = credits_used + $2
         WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
      [billingId, delta]
    )
    if (!upd.rowCount) {
      await pool.query(
        `INSERT INTO lt_usage_counters (agent_id, period_month, credits_used)
           VALUES ($1, date_trunc('month', now())::date, $2)`,
        [billingId, delta]
      )
    }
  }

  const spentTotal = unlimited ? 0 : await usedFor(billingId, p)
  const creditBalance = unlimited ? -1 : p.creditsMonth - spentTotal
  const freeLeft = Math.max(0, freeLeftBefore - freeUsed)
  const broke = !unlimited && freeLeft <= 0 && creditBalance < 1

  return {
    sessionUnits, freeUsed, credits, freeLeft, creditBalance,
    // 见底 → 先砍视频(4× 单价)。unlimited 恒 false(见 checkCallQuota 注释)。
    stopVideo: broke,
    // 撤了视频还是撑不住(纯语音也超)→ 挂断整场
    stopCall: broke && videoViewerSeconds <= 0,
  }
}

/** 统一的"积分不足/需订阅"响应(402)。 */
export function creditError(feature: Feature, c: CreditCheck): { status: number; body: Record<string, unknown> } {
  // 全站 9 个 402 门都必经这一个函数 → 一处埋点覆盖所有 paywall。
  // 「谁被挡住了、被什么挡住的」是转化漏斗里最值钱的一格:
  // subscription_required = 他想用但没订阅(热线索);insufficient_credits = 试用烧完了(更热)
  counter('billing.paywall.hit', {
    feature,
    reason: c.reason === 'insufficient' ? 'insufficient_credits' : 'subscription_required',
    trial: c.freeTrial ? 'yes' : 'no',
  }).inc()
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
