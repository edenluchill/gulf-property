/**
 * 市场口径（期房/现房）前端单点配置 —— docs/offplan-metrics-segmentation-plan-2026-07-01.md
 *
 * 散客默认「期房口径」：中位价/增长只统计期房成交，避免现房结构变化稀释期房增值。
 * 租金回报率/租金稳定性不受口径影响（永远全市场租金，后端保证）。
 * 经纪 portal 自己的数据面（报告/CRM）走独立端点，全口径不受影响。
 *
 * 回滚：把 CONSUMER_SEGMENT 改回 'all' 即恢复旧混合口径（后端三口径全存，随时切）。
 */
export type MarketSegment = 'offplan' | 'ready' | 'all'

/** 散客端默认口径（改这一行即全站切换） */
export const CONSUMER_SEGMENT: MarketSegment = 'offplan'

export function segmentLabel(seg: MarketSegment, zh: boolean): string {
  if (seg === 'offplan') return zh ? '期房' : 'Off-plan'
  if (seg === 'ready') return zh ? '现房' : 'Ready'
  return zh ? '全部' : 'All'
}
