/**
 * 买家找经纪 —— 派单 API 客户端。
 *
 * 🔴 **匹配和「要联系方式」是两步,别合并。**
 * `matchAgent()` 只拿到"这个人是谁"(名字/头像/头衔),电话要再调 `revealContact()`。
 * 后端故意这么分的:公开接口直接吐经纪私人手机号 = 送给爬虫;而且 reveal 那一下
 * 才是真正的转化信号(光看到一张卡说明不了买家想不想联系)。
 *
 * 🔴 **matchAgent 只在用户真的点了之后调,绝不在挂载时预取。**
 * 每调一次就会在库里落一条派单记录并占用轮换名额 —— 预取的话,轮换会被一堆
 * 压根没想找经纪的人消耗掉,而"派给谁"这件事就失去意义了。
 */
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_API_URL || ''}/api/agent-match`

/** 对外的经纪卡片 —— 没有任何联系方式(那要 reveal)。 */
export interface MatchedAgent {
  display_name: string | null
  photo_url: string | null
  title: string | null
  brokerage: string | null
  rera_brn: string | null
  /**
   * 联系渠道 —— 决定买家侧的流程:
   *   'whatsapp' 直接给 WhatsApp / 电话
   *   'email'    直接给他主动公开的邮箱
   *   'relay'    **买家看不到地址**,由我们转发 → 所以必须让他留下自己的联系方式
   */
  channel?: 'whatsapp' | 'email' | 'relay'
}

export interface MatchResult {
  matchId: number | null
  agent: MatchedAgent | null
  revealed?: boolean
  /** 池子里一个人都没有 —— **正常状态,不是错误**,前端据此不渲染入口。 */
  empty?: boolean
}

export interface RevealedContact {
  display_name: string | null
  channel?: 'whatsapp' | 'email' | 'relay'
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  /** relay 专用:需求是否真的发出去了。**false 要如实告诉买家**,
   *  不然他以为发了、一直在等。 */
  relayed?: boolean
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const t = await token()
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(init?.headers || {}),
    },
  })
}

/**
 * 给这个访客派一个经纪。同一访客对同一项目**永远是同一个人**(服务端 sticky) ——
 * 所以重复调用是安全的,不会把人换掉。
 *
 * X-Visitor-Id 由 track.ts 的全局 fetch 包装统一盖上,这里不用管。
 */
export async function matchAgent(opts: { projectId?: string; source: 'project' | 'map'; prefer?: string }): Promise<MatchResult> {
  const qs = new URLSearchParams({ source: opts.source })
  if (opts.projectId) qs.set('projectId', opts.projectId)
  // prefer = peek 时看到的那个人。**保证「看到谁、点开就是谁」** ——
  // 不带的话高并发下可能被别人抢走名额,买家看到 A 的头像却分到 B。
  if (opts.prefer) qs.set('prefer', opts.prefer)
  const res = await fetch(`${BASE}?${qs}`)
  if (!res.ok) return { matchId: null, agent: null, empty: true }
  return await res.json()
}

/**
 * 「现在值班的是谁」—— **只读,不落库**。
 *
 * 🔴 别拿 matchAgent() 来做这件事:那个会写一条派单记录并占用轮换名额。
 *    入口要在按钮上直接显示头像和名字,也就是**每个打开页面的人**都会触发一次;
 *    用 matchAgent 的话轮换会被一堆压根没想找经纪的人消耗光。
 */
export async function peekNextAgent(projectId?: string): Promise<(MatchedAgent & { id: string }) | null> {
  try {
    const qs = new URLSearchParams()
    if (projectId) qs.set('projectId', projectId)
    const res = await fetch(`${BASE}/next?${qs}`)
    if (!res.ok) return null
    return (await res.json()).agent ?? null
  } catch {
    return null
  }
}

/** 买家要联系方式。留言和自己的联系方式都可选 —— 强制填会把大部分人挡在门外。 */
export async function revealContact(
  matchId: number, buyer?: { contact?: string; note?: string; lang?: string },
): Promise<RevealedContact | null> {
  const res = await fetch(`${BASE}/${matchId}/reveal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // lang = **买家**当前的界面语言。经纪拿到的联系模板按它生成 ——
    // 收信的是买家,不是经纪。默认英文(后端 outreachLang 回落)。
    body: JSON.stringify({ contact: buyer?.contact || '', note: buyer?.note || '', lang: buyer?.lang || '' }),
  })
  if (!res.ok) return null
  return await res.json()
}

// ── 经纪台 ──────────────────────────────────────────────────────────────────

export interface MyMatch {
  id: number
  created_at: string
  revealed_at: string | null
  buyer_contact: string | null
  buyer_note: string | null
  agent_ack_at: string | null
  source: string
  project_name: string | null
  buyer_lang?: string | null
  /** 后端按**买家语言**生成的现成邮件(主题+正文)。经纪复制就能发。 */
  template?: { subject: string; body: string }
}

export async function fetchMyMatches(): Promise<MyMatch[]> {
  const res = await authed('/mine')
  if (!res.ok) return []
  return (await res.json()).matches || []
}

export async function ackMatch(id: number, done: boolean): Promise<boolean> {
  const res = await authed(`/mine/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) })
  return res.ok
}

/** 我在不在派单池里 —— 以及**还差什么**(这才是让经纪去补资料的钩子)。 */
export interface PoolStatus {
  in_pool: boolean
  subscribed: boolean
  has_contact: boolean
  has_photo?: boolean
  has_brn?: boolean
  paused?: boolean
  matched_30d?: number
}

export async function fetchPoolStatus(): Promise<PoolStatus | null> {
  const res = await authed('/pool')
  if (!res.ok) return null
  return await res.json()
}

export async function setPaused(paused: boolean): Promise<boolean> {
  const res = await authed('/pool', { method: 'PATCH', body: JSON.stringify({ paused }) })
  return res.ok
}

// ── admin ───────────────────────────────────────────────────────────────────

export interface RosterRow {
  email: string
  display_name: string | null
  has_contact: boolean
  /** 联系渠道:whatsapp 最快 / email 他主动公开的 / relay 由我们转发 */
  channel: 'whatsapp' | 'email' | 'relay'
  paused: boolean
  subscribed: boolean
  /** **服务端算好的**。别在前端拿几个布尔量再拼一遍 —— 两处判据必然分叉。 */
  in_pool: boolean
  matched_30d: number
  revealed_30d: number
  acked_30d: number
  last_at: string | null
}

export interface AdminMatchRow {
  id: number
  created_at: string
  revealed_at: string | null
  agent_ack_at: string | null
  source: string
  buyer_contact: string | null
  buyer_note: string | null
  visitor_id: string
  agent_email: string
  agent_name: string | null
  project_name: string | null
}

export interface MatchAdmin {
  roster: RosterRow[]
  matches: AdminMatchRow[]
  pool_size: number
  /** 第几轮。轮次**没有时间成分** —— 池里每个人都拿到一条 lead 才进下一轮。 */
  round_no: number
  /** 本轮已经拿到 lead 的人数 */
  round_done: number
  /** 本轮还没轮到的人(队列就在这里面) */
  round_waiting: string[]
  /**
   * 漏斗总量。三个数含义差很多:assigned=看到了卡片,revealed=真提交了需求
   * (**唯一消耗轮次的事件**),acked=经纪自己标的。
   */
  totals: { assigned: number; revealed: number; acked: number; queued: number; visitors: number }
  /** 近 30 天逐日(**含没有数据的天**,缺口不能被折叠掉) */
  daily: { day: string; assigned: number; revealed: number }[]
}

export async function fetchMatchAdmin(): Promise<MatchAdmin | null> {
  const res = await authed('/admin')
  if (!res.ok) return null
  return await res.json()
}
