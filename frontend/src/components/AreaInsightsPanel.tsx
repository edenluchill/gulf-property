/**
 * 区域洞察共享组件 —— 桌面 AreaDetailDialog 和移动端 bottom sheet 共用：
 * useAreaInsights(取数 hook) + AreaTrendGrid(四指标趋势卡) + AreaRecentTx(近期成交,可加载更多)
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { BadgeCheck, Info } from 'lucide-react'
import { DubaiArea } from '../types'
import { formatMoneyCompact, formatMoneyFull } from '../lib/money'
import { fetchAreaInsights, fetchTxList, AreaInsights } from '../lib/api'
import DirhamSymbol from './DirhamSymbol'

// ── 取数 hook ────────────────────────────────────────────────────────────────

export function useAreaInsights(areaId: string | undefined, usage: string = 'residential') {
  const [insights, setInsights] = useState<AreaInsights | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!areaId) { setInsights(null); return }
    let stale = false
    setInsights(null)
    setLoading(true)
    fetchAreaInsights(areaId, usage).then(d => {
      if (stale) return
      setInsights(d)
      setLoading(false)
    })
    return () => { stale = true }
  }, [areaId, usage])
  return { insights, loading }
}

// ── 迷你趋势图（无依赖 SVG）────────────────────────────────────────────────

// Small floating value label that follows the hovered point on a spark chart.
function SparkTip({ xPct, text, label }: { xPct: number; text: string; label?: string }) {
  return (
    <div
      className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-lg"
      style={{ left: `${Math.min(Math.max(xPct, 16), 84)}%` }}
    >
      {text}
      {label ? <span className="ml-1 font-normal text-slate-400">{label}</span> : null}
    </div>
  )
}

function SparkLine({ data, color, showZero, labels, fmt }: {
  data: (number | null)[]; color: string; showZero?: boolean; labels?: string[]; fmt?: (v: number) => string
}) {
  const w = 132, h = 36
  const [hover, setHover] = useState<number | null>(null)
  const vals = data.filter((v): v is number => v != null)
  if (vals.length < 2) {
    return <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
  }
  const min = Math.min(...vals, showZero ? 0 : Infinity)
  const max = Math.max(...vals, showZero ? 0 : -Infinity)
  const span = Math.max(max - min, 1e-9)
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6)
  const pts: [number, number][] = []
  data.forEach((v, i) => {
    if (v != null) pts.push([(i / Math.max(data.length - 1, 1)) * w, y(v)])
  })
  const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const fill = `${pts[0][0].toFixed(1)},${h} ${line} ${pts[pts.length - 1][0].toFixed(1)},${h}`

  // map a 0..1 fraction to the nearest index that actually has a value
  const pick = (frac: number) => {
    let idx = Math.max(0, Math.min(Math.round(frac * (data.length - 1)), data.length - 1))
    if (data[idx] == null) {
      for (let d = 1; d < data.length; d++) {
        if (data[idx - d] != null) { idx -= d; break }
        if (data[idx + d] != null) { idx += d; break }
      }
    }
    return data[idx] != null ? idx : null
  }
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover(pick((e.clientX - r.left) / r.width))
  }
  const hv = hover != null ? data[hover] : null
  const hxPct = hover != null ? (hover / Math.max(data.length - 1, 1)) * 100 : 0
  const hyPct = hv != null ? (y(hv) / h) * 100 : 0

  return (
    <div className="relative cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
        {showZero && min < 0 && max > 0 && (
          <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,3" />
        )}
        <polygon points={fill} fill={color} opacity={0.1} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {hv != null && (
        <>
          <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-slate-300/70" style={{ left: `${hxPct}%` }} />
          <div
            className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
            style={{ left: `${hxPct}%`, top: `${hyPct}%`, background: color }}
          />
          <SparkTip xPct={hxPct} text={fmt ? fmt(hv) : Math.round(hv).toLocaleString()} label={labels?.[hover!]} />
        </>
      )}
    </div>
  )
}

function SparkBars({ data, color, labels, fmt }: {
  data: number[]; color: string; labels?: string[]; fmt?: (v: number) => string
}) {
  const w = 132, h = 36
  const [hover, setHover] = useState<number | null>(null)
  if (!data.length) return <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
  const max = Math.max(...data, 1)
  const bw = w / data.length
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const idx = Math.floor(((e.clientX - r.left) / r.width) * data.length)
    setHover(Math.max(0, Math.min(idx, data.length - 1)))
  }
  const hxPct = hover != null ? ((hover + 0.5) / data.length) * 100 : 0
  return (
    <div className="relative cursor-crosshair" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
        {data.map((v, i) => {
          const bh = Math.max((v / max) * (h - 4), v > 0 ? 1.5 : 0)
          return <rect key={i} x={i * bw + 0.5} y={h - bh} width={Math.max(bw - 1, 1)} height={bh} fill={color} opacity={hover === i ? 0.95 : 0.55} rx={1} />
        })}
      </svg>
      {hover != null && (
        <SparkTip xPct={hxPct} text={fmt ? fmt(data[hover]) : data[hover].toLocaleString()} label={labels?.[hover]} />
      )}
    </div>
  )
}

// Small "how it's calculated" hint — click toggles a popover with the formula
// (and, when passed, the evidence: how many leases it's based on). Works on
// mobile (click) and desktop; a full-screen catcher closes it on outside click.
function InfoHint({ title, text, evidence }: { title: string; text: string; evidence?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Render the popover in a body portal with viewport-clamped fixed position so
  // it can't be clipped by the dialog's rounded/overflow edges (was cut off).
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pos) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const W = 248
    const left = Math.max(8, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 8))
    setPos({ top: r.bottom + 6, left })
  }
  return (
    <span className="inline-flex shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="text-slate-300 transition-colors hover:text-slate-500"
        aria-label="How it's calculated"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[10005]" onClick={(e) => { e.stopPropagation(); setPos(null) }} />
          <div
            className="fixed z-[10006] w-[248px] rounded-xl bg-slate-900 p-3 text-left shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
            <p className="text-[12px] font-normal leading-relaxed text-white">{text}</p>
            {evidence && <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] leading-relaxed text-slate-400">{evidence}</p>}
          </div>
        </>,
        document.body
      )}
    </span>
  )
}

function StatCard({ label, info, value, valueClass = 'text-slate-900', chip, chipClass, loading, children }: {
  label: string
  info?: ReactNode
  value: ReactNode
  valueClass?: string
  chip?: string | null
  chipClass?: string
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-xs font-medium text-slate-500">{label}</span>
          {info}
        </span>
        {chip && (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${chipClass || 'bg-slate-100 text-slate-500'}`}>
            {chip}
          </span>
        )}
      </div>
      <div className={`mt-1 flex items-center gap-1 text-lg font-bold leading-tight ${valueClass}`}>{value}</div>
      <div className="mt-2">
        {loading ? <div className="h-9 animate-pulse rounded bg-slate-100" /> : children}
      </div>
    </div>
  )
}

const lastNonNull = (arr: (number | null)[] | undefined) => {
  if (!arr) return null
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]
  return null
}

// ── 四指标趋势卡 ────────────────────────────────────────────────────────────

export function AreaTrendGrid({ area, insights, loading, usageActive = false }: {
  area: DubaiArea
  insights: AreaInsights | null
  loading: boolean
  usageActive?: boolean   // a specific usage filter is active → prefer the per-usage insights series
}) {
  const { t, i18n } = useTranslation(['map'])
  const zh = (i18n.language || 'en').startsWith('zh')
  // `area.*` is the map's combined ('all') value. When the user picks a specific
  // usage in the dialog, the insights series IS that usage → prefer it. Otherwise
  // prefer the precomputed area columns, falling back to insights (custom areas).
  const insVol = insights?.volume?.length ? insights.volume.reduce((a, b) => a + b, 0) : null
  // When a specific usage is selected, show ONLY that usage's real data (the
  // insights series). Never fall back to area.* (the map's combined 'all' value)
  // — otherwise a usage with 0 transactions would wrongly show the 'all' price/
  // growth. For 'all', use the precomputed area columns, falling back to insights.
  const pick = <T,>(a: T | null | undefined, b: T | null | undefined) =>
    usageActive ? (b ?? null) : (a ?? b)
  const growthNow = pick(area.capitalAppreciation, lastNonNull(insights?.growth))
  const yieldNow = pick(area.rentalYield, lastNonNull(insights?.rentalYield))
  // Rent stability is residential-derived → only meaningful in the 'all' view.
  const stabilityNow = usageActive ? null : (area.rentStability ?? null)
  const medianPsm = pick(area.medianPriceSqm, lastNonNull(insights?.price))
  const txCount = pick(area.transactionCount, insVol)
  // Single price value for the tile. For a specific usage, only its own median —
  // never the area's combined avg. For 'all', median then avg fallback.
  const priceDisplay = medianPsm ?? (usageActive ? null : (area.averagePrice ?? null))
  const pctChip = (v: number | null | undefined) =>
    v == null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  // Evidence line: how many new/renewal leases the rent metrics are based on.
  const leaseEvidence = (area.newContractCount != null && area.renewContractCount != null)
    ? t('map:explain.basedOn', {
        newCount: area.newContractCount.toLocaleString(),
        renewCount: area.renewContractCount.toLocaleString(),
      })
    : undefined
  const howTitle = t('map:explain.howCalculated')

  // Clean empty-state: many display areas are industrial / land / low-activity, or
  // not yet matched to DLD's cadastre — show an intentional note, not a grid of "—".
  const hasAnyMetric =
    priceDisplay != null || (txCount != null && txCount > 0) || growthNow != null || yieldNow != null
  if (!loading && !hasAnyMetric) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
        <div className="text-sm font-medium text-slate-600">
          {zh ? '该区域近期住宅成交较少' : 'Limited recent residential activity'}
        </div>
        <div className="mt-1.5 text-xs leading-relaxed text-slate-400">
          {zh
            ? '暂无足够 DLD 成交以计算可靠的市场指标。可能是工业 / 新兴 / 低活跃片区。'
            : 'Not enough DLD transactions to compute reliable market metrics — likely an industrial, emerging, or low-activity district.'}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label={`${t('map:areaDialog.avgPrice')} (AED/m²)`}
          info={<InfoHint title={howTitle} text={t('map:explain.medianPriceSqft')} />}
          value={
            priceDisplay != null ? (
              <>
                <DirhamSymbol size="0.75em" className="text-slate-400" />
                {formatMoneyFull(priceDisplay)}
              </>
            ) : '—'
          }
          chip={pctChip(growthNow)}
          chipClass={growthNow != null && growthNow >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}
          loading={loading}
        >
          <SparkLine data={insights?.price || []} color="#0d9488" labels={insights?.months} fmt={(v) => Math.round(v).toLocaleString()} />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.transactionCount')}
          value={txCount != null ? txCount.toLocaleString() : '—'}
          loading={loading}
        >
          <SparkBars data={insights?.volume || []} color="#3b82f6" labels={insights?.months} fmt={(v) => v.toLocaleString()} />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.capitalGrowth')}
          info={<InfoHint title={howTitle} text={t('map:explain.capitalGrowth')} />}
          value={growthNow != null ? `${growthNow >= 0 ? '+' : ''}${growthNow.toFixed(1)}%` : '—'}
          valueClass={growthNow != null && growthNow >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          loading={loading}
        >
          <SparkLine data={insights?.growth || []} color={growthNow != null && growthNow >= 0 ? '#059669' : '#e11d48'} showZero labels={insights?.months} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`} />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.rentalYield')}
          info={<InfoHint title={howTitle} text={t('map:explain.rentalYield')} evidence={leaseEvidence} />}
          value={yieldNow != null ? `${yieldNow.toFixed(1)}%` : '—'}
          chip={area.netYield != null ? `${zh ? '净' : 'Net'} ${area.netYield.toFixed(1)}%` : null}
          chipClass="bg-emerald-50 text-emerald-700"
          loading={loading}
        >
          <SparkLine data={insights?.rentalYield || []} color="#7c3aed" labels={insights?.months} fmt={(v) => `${v.toFixed(1)}%`} />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.rentStability')}
          info={<InfoHint title={howTitle} text={t('map:explain.rentStability')} evidence={leaseEvidence} />}
          value={stabilityNow != null ? `${Math.round(stabilityNow)}%` : '—'}
          valueClass={stabilityNow == null ? 'text-slate-900' : stabilityNow >= 90 ? 'text-emerald-600' : stabilityNow >= 80 ? 'text-slate-900' : 'text-amber-600'}
          chip={stabilityNow == null ? null : stabilityNow >= 90 ? (zh ? '稳定' : 'Stable') : stabilityNow < 80 ? (zh ? '租金上涨快' : 'Rising fast') : null}
          chipClass={stabilityNow != null && stabilityNow >= 90 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}
          loading={loading}
        >
          {stabilityNow != null ? (
            <div className="flex h-9 items-end gap-1.5">
              <div className="flex-1">
                <div className="text-[9px] text-slate-400">{zh ? '续租' : 'Renew'}</div>
                <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.min(stabilityNow, 100)}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
          )}
        </StatCard>
      </div>

      {/* 净租金回报：完整算式(毛回报 − 物业费 = 净回报),三数同源自洽,一看就懂 */}
      {area.netYield != null && area.serviceChargeSqft != null && area.netGrossYield != null && area.scDragPct != null && (
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-700">{zh ? '净租金回报（扣物业费）' : 'Net rental yield (after service charge)'}</span>
            <InfoHint title={howTitle} text={t('map:explain.netYield')} />
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{zh ? '毛租金回报' : 'Gross yield'}</span>
              <span className="font-medium text-slate-700">{area.netGrossYield.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">
                {zh ? '物业费' : 'Service charge'}
                <span className="ml-1 text-slate-400">(<DirhamSymbol size="0.7em" className="text-slate-400" />{area.serviceChargeSqft.toFixed(0)}/sqft)</span>
              </span>
              <span className="font-medium text-rose-500">−{area.scDragPct.toFixed(1)}%</span>
            </div>
            <div className="h-px bg-emerald-200/70" />
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">{zh ? '净租金回报' : 'Net yield'}</span>
              <span className="text-sm font-bold text-emerald-600">{area.netYield.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" />
        {t('map:areaDialog.dldSource', { month: insights?.dataThrough || '—' })}
      </p>
    </div>
  )
}

// ── 近期真实成交（可加载更多）────────────────────────────────────────────────

type TxItem = AreaInsights['recentTransactions'][number]

type RentItem = NonNullable<AreaInsights['recentRentals']>[number]

export function AreaRecentTx({ areaId, insights, loading, kind }: {
  areaId: string
  insights: AreaInsights | null
  loading: boolean
  kind?: 'sales' | 'rentals'   // when set, render only that list + hide the internal toggle
}) {
  const { t, i18n } = useTranslation(['map'])
  const lang = i18n.language || 'en'
  const [internalTab, setInternalTab] = useState<'sales' | 'rentals'>('sales')
  const tab = kind ?? internalTab
  const [extra, setExtra] = useState<TxItem[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // 切换区域时重置追加列表 + 回到成交 tab
  useEffect(() => { setExtra([]); setHasMore(true); setInternalTab('sales') }, [areaId])

  const baseRows = insights?.recentTransactions || []
  const rows = [...baseRows, ...extra]
  const rentRows = insights?.recentRentals || []

  const loadMore = async () => {
    setLoadingMore(true)
    const PAGE = 20
    const r = await fetchTxList({ areaId, limit: String(PAGE), offset: String(rows.length) })
    const mapped: TxItem[] = r.rows.map(x => ({
      date: x.date,
      building: x.building === '—' ? null : x.building,
      rooms: x.rooms === '—' ? null : x.rooms,
      sizeSqm: x.sizeSqm,
      price: x.price,
      pricePerSqm: x.pricePerSqm,
      saleType: x.saleType
    }))
    setExtra(prev => [...prev, ...mapped])
    if (mapped.length < PAGE) setHasMore(false)
    setLoadingMore(false)
  }

  const TabBtn = ({ id, label }: { id: 'sales' | 'rentals'; label: string }) => (
    <button
      type="button"
      onClick={() => setInternalTab(id)}
      className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
        tab === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div>
      <div className={`mb-2 flex items-center gap-2 ${kind ? 'justify-end' : 'justify-between'}`}>
        {!kind && (
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
            <TabBtn id="sales" label={t('map:areaDialog.tabSales')} />
            <TabBtn id="rentals" label={t('map:areaDialog.tabRentals')} />
          </div>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
          <BadgeCheck className="h-3 w-3" />
          Dubai Land Department
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-white border border-slate-200" />
          ))}
        </div>
      ) : tab === 'sales' ? (
        rows.length > 0 ? (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
              {rows.map((tx, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{tx.building || '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {tx.date}
                      {tx.rooms ? ` · ${tx.rooms}` : ''}
                      {tx.sizeSqm ? ` · ${tx.sizeSqm} m²` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1 text-sm font-bold text-slate-900">
                      {tx.price != null && <DirhamSymbol size="0.75em" className="text-slate-400" />}
                      {tx.price != null ? formatMoneyCompact(tx.price, lang) : '—'}
                    </div>
                    <span className={`text-[10px] font-medium ${tx.saleType === 'offplan' ? 'text-violet-600' : 'text-emerald-600'}`}>
                      {tx.saleType === 'offplan' ? t('map:areaDialog.offplan') : t('map:areaDialog.ready')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? t('map:areaDialog.loadingMore') : t('map:areaDialog.loadMore')}
              </button>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            {t('map:areaDialog.noRecentTx')}
          </div>
        )
      ) : rentRows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {rentRows.map((r: RentItem, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{r.building || '—'}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {r.date}
                  {r.subtype ? ` · ${r.subtype}` : ''}
                  {r.sizeSqm ? ` · ${r.sizeSqm} m²` : ''}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-1 text-sm font-bold text-slate-900">
                  {r.annualRent != null && <DirhamSymbol size="0.75em" className="text-slate-400" />}
                  {r.annualRent != null ? formatMoneyCompact(r.annualRent, lang) : '—'}
                  <span className="text-[10px] font-normal text-slate-400">{t('map:areaDialog.perYear')}</span>
                </div>
                <span className={`text-[10px] font-medium ${r.regType === 'new' ? 'text-sky-600' : 'text-slate-500'}`}>
                  {r.regType === 'new' ? t('map:areaDialog.leaseNew') : t('map:areaDialog.leaseRenew')}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
          {t('map:areaDialog.noRecentRent')}
        </div>
      )}
    </div>
  )
}
