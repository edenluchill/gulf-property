import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { fetchProjectTransactions, ProjectTransactions } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

/**
 * Real DLD transactions for this project's matched development (master_project).
 * 成交 / 租约 toggle. Honest empty-state when the project can't be resolved to a
 * development. Backed by /residential-projects/:id/transactions.
 */
export function TransactionsTab({ projectId }: { projectId: string }) {
  const { i18n } = useTranslation(['project', 'common'])
  const zh = i18n.language?.startsWith('zh')
  const [data, setData] = useState<ProjectTransactions | null>(null)
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<'sales' | 'rentals'>('sales')

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
          <p className="text-sm font-medium text-slate-600">{zh ? '暂无可匹配的真实成交' : 'No matched DLD transactions'}</p>
          <p className="mt-1 text-xs text-slate-400">
            {zh ? '尚未把该项目匹配到 DLD 开发体（可能是新盘或名称未对齐）。' : 'This project isn’t matched to a DLD development yet.'}
          </p>
        </div>
      </div>
    )
  }

  const rows = kind === 'sales' ? data.sales : data.rentals
  const total = data.sales.length + data.rentals.length

  return (
    <div className="container mx-auto px-4 py-4 max-w-3xl">
      {/* Matched development + source */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          {zh ? '真实成交 · 开发体 ' : 'Real transactions · '}
          <span className="font-semibold text-slate-800">{data.development}</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
          ✓ Dubai Land Department
        </span>
      </div>

      {/* 成交 / 租约 toggle */}
      <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-0.5">
        {([
          { k: 'sales' as const, label: zh ? '成交' : 'Sales', n: data.sales.length },
          { k: 'rentals' as const, label: zh ? '租约' : 'Rentals', n: data.rentals.length },
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

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-400">
          {zh ? '该口径暂无记录' : 'No records'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          {kind === 'sales'
            ? data.sales.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800">{r.building || '—'}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {r.date} {r.rooms ? `· ${r.rooms}` : ''} {r.sizeSqm ? `· ${r.sizeSqm} m²` : ''}
                      {r.saleType === 'offplan' ? ` · ${zh ? '期房' : 'Off-plan'}` : ` · ${zh ? '现房' : 'Ready'}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
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
                      {` · ${r.regType === 'new' ? (zh ? '新签' : 'New') : (zh ? '续租' : 'Renew')}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-bold text-slate-900">
                      <DirhamSymbol size="0.8em" className="mx-0.5 text-slate-400" />
                      {r.annualRent != null ? formatMoneyCompact(r.annualRent, i18n.language) : '—'}<span className="text-[11px] font-normal text-slate-400">/{zh ? '年' : 'yr'}</span>
                    </div>
                    {r.rentPerSqm != null && <div className="text-[11px] text-slate-400">{r.rentPerSqm.toLocaleString()}/m²</div>}
                  </div>
                </div>
              ))}
        </div>
      )}

      {total > 0 && (
        <p className="mt-3 text-[11px] text-slate-400">
          {zh ? '数据来源 Dubai Land Department,展示该开发体近期记录。' : 'Source: Dubai Land Department — recent records for this development.'}
        </p>
      )}
    </div>
  )
}
