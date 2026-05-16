/**
 * 区域分级判断 (功能 C) —— 成熟/增长/未来/供应压力区 + 两区对比
 * 方法论透明，标签可展开看依据；中性措辞 + 投资/自住双视角
 */
import { useEffect, useMemo, useState } from 'react'
import { fetchAreaClassification, fetchAreaCompare, AreaClass, AreaClassResp } from '../lib/api'

const TAG_STYLE: Record<string, string> = {
  growth: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  mature: 'bg-sky-50 text-sky-700 ring-sky-200',
  future: 'bg-violet-50 text-violet-700 ring-violet-200',
  supply_pressure: 'bg-amber-50 text-amber-700 ring-amber-200',
  stable: 'bg-slate-100 text-slate-600 ring-slate-200',
  insufficient: 'bg-slate-100 text-slate-400 ring-slate-200'
}

function fmt(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString('en-US')
}

function AreaCard({ a }: { a: AreaClass }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{a.name}</div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TAG_STYLE[a.tag] || TAG_STYLE.stable}`}>
          {a.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><div className="text-slate-400">成交</div><div className="font-semibold text-slate-700">{fmt(a.metrics.transactionCount)}</div></div>
        <div><div className="text-slate-400">价格增长</div><div className="font-semibold text-slate-700">{a.metrics.capitalGrowthPct != null ? `${a.metrics.capitalGrowthPct}%` : '—'}</div></div>
        <div><div className="text-slate-400">租金回报</div><div className="font-semibold text-slate-700">{a.metrics.rentalYieldPct != null ? `${a.metrics.rentalYieldPct}%` : '—'}</div></div>
      </div>
      <button onClick={() => setOpen(o => !o)} className="mt-3 text-xs font-medium text-primary hover:underline">
        {open ? '收起' : '为什么?'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-slate-600">
          <ul className="list-disc pl-4 space-y-1">
            {a.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <div className="rounded-lg bg-slate-50 p-2 leading-relaxed">
            <div><span className="font-medium text-slate-700">投资视角：</span>{a.perspective.invest}</div>
            <div className="mt-1"><span className="font-medium text-slate-700">自住视角：</span>{a.perspective.live}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AreaInsightsPage() {
  const [data, setData] = useState<AreaClassResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [tagFilter, setTagFilter] = useState('all')
  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')
  const [cmp, setCmp] = useState<{ matched: boolean; a?: AreaClass; b?: AreaClass; summary: string } | null>(null)

  useEffect(() => {
    fetchAreaClassification().then(d => { setData(d); setLoading(false) })
  }, [])

  const tags = useMemo(() => {
    const set = new Map<string, string>()
    data?.areas.forEach(a => set.set(a.tag, a.label))
    return Array.from(set.entries())
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return tagFilter === 'all' ? data.areas : data.areas.filter(a => a.tag === tagFilter)
  }, [data, tagFilter])

  const runCompare = () => {
    if (cmpA && cmpB) fetchAreaCompare(cmpA, cmpB).then(setCmp)
  }

  if (loading) return <div className="container mx-auto px-4 py-10 text-sm text-slate-400">正在分析区域…</div>
  if (!data) return <div className="container mx-auto px-4 py-10 text-sm text-slate-400">暂无区域分级数据。</div>

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-slate-800">区域分级判断</h1>
      <p className="mt-1 text-sm text-slate-500">
        基于 DLD 真实成交，把区域分为成熟 / 增长 / 未来 / 供应压力等。标签按全市分位数相对划分，可点开看依据。
      </p>

      {/* 两区对比 */}
      <div className="mt-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="text-sm font-medium text-slate-700">两区对比</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={cmpA} onChange={e => setCmpA(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">区域 A</option>
            {data.areas.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <span className="text-slate-400">vs</span>
          <select value={cmpB} onChange={e => setCmpB(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">区域 B</option>
            {data.areas.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
          </select>
          <button onClick={runCompare} disabled={!cmpA || !cmpB}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">对比</button>
        </div>
        {cmp && (cmp.matched && cmp.a && cmp.b ? (
          <div className="mt-3">
            <p className="text-sm text-slate-700">{cmp.summary}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <AreaCard a={cmp.a} />
              <AreaCard a={cmp.b} />
            </div>
          </div>
        ) : <p className="mt-2 text-sm text-slate-400">{cmp.summary}</p>)}
      </div>

      {/* 标签筛选 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={() => setTagFilter('all')}
          className={`rounded-full px-3 py-1 text-xs ring-1 ${tagFilter === 'all' ? 'bg-primary text-white ring-primary' : 'bg-white text-slate-600 ring-slate-200'}`}>
          全部（{data.count}）
        </button>
        {tags.map(([tag, label]) => (
          <button key={tag} onClick={() => setTagFilter(tag)}
            className={`rounded-full px-3 py-1 text-xs ring-1 ${tagFilter === tag ? 'bg-primary text-white ring-primary' : 'bg-white text-slate-600 ring-slate-200'}`}>
            {label}（{data.areas.filter(a => a.tag === tag).length}）
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(a => <AreaCard key={a.id} a={a} />)}
      </div>

      <p className="mt-5 text-xs text-slate-400">{data.methodology}</p>
    </div>
  )
}
