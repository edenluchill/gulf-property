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
  plan_id?: 'explore' | 'rookie' | 'agent' | 'founder'
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

/**
 * Owner: 一次性赠送 30 天试用 / 撤销赠送。
 *
 * ⚠️ 不再有「授予永久套餐」这回事(2026-07-13):旧的 comp 授予是 100 年期且没有
 * 任何过期清理,发出去就收不回。现在只能一人一次、30 天、到期自动停。
 * 已经赠送过 / 已有生效订阅 → 后端 409,这里把原因抛出来给 UI 显示。
 */
export async function grantAgentTrial(email: string): Promise<void> {
  const res = await authed(`/${encodeURIComponent(email)}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'grant_trial' }),
  })
  if (res.ok) return
  const j = await res.json().catch(() => ({}))
  throw new Error(
    j.error === 'already_granted' ? '这个经纪已经赠送过了(一人只能一次)'
    : j.error === 'already_subscribed' ? '他已有生效的套餐,不需要赠送'
    : '赠送失败'
  )
}

/** Owner: 撤销赠送(停掉非 Stripe 的行)。注意:撤销不退还「一人一次」的名额。 */
export async function revokeAgentGrant(email: string): Promise<void> {
  await authed(`/${encodeURIComponent(email)}/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'revoke' }),
  })
}

// ── 楼书上传权限(uploader)——admin 之外单独授权某个 email 能上传/审核楼书 ──
export interface UploadPermRow {
  email: string
  granted_by: string | null
  created_at: string
}

export async function listUploadPerms(): Promise<UploadPermRow[]> {
  const res = await authed('/upload-permissions')
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()).permissions || []
}

export async function grantUploadPerm(email: string): Promise<void> {
  const res = await authed('/upload-permissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(String(res.status))
}

export async function revokeUploadPerm(email: string): Promise<void> {
  await authed(`/upload-permissions/${encodeURIComponent(email)}`, { method: 'DELETE' })
}
