// 地图「时间轴模式」数据层。
//
// 设计铁律 —— 改这个文件前必读：
//
// 1. **切年绝不能重建 GeoJSON。** 现有着色路径是「JS 算好颜色 → 烤进 feature
//    properties → useMemo 重建整个 FeatureCollection → setData」。那套路径拖动
//    滑块会每格重传 200+ 个多边形，必卡。时间轴的做法是**一次性把所有年份的
//    颜色和文案都烤进 properties**（tc2021..tc2026 / tv2021..tv2026），切年只改
//    paint/layout 表达式里的 key（['get','tc2025']）——O(1)，零数据上传。
//    ⇒ 构建 GeoJSON 的 useMemo **依赖数组里绝对不能出现 year**。
//
// 2. **配色阈值必须跨年份统一。** 分位数要用「全部年份合并后的分布」算一次，
//    而不是每年各算各的。否则颜色会自己漂：某区数值明明没动，只因当年整体分布
//    变了就换个颜色 —— 时间轴就失去意义了。
//
// 3. **样本不足就是灰色，不插值、不沿用上一年。** 后端已按 n<30 返回 null。
//
// 数据边界（硬事实，别试图往前扩）：DLD 原始表最早只到 2021-01-01。

import { formatMoneyCompact } from '../money'

/** 时间轴支持的指标。刻意只有三个 —— 时间轴是「看趋势」不是「看全部指标」。 */
export type TimelineMetric = 'medianRent' | 'medianUnitPrice' | 'growth'

export const TIMELINE_METRICS: TimelineMetric[] = ['medianRent', 'medianUnitPrice', 'growth']

export interface YearCell {
  rent: number | null
  rentAll: number | null
  rentN: number
  price: number | null
  priceSqm: number | null
  salesN: number
  growth: number | null
}

export interface AreaYearly {
  dataThrough: string | null
  years: number[]
  /** 不完整的当年。前端必须标 YTD，且不拿它做同比。 */
  ytdYear: number | null
  areas: Record<string, Record<string, YearCell>>
}

/** 从一格里取出某指标的原值。null = 样本不足或无数据 → 灰。 */
export function cellValue(cell: YearCell | undefined, metric: TimelineMetric): number | null {
  if (!cell) return null
  switch (metric) {
    case 'medianRent': return cell.rent
    case 'medianUnitPrice': return cell.price
    case 'growth': return cell.growth
  }
}

/** 该指标在该年的样本数（用于「样本不足」提示与 tooltip）。 */
export function cellSampleSize(cell: YearCell | undefined, metric: TimelineMetric): number {
  if (!cell) return 0
  return metric === 'medianRent' ? cell.rentN : cell.salesN
}

export interface TimelineScale {
  /** 跨全部年份统一的分位数断点。growth 走绝对阈值，不用这个。 */
  p25: number
  p50: number
  p75: number
}

/**
 * 用**所有年份、所有区域**的值算一次分位数。见文件头铁律 2。
 */
export function computeTimelineScale(
  yearly: AreaYearly, metric: TimelineMetric
): TimelineScale {
  const values: number[] = []
  for (const byYear of Object.values(yearly.areas)) {
    for (const year of yearly.years) {
      const v = cellValue(byYear[String(year)], metric)
      if (v != null) values.push(v)
    }
  }
  if (!values.length) return { p25: 0, p50: 0, p75: 0 }
  values.sort((a, b) => a - b)
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) }
}

const NO_DATA = '#94a3b8'

/**
 * 时间轴配色。growth 用发散色（红↔绿，0 为界），量级指标用统一分位数四色。
 * 色板与 getHeatmapColor 保持一致，避免用户在两种模式间切换时觉得「换了套色」。
 */
export function timelineColor(
  value: number | null, metric: TimelineMetric, scale: TimelineScale
): string {
  if (value == null) return NO_DATA
  if (metric === 'growth') {
    if (value >= 15) return '#059669'
    if (value >= 7) return '#10b981'
    if (value >= 0) return '#6ee7b7'
    if (value >= -7) return '#fca5a5'
    if (value >= -15) return '#ef4444'
    return '#dc2626'
  }
  if (value >= scale.p75) return '#059669'
  if (value >= scale.p50) return '#10b981'
  if (value >= scale.p25) return '#fbbf24'
  return '#ef4444'
}

/** 地图标签上的短文案。金额走 formatMoneyCompact（中文万/亿），涨幅带 +/- 和 %。 */
export function timelineLabel(
  value: number | null, metric: TimelineMetric, lang: string
): string {
  if (value == null) return ''
  if (metric === 'growth') return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
  return formatMoneyCompact(value, lang)
}

/** properties 里的 key —— 颜色 tc{year}、文案 tv{year}。paint/layout 表达式按年取。 */
export const colorKey = (year: number) => `tc${year}`
export const valueKey = (year: number) => `tv${year}`

/**
 * 给一个区域烤出「所有年份」的颜色 + 文案，供 feature.properties 展开。
 * 这是整个时间轴平滑的关键：所有年份一次算完，之后切年不再碰数据。
 */
export function bakeAreaYears(
  byYear: Record<string, YearCell> | undefined,
  yearly: AreaYearly,
  metric: TimelineMetric,
  scale: TimelineScale,
  lang: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const year of yearly.years) {
    const v = cellValue(byYear?.[String(year)], metric)
    out[colorKey(year)] = timelineColor(v, metric, scale)
    out[valueKey(year)] = timelineLabel(v, metric, lang)
  }
  return out
}
