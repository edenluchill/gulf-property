/**
 * 价格体检 (Price Check) — 本项目单价 vs 同区近 12 个月真实成交分布。
 * i18n: 全部串走 t('compare:priceCheck.*'),翻译在 locales 各语言 compare.json。
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { fetchPriceCheck, PriceCheckResult } from '../../lib/api'

type Level = 'inline' | 'below' | 'above' | 'high' | 'insufficient' | 'no_project_price'

const LEVEL_STYLE: Record<string, { dot: string; chip: string }> = {
  inline: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  below: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700 ring-sky-200' },
  above: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  high: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 ring-red-200' },
  insufficient: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
  no_project_price: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
const VERDICT_KEY: Record<Level, string> = {
  high: 'vHigh', above: 'vAbove', below: 'vBelow', inline: 'vInline', insufficient: 'vInsufficient', no_project_price: 'vNoPrice',
}
const fmt = (n: number) => n.toLocaleString('en-US')

export function PriceCheckModule({ projectId }: { projectId: string }) {
  const { t } = useTranslation('compare')
  const tk = (k: string, o?: Record<string, unknown>) => (t as (k: string, o?: Record<string, unknown>) => string)(`priceCheck.${k}`, o)
  const [data, setData] = useState<PriceCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showWhy, setShowWhy] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPriceCheck(projectId).then((d) => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [projectId])

  if (loading) {
    return <Card><CardHeader><CardTitle>{tk('title')}</CardTitle></CardHeader><CardContent><div className="text-sm text-slate-400">{tk('loading')}</div></CardContent></Card>
  }
  if (!data) return null

  if (!data.matched || !data.area || !data.sampleCount) {
    return (
      <Card>
        <CardHeader><CardTitle>{tk('title')}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{tk('noData')}</p>
          <p className="mt-2 text-xs text-slate-400">{tk('noDataHint')}</p>
        </CardContent>
      </Card>
    )
  }

  const a = data.area
  const proj = data.project?.pricePerSqm ?? null
  const level = (data.verdict?.level || 'insufficient') as Level
  const style = LEVEL_STYLE[level] || LEVEL_STYLE.insufficient
  const months = data.windowMonths || 12
  const span = Math.max(a.max - a.min, 1)
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - a.min) / span) * 100))
  const p = data.premiumPct != null ? Math.abs(Math.round(data.premiumPct)) : 0
  const explanation =
    level === 'high' || level === 'above' ? tk('eAbove', { p, months })
    : level === 'below' ? tk('eBelow', { p, months })
    : level === 'inline' ? tk('eInline')
    : level === 'no_project_price' ? tk('eNoPrice')
    : tk('eInsufficient')

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>{tk('title')}</CardTitle>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${style.chip}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {tk(VERDICT_KEY[level])}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="pt-6 pb-2">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-sky-200 via-emerald-200 to-amber-200">
            <div className="absolute -top-1 h-4 w-0.5 bg-slate-500" style={{ left: `${pct(a.median)}%` }} />
            {proj != null && (
              <div className="absolute -top-3 flex flex-col items-center -translate-x-1/2" style={{ left: `${pct(proj)}%` }}>
                <div className={`h-4 w-4 rounded-full ring-2 ring-white ${style.dot}`} />
              </div>
            )}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-400">
            <span>{fmt(a.min)}</span>
            <span className="text-slate-600 font-medium">{tk('median')} {fmt(a.median)}</span>
            <span>{fmt(a.max)}</span>
          </div>
          <div className="mt-1 text-center text-[11px] text-slate-400">{tk('aedWindow', { area: data.areaName, months })}</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{tk('thisProject')}</div>
            <div className="text-lg font-semibold text-slate-800">{proj != null ? `${fmt(proj)} AED/m²` : '—'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{tk('vsMedian')}</div>
            <div className="text-lg font-semibold text-slate-800">{data.premiumPct != null ? `${data.premiumPct > 0 ? '+' : ''}${data.premiumPct}%` : '—'}</div>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-600">{explanation}</p>

        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{tk('basedOn', { count: data.sampleCount, date: data.dataThrough || '—' })}{data.confidence === 'low' ? tk('smallSample') : ''}</span>
            <button type="button" onClick={() => setShowWhy((v) => !v)} className="font-medium text-primary hover:underline">{showWhy ? tk('hide') : tk('why')}</button>
          </div>
          {showWhy && <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{tk('methodology')}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
