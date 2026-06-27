/**
 * 租金视图 — /transactions 页的"租金"模式。自包含:自己拉 rent filters/projects/summary/list,
 * 不动原成交视图。数据源 dld_rent_contracts(Ejari)。租金无卧室数,用 年租金 + 租金/㎡。
 * 与成交侧一致:项目多选前置 + 价格区间 + 移动端卡片(年租金优先)。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, ChevronDown } from 'lucide-react'
import { fetchRentFilters, fetchRentProjects, fetchRentSummary, fetchRentList, RentSummary, RentRow } from '../../lib/api'
import DirhamSymbol from '../../components/DirhamSymbol'
import { formatMoneyCompact } from '../../lib/money'

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))

// 年租金区间预设(AED)
const RENT_PRICE_STEPS = [30000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 1000000]

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
  // 项目多选(同社区多个 phase 合看)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [projectQuery, setProjectQuery] = useState('')
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectSuggestions, setProjectSuggestions] = useState<{ name: string; count: number }[]>([])
  const [year, setYear] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [summary, setSummary] = useState<RentSummary | null>(null)
  const [rows, setRows] = useState<RentRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const limit = 25

  const query = useMemo(
    () => ({
      area: area || undefined,
      project: selectedProjects.length ? selectedProjects : undefined,
      from: year ? `${year}-01-01` : undefined,
      to: year ? `${year}-12-31` : undefined,
      minPrice: minPrice || undefined,
      maxPrice: maxPrice || undefined,
    }),
    [area, selectedProjects, year, minPrice, maxPrice]
  )

  useEffect(() => { fetchRentFilters().then((f) => setAreas(f.areas)) }, [])

  // 区域变化 → 重置项目筛选
  useEffect(() => { setSelectedProjects([]); setProjectQuery('') }, [area])

  // 项目搜索建议(300ms 防抖)
  useEffect(() => {
    const q = projectQuery.trim()
    let stale = false
    const id = setTimeout(() => {
      fetchRentProjects({ area: area || undefined, q: q || undefined })
        .then((p) => { if (!stale) setProjectSuggestions(p) })
    }, 300)
    return () => { stale = true; clearTimeout(id) }
  }, [area, projectQuery])

  useEffect(() => {
    setLoading(true); setPage(0)
    fetchRentSummary(query).then((s) => { setSummary(s); setLoading(false) })
  }, [query])
  useEffect(() => {
    fetchRentList({ ...query, limit: String(limit), offset: String(page * limit) }).then((r) => setRows(r.rows))
  }, [query, page])

  const rps = summary?.rentPerSqm

  const filterParts = [
    selectedProjects.length === 1 ? selectedProjects[0]
      : selectedProjects.length > 1 ? L(`${selectedProjects.length} 个项目`, `${selectedProjects.length} projects`)
      : null,
    area || null,
    (minPrice || maxPrice)
      ? `${minPrice ? formatMoneyCompact(Number(minPrice), i18n.language) : ''}~${maxPrice ? formatMoneyCompact(Number(maxPrice), i18n.language) : ''}`
      : null,
    year || null,
  ].filter(Boolean) as string[]
  const filterSummary = filterParts.length ? filterParts.join(' · ') : L('全部租约', 'All contracts')

  return (
    <>
      {/* 筛选(单一连贯卡片:移动端头部=折叠开关,桌面端头部隐藏) */}
      <div className="mt-3 md:mt-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left md:hidden"
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1 truncate text-sm font-medium text-slate-700">{filterSummary}</span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className={`${filtersOpen ? 'flex' : 'hidden'} md:flex flex-col md:flex-row md:flex-wrap items-stretch md:items-end gap-3 border-t border-slate-100 px-4 pb-4 pt-3 md:border-t-0 md:p-4`}>
          {/* 项目多选(放最前) */}
          <label className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
            {L('项目', 'Project')}
            <div className="relative">
              <input
                type="text"
                value={projectQuery}
                onChange={(e) => { setProjectQuery(e.target.value); setProjectOpen(true) }}
                onFocus={() => setProjectOpen(true)}
                onBlur={() => setTimeout(() => setProjectOpen(false), 150)}
                placeholder={L('搜索项目名（可多选）…', 'Search projects (multi-select)…')}
                className="w-full md:min-w-[260px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
              />
              {projectOpen && projectSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {projectSuggestions.map((p) => {
                    const picked = selectedProjects.includes(p.name)
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setSelectedProjects((prev) => prev.includes(p.name) ? prev.filter((x) => x !== p.name) : [...prev, p.name])
                          setProjectQuery('')
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${picked ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700'}`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300'}`}>{picked ? '✓' : ''}</span>
                          <span className="truncate">{p.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">{p.count}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {selectedProjects.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {selectedProjects.map((name) => (
                  <span key={name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 ring-1 ring-emerald-200">
                    <span className="truncate">{name}</span>
                    <button type="button" onClick={() => setSelectedProjects((prev) => prev.filter((x) => x !== name))} className="shrink-0 text-emerald-400 hover:text-emerald-700" aria-label={L('移除', 'Remove')}>×</button>
                  </span>
                ))}
                {selectedProjects.length > 1 && (
                  <button type="button" onClick={() => setSelectedProjects([])} className="text-xs text-slate-400 underline hover:text-slate-600">{L('清空', 'Clear all')}</button>
                )}
              </div>
            )}
          </label>

          <label className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
            {L('区域', 'Area')}
            <select value={area} onChange={(e) => setArea(e.target.value)} className="w-full md:min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
              <option value="">{L('全部区域', 'All areas')}</option>
              {areas.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.count.toLocaleString()})</option>)}
            </select>
          </label>

          {/* 年租金区间 */}
          <div className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
            {L('年租金区间', 'Annual rent')}
            <div className="flex items-center gap-1.5">
              <select value={minPrice} onChange={(e) => setMinPrice(e.target.value)} className="w-full md:w-auto rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800">
                <option value="">{L('最低', 'Min')}</option>
                {RENT_PRICE_STEPS.map((v) => <option key={v} value={v}>{formatMoneyCompact(v, i18n.language)}</option>)}
              </select>
              <span className="text-slate-400">–</span>
              <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="w-full md:w-auto rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-800">
                <option value="">{L('最高', 'Max')}</option>
                {RENT_PRICE_STEPS.map((v) => <option key={v} value={v}>{formatMoneyCompact(v, i18n.language)}</option>)}
              </select>
            </div>
          </div>

          <label className="flex w-full md:w-auto flex-col gap-1 text-xs text-slate-500">
            {L('年份', 'Year')}
            <select value={year} onChange={(e) => setYear(e.target.value)} className="w-full md:w-auto rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800">
              <option value="">{L('不限', 'Any')}</option>
              {['2026', '2025', '2024', '2023', '2022', '2021'].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>

          <button onClick={() => setFiltersOpen(false)} className="mt-1 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white md:hidden">
            {L('查看结果', 'Apply')}
          </button>
        </div>
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

          <div className="mt-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {/* 移动端:卡片(年租金优先,信息一屏看全) */}
            <div className="divide-y divide-slate-100 md:hidden">
              {rows.map((r, i) => (
                <div key={i} className="p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1 text-base font-bold text-slate-900">
                      <DirhamSymbol size="0.8em" className="text-slate-400" />
                      {fmt(r.annualRent)}<span className="text-xs font-normal text-slate-400">/{L('年', 'yr')}</span>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${r.regType === 'renew' ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {r.regType === 'renew' ? L('续租', 'Renew') : L('新签', 'New')}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-700" title={r.building}>{r.building}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                    {r.area && <span>{r.area}</span>}
                    {r.subtype && r.subtype !== '—' && <span>{r.subtype}</span>}
                    {r.sizeSqm != null && <span>{fmt(r.sizeSqm)} m²</span>}
                    {r.rentPerSqm != null && <span className="inline-flex items-center gap-0.5"><DirhamSymbol size="0.75em" className="text-slate-400" />{fmt(r.rentPerSqm)}/m²</span>}
                    <span className="text-slate-400">{r.date}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 桌面端:完整表格 */}
            <div className="hidden md:block overflow-x-auto">
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
            </div>
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
