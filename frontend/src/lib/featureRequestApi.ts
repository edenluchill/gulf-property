/**
 * 功能建议 API —— /changelog 页面用。
 *
 * 列表是**公开**的(不登录也能看别人提了什么、多少人赞);提交/点赞/跟帖要登录。
 * 服务端永远不返回提交人 —— 前端这边也就没有任何字段可以不小心渲染出来。
 * 唯一会显示的身份信息是 `role`(经纪/买家/开发商):那是**群体属性,不是身份**。
 */
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_API_URL || ''}/api/feature-requests`

export type RequestStatus = 'open' | 'planned' | 'shipped' | 'declined'

export interface FeatureRequest {
  id: number
  created_at: string
  title: string
  body: string | null
  status: RequestStatus
  reply: string | null
  role: string | null
  votes: number
  comments: number
  voted: boolean
}

export interface RequestComment {
  id: number
  created_at: string
  body: string
  role: string | null
  is_staff: boolean
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** 后端把中文错误写在 message 里(限流/太短)——原样抛出去给用户看,别吞成「失败」。 */
async function readError(res: Response): Promise<never> {
  let msg = ''
  try {
    const j = await res.json()
    msg = j?.message || j?.error || ''
  } catch { /* 非 JSON */ }
  throw new Error(msg || `请求失败 (${res.status})`)
}

async function authed(path: string, body?: unknown, method = 'POST'): Promise<Response> {
  const t = await token()
  if (!t) throw new Error('需要先登录')
  return fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${t}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function fetchFeatureRequests(): Promise<FeatureRequest[]> {
  // 带上 token:后端据此标「我赞过没」。没登录就是普通公开请求。
  const t = await token()
  const res = await fetch(BASE, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
  if (!res.ok) return []          // 公开列表拉不到不该炸掉整页,静默降级为空
  const json = await res.json()
  return (json.requests || []) as FeatureRequest[]
}

export async function submitFeatureRequest(title: string, body: string): Promise<FeatureRequest> {
  const res = await authed('', { title, body })
  if (!res.ok) await readError(res)
  return (await res.json()).request as FeatureRequest
}

export async function toggleVote(id: number): Promise<{ votes: number; voted: boolean }> {
  const res = await authed(`/${id}/vote`)
  if (!res.ok) await readError(res)
  return await res.json()
}

export async function fetchThread(id: number): Promise<RequestComment[]> {
  const res = await fetch(`${BASE}/${id}/thread`)
  if (!res.ok) return []
  return ((await res.json()).comments || []) as RequestComment[]
}

export async function postReply(id: number, body: string): Promise<RequestComment> {
  const res = await authed(`/${id}/reply`, { body })
  if (!res.ok) await readError(res)
  return (await res.json()).comment as RequestComment
}

/** owner 专用:改状态 / 写公开回复。非 owner 调用会 403。 */
export async function updateRequest(
  id: number, patch: { status?: RequestStatus; reply?: string },
): Promise<FeatureRequest> {
  const res = await authed(`/${id}`, patch, 'PATCH')
  if (!res.ok) await readError(res)
  return (await res.json()).request as FeatureRequest
}
