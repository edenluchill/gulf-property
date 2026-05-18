/**
 * 成交记录查询页 (功能 B) —— 直接面向 DLD 真实成交数据
 * 多维筛选 → 聚合指标 + 月度趋势 + 明细分页
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchTxFilters, fetchTxSummary, fetchTxList,
  TxFilters, TxSummary, TxRow
} from '../lib/api'

type SaleType = 'all' | 'ready' | 'offplan'

function fmt(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString('en-US')
}

function TrendChart({ trend }: { trend: TxSummary['trend'] }) {
  if (!trend.length) return null
  const w = 720, h = 160, pad = 28
  const maxCount = Math.max(...trend.map(t => t.count), 1)
  const meds = trend.map(t => t.medianPps)
  const minMed = Math.min(...meds), maxMed = Math.max(...meds)
  const medSpan = Math.max(maxMed - minMed, 1)
  const bw = (w - pad * 2) / trend.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {trend.map((t, i) => {
        const bh = (t.count / maxCount) * (h - pad * 2)
        return (
          <rect key={i} x={pad + i * bw + 1} y={h - pad - bh}
            width={Math.max(bw - 2, 1)} height={bh} fill="#dbeafe" />
        )
      })}
      <polyline
        fill="none" stroke="#2563eb" strokeWidth={2}
        points={trend.map((t, i) => {
          const x = pad + i * bw + bw / 2
          const y = h - pad - ((t.medianPps - minMed) / medSpan) * (h - pad * 2)
          return `${x},${y}`
        }).join(' ')}
      />
      {trend.map((t, i) => (
        i % 3 === 0 ? (
          <text key={i} x={pad + i * bw + bw / 2} y={h - 8}
            fontSize={9} fill="#94a3b8" textAnchor="middle">{t.month.slice(2)}</text>
        ) : null
      ))}
    </svg>
  )
}

export default function TransactionsPage() {
  const { t } = useTranslation(['transactions', 'common'])
  const [filters, setFilters] = useState<TxFilters>({ areas: [], rooms: [] })
  const [area, setArea] = useState('')
  const [rooms, setRooms] = useState('')
  const [type, setType] = useState<SaleType>('all')
  const [year, setYear] = useState('')  // '' = 不限(默认按最新)
  const [summary, setSummary] = useState<TxSummary | null>(null)
  const [rows, setRows] = useState<TxRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)

  const limit = 25
  const query = useMemo(() => ({
    area: area || undefined,
    rooms: rooms || undefined,
    type: type === 'all' ? undefined : type,
    from: year ? `${year}-01-01` : undefined,
    to: year ? `${year}-12-31` : undefined
  }), [area, rooms, type, year])

  useEffect(() => { fetchTxFilters().then(setFilters) }, [])

  useEffect(() => {
    setLoading(true)
    setPage(0)
    fetchTxSummary(query).then(s => { setSummary(s); setLoading(false) })
  }, [query])

  useEffect(() => {
    fetchTxList({ ...query, limit: String(limit), offset: String(page * limit) })
      .then(r => setRows(r.rows))
  }, [query, page])

  const pps = summary?.pricePerSqm

  return (
    <div className="flex-1 overflow-auto pb-20 md:pb-8">
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-800">{t('title')}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {t('description')}
      </p>

      {/* 筛选 */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t('filter.area')}
          <select
            value={area}
            onChange={e => setArea(e.target.value)}
            className="min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">{t('filter.allAreas')}</option>
            {filters.areas.map(a => (
              <option key={a.name} value={a.name}>{t('filter.areaOption', { name: a.name, count: a.count })}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t('filter.rooms')}
          <select
            value={rooms}
            onChange={e => setRooms(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">{t('filter.allRooms')}</option>
            {filters.rooms.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t('filter.year')}
          <select
            value={year}
            onChange={e => setYear(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">{t('filter.anyYear')}</option>
            {['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018'].map(y => (
              <option key={y} value={y}>{t('filter.yearLabel', { year: y })}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          {t('filter.type')}
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {(['all', 'ready', 'offplan'] as SaleType[]).map(tp => (
              <button
                key={tp}
                onClick={() => setType(tp)}
                className={`px-3 py-2 ${type === tp ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {t(`saleType.${tp}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 指标卡 */}
      {loading ? (
        <div className="mt-6 text-sm text-slate-400">{t('loading')}</div>
      ) : summary && summary.count > 0 ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label={t('kpi.count')} value={fmt(summary.count)} />
            <Kpi label={t('kpi.medianPps')} value={fmt(pps?.median)} />
            <Kpi label={t('kpi.medianTotal')} value={fmt(summary.medianUnitPrice)} />
            <Kpi label={t('kpi.avgSize')} value={fmt(summary.avgSizeSqm)} />
          </div>
          {pps && (
            <div className="mt-2 text-xs text-slate-500">
              {t('ppsRange', {
                min: fmt(pps.min),
                median: fmt(pps.median),
                max: fmt(pps.max),
                p25: fmt(pps.p25),
                p75: fmt(pps.p75)
              })}
            </div>
          )}

          {/* 趋势 */}
          <div className="mt-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">{t('trend.title')}</div>
            <TrendChart trend={summary.trend} />
          </div>

          {/* 明细 */}
          <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">{t('table.date')}</th>
                  <th className="px-3 py-2">{t('table.area')}</th>
                  <th className="px-3 py-2">{t('table.building')}</th>
                  <th className="px-3 py-2">{t('table.rooms')}</th>
                  <th className="px-3 py-2 text-right">{t('table.size')}</th>
                  <th className="px-3 py-2 text-right">{t('table.price')}</th>
                  <th className="px-3 py-2 text-right">{t('table.pps')}</th>
                  <th className="px-3 py-2">{t('table.type')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{r.date}</td>
                    <td className="px-3 py-2">{r.area}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={r.building}>{r.building}</td>
                    <td className="px-3 py-2">{r.rooms}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.sizeSqm)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.price)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.pricePerSqm)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${r.saleType === 'offplan' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {r.saleType === 'offplan' ? t('saleType.offplan') : t('saleType.readyShort')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>{t('pagination.page', { page: page + 1 })}</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >{t('pagination.prev')}</button>
                <button
                  disabled={rows.length < limit}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >{t('pagination.next')}</button>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">{summary.note}</p>
        </>
      ) : (
        <div className="mt-6 text-sm text-slate-400">{t('empty')}</div>
      )}
    </div>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-slate-800">{value}</div>
    </div>
  )
}
