/**
 * Luna Tour — 5-year growth trend chart (SVG).
 *
 * A small animated line+area chart for the "numbers" beat: value rising from
 * buy price (year 0) to projected future value (year 5), with the stroke
 * drawing in. Pure SVG, no deps, mobile-friendly (scales to its container).
 */
import { useEffect, useRef, useState } from 'react'

interface GrowthChartProps {
  buy: number
  future: number
  years: number
  accent: string
}

const W = 300
const H = 140 // ~2:1, normal chart proportions inside the compact card
const PAD_X = 8
const PAD_Y = 16

export default function GrowthChart({ buy, future, years, accent }: GrowthChartProps) {
  // compound path from buy → future over `years`
  const n = Math.max(2, years + 1)
  const ratio = buy > 0 ? future / buy : 1
  const values = Array.from({ length: n }, (_, i) => buy * Math.pow(ratio, i / (n - 1)))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const pts = values.map((v, i) => {
    const x = PAD_X + (i / (n - 1)) * (W - PAD_X * 2)
    const y = PAD_Y + (1 - (v - min) / span) * (H - PAD_Y * 2)
    return [x, y] as const
  })
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`
  const end = pts[pts.length - 1]

  // animate stroke draw
  const pathRef = useRef<SVGPathElement>(null)
  const [len, setLen] = useState(0)
  useEffect(() => {
    if (pathRef.current) setLen(pathRef.current.getTotalLength())
  }, [line])

  const gid = `lt-grad-${Math.round(buy)}`
  return (
    <svg className="lt-growth-svg" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} className="lt-growth-area" />
      <path
        ref={pathRef}
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={len ? { strokeDasharray: len, strokeDashoffset: len, animation: 'lt-draw 1.6s ease-out forwards' } : undefined}
      />
      <circle cx={end[0]} cy={end[1]} r="4" fill={accent} className="lt-growth-dot" />
    </svg>
  )
}
