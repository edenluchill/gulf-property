/**
 * 区域洞察共享组件 —— 桌面 AreaDetailDialog 和移动端 bottom sheet 共用：
 * useAreaInsights(取数 hook) + AreaTrendGrid(四指标趋势卡) + AreaRecentTx(近期成交,可加载更多)
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BadgeCheck } from 'lucide-react'
import { DubaiArea } from '../types'
import { formatMoneyCompact, formatMoneyFull } from '../lib/money'
import { fetchAreaInsights, fetchTxList, AreaInsights } from '../lib/api'
import DirhamSymbol from './DirhamSymbol'

// ── 取数 hook ────────────────────────────────────────────────────────────────

export function useAreaInsights(areaId: string | undefined) {
  const [insights, setInsights] = useState<AreaInsights | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!areaId) { setInsights(null); return }
    let stale = false
    setInsights(null)
    setLoading(true)
    fetchAreaInsights(areaId).then(d => {
      if (stale) return
      setInsights(d)
      setLoading(false)
    })
    return () => { stale = true }
  }, [areaId])
  return { insights, loading }
}

// ── 迷你趋势图（无依赖 SVG）────────────────────────────────────────────────

function SparkLine({ data, color, showZero }: { data: (number | null)[]; color: string; showZero?: boolean }) {
  const w = 132, h = 36
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      {showZero && min < 0 && max > 0 && (
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3,3" />
      )}
      <polygon points={fill} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function SparkBars({ data, color }: { data: number[]; color: string }) {
  const w = 132, h = 36
  if (!data.length) return <div className="flex h-9 items-center text-[10px] text-slate-300">—</div>
  const max = Math.max(...data, 1)
  const bw = w / data.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      {data.map((v, i) => {
        const bh = Math.max((v / max) * (h - 4), v > 0 ? 1.5 : 0)
        return <rect key={i} x={i * bw + 0.5} y={h - bh} width={Math.max(bw - 1, 1)} height={bh} fill={color} opacity={0.55} rx={1} />
      })}
    </svg>
  )
}

function StatCard({ label, value, valueClass = 'text-slate-900', chip, chipClass, loading, children }: {
  label: string
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
        <span className="truncate text-xs font-medium text-slate-500">{label}</span>
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

export function AreaTrendGrid({ area, insights, loading }: {
  area: DubaiArea
  insights: AreaInsights | null
  loading: boolean
}) {
  const { t, i18n } = useTranslation(['map'])
  const zh = (i18n.language || 'en').startsWith('zh')
  const growthNow = area.capitalAppreciation ?? lastNonNull(insights?.growth)
  const yieldNow = area.rentalYield ?? lastNonNull(insights?.rentalYield)
  const pctChip = (v: number | null | undefined) =>
    v == null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  // Clean empty-state: many display areas are industrial / land / low-activity, or
  // not yet matched to DLD's cadastre — show an intentional note, not a grid of "—".
  const hasAnyMetric =
    area.medianPriceSqm != null || area.averagePrice != null ||
    area.transactionCount != null || growthNow != null || yieldNow != null
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
          value={
            area.medianPriceSqm != null ? (
              <>
                <DirhamSymbol size="0.75em" className="text-slate-400" />
                {formatMoneyFull(area.medianPriceSqm)}
              </>
            ) : area.averagePrice != null ? (
              <>
                <DirhamSymbol size="0.75em" className="text-slate-400" />
                {formatMoneyFull(area.averagePrice)}
              </>
            ) : '—'
          }
          chip={pctChip(growthNow)}
          chipClass={growthNow != null && growthNow >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}
          loading={loading}
        >
          <SparkLine data={insights?.price || []} color="#0d9488" />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.transactionCount')}
          value={area.transactionCount != null ? area.transactionCount.toLocaleString() : '—'}
          loading={loading}
        >
          <SparkBars data={insights?.volume || []} color="#3b82f6" />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.capitalGrowth')}
          value={growthNow != null ? `${growthNow >= 0 ? '+' : ''}${growthNow.toFixed(1)}%` : '—'}
          valueClass={growthNow != null && growthNow >= 0 ? 'text-emerald-600' : 'text-rose-600'}
          loading={loading}
        >
          <SparkLine data={insights?.growth || []} color={growthNow != null && growthNow >= 0 ? '#059669' : '#e11d48'} showZero />
        </StatCard>

        <StatCard
          label={t('map:areaDialog.rentalYield')}
          value={yieldNow != null ? `${yieldNow.toFixed(1)}%` : '—'}
          loading={loading}
        >
          <SparkLine data={insights?.rentalYield || []} color="#7c3aed" />
        </StatCard>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
        <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" />
        {t('map:areaDialog.dldSource', { month: insights?.dataThrough || '—' })}
      </p>
    </div>
  )
}

// ── 近期真实成交（可加载更多）────────────────────────────────────────────────

type TxItem = AreaInsights['recentTransactions'][number]

export function AreaRecentTx({ areaId, insights, loading }: {
  areaId: string
  insights: AreaInsights | null
  loading: boolean
}) {
  const { t, i18n } = useTranslation(['map'])
  const lang = i18n.language || 'en'
  const [extra, setExtra] = useState<TxItem[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // 切换区域时重置追加列表
  useEffect(() => { setExtra([]); setHasMore(true) }, [areaId])

  const baseRows = insights?.recentTransactions || []
  const rows = [...baseRows, ...extra]

  const loadMore = async () => {
    setLoadingMore(true)
    const PAGE = 20
    const r = await fetchTxList({
      areaId,
      limit: String(PAGE),
      offset: String(rows.length)
    })
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

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('map:areaDialog.recentTx')}
        </span>
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
      ) : rows.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {rows.map((tx, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {tx.building || '—'}
                  </div>
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
      )}
    </div>
  )
}
