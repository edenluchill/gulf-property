/**
 * 经纪准入 API 客户端。/me 用登录经纪的 Supabase token;owner 管理端点同时带
 * dashboard-key 兜底(与 analyticsApi 一致)。
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

const BASE = `${API_BASE_URL}/api/agents`

export type AgentStatus = 'approved' | 'pending' | 'rejected' | 'none' | 'error' | 'loading'

export interface AgentRow {
  id: number
  email: string
  name: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
  decided_at: string | null
  // 订阅/用量(后台展示)
  plan_id?: 'explore' | 'agent' | 'founder'
  sub_status?: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  paid?: boolean
  current_period_end?: string | null
  credits_month?: number
  credits_used?: number
}

async function authed(path: string, opts: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) }
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const key = localStorage.getItem('dashboard-key')
    if (key) headers['x-dashboard-key'] = key
  } catch { /* ignore */ }
  return fetch(`${BASE}${path}`, { ...opts, headers })
}

/** Caller's own approval status. */
export async function fetchAgentStatus(): Promise<AgentStatus> {
  try {
    const res = await authed('/me')
    if (!res.ok) return 'error'
    const j = await res.json()
    return (j.status as AgentStatus) || 'none'
  } catch {
    return 'error'
  }
}

/** Owner: list all agents (pending first). */
export async function listAgents(): Promise<AgentRow[]> {
  const res = await authed('/')
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()).agents || []
}

export async function approveAgent(email: string): Promise<void> {
  await authed(`/${encodeURIComponent(email)}/approve`, { method: 'POST' })
}
export async function rejectAgent(email: string): Promise<void> {
  await authed(`/${encodeURIComponent(email)}/reject`, { method: 'POST' })
}

/** Owner: 手动授予/撤销套餐(comp,不走 Stripe)。plan: explore|agent|founder|revoke */
export async function setAgentPlan(email: string, plan: 'explore' | 'agent' | 'founder' | 'revoke'): Promise<void> {
  await authed(`/${encodeURIComponent(email)}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan }),
  })
}
