/**
 * 累积概率曲线(CDF)—— 手写 SVG。
 * 回答的是「IRR 低于 X 的概率有多大」,比直方图更适合读风险。
 */
const W = 600
const H = 220
const PAD = { t: 10, r: 10, b: 24, l: 34 }

interface Props {
  points: { x: number; p: number }[]
  /** 用户关心的门槛(小数),画一条竖线并标出对应概率 */
  threshold?: number
}

export default function CdfChart({ points, threshold = 0 }: Props) {
  if (points.length < 2) return null
  const x0 = points[0].x
  const x1 = points[points.length - 1].x
  const span = x1 - x0 || 1
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const sx = (v: number) => PAD.l + ((v - x0) / span) * plotW
  const sy = (p: number) => PAD.t + (1 - p) * plotH

  const d = points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${sx(pt.x).toFixed(1)},${sy(pt.p).toFixed(1)}`).join('')

  // 门槛处的累积概率(线性查表)
  let pAt: number | null = null
  if (threshold >= x0 && threshold <= x1) {
    let lo = 0
    while (lo < points.length - 1 && points[lo + 1].x < threshold) lo++
    pAt = points[lo].p
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <g key={p}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(p)} y2={sy(p)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.l - 5} y={sy(p) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
            {(p * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {threshold >= x0 && threshold <= x1 && (
        <line x1={sx(threshold)} x2={sx(threshold)} y1={PAD.t} y2={PAD.t + plotH} stroke="#dc2626" strokeWidth={1} strokeDasharray="3 3" />
      )}
      <path d={d} fill="none" stroke="#0d9488" strokeWidth={2} strokeLinejoin="round" />
      {pAt !== null && <circle cx={sx(threshold)} cy={sy(pAt)} r={3.5} fill="#dc2626" />}
      {[x0, x0 + span / 2, x1].map((tv, i) => (
        <text
          key={i}
          x={sx(tv)}
          y={H - 7}
          textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
          fontSize={11}
          fill="#64748b"
        >
          {(tv * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  )
}
