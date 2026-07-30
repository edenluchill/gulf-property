/**
 * Luna Tour —— 每个楼盘一条的**公开常驻导览**（客户端读取层）。
 *
 * 和经纪版 tour 的区别：这些导览不是某个经纪给某个客户生成的，而是**楼盘自带**的，
 * 任何人都能看。入口有两个：项目详情页上的按钮、以及 `/tours` 目录页。
 *
 * ISOLATION：只读两个公开端点，不需要登录、不带 token。删掉这个文件 +
 * ProjectTourButton + ToursPage 即可移除。
 */
import { API_BASE_URL } from '../lib/config'

export interface ProjectTour {
  project_id: string
  share_code: string
  project_name: string
  area: string | null
  developer: string | null
  status: string | null
  min_price: number | null
  handover_date: string | null
  image: string | null
  duration_ms: number | null
  published_at: string | null
  featured: number
  /** 播放次数。**目录默认不按它排序** —— 全是 0 的热度榜等于公告「这里没人」。 */
  plays: number
  /** 户型数量。覆盖率最好的一个信号（min_price 只有一半的盘有）。 */
  unit_count: number
}

/** 看这条导览的地址。`?toursession=` 是主力形态（owner 指定的干净首页形式）。 */
export const tourWatchUrl = (shareCode: string): string => `/?toursession=${encodeURIComponent(shareCode)}`

/** 目录页用：所有已上线的楼盘导览。失败返回空数组 —— 目录空着比报错好。 */
export async function fetchProjectTours(): Promise<ProjectTour[]> {
  try {
    const r = await fetch(`${API_BASE_URL}/api/luna/public/project-tours`)
    if (!r.ok) return []
    const j = (await r.json()) as { tours?: ProjectTour[] }
    return Array.isArray(j.tours) ? j.tours : []
  } catch {
    return []
  }
}

/**
 * 详情页用：这个楼盘有没有导览。
 *
 * ⚠️ **「没有」是正常状态**（53 个盘一个一个铺开），所以后端返回 200 + tour:null，
 *    这里也只是返回 null —— 详情页不显示那个按钮而已，不该在控制台里刷错误。
 */
export async function fetchProjectTour(projectId: string): Promise<ProjectTour | null> {
  try {
    const r = await fetch(`${API_BASE_URL}/api/luna/public/project-tours/${encodeURIComponent(projectId)}`)
    if (!r.ok) return null
    const j = (await r.json()) as { tour?: ProjectTour | null }
    return j.tour ?? null
  } catch {
    return null
  }
}

/** 「约 90 秒」——目录卡和按钮上都用它。 */
export function tourDurationLabel(durationMs: number | null, lang: string): string {
  const s = Math.round((durationMs ?? 0) / 1000)
  if (!s) return ''
  const zh = lang.startsWith('zh')
  // 90 秒以内说秒，超过就说分钟 —— 「1.5 分钟」没人这么说话
  if (s < 100) return zh ? `约 ${Math.round(s / 5) * 5} 秒` : `~${Math.round(s / 5) * 5}s`
  const m = Math.round(s / 60)
  return zh ? `约 ${m} 分钟` : `~${m} min`
}
