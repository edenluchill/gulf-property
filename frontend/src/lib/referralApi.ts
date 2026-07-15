/**
 * 推荐计划 API 客户端 (2026-07-14) — docs/referral-program-spec.md
 *
 *   attachReferral(code)  登录后把自己钉到推荐人身上(幂等)
 *   fetchReferral()       推广面板数据(链接/漏斗/进度/明细/奖励/badge)
 *   claimShareReward()    首次分享 +7 天(一辈子一次)
 *
 * 归因走「前端存码 + 登录后回传」:落地 /i/:code 时把 code 存 localStorage
 * (60 天窗口,last-click 覆盖),登录成功那一刻 attach。见 lib/referral.ts。
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

const BASE = `${API_BASE_URL}/api/referral`

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

export type AttrStatus = 'attached' | 'pending' | 'qualified' | 'expired' | 'revoked'

export interface ReferralBadge {
  tier: 'none' | 'connector' | 'ambassador' | 'gold'
  label: string
  zh: string
}

export interface ReferralStats {
  code: string
  link: string
  clicks: number
  signups: number
  paid: number
  qualified: number
  progress: number
  perReward: number
  towardNext: number
  badge: ReferralBadge
  referrals: Array<{
    email: string
    status: AttrStatus
    attachedAt: string
    holdUntil: string | null
    expiresAt: string | null
  }>
  rewards: Array<{
    milestone: number
    status: string
    amount: number | null
    currency: string | null
    createdAt: string
    appliedAt: string | null
  }>
  shareRewardClaimed: boolean
  shareRewardDays: number
  shareRewardCredits: number
}

/** 推广面板数据;未登录/出错返回 null。 */
export async function fetchReferral(): Promise<ReferralStats | null> {
  try {
    const res = await authed('/me')
    if (!res.ok) return null
    const j = await res.json()
    return j.success ? (j as ReferralStats) : null
  } catch {
    return null
  }
}

/** 登录后把 code 钉到自己身上。幂等:重复/已归因/自荐都算「已处理」。 */
export async function attachReferral(code: string): Promise<{ ok: boolean; code: string | null }> {
  try {
    const res = await authed('/attach', { method: 'POST', body: JSON.stringify({ code }) })
    const j = await res.json().catch(() => ({}))
    return { ok: !!j.success, code: j.code ?? null }
  } catch {
    return { ok: false, code: null }
  }
}

/** 首次分享 +7 天。返回实际发放的天数(0 = 无试用可延 / already_claimed)。 */
export async function claimShareReward(): Promise<{ ok: boolean; days: number; credits: number; code: string | null }> {
  try {
    const res = await authed('/share-claim', { method: 'POST' })
    const j = await res.json().catch(() => ({}))
    return { ok: !!j.success, days: j.days ?? 0, credits: j.credits ?? 0, code: j.code ?? null }
  } catch {
    return { ok: false, days: 0, credits: 0, code: null }
  }
}
