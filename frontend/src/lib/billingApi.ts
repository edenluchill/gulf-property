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
  limits: Record<string, number | boolean>
}

export interface BillingMe {
  approved: boolean
  plan: { id: string; name: string; limits: Record<string, number | boolean> }
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  current_period_end: string | null
  usage: { luna_tours: number; live_minutes: number }
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

/** 开始订阅:跳转到 Stripe Checkout。返回错误信息(成功则直接跳转,不返回)。 */
export async function startCheckout(planId: 'agent' | 'founder'): Promise<string | null> {
  try {
    const res = await authed('/checkout', { method: 'POST', body: JSON.stringify({ planId }) })
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
