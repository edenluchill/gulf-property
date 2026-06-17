import { ReactNode, useMemo } from 'react'
import { cn } from '../../lib/utils'

export interface TrendPoint {
  day: string
  value: number
}

/**
 * Minimal inline-SVG area/line trend — no chart dependency (matches the app's
 * existing hand-rolled SVG charts). Pass any [{day,value}] series.
 */
export default function TrendChart({
  title,
  points,
  height = 160,
  className,
  headerRight,
}: {
  title: string
  points: TrendPoint[]
  height?: number
  className?: string
  headerRight?: ReactNode
}) {
  const W = 600
  const H = height
  const PAD = 24

  const { line, area, max } = useMemo(() => {
    if (points.length === 0) return { line: '', area: '', max: 0 }
    const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1
    const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0
    const x = (i: number) => PAD + i * stepX
    const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2)
    const coords = points.map((p, i) => `${x(i)},${y(p.value)}`)
    const line = `M ${coords.join(' L ')}`
    const area = `${line} L ${x(points.length - 1)},${H - PAD} L ${x(0)},${H - PAD} Z`
    return { line, area, max }
  }, [points])

  return (
    <div className={cn('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <div className="flex items-center gap-2">
          {headerRight}
          <span className="text-xs text-slate-400">峰值 {max}</span>
        </div>
      </div>
      {points.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无数据</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#trendFill)" />
          <path d={line} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
      {points.length > 0 && (
        <div className="mt-1 flex justify-between text-[10px] text-slate-400">
          <span>{points[0].day.slice(5)}</span>
          <span>{points[points.length - 1].day.slice(5)}</span>
        </div>
      )}
    </div>
  )
}
