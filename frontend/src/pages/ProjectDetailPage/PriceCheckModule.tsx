/**
 * 价格体检 (Price Check) — 功能 D
 * 本项目单价 vs 同区近 12 个月真实成交分布，中性可解释。
 * 数据来源：DLD 成交（定期快照，非实时）。
 */
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { fetchPriceCheck, PriceCheckResult } from '../../lib/api'

const LEVEL_STYLE: Record<string, { dot: string; chip: string }> = {
  inline: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  below: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  above: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  insufficient: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  no_project_price: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' }
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

export function PriceCheckModule({ projectId }: { projectId: string }) {
  const [data, setData] = useState<PriceCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showWhy, setShowWhy] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPriceCheck(projectId).then(d => {
      if (alive) { setData(d); setLoading(false) }
    })
    return () => { alive = false }
  }, [projectId])

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>价格体检</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-slate-400">正在比对同区真实成交…</div></CardContent>
      </Card>
    )
  }

  if (!data) return null

  // 无法体检的几种情况：如实告知，不编造
  if (!data.matched || !data.area || !data.sampleCount) {
    return (
      <Card>
        <CardHeader><CardTitle>价格体检</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            {data.summary || '暂无足够同区成交数据，无法做价格体检。'}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            数据基于 DLD 成交快照；新社区或样本不足时无法给出判断。
          </p>
        </CardContent>
      </Card>
    )
  }

  const a = data.area
  const proj = data.project?.pricePerSqm ?? null
  const level = data.verdict?.level || 'insufficient'
  const style = LEVEL_STYLE[level] || LEVEL_STYLE.insufficient

  // 标尺范围用 min..max，项目点按比例定位（夹在 0–100%）
  const span = Math.max(a.max - a.min, 1)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - a.min) / span) * 100))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>价格体检</CardTitle>
          {data.verdict && (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${style.chip}`}>
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              {data.verdict.label}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* 标尺 */}
        <div className="pt-6 pb-2">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-sky-200 via-emerald-200 to-amber-200">
            {/* 中位数刻度 */}
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: `${pct(a.median)}%` }} />
            {/* 项目价位点 */}
            {proj != null && (
              <div
                className="absolute -top-3 flex flex-col items-center -translate-x-1/2"
                style={{ left: `${pct(proj)}%` }}
              >
                <div className={`h-4 w-4 rounded-full ring-2 ring-white ${style.dot}`} />
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{fmt(a.min)}</span>
            <span className="text-slate-600 font-medium">中位 {fmt(a.median)}</span>
            <span>{fmt(a.max)}</span>
          </div>
          <div className="mt-1 text-center text-[11px] text-slate-400">AED / m²（{data.areaName} 近 {data.windowMonths} 个月成交）</div>
        </div>

        {/* 项目单价 + 溢价 */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">本项目单价</div>
            <div className="text-lg font-semibold text-slate-800">
              {proj != null ? `${fmt(proj)} AED/m²` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">相对区域中位数</div>
            <div className="text-lg font-semibold text-slate-800">
              {data.premiumPct != null
                ? `${data.premiumPct > 0 ? '+' : ''}${data.premiumPct}%`
                : '—'}
            </div>
          </div>
        </div>

        {/* 中性解释 */}
        {data.verdict && (
          <p className="mt-4 text-sm leading-relaxed text-slate-600">{data.verdict.explanation}</p>
        )}

        {/* 数据诚实声明 + 为什么 */}
        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              基于 {data.sampleCount} 笔成交 · 数据截至 {data.dataThrough || '—'}
              {data.confidence === 'low' ? ' · 样本偏少' : ''}
            </span>
            <button
              type="button"
              onClick={() => setShowWhy(v => !v)}
              className="font-medium text-primary hover:underline"
            >
              {showWhy ? '收起' : '为什么?'}
            </button>
          </div>
          {showWhy && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{data.methodology}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
