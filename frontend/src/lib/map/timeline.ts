// 地图「时间轴模式」数据层 —— 月度(近 3 个月滚动)+ 连续拖动。
//
// 设计铁律 —— 改这个文件前必读：
//
// 1. **拖动时绝不能重建多边形 GeoJSON。** 现有普通着色路径是「JS 算好颜色 → 烤进
//    feature properties → useMemo 重建整个 FeatureCollection → setData」。那套路径
//    拖时间轴会每帧重传 200+ 个多边形，必卡。
//    时间轴改走 **feature-state**：多边形只 setData 一次，每帧只对 ~180 个 feature
//    调 setFeatureState 换颜色（微秒级）。
//    ⚠️ 早先的年度版本是把所有帧的颜色烤进 properties(tc2021..tc2026)，帧数少时可行；
//    换成 67 个月后那样会变成 180 feature × 67 × 2 ≈ 2.4 万个字符串塞进 properties，
//    所以改成了 feature-state。别再退回去烤属性。
//
// 2. **标签不能走 feature-state。** MapLibre 的 feature-state 只能用在 **paint** 属性上，
//    而文字是 `text-field`（**layout** 属性）—— 读不到 feature-state。
//    所以标签走独立的**点**图层，拖动停下后（防抖）整体 setData 一次。
//    这很便宜：那个 source 只有 ~180 个点、没有多边形几何。贵的是多边形，不是点。
//
// 3. **配色阈值必须跨全部月份统一算一次。** 每帧各算各的话，某区数值没动、只因当帧
//    整体分布变了就换颜色 —— 拖动时满屏乱闪，趋势就看不出来了。
//
// 4. **样本不足就是灰色**，不插值、不沿用上一帧。后端已按 3 个月窗口内 n<30 返回 null。
//
// 数据边界（硬事实）：DLD 原始表最早只到 2021-01-01；前 2 个月因窗口不满已被后端裁掉。

import { formatMoneyCompact } from '../money'

/** 时间轴支持的指标。刻意只有三个 —— 时间轴是「看趋势」不是「看全部指标」。 */
export type TimelineMetric = 'medianRent' | 'medianUnitPrice' | 'growth'

export const TIMELINE_METRICS: TimelineMetric[] = ['medianRent', 'medianUnitPrice', 'growth']

/** 各区一条与 months 等长、按月对齐的序列。null = 该窗口样本不足。 */
export interface AreaSeries {
  rent: (number | null)[]
  price: (number | null)[]
  priceSqm: (number | null)[]
  growth: (number | null)[]
}

export interface AreaMonthly {
  dataThrough: string | null
  /** 'YYYY-MM' 升序。 */
  months: string[]
  areas: Record<string, AreaSeries>
}

export function seriesOf(s: AreaSeries | undefined, metric: TimelineMetric): (number | null)[] | null {
  if (!s) return null
  switch (metric) {
    case 'medianRent': return s.rent
    case 'medianUnitPrice': return s.price
    case 'growth': return s.growth
  }
}

export function valueAt(
  data: AreaMonthly, areaId: string, metric: TimelineMetric, i: number
): number | null {
  const s = seriesOf(data.areas[areaId], metric)
  return s ? (s[i] ?? null) : null
}

export interface TimelineScale { p25: number; p50: number; p75: number }

/** 用**所有月份、所有区域**的值算一次分位数。见文件头铁律 3。 */
export function computeTimelineScale(data: AreaMonthly, metric: TimelineMetric): TimelineScale {
  const values: number[] = []
  for (const s of Object.values(data.areas)) {
    const arr = seriesOf(s, metric)
    if (!arr) continue
    for (const v of arr) if (v != null) values.push(v)
  }
  if (!values.length) return { p25: 0, p50: 0, p75: 0 }
  values.sort((a, b) => a - b)
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(values.length * q))]
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) }
}

export const NO_DATA_COLOR = '#94a3b8'

/**
 * 时间轴配色。growth 用发散色（红↔绿，0 为界），量级指标用统一分位数四色。
 * 与 getHeatmapColor 同色板，避免用户在两种模式间切换时觉得「换了套色」。
 */
export function timelineColor(
  value: number | null, metric: TimelineMetric, scale: TimelineScale
): string {
  if (value == null) return NO_DATA_COLOR
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

/** 'YYYY-MM' → 本地化短标签,例如 中文「2025年3月」/ 英文「Mar 2025」。 */
export function formatMonth(ym: string, lang: string): string {
  const [y, m] = ym.split('-')
  if ((lang || 'en').startsWith('zh')) return `${y}年${Number(m)}月`
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1]} ${y}`
}

/** 月轴上每年 1 月的位置 —— 拖动条上打年份刻度用（不然 67 格看不出走到哪年了）。 */
export function yearTicks(months: string[]): { index: number; year: number }[] {
  const out: { index: number; year: number }[] = []
  months.forEach((m, i) => {
    const [y, mo] = m.split('-')
    if (mo === '01') out.push({ index: i, year: Number(y) })
  })
  return out
}
