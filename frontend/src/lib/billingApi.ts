/**
 * Stripe billing API 客户端(设计稿: docs/stripe-billing-spec.md)。
 *  - /plans 公开(营销报价页 + 台内升级页共用,价格单一真相源)。
 *  - /checkout /portal /me 带登录经纪的 Supabase token。
 * checkout/portal 返回 Stripe 托管页 url,前端直接 window.location 跳过去。
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'
import { trackEvent } from './track'

const BASE = `${API_BASE_URL}/api/billing`

export interface BillingPlan {
  id: string
  name: string
  price_usd_month: number | string
  price_usd_year?: number | string // 年付实收价(rookie=249;缺省时前端回退 month×10)
  limits: Record<string, number | boolean>
}

export interface BillingMe {
  approved: boolean
  plan: { id: string; name: string; limits: Record<string, number | boolean> }
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  current_period_end: string | null
  cancel_at_period_end?: boolean // true = 已约定期末取消,期内仍可用
  credits_reset_at?: string | null // 下次积分重置时间(下月 1 日)
  teamMember?: boolean // true = Founder 席位成员(套餐由团队承担)
  credits: { month: number; used: number; balance: number } // -1 = 无限(owner)
  /**
   * 我**实际**的通话额度(units)。⚠️ 别从 plan.limits 推 —— 试用用户的 plan_id
   * 就是 'agent',但他的通话额度是独立的(120),不是套餐的 1200。-1 = 无限。
   */
  callQuota?: { total: number; left: number }
  /** 免绑卡试用 (2026-07-11)。used=true → 不能再开,CTA 回落「立即订阅」。 */
  trial?: {
    active: boolean
    used: boolean
    /** 从业者角色 + 无生效订阅 + 没用过 → 产品里长出「一键领取」入口 */
    eligible: boolean
    endsAt: string | null
    daysLeft: number | null
  }
  /** 开发商验证:通过后试用延到 30 天 / 600 积分。 */
  developer?: { verified: boolean; verification: 'pending' | 'approved' | 'rejected' | null }
  /** 当前身份;付款回跳的 role 兜底只在它为空时才写(别把 developer 改写成 agent)。 */
  role?: UserRole | null
}

export interface FeatureCost {
  key: string
  // label/labelEn 已由后端移除 —— 按 key 走 t('pricing:feature.<key>')。
  credits: number               // 标准成本(unit='once' 时是每次)
  minPlan: 'explore' | 'rookie' | 'agent' | 'founder'
  /**
   * 三类,不区分的话 UI 会把它们全渲染成「每次 N 积分」——「通话与视频 1 积分」
   * 会被读成「一场通话 1 积分」,而实时带看会被读成收费的(它其实免费)。
   *   once      按次 · free 免费不限 · call_unit 计量型(套餐送额度,超出才扣)
   */
  unit?: 'once' | 'free' | 'call_unit'
  /** call_unit 才有:1 积分能买几分钟语音 / 几分钟视频 */
  audioMinutesPerCredit?: number
  videoMinutesPerCredit?: number
}
export interface PlanCredits {
  id: string
  creditsMonth: number
  multiplier: number            // Founder < 1(扣得便宜)
  /** 套餐内含的免费通话额度(call units/月;语音 1 分钟=1,视频 1 分钟=4)。0 = 无 */
  callUnits?: number
}
export interface FeaturesInfo {
  features: FeatureCost[]
  plans: PlanCredits[]
  /** 视频的额度权重(4 = 视频 1 分钟吃 4 个额度) */
  videoUnitWeight?: number
  unitsPerCredit?: number
}

/** 公开:积分功能目录(每次成本)+ 各套餐积分额度/折扣。价格页/台内渲染消耗表。 */
export async function fetchFeatures(): Promise<FeaturesInfo> {
  try {
    const res = await fetch(`${BASE}/features`)
    if (!res.ok) return { features: [], plans: [] }
    const j = await res.json()
    return { features: j.features || [], plans: j.plans || [] }
  } catch {
    return { features: [], plans: [] }
  }
}

async function authed(path: string, opts: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = {
    ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...((opts.headers as Record<string, string>) || {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(`${BASE}${path}`, { ...opts, headers })
}

export interface Promo {
  active: boolean
  percentOff?: number       // 30
  forever?: boolean         // 永久锁定创始价
  seatsTotal?: number | null
  seatsRemaining?: number | null
  endsAt?: string | null    // ISO
}

/** 公开:创始发布优惠的实时状态(真实剩余席位 + 截止)。 */
export async function fetchPromo(): Promise<Promo> {
  try {
    const res = await fetch(`${BASE}/promo`)
    if (!res.ok) return { active: false }
    return await res.json()
  } catch {
    return { active: false }
  }
}

/** 公开:套餐目录(价格来自后端,与 Stripe 一致)。 */
export async function fetchPlans(): Promise<BillingPlan[]> {
  try {
    const res = await fetch(`${BASE}/plans`)
    if (!res.ok) return []
    return (await res.json()).plans || []
  } catch {
    return []
  }
}

/** 当前经纪的套餐 + 状态 + 用量;未登录/出错返回 null。 */
export async function fetchBillingMe(): Promise<BillingMe | null> {
  try {
    const res = await authed('/me')
    if (!res.ok) return null
    const j = await res.json()
    return j.success ? (j as BillingMe) : null
  } catch {
    return null
  }
}

// 只卖月付/年付(年付=收10个月);历史季付订阅仍由 portal 管理。
export type BillingInterval = 'month' | 'year'
export type PaidPlanId = 'rookie' | 'agent' | 'founder' | 'developer'

/** 开始订阅:跳转到 Stripe Checkout。返回错误信息(成功则直接跳转,不返回)。 */
export async function startCheckout(
  planId: PaidPlanId,
  interval: BillingInterval = 'month',
  opts?: { hadTrial?: boolean }
): Promise<string | null> {
  try {
    // 埋在跳走之前(immediate):checkout_start 与 checkout_success 的差值
    // = 「绑卡这一步吓跑了多少人」,这是我们此前无法回答的那个问题。
    trackEvent('checkout_start', { plan_id: planId, cycle: interval, had_trial: !!opts?.hadTrial }, { immediate: true })
    const res = await authed('/checkout', { method: 'POST', body: JSON.stringify({ planId, interval }) })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) {
      window.location.href = j.url
      return null
    }
    return j.error || `请求失败 (${res.status})`
  } catch {
    return '网络错误,请重试'
  }
}

// ── 开发商验证 → 30 天 / 600 积分试用 ──────────────────────
export interface DeveloperVerification {
  id: number
  agent_id: string
  email: string
  company: string
  website: string | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  decided_by: string | null
  decided_at: string | null
  created_at: string
  display_name: string | null
  developer_verified_at: string | null
  trial_ends_at: string | null
  trial_credits: number | null
}

/** 申请开发商验证(通过后 owner 一键把试用延到 30 天 / 600 积分)。 */
export async function requestDeveloperVerification(
  body: { company: string; website?: string; note?: string }
): Promise<string | null> {
  try {
    const res = await authed('/developer/verify-request', { method: 'POST', body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    return res.ok && j.success ? null : (j.error || `请求失败 (${res.status})`)
  } catch {
    return '网络错误,请重试'
  }
}

/** admin:开发商验证列表。 */
export async function fetchDeveloperVerifications(): Promise<DeveloperVerification[]> {
  try {
    const res = await authed('/admin/developer-verifications')
    if (!res.ok) return []
    return (await res.json()).verifications || []
  } catch {
    return []
  }
}

/** admin:批 / 拒。批 → 换发一条 30 天 / 600 积分的新试用 + 落 developer 角色。 */
export async function decideDeveloperVerification(id: number, action: 'approve' | 'reject'): Promise<string | null> {
  try {
    const res = await authed(`/admin/developer-verifications/${id}/decide`, {
      method: 'POST', body: JSON.stringify({ action }),
    })
    const j = await res.json().catch(() => ({}))
    return res.ok && j.success ? null : (j.error || `请求失败 (${res.status})`)
  } catch {
    return '网络错误,请重试'
  }
}

export type TrialRole = 'agent' | 'agency' | 'developer'
export interface TrialStarted { plan: string; endsAt: string; days: number; credits: number }

/**
 * 免绑卡试用:不跳 Stripe、不收卡,直接开通 7 天 Starter(200 积分)。
 * 成功返回试用信息;失败返回 { error, code }(trial_used / already_subscribed / not_agent)。
 */
export async function startFreeTrial(role: TrialRole): Promise<{ trial?: TrialStarted; error?: string; code?: string }> {
  try {
    const res = await authed('/trial/start', { method: 'POST', body: JSON.stringify({ role }) })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.success) {
      trackEvent('trial_start', { plan_id: j.trial?.plan, role }, { immediate: true })
      return { trial: j.trial as TrialStarted }
    }
    return { error: j.error || `请求失败 (${res.status})`, code: j.code }
  } catch {
    return { error: '网络错误,请重试' }
  }
}

/** 管理订阅:跳转到 Stripe Billing Portal。 */
export async function openPortal(): Promise<string | null> {
  try {
    const res = await authed('/portal', { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    if (res.ok && j.url) {
      window.location.href = j.url
      return null
    }
    return j.error || `请求失败 (${res.status})`
  } catch {
    return '网络错误,请重试'
  }
}

// ── Founder 团队席位 ─────────────────────────────────────────

export interface TeamInfo {
  role: 'owner' | 'member' | 'none'
  members?: { id: string; email: string; display_name: string }[]
  seatLimit?: number    // 总席位(含本人)
  memberLimit?: number  // 可邀成员数
  extraSeats?: number
  owner?: { email: string; display_name: string } | null
}

export async function fetchTeam(): Promise<TeamInfo | null> {
  try {
    const res = await authed('/team')
    if (!res.ok) return null
    const j = await res.json()
    return j.success ? (j as TeamInfo) : null
  } catch {
    return null
  }
}

/** 邀请成员占一席(共享积分池)。返回错误信息,null = 成功。 */
export async function inviteTeamMember(email: string): Promise<string | null> {
  try {
    const res = await authed('/team/invite', { method: 'POST', body: JSON.stringify({ email }) })
    const j = await res.json().catch(() => ({}))
    return res.ok ? null : j.error || `请求失败 (${res.status})`
  } catch {
    return '网络错误,请重试'
  }
}

export async function removeTeamMember(memberId: string): Promise<string | null> {
  try {
    const res = await authed(`/team/${memberId}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    return res.ok ? null : j.error || `请求失败 (${res.status})`
  } catch {
    return '网络错误,请重试'
  }
}

/** 调整加席数(Stripe 按比例计费,webhook 回写)。返回错误信息,null = 成功。 */
export async function setExtraSeats(extraSeats: number): Promise<string | null> {
  try {
    const res = await authed('/seats', { method: 'POST', body: JSON.stringify({ extraSeats }) })
    const j = await res.json().catch(() => ({}))
    return res.ok ? null : j.error || `请求失败 (${res.status})`
  } catch {
    return '网络错误,请重试'
  }
}

// ── 套餐变更审计(admin)─────────────────────────────────────

export interface PlanChange {
  id: number
  agent_email: string | null
  display_name: string | null
  action: string
  from_plan: string | null
  to_plan: string | null
  from_status: string | null
  to_status: string | null
  reason: string | null
  metadata: Record<string, unknown>
  /** 谁做的这次变更(手动赠送/撤销才有;Stripe webhook 的是系统行为,为 null)。 */
  actor_email: string | null
  created_at: string
}

export async function fetchPlanChanges(opts: { limit?: number; email?: string } = {}): Promise<PlanChange[]> {
  try {
    const q = new URLSearchParams()
    if (opts.limit) q.set('limit', String(opts.limit))
    if (opts.email) q.set('email', opts.email)
    const res = await authed(`/admin/plan-changes?${q.toString()}`)
    if (!res.ok) return []
    return (await res.json()).changes || []
  } catch {
    return []
  }
}

// ── 用户角色(type:buyer/agent)────────────────────────────

async function authHeaders(json = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {}
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  if (t) headers.Authorization = `Bearer ${t}`
  return headers
}

export type UserRole = 'buyer' | 'agent' | 'agency' | 'developer'

/**
 * 🔴 **「读不到」和「没有角色」是两件事,永远不许合并成 null。**
 *
 * 2026-08-12 实测的真实损失:这个函数原来在**三种完全不同的情况**下都回 null ——
 * 真的没角色 / HTTP 挂了 / 网络断了。而 RoleSelectRedirect 把 null 一律当成
 * 「没角色」→ 把人送去 /choose-role。
 *
 * 后果(生产库查出来的两个真人):
 *   · jencruise3@gmail.com(08-11 注册的经纪)—— **179 次 /choose-role**,
 *     8-12 那次是一秒内几十条 `online:false` 的刷新失败,她被卡死在选角色页;
 *   · slavynchuk94@gmail.com —— 我们唯一收到过回信的用户。08-07 回访,
 *     一秒内 6 条网络错误 → 被踢回 /choose-role → 看了一眼价格 → 走了。
 *     她 30 天看了 16 次定价页,全站最高。
 *
 * 所以:失败就说失败(`ok:false`),调用方**必须**自己决定怎么办 ——
 * 而不是替它猜一个「这人没角色」。
 */
export type RoleResult = { ok: true; role: UserRole | null } | { ok: false; role: null }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fetchMyRoleResult(): Promise<RoleResult> {
  // 瞬时抖动重试两次(200ms / 600ms)。离线时直接放弃 —— 重试只会加重风暴,
  // 而 navigator.onLine=false 正是 jencruise3 那一秒里的状态。
  for (let attempt = 0; attempt < 3; attempt++) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) break
    try {
      const res = await fetch(`${API_BASE_URL}/api/me/profile`, { headers: await authHeaders() })
      if (res.ok) return { ok: true, role: ((await res.json()).role as UserRole) || null }
      // 4xx 是**确定的答复**(没登录/没权限),重试没有意义,但也不代表"没角色"
      if (res.status < 500) return { ok: false, role: null }
    } catch { /* 网络层断了 → 落到下面重试 */ }
    if (attempt < 2) await sleep(attempt === 0 ? 200 : 600)
  }
  return { ok: false, role: null }
}

/** 老签名的兼容包装 —— 只给「读不到就当没有」也无所谓的地方用。 */
export async function fetchMyRole(): Promise<UserRole | null> {
  return (await fetchMyRoleResult()).role
}

/**
 * 落角色。**失败必须让调用方看得见** —— RoleSelectPage 原来是
 * `if (!ok) return`,用户点了「我是经纪」什么也没发生,只能一遍遍点。
 * 这是 jencruise3 那 179 次的另一半。
 */
export async function setMyRole(role: UserRole): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/me/profile`, {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ role }),
      })
      if (res.ok) return true
      if (res.status < 500) return false   // 确定的拒绝,重试也一样
    } catch { /* 网络层 → 重试 */ }
    if (attempt < 2) await sleep(attempt === 0 ? 300 : 900)
  }
  return false
}
