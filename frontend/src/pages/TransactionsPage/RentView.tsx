/**
 * 租金视图 — /transactions 页的"租金"模式。自包含:自己拉 rent filters/summary/list,
 * 不动原成交视图。数据源 dld_rent_contracts(Ejari)。租金无卧室数,用 年租金 + 租金/㎡。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchRentFilters, fetchRentSummary, fetchRentList, RentSummary, RentRow } from '../../lib/api'
import DirhamSymbol from '../../components/DirhamSymbol'

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))

function RentTrend({ trend }: { trend: RentSummary['trend'] }) {
  if (!trend.length) return null
  const w = 720, h = 160, pad = 28
  const maxCount = Math.max(...trend.map((t) => t.count), 1)
  const meds = trend.map((t) => t.medianSqm)
  const minMed = Math.min(...meds), maxMed = Math.max(...meds)
  const span = Math.max(maxMed - minMed, 1)
  const bw = (w - pad * 2) / trend.length
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {trend.map((t, i) => {
        const bh = (t.count / maxCount) * (h - pad * 2)
        return <rect key={i} x={pad + i * bw + 1} y={h - pad - bh} width={Math.max(bw - 2, 1)} height={bh} fill="#d1fae5" />
      })}
      <polyline
        fill="none" stroke="#059669" strokeWidth={2}
        points={trend.map((t, i) => {
          const x = pad + i * bw + bw / 2
          const y = h - pad - ((t.medianSqm - minMed) / span) * (h - pad * 2)
          return `${x},${y}`
        }).join(' ')}
      />
      {trend.map((t, i) => (i % 3 === 0 ? (
        <text key={i} x={pad + i * bw + bw / 2} y={h - 8} fontSize={9} fill="#94a3b8" textAnchor="middle">{t.month.slice(2)}</text>
      ) : null))}
    </svg>
  )
}

function Kpi({ label, value, currency }: { label: string; value: string; currency?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-1 text-xl font-bold text-slate-800">
        {currency && value !== '—' && <DirhamSymbol size="0.8em" className="text-slate-500" />}
        {value}
      </div>
    </div>
  )
}

export default function RentView() {
  const { i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh')
  const L = (z: string, e: string) => (zh ? z : e)
  const [areas, setAreas] = useState<{ name: string; count: number }[]>([])
  const [area, setArea] = useState('')
  const [year, setYear] = useState('')
  const [summary, setSummary] = useState<RentSummary | null>(null)
  const [rows, setRows] = useState<RentRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const limit = 25

  const query = useMemo(
    () => ({ area: area || undefined, from: year ? `${year}-01-01` : undefined, to: year ? `${year}-12-31` : undefined }),
    [area, year]
  )

  useEffect(() => { fetchRentFilters().then((f) => setAreas(f.areas)) }, [])
  useEffect(() => {
    setLoading(true); setPage(0)
    fetchRentSummary(query).then((s) => { setSummary(s); setLoading(false) })
  }, [query])
  useEffect(() => {
    fetchRentList({ ...query, limit: String(limit), offset: String(page * limit) }).then((r) => setRows(r.rows))
  }, [query, page])

  const rps = summary?.rentPerSqm

  return (
    <>
      {/* 筛选:区域 + 年份 */}
      <div className="mt-3 md:mt-5 flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 md:flex-row md:items-end">
        <label className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
          {L('区域', 'Area')}
          <select value={area} onChange={(e) => setArea(e.target.value)} className="w-full md:min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
            <option value="">{L('全部区域', 'All areas')}</option>
            {areas.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.count.toLocaleString()})</option>)}
          </select>
        </label>
        <label className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
          {L('年份', 'Year')}
          <select value={year} onChange={(e) => setYear(e.target.value)} className="w-full md:w-auto rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
            <option value="">{L('不限', 'Any')}</option>
            {['2026', '2025', '2024', '2023', '2022', '2021'].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="mt-6 text-sm text-slate-400">{L('加载中…', 'Loading…')}</div>
      ) : summary && summary.count > 0 ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label={L('租约笔数', 'Contracts')} value={fmt(summary.count)} />
            <Kpi label={L('中位年租金', 'Median annual rent')} value={fmt(summary.medianAnnualRent)} currency />
            <Kpi label={L('中位租金/㎡', 'Median rent/m²')} value={fmt(rps?.median)} currency />
            <Kpi label={L('平均面积 (㎡)', 'Avg size (m²)')} value={fmt(summary.avgSizeSqm)} />
          </div>
          {rps && (
            <div className="mt-2 text-xs text-slate-500">
              {L('租金/㎡区间(年):', 'Rent/m² (annual):')} {fmt(rps.p25)} – {fmt(rps.median)} – {fmt(rps.p75)} AED/m²
            </div>
          )}

          <div className="mt-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">{L('近 24 个月趋势(柱=租约量,线=中位租金/㎡)', 'Last 24 months (bars=volume, line=median rent/m²)')}</div>
            <RentTrend trend={summary.trend} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">{L('起租日', 'Start')}</th>
                  <th className="px-3 py-2">{L('区域', 'Area')}</th>
                  <th className="px-3 py-2">{L('楼盘', 'Project')}</th>
                  <th className="px-3 py-2">{L('类型', 'Type')}</th>
                  <th className="px-3 py-2 text-right">{L('面积', 'Size')}</th>
                  <th className="px-3 py-2 text-right">{L('年租金', 'Annual rent')}</th>
                  <th className="px-3 py-2 text-right">{L('租金/㎡', 'Rent/m²')}</th>
                  <th className="px-3 py-2">{L('登记', 'Reg')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{r.date}</td>
                    <td className="px-3 py-2">{r.area}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={r.building}>{r.building}</td>
                    <td className="px-3 py-2">{r.subtype}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.sizeSqm)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.annualRent)}</td>
                    <td className="px-3 py-2 text-right">{fmt(r.rentPerSqm)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${r.regType === 'renew' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {r.regType === 'renew' ? L('续租', 'Renew') : L('新签', 'New')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>{L('第', 'Page')} {page + 1} {L('页', '')}</span>
              <div className="flex gap-2">
                <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">{L('上一页', 'Prev')}</button>
                <button disabled={rows.length < limit} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40">{L('下一页', 'Next')}</button>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">{summary.note}</p>
        </>
      ) : (
        <div className="mt-6 text-sm text-slate-400">{L('该筛选下暂无租约数据。', 'No rent contracts for this filter.')}</div>
      )}
    </>
  )
}
