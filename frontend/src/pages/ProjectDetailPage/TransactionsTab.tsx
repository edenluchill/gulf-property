import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { fetchProjectTransactions, ProjectTransactions } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import { CONSUMER_SEGMENT, MarketSegment } from '../../lib/marketSegment'
import DirhamSymbol from '../../components/DirhamSymbol'

/**
 * Real DLD transactions for this project's matched development (master_project).
 * 成交 / 租约 toggle. Honest empty-state when the project can't be resolved to a
 * development. Backed by /residential-projects/:id/transactions.
 */
export function TransactionsTab({ projectId }: { projectId: string }) {
  const { t: tRaw, i18n } = useTranslation('transactions')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [data, setData] = useState<ProjectTransactions | null>(null)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<'sales' | 'rentals'>('sales')
  // 期房/现房筛选（散客默认期房口径；后端返回带标签的完整列表，客户端过滤）
  const [saleFilter, setSaleFilter] = useState<MarketSegment>(CONSUMER_SEGMENT)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchProjectTransactions(projectId)
      .then((d) => alive && (setData(d), setLoading(false)))
      .catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [projectId])

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-teal-500" /></div>
  }

  if (!data || !data.matched) {
    return (
      <div className="container mx-auto px-4 py-10">
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-12 text-center">
          <p className="text-sm font-medium text-slate-600">{t('transactions:noMatchedDldTransactions')}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t('transactions:thisProjectIsnT')}
          </p>
        </div>
      </div>
    )
  }

  const filteredSales = saleFilter === 'all' ? data.sales : data.sales.filter(s => s.saleType === saleFilter)
  const rows = kind === 'sales' ? filteredSales : data.rentals
  const total = data.sales.length + data.rentals.length

  return (
    <div className="container mx-auto px-4 py-4 max-w-3xl">
      {/* Matched development + source */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          {t('transactions:realTransactions')}
          <span className="font-semibold text-slate-800">{data.development}</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          ✓ Dubai Land Department
        </span>
      </div>

      {/* 成交 / 租约 toggle */}
      <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-0.5">
        {([
          { k: 'sales' as const, label: t('transactions:sales'), n: data.sales.length },
          { k: 'rentals' as const, label: t('transactions:rentals'), n: data.rentals.length },
        ]).map((tb) => (
          <button
            key={tb.k}
            onClick={() => setKind(tb.k)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              kind === tb.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {tb.label} {tb.n ? `(${tb.n})` : ''}
          </button>
        ))}
      </div>

      {/* 期房/现房筛选 chips（仅成交 tab） */}
      {kind === 'sales' && (
        <div className="mb-3 flex items-center gap-1.5">
          {([
            { k: 'offplan' as const, label: t('transactions:offPlan') },
            { k: 'ready' as const, label: t('transactions:ready') },
            { k: 'all' as const, label: t('transactions:all') },
          ]).map((c) => (
            <button
              key={c.k}
              onClick={() => setSaleFilter(c.k)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                saleFilter === c.k ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-400">
          {t('transactions:noRecords')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          {kind === 'sales'
            ? filteredSales.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{r.building || '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {r.date} {r.rooms ? `· ${r.rooms}` : ''} {r.sizeSqm ? `· ${r.sizeSqm} m²` : ''}
                      {r.saleType === 'offplan' ? ` · ${t('transactions:offPlan2')}` : ` · ${t('transactions:ready2')}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-sm font-bold text-slate-900">
                      <DirhamSymbol size="0.8em" className="mx-0.5 text-slate-400" />
                      {r.price != null ? formatMoneyCompact(r.price, i18n.language) : '—'}
                    </div>
                    {r.pricePerSqm != null && <div className="text-[11px] text-slate-400">{r.pricePerSqm.toLocaleString()}/m²</div>}
                  </div>
                </div>
              ))
            : data.rentals.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{r.building || '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {r.date} {r.subtype ? `· ${r.subtype}` : ''} {r.sizeSqm ? `· ${r.sizeSqm} m²` : ''}
                      {` · ${r.regType === 'new' ? (t('transactions:new')) : (t('transactions:renew'))}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-sm font-bold text-slate-900">
                      <DirhamSymbol size="0.8em" className="mx-0.5 text-slate-400" />
                      {r.annualRent != null ? formatMoneyCompact(r.annualRent, i18n.language) : '—'}<span className="text-[11px] font-normal text-slate-400">/{t('transactions:yr')}</span>
                    </div>
                    {r.rentPerSqm != null && <div className="text-[11px] text-slate-400">{r.rentPerSqm.toLocaleString()}/m²</div>}
                  </div>
                </div>
              ))}
        </div>
      )}

      {total > 0 && (
        <p className="mt-3 text-[11px] text-slate-400">
          {t('transactions:sourceDubaiLandDepartment')}
        </p>
      )}
    </div>
  )
}
