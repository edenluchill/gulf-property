/**
 * 市场口径（期房/现房）前端单点配置
 * —— docs/offplan-metrics-segmentation-plan-2026-07-01.md（segment 维度）
 * —— docs/segment-filter-map-plan-2026-07-02.md（口径筛选器）
 *
 * 2026-07-02 定版：默认显示全部综合数据，地图右上角口径筛选器（全部/期房/现房）
 * 联动整张地图与区域块。租金回报率/租金稳定性/成交量不受口径影响（后端保证）。
 * Luna/AI 链路仍默认期房口径（服务端 DEFAULT_SEGMENT，与展示层独立）。
 */
export type MarketSegment = 'offplan' | 'ready' | 'all'

/** 散客端默认口径（改这一行即全站切换默认） */
export const CONSUMER_SEGMENT: MarketSegment = 'all'

export function segmentLabel(seg: MarketSegment, zh: boolean): string {
  if (seg === 'offplan') return zh ? '期房' : 'Off-plan'
  if (seg === 'ready') return zh ? '现房' : 'Ready'
  return zh ? '全部' : 'All'
}

/** 口径筛选器持久化（记住用户上次选择，跨会话） */
export const SEGMENT_STORAGE_KEY = 'pinzos_market_segment'

export function loadSavedSegment(): MarketSegment {
  try {
    const s = localStorage.getItem(SEGMENT_STORAGE_KEY)
    if (s === 'offplan' || s === 'ready' || s === 'all') return s
  } catch { /* ignore */ }
  return CONSUMER_SEGMENT
}

export function saveSegment(seg: MarketSegment) {
  try { localStorage.setItem(SEGMENT_STORAGE_KEY, seg) } catch { /* ignore */ }
}
