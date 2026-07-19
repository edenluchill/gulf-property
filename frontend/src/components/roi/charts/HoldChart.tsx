/**
 * 持有年限敏感性 —— 每档一根柱(中位 IRR)+ 一条 p25–p75 须。
 * 所有年限**共用同一批抽样**(见 simulate.ts),所以档与档之间的差就是年限本身的
 * 影响,不掺抽样噪声。
 */
import type { HoldPoint } from '../../../lib/roi/simulate'

const W = 600
const H = 230
const PAD = { t: 12, r: 10, b: 34, l: 38 }

interface Props {
  points: HoldPoint[]
  /** 用户当前选的年限,高亮 */
  activeYears: number
}

export default function HoldChart({ points, activeYears }: Props) {
  if (!points.length) return null
  const lo = Math.min(0, ...points.map((p) => p.p25))
  const hi = Math.max(...points.map((p) => p.p75))
  const span = hi - lo || 0.01
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const sy = (v: number) => PAD.t + (1 - (v - lo) / span) * plotH
  const step = plotW / points.length
  const bw = Math.min(46, step * 0.55)
  const zeroY = sy(0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto" role="img">
      {[lo, lo + span / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.l - 5} y={sy(v) + 3.5} textAnchor="end" fontSize={10} fill="#94a3b8">
            {(v * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth={1.5} />
      {points.map((p, i) => {
        const cx = PAD.l + step * (i + 0.5)
        const y = sy(Math.max(p.median, 0))
        const h = Math.abs(sy(p.median) - zeroY)
        const active = p.years === activeYears
        return (
          <g key={p.years}>
            <rect
              x={cx - bw / 2}
              y={p.median >= 0 ? y : zeroY}
              width={bw}
              height={Math.max(h, 1)}
              rx={3}
              fill={active ? '#0d9488' : '#99f6e4'}
            />
            <line x1={cx} x2={cx} y1={sy(p.p75)} y2={sy(p.p25)} stroke="#0f766e" strokeWidth={1.5} opacity={0.7} />
            <line x1={cx - 5} x2={cx + 5} y1={sy(p.p75)} y2={sy(p.p75)} stroke="#0f766e" strokeWidth={1.5} opacity={0.7} />
            <line x1={cx - 5} x2={cx + 5} y1={sy(p.p25)} y2={sy(p.p25)} stroke="#0f766e" strokeWidth={1.5} opacity={0.7} />
            <text x={cx} y={H - 18} textAnchor="middle" fontSize={11} fill={active ? '#0f172a' : '#64748b'} fontWeight={active ? 600 : 400}>
              {p.years}
            </text>
            <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="#94a3b8">
              {(p.median * 100).toFixed(1)}%
            </text>
          </g>
        )
      })}
    </svg>
  )
}
