/**
 * Stripe billing API 客户端(设计稿: docs/stripe-billing-spec.md)。
 *  - /plans 公开(营销报价页 + 台内升级页共用,价格单一真相源)。
 *  - /checkout /portal /me 带登录经纪的 Supabase token。
 * checkout/portal 返回 Stripe 托管页 url,前端直接 window.location 跳过去。
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

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
  teamMember?: boolean // true = Founder 席位成员(套餐由团队承担)
  credits: { month: number; used: number; balance: number } // -1 = 无限(owner)
}

export interface FeatureCost {
  key: string
  label: string
  labelEn?: string              // 英文名(i18n;后端 featureCatalog 提供)
  credits: number               // 标准每次成本
  minPlan: 'explore' | 'rookie' | 'agent' | 'founder'
}
export interface PlanCredits {
  id: string
  creditsMonth: number
  multiplier: number            // Founder < 1(扣得便宜)
}
export interface FeaturesInfo {
  features: FeatureCost[]
  plans: PlanCredits[]
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
export async function startCheckout(planId: PaidPlanId, interval: BillingInterval = 'month'): Promise<string | null> {
  try {
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

export async function fetchMyRole(): Promise<UserRole | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/me/profile`, { headers: await authHeaders() })
    if (!res.ok) return null
    const j = await res.json()
    return j.role || null
  } catch {
    return null
  }
}

export async function setMyRole(role: UserRole): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/me/profile`, {
      method: 'POST',
      headers: await authHeaders(true),
      body: JSON.stringify({ role }),
    })
    return res.ok
  } catch {
    return false
  }
}
