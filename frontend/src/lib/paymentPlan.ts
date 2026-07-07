import { PaymentPlan } from '../types'

/**
 * residential_projects.payment_plan JSONB 有两种历史形态:
 *  - PDF 管道/编辑页提交的 camelCase: { milestone, percentage, date, displayOrder, intervalMonths, intervalDescription }
 *  - 老的 snake_case(与前端 PaymentPlan 类型一致): { milestone_name, display_order, ... }
 * 后端 GET 原样返回 JSONB,这里统一归一化成 PaymentPlan —— PaymentChart/PaymentTimeline
 * 只认 snake_case,不归一化的话 camelCase 项目的里程碑名/时点全是空。
 */
/** 两个日期差多少个月(粗粒度,30.44 天/月),解析失败返回 null。
 *  报价单/弹窗给客户看的是"距上期 N 个月"的间隔而非日历日期(日期常已过期,
 *  2026-07-07 用户定)——项目计划里的死日期用它换算成间隔。 */
export function monthGap(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null
  return Math.max(0, Math.round((db - da) / (30.44 * 24 * 3600 * 1000)))
}

export function normalizePaymentPlan(raw: unknown): PaymentPlan[] {
  if (!Array.isArray(raw)) return []
  return raw.map((m: any, i: number) => ({
    id: m?.id != null ? String(m.id) : String(i),
    project_id: m?.project_id || '',
    milestone_name: m?.milestone_name ?? m?.milestone ?? '',
    percentage: m?.percentage,
    milestone_date: m?.milestone_date ?? m?.date ?? undefined,
    display_order: m?.display_order ?? m?.displayOrder ?? i,
    description: m?.description,
    interval_months: m?.interval_months ?? m?.intervalMonths ?? undefined,
    interval_description: m?.interval_description ?? m?.intervalDescription ?? undefined,
    created_at: m?.created_at || '',
  }))
}
