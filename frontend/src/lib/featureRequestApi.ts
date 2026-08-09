/**
 * 功能建议 API —— /changelog 页面用。
 *
 * 列表是**公开**的(不登录也能看别人提了什么、多少人赞);提交/点赞/跟帖要登录。
 *
 * 署名(2026-08-08 起):`author` 是公开显示名,null = 匿名(2026-08-08 之前的存量帖
 * 全是 null,它们提交时页面写的是"匿名")。`author_email` **只有 owner/admin 拿得到**
 * ——服务端按登录身份决定给不给,前端只管有就显示、没有就不显示,别自己判断权限
 * (判据放两处早晚分叉)。
 */
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_API_URL || ''}/api/feature-requests`

export type RequestStatus = 'open' | 'planned' | 'shipped' | 'declined'

/**
 * 这条建议给谁看:'all' 所有人 / 'agent' 只给经纪侧。
 * **列表由服务端按登录身份过滤**——买家拉到的数组里根本不会有 agent 的条目,
 * 前端不用也不该再过滤一遍(两处判据早晚会分叉)。
 */
export type RequestAudience = 'all' | 'agent'

export interface FeatureRequest {
  id: number
  created_at: string
  title: string
  body: string | null
  status: RequestStatus
  reply: string | null
  /** 官方回复的时间。**不是** updated_at —— 那个会被改状态/受众刷新。 */
  replied_at: string | null
  role: string | null
  audience: RequestAudience
  votes: number
  comments: number
  voted: boolean
  /** 公开署名;null = 匿名(存量帖 + 取不到名字的新帖)。 */
  author: string | null
  /** 只有 owner/admin 会收到这个字段。 */
  author_email?: string
}

export interface RequestComment {
  id: number
  created_at: string
  body: string
  role: string | null
  is_staff: boolean
  author: string | null
  author_email?: string
}

/** 我这条会以什么名义公开发布 —— 发帖弹窗如实显示用。 */
export interface WhoAmI {
  author: string | null
  signed_in: boolean
  staff?: boolean
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

/** 单条(每条建议有自己的页面 /requests/:id)。不存在返回 null,由页面显示「找不到」。 */
export async function fetchFeatureRequest(id: number): Promise<FeatureRequest | null> {
  const t = await token()
  const res = await fetch(`${BASE}/${id}`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
  if (!res.ok) return null
  return (await res.json()).request as FeatureRequest
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

/** 楼层。**带 token** —— owner 靠它才能在楼层里看到 author_email(去回访提议人)。 */
export async function fetchThread(id: number): Promise<RequestComment[]> {
  const t = await token()
  const res = await fetch(`${BASE}/${id}/thread`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
  if (!res.ok) return []
  return ((await res.json()).comments || []) as RequestComment[]
}

/**
 * 发帖前问一句"我会署成什么名"。
 *
 * 不复用别处的 profile 接口:那些要么没挂在这页、要么返回一大坨。这里只要一个字符串,
 * 而且必须和服务端写库时用的是**同一个判据**(后端 whoami 和写库都走 displayNameOf)。
 */
export async function fetchWhoami(): Promise<WhoAmI> {
  try {
    const t = await token()
    const res = await fetch(`${BASE}/whoami`, t ? { headers: { Authorization: `Bearer ${t}` } } : undefined)
    if (!res.ok) return { author: null, signed_in: false }
    return await res.json()
  } catch {
    return { author: null, signed_in: false }
  }
}

export async function postReply(id: number, body: string): Promise<RequestComment> {
  const res = await authed(`/${id}/reply`, { body })
  if (!res.ok) await readError(res)
  return (await res.json()).comment as RequestComment
}

/** owner 专用:改状态 / 写公开回复 / 纠正受众。非 owner 调用会 403。 */
export async function updateRequest(
  id: number, patch: { status?: RequestStatus; reply?: string; audience?: RequestAudience },
): Promise<FeatureRequest> {
  const res = await authed(`/${id}`, patch, 'PATCH')
  if (!res.ok) await readError(res)
  return (await res.json()).request as FeatureRequest
}
