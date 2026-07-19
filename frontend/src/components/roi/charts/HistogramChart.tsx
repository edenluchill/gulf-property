/**
 * IRR 分布直方图(60 档)—— 手写 SVG。
 *
 * 为什么不引 Chart.js/recharts:整个前端没有图表库,为四张静态图引 ~180KB
 * 不划算。这类图各 30 行 SVG 就够,而且响应式完全可控。
 * 响应式做法:viewBox + preserveAspectRatio,**绝不写死 px 宽**。
 */
import type { HistBin } from '../../../lib/roi/simulate'

const W = 600
const H = 220
const PAD = { t: 10, r: 8, b: 24, l: 8 }

interface Props {
  bins: HistBin[]
  /** 中位数(小数),画一条参考线 */
  median: number
  /** 盈亏平衡(0)竖线是否显示 */
  showZero?: boolean
}

export default function HistogramChart({ bins, median, showZero = true }: Props) {
  if (!bins.length) return null
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const x0 = bins[0].x0
  const x1 = bins[bins.length - 1].x1
  const span = x1 - x0 || 1
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const sx = (v: number) => PAD.l + ((v - x0) / span) * plotW
  const bw = plotW / bins.length

  const ticks = [x0, x0 + span * 0.25, x0 + span * 0.5, x0 + span * 0.75, x1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto" role="img">
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * plotH
        const negative = b.x1 <= 0
        return (
          <rect
            key={i}
            x={PAD.l + i * bw}
            y={PAD.t + plotH - h}
            width={Math.max(bw - 0.6, 0.6)}
            height={h}
            fill={negative ? '#f87171' : '#14b8a6'}
            opacity={0.85}
          />
        )
      })}
      {showZero && x0 < 0 && x1 > 0 && (
        <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={PAD.t + plotH} stroke="#dc2626" strokeWidth={1} strokeDasharray="3 3" />
      )}
      {median >= x0 && median <= x1 && (
        <line x1={sx(median)} x2={sx(median)} y1={PAD.t} y2={PAD.t + plotH} stroke="#0f172a" strokeWidth={1.5} />
      )}
      <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + plotH} y2={PAD.t + plotH} stroke="#cbd5e1" strokeWidth={1} />
      {ticks.map((tv, i) => (
        <text
          key={i}
          x={sx(tv)}
          y={H - 7}
          textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          fontSize={11}
          fill="#64748b"
        >
          {(tv * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  )
}
