/**
 * 功能建议 API —— /changelog 页面用。
 *
 * 列表是**公开**的(不需要登录也能看别人提了什么);提交要登录。
 * 服务端永远不返回提交人 —— 前端这边也就没有任何字段可以不小心渲染出来。
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

export async function fetchFeatureRequests(): Promise<FeatureRequest[]> {
  const res = await fetch(BASE)
  if (!res.ok) return []          // 公开列表拉不到不该炸掉整页,静默降级为空
  const json = await res.json()
  return (json.requests || []) as FeatureRequest[]
}

export async function submitFeatureRequest(title: string, body: string): Promise<FeatureRequest> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('需要先登录')
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, body }),
  })
  if (!res.ok) await readError(res)
  const json = await res.json()
  return json.request as FeatureRequest
}
