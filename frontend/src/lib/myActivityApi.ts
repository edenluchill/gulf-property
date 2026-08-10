/**
 * 买家的「我的东西」—— 收藏 / 看过的房源 / 联系过的顾问。
 *
 * 身份走**登录邮箱 ∪ visitor_id** 两条腿(服务端判):只认登录的话,
 * 匿名逛的记录全丢 —— 而买家绝大多数时候是匿名的。
 * X-Visitor-Id 由 track.ts 的全局 fetch 包装统一盖上,这里不用管。
 */
import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_API_URL || ''}/api/my-activity`

export interface ActivityProject {
  id: string
  project_name: string
  developer: string | null
  area: string | null
  starting_price: number | null
  completion_date?: string | null
  added_at?: string
  viewed_at?: string
}

export interface ActivityAdvisor {
  match_id: number
  created_at: string
  /** 买家真的要过联系方式(= agent-match 的 reveal) */
  revealed: boolean
  display_name: string | null
  photo_url: string | null
  title: string | null
  project_name: string | null
}

export interface MyActivity {
  favorites: ActivityProject[]
  viewed: ActivityProject[]
  /** **不含任何联系方式** —— 要电话仍走 agent-match 的 reveal(唯一出口 + 转化埋点) */
  advisors: ActivityAdvisor[]
  signed_in: boolean
}

const EMPTY: MyActivity = { favorites: [], viewed: [], advisors: [], signed_in: false }

export async function fetchMyActivity(): Promise<MyActivity> {
  try {
    const { data } = await supabase.auth.getSession()
    const tok = data.session?.access_token
    const res = await fetch(BASE, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined)
    if (!res.ok) return EMPTY
    return await res.json()
  } catch {
    // 个人页拉不到这块不该炸掉整页 —— 静默降级成空
    return EMPTY
  }
}
