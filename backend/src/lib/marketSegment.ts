/**
 * 市场口径（期房/现房）单点配置 —— docs/offplan-metrics-segmentation-plan-2026-07-01.md
 *
 * 散客端产品默认「期房口径」：混合口径的中位价/增长会被现房结构拉动，
 * 让期房增值失真（对经纪/开发商不精准）。经纪 portal 前端显式传 'all'。
 * 指标级例外：租金回报率/租金稳定性永远全口径（租金全部来自已交付现房）。
 *
 * 回滚：服务器 compose 加 MARKET_DEFAULT_SEGMENT=all（免改代码），
 *      或把下面 'offplan' 改回 'all' 重新部署。数据层三口径全存，随时可切。
 */
export type MarketSegment = 'offplan' | 'ready' | 'all'

const VALID: readonly MarketSegment[] = ['offplan', 'ready', 'all']

/** 散客/AI 链路的默认口径（env 可覆盖） */
export const DEFAULT_SEGMENT: MarketSegment = VALID.includes(
  process.env.MARKET_DEFAULT_SEGMENT as MarketSegment
)
  ? (process.env.MARKET_DEFAULT_SEGMENT as MarketSegment)
  : 'offplan'

/** segment 样本护栏：近 12 个月该口径成交低于此数时回退全口径（防小样本抖动） */
export const SEGMENT_MIN_SAMPLE = Number(process.env.MARKET_SEGMENT_MIN_SAMPLE || 10)

/** 解析 query 参数（?segment= / ?type=），非法值回退 fallback */
export function parseSegment(v: unknown, fallback: MarketSegment = DEFAULT_SEGMENT): MarketSegment {
  return VALID.includes(v as MarketSegment) ? (v as MarketSegment) : fallback
}

/** segment → SQL 函数的 is_offplan 布尔参数（'all' → null = 不过滤） */
export function segmentToOffplan(seg: MarketSegment): boolean | null {
  return seg === 'all' ? null : seg === 'offplan'
}
