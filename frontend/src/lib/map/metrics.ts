import { DubaiArea } from '../../types'
import { formatMoneyCompact, formatCountCompact, formatMoneyFull } from '../money'
import { pricePerSqmToPerSqft } from '../units'

export type AreaMetric = 'none' | 'medianUnitPrice' | 'medianPriceSqft' | 'capitalGrowth' | 'transactionCount' | 'rentalYield' | 'netYield' | 'rentStability'

// ============================================================================
// Helper Functions
// ============================================================================

export function getCentroid(coords: [number, number][]): [number, number] {
  let lngSum = 0, latSum = 0
  for (const [lng, lat] of coords) {
    lngSum += lng
    latSum += lat
  }
  return [lngSum / coords.length, latSum / coords.length]
}

export function getPolygonSpan(coords: [number, number][]): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }
  return Math.sqrt((maxLat - minLat) ** 2 + (maxLng - minLng) ** 2)
}

// Progressive disclosure by importance (LOD). The busiest markets reveal first
// at city overview; quieter areas appear as you zoom into their neighborhood.
// This is LOSSLESS (every label is reachable by zooming) and deterministic —
// the opposite of letting the collision engine randomly drop crowded labels.
// `rank` is the area's position when all areas are sorted by transaction count
// (0 = busiest). Areas with no transaction data get Infinity → revealed last.
// Ranking by importance (not polygon size) keeps the overview a clean, curated
// set: big-but-quiet desert areas no longer crowd the city core — their color
// fill still marks them, and the name appears once you zoom into the area.
export function getMinZoomForRank(rank: number): number {
  // Reveal generously — the collision engine (text-allow-overlap:false) still
  // prevents any overlap, so a bigger candidate pool just FILLS empty space with
  // more names instead of leaving gaps. Lowered thresholds (was 12/28/50/90→13)
  // after feedback that too few area names showed at the overview.
  if (rank < 42) return 8    // top ~42 busiest markets — visible at wide city overview
  if (rank < 85) return 9
  return 10                   // everything else (incl. no-data desert areas) by zoom 10
}

// 格式化指标值（按语言：中文 185万，英文 1.85M；中文用户对 K/M 不直观）。
// 不带 "AED" 前缀——地图标签寸土寸金，货币单位由顶部指标条/图例承担。
export function formatMetricValue(area: DubaiArea, metric: AreaMetric, lang: string): string {
  switch (metric) {
    case 'medianUnitPrice': {
      // Total median unit price in AED
      const v = area.medianUnitPrice
      if (v === undefined || v === null) return ''
      return formatMoneyCompact(v, lang)
    }
    case 'medianPriceSqft': {
      // DLD gives per-m²; the UI speaks sqft. Same conversion as AreaInsightsPanel
      // — they show this same field and must not disagree.
      const v = area.medianPriceSqm
      if (v === undefined || v === null) return ''
      return formatMoneyFull(pricePerSqmToPerSqft(v))
    }
    case 'capitalGrowth': {
      const v = area.capitalAppreciation
      if (v === undefined || v === null) return ''
      return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
    }
    case 'transactionCount': {
      const v = area.transactionCount
      if (v === undefined || v === null) return ''
      return formatCountCompact(v, lang)
    }
    case 'rentalYield': {
      const v = area.rentalYield
      if (v === undefined || v === null) return ''
      return `${v.toFixed(1)}%`
    }
    case 'netYield': {
      const v = area.netYield
      if (v === undefined || v === null) return ''
      return `${v.toFixed(1)}%`
    }
    case 'rentStability': {
      const v = area.rentStability
      if (v === undefined || v === null) return ''
      return `${Math.round(v)}%`
    }
    default:
      return ''
  }
}

// 获取指标的原始数值 (用于热力图计算)
export function getMetricRawValue(area: DubaiArea, metric: AreaMetric): number | null {
  switch (metric) {
    case 'medianUnitPrice': return area.medianUnitPrice ?? null
    case 'medianPriceSqft': {
      const v = area.medianPriceSqm
      return v !== undefined && v !== null ? v / 10.764 : null
    }
    case 'capitalGrowth': return area.capitalAppreciation ?? null
    case 'transactionCount': return area.transactionCount ?? null
    case 'rentalYield': return area.rentalYield ?? null
    case 'netYield': return area.netYield ?? null
    case 'rentStability': return area.rentStability ?? null
    default: return null
  }
}

// 计算分位数
export function calculatePercentiles(values: number[]): { p25: number; p50: number; p75: number } {
  if (values.length === 0) return { p25: 0, p50: 0, p75: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const p25 = sorted[Math.floor(sorted.length * 0.25)]
  const p50 = sorted[Math.floor(sorted.length * 0.50)]
  const p75 = sorted[Math.floor(sorted.length * 0.75)]
  return { p25, p50, p75 }
}

// 热力图颜色计算
// capitalGrowth: 绿色=正增长, 红色=负增长
// 其他指标: 用分位数 P25/P50/P75 分割
export function getHeatmapColor(
  value: number | null,
  metric: AreaMetric,
  percentiles: { p25: number; p50: number; p75: number }
): string {
  if (value === null) return '#94a3b8' // 灰色表示无数据

  if (metric === 'capitalGrowth') {
    // 增长率: 绿色=正, 红色=负
    if (value >= 10) return '#059669'      // 深绿 (>10%)
    if (value >= 5) return '#10b981'       // 绿色 (5-10%)
    if (value >= 0) return '#6ee7b7'       // 浅绿 (0-5%)
    if (value >= -5) return '#fca5a5'      // 浅红 (-5-0%)
    if (value >= -10) return '#ef4444'     // 红色 (-10--5%)
    return '#dc2626'                        // 深红 (<-10%)
  }

  // 其他指标: 用分位数分割
  const { p25, p50, p75 } = percentiles

  if (value >= p75) return '#059669'       // 深绿 (top 25%, > P75)
  if (value >= p50) return '#10b981'       // 绿色 (P50-P75)
  if (value >= p25) return '#fbbf24'       // 黄色 (P25-P50)
  return '#ef4444'                          // 红色 (bottom 25%, < P25)
}
