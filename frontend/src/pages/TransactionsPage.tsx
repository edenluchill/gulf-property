/**
 * 成交记录查询页 (功能 B) —— 直接面向 DLD 真实成交数据
 * 多维筛选 → 聚合指标 + 月度趋势 + 明细分页
 */
import { useEffect, useMemo, useState } from 'react'
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
  const [filters, setFilters] = useState<TxFilters>({ areas: [], rooms: [] })
  const [area, setArea] = useState('')
  const [rooms, setRooms] = useState('')
  const [type, setType] = useState<SaleType>('all')
  const [summary, setSummary] = useState<TxSummary | null>(null)
  const [rows, setRows] = useState<TxRow[]>([])
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)

  const limit = 25
  const query = useMemo(() => ({
    area: area || undefined,
    rooms: rooms || undefined,
    type: type === 'all' ? undefined : type
  }), [area, rooms, type])

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
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-800">成交记录查询</h1>
      <p className="mt-1 text-sm text-slate-500">
        基于 Dubai Land Department 真实住宅成交数据（定期快照，非实时；二手登记通常滞后 4–8 周）。
      </p>

      {/* 筛选 */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          区域
          <select
            value={area}
            onChange={e => setArea(e.target.value)}
            className="min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">全部区域</option>
            {filters.areas.map(a => (
              <option key={a.name} value={a.name}>{a.name}（{a.count}）</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          户型
          <select
            value={rooms}
            onChange={e => setRooms(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800"
          >
            <option value="">全部户型</option>
            {filters.rooms.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-slate-500">
          类型
          <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {(['all', 'ready', 'offplan'] as SaleType[]).map(tp => (
              <button
                key={tp}
                onClick={() => setType(tp)}
                className={`px-3 py-2 ${type === tp ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {tp === 'all' ? '全部' : tp === 'ready' ? '现房/二手' : '期房'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 指标卡 */}
      {loading ? (
        <div className="mt-6 text-sm text-slate-400">正在统计…</div>
      ) : summary && summary.count > 0 ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="成交笔数" value={fmt(summary.count)} />
            <Kpi label="中位单价 (AED/m²)" value={fmt(pps?.median)} />
            <Kpi label="中位总价 (AED)" value={fmt(summary.medianUnitPrice)} />
            <Kpi label="平均面积 (m²)" value={fmt(summary.avgSizeSqm)} />
          </div>
          {pps && (
            <div className="mt-2 text-xs text-slate-500">
              单价区间：{fmt(pps.min)} – <span className="text-slate-700 font-medium">{fmt(pps.median)}</span> – {fmt(pps.max)} AED/m²
              （p25 {fmt(pps.p25)} · p75 {fmt(pps.p75)}）
            </div>
          )}

          {/* 趋势 */}
          <div className="mt-6 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-2 text-sm font-medium text-slate-700">近 24 个月趋势（柱=成交量，线=中位单价）</div>
            <TrendChart trend={summary.trend} />
          </div>

          {/* 明细 */}
          <div className="mt-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">区域</th>
                  <th className="px-3 py-2">楼盘/楼栋</th>
                  <th className="px-3 py-2">户型</th>
                  <th className="px-3 py-2 text-right">面积 m²</th>
                  <th className="px-3 py-2 text-right">总价 AED</th>
                  <th className="px-3 py-2 text-right">单价 /m²</th>
                  <th className="px-3 py-2">类型</th>
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
                        {r.saleType === 'offplan' ? '期房' : '现房'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              <span>第 {page + 1} 页</span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >上一页</button>
                <button
                  disabled={rows.length < limit}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >下一页</button>
              </div>
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-400">{summary.note}</p>
        </>
      ) : (
        <div className="mt-6 text-sm text-slate-400">该筛选条件下暂无成交数据。</div>
      )}
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
