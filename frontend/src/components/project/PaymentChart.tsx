import { useEffect, useMemo, useRef, useState } from 'react'
import { PaymentPlan } from '../../types'
import { formatMoneyCompact } from '../../lib/money'

/**
 * 付款时间线交互图表（内联 SVG，无依赖）。
 * 横轴 = 距签约的月数（interval_months；缺失时退化为里程碑顺序），
 * 纵轴 = AED：每期柱（teal）+ 累计已付线（violet）——同单位共用一根轴。
 * 交互：每个里程碑一个全高命中区（远大于柱体），hover/focus 出 tooltip
 * （期数/时点/本期金额/累计金额），柱体点亮。金额随所选户型总价换算。
 * 调色板 #0d9488/#4a3aa7 已过 CVD 校验（ΔE 55.9）。
 */
const BAR = '#0d9488'      // 分期款（teal）
const LINE = '#4a3aa7'     // 累计已付（violet）
const GRID = '#e2e8f0'
const TXT = '#334155'
const TXT_MUTED = '#94a3b8'

interface Milestone {
  name: string
  month: number | null
  pct: number
  amount: number
  cumAmount: number
  timing: string
}

export default function PaymentChart({
  paymentPlan,
  price,
  lang,
}: {
  paymentPlan: PaymentPlan[]
  price: number
  lang: string
}) {
  const zh = lang?.startsWith('zh')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo<{ ms: Milestone[]; monthsKnown: boolean }>(() => {
    const sorted = [...paymentPlan].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    const monthsKnown = sorted.length > 0 && sorted.every((m) => m.interval_months != null)
    let cum = 0
    const ms = sorted.map((m, i) => {
      const pct = parseFloat(String(m.percentage)) || 0
      const amount = (price * pct) / 100
      cum += amount
      const timing = m.interval_description
        || (m.interval_months != null
          ? (m.interval_months === 0 ? (zh ? '签约时' : 'At booking') : (zh ? `第 ${m.interval_months} 个月` : `Month ${m.interval_months}`))
          : (m.milestone_date ? String(m.milestone_date).slice(0, 10) : ''))
      return {
        name: m.milestone_name,
        month: monthsKnown ? (m.interval_months as number) : i,
        pct,
        amount,
        cumAmount: cum,
        timing,
      }
    })
    return { ms, monthsKnown }
  }, [paymentPlan, price, zh])

  const { ms, monthsKnown } = data
  if (!ms.length || !price) return <div ref={wrapRef} />

  // ── 布局 ──────────────────────────────────────────────────────────────
  const H = 250
  const M = { t: 18, r: 14, b: 30, l: 8 }
  const w = Math.max(width, 280)
  const innerW = w - M.l - M.r
  const innerH = H - M.t - M.b
  const maxMonth = Math.max(...ms.map((m) => m.month ?? 0), 1)
  const yMax = ms[ms.length - 1].cumAmount || price
  // 右端多留 60px:y 轴刻度标签在右侧,别让最后一根柱压住它
  const x = (month: number) => M.l + 18 + (month / maxMonth) * (innerW - 78)
  const y = (v: number) => M.t + innerH - (v / yMax) * innerH
  const slot = (innerW - 48) / Math.max(ms.length - 1, 1)
  const barW = Math.min(24, Math.max(8, slot - 4))

  // 柱体:顶部 4px 圆角、底部方角(贴基线)
  const barPath = (cx: number, v: number) => {
    const topY = y(v), baseY = y(0), hw = barW / 2, r = Math.min(4, (baseY - topY) / 2, hw)
    return `M${cx - hw},${baseY} L${cx - hw},${topY + r} Q${cx - hw},${topY} ${cx - hw + r},${topY} L${cx + hw - r},${topY} Q${cx + hw},${topY} ${cx + hw},${topY + r} L${cx + hw},${baseY} Z`
  }

  const yTicks = 4
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (yMax / yTicks) * i)
  const linePts = ms.map((m) => `${x(m.month!)},${y(m.cumAmount)}`).join(' ')
  const areaPts = `${x(ms[0].month!)},${y(0)} ${linePts} ${x(ms[ms.length - 1].month!)},${y(0)}`
  const hovered = hover != null ? ms[hover] : null
  // tooltip 水平位置(clamp 在图内)
  const tipX = hovered ? Math.min(Math.max(x(hovered.month!) - 90, 4), w - 190) : 0

  return (
    <div ref={wrapRef} className="relative">
      {/* 图例:两个系列必有图例(rect=柱 / line=线) */}
      <div className="mb-1.5 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: BAR }} />
          {zh ? '本期应付' : 'Installment'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: LINE }} />
          {zh ? '累计已付' : 'Cumulative paid'}
        </span>
      </div>

      {width > 0 && (
        <svg width={w} height={H} role="img"
             aria-label={zh ? '付款时间线图表' : 'Payment timeline chart'}>
          {/* 网格 + y 轴刻度(hairline,不抢数据) */}
          {/* 最顶刻度不标——终点已直接标注总额,避免右上两个相同数字 */}
          {tickVals.map((v, i) => (
            <g key={i}>
              <line x1={M.l} x2={w - M.r} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
              {i > 0 && i < yTicks && (
                <text x={w - M.r} y={y(v) - 3} textAnchor="end" fontSize={9} fill={TXT_MUTED}>
                  {formatMoneyCompact(v, lang)}
                </text>
              )}
            </g>
          ))}

          {/* 累计面积轻染 + 折线 */}
          <polygon points={areaPts} fill={LINE} opacity={0.08} />
          <polyline points={linePts} fill="none" stroke={LINE} strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round" />

          {/* 分期柱 */}
          {ms.map((m, i) => (
            <path key={i} d={barPath(x(m.month!), m.amount)} fill={BAR}
                  opacity={hover == null || hover === i ? 1 : 0.45} />
          ))}

          {/* 累计线节点:白 ring 保证压线可读;终点大一号 + 直接标注总价 */}
          {ms.map((m, i) => (
            <circle key={i} cx={x(m.month!)} cy={y(m.cumAmount)}
                    r={i === ms.length - 1 ? 5 : hover === i ? 5 : 3.5}
                    fill={LINE} stroke="#fff" strokeWidth={2} />
          ))}
          <text x={Math.min(x(ms[ms.length - 1].month!), w - M.r)} y={y(yMax) - 7}
                textAnchor="end" fontSize={11} fontWeight={600} fill={TXT}>
            {formatMoneyCompact(yMax, lang)}
          </text>

          {/* x 轴时点标签 */}
          {ms.map((m, i) => (
            <text key={i} x={x(m.month!)} y={H - 10} textAnchor="middle" fontSize={9}
                  fill={hover === i ? TXT : TXT_MUTED}>
              {monthsKnown ? (m.month === 0 ? (zh ? '签约' : 'Book') : `${m.month}${zh ? '月' : 'mo'}`) : i + 1}
            </text>
          ))}

          {/* 命中区:全高、比柱体宽(≥slot),hover/键盘 focus 都出 tooltip */}
          {ms.map((m, i) => (
            <rect key={i}
                  x={x(m.month!) - Math.max(slot, barW + 8) / 2} y={M.t}
                  width={Math.max(slot, barW + 8)} height={innerH + M.b - 6}
                  fill="transparent" tabIndex={0}
                  aria-label={`${m.name} ${m.timing} ${Math.round(m.amount).toLocaleString()}`}
                  onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)}
                  onPointerLeave={() => setHover(null)} onBlur={() => setHover(null)} />
          ))}
        </svg>
      )}

      {/* Tooltip:值为主、名为次;两系列同框;不 gate(卡片列表里全都有) */}
      {hovered && (
        <div className="pointer-events-none absolute top-1 z-10 w-[184px] rounded-xl bg-slate-900 p-2.5 shadow-xl"
             style={{ left: tipX }}>
          {(hovered.name || hovered.timing) && (
            <div className="mb-1 truncate text-[11px] text-slate-300">
              {[hovered.name, hovered.timing].filter(Boolean).join(' · ') || (zh ? `第 ${(hover ?? 0) + 1} 期` : `Installment ${(hover ?? 0) + 1}`)}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: BAR }} />
              {zh ? '本期' : 'Due'} {hovered.pct}%
            </span>
            <span className="text-xs font-bold text-white">{formatMoneyCompact(hovered.amount, lang)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: LINE }} />
              {zh ? '累计' : 'Total'} {price ? Math.round((hovered.cumAmount / price) * 100) : 0}%
            </span>
            <span className="text-xs font-semibold text-slate-200">{formatMoneyCompact(hovered.cumAmount, lang)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
