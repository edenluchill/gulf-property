/**
 * 价格体检 (Price Check) — 本项目单价 vs 同区近 12 个月真实成交分布，中性可解释。
 * 文案全部由前端按语言组装(level + 溢价% + 样本量),不吃后端中文串 → 中英一致翻译。
 * 数据来源：DLD 成交（定期快照，非实时）。
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

const fmt = (n: number) => n.toLocaleString('en-US')

function verdictLabel(level: Level, zh: boolean): string {
  switch (level) {
    case 'high': return zh ? '显著高于区域成交中位数' : 'Well above area median'
    case 'above': return zh ? '高于区域成交中位数' : 'Above area median'
    case 'below': return zh ? '低于区域成交中位数' : 'Below area median'
    case 'inline': return zh ? '与区域中位基本持平' : 'In line with area median'
    case 'insufficient': return zh ? '样本不足' : 'Insufficient sample'
    case 'no_project_price': return zh ? '缺少项目单价' : 'No project price'
  }
}

function explanation(level: Level, premiumPct: number | null, months: number, zh: boolean): string {
  const p = premiumPct != null ? Math.abs(Math.round(premiumPct)) : 0
  if (level === 'high' || level === 'above') {
    return zh
      ? `本项目单价相对同区近 ${months} 个月成交中位数高约 ${p}%。新盘相对二手存在溢价较常见，建议结合付款计划、交付时间与楼层/景观综合判断。`
      : `About ${p}% above the area’s median over the last ${months} months. A premium for new-build over resale is common — weigh it against payment plan, handover timing and floor/view.`
  }
  if (level === 'below') {
    return zh
      ? `本项目单价相对同区近 ${months} 个月成交中位数低约 ${p}%，可能反映户型、楼龄或具体单元差异。`
      : `About ${p}% below the area’s median over the last ${months} months — may reflect unit mix, building age or specific units.`
  }
  if (level === 'inline') {
    return zh ? '本项目单价与同区近期成交中位数基本一致。' : 'In line with the area’s recent median.'
  }
  if (level === 'no_project_price') {
    return zh ? '该项目未录入可用的户型单价，仅展示区域成交区间供参考。' : 'No usable unit price on file — showing the area’s range for reference only.'
  }
  return zh ? '该区域近期可比成交样本不足，暂不给出价格判断，仅供参考。' : 'Not enough comparable area sales for a price call — indicative only.'
}

export function PriceCheckModule({ projectId }: { projectId: string }) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
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
    return (
      <Card>
        <CardHeader><CardTitle>{zh ? '价格体检' : 'Price check'}</CardTitle></CardHeader>
        <CardContent><div className="text-sm text-slate-400">{zh ? '正在比对同区真实成交…' : 'Comparing area deals…'}</div></CardContent>
      </Card>
    )
  }
  if (!data) return null

  if (!data.matched || !data.area || !data.sampleCount) {
    return (
      <Card>
        <CardHeader><CardTitle>{zh ? '价格体检' : 'Price check'}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{zh ? '暂无足够同区成交数据，无法做价格体检。' : 'Not enough area sales to run a price check.'}</p>
          <p className="mt-2 text-xs text-slate-400">{zh ? '数据基于 DLD 成交快照；新社区或样本不足时无法给出判断。' : 'Based on DLD sales snapshots; unavailable for new communities or thin samples.'}</p>
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>{zh ? '价格体检' : 'Price check'}</CardTitle>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${style.chip}`}>
            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
            {verdictLabel(level, zh)}
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
            <span className="text-slate-600 font-medium">{zh ? '中位' : 'Median'} {fmt(a.median)}</span>
            <span>{fmt(a.max)}</span>
          </div>
          <div className="mt-1 text-center text-[11px] text-slate-400">
            {zh ? `AED / m²（${data.areaName} 近 ${months} 个月成交）` : `AED/m² (${data.areaName} · last ${months} months)`}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{zh ? '本项目单价' : 'This project'}</div>
            <div className="text-lg font-semibold text-slate-800">{proj != null ? `${fmt(proj)} AED/m²` : '—'}</div>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-slate-500">{zh ? '相对区域中位数' : 'vs area median'}</div>
            <div className="text-lg font-semibold text-slate-800">
              {data.premiumPct != null ? `${data.premiumPct > 0 ? '+' : ''}${data.premiumPct}%` : '—'}
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-600">{explanation(level, data.premiumPct ?? null, months, zh)}</p>

        <div className="mt-4 border-t pt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              {zh ? `基于 ${data.sampleCount} 笔成交 · 数据截至 ${data.dataThrough || '—'}` : `Based on ${data.sampleCount} sales · through ${data.dataThrough || '—'}`}
              {data.confidence === 'low' ? (zh ? ' · 样本偏少' : ' · small sample') : ''}
            </span>
            <button type="button" onClick={() => setShowWhy((v) => !v)} className="font-medium text-primary hover:underline">
              {showWhy ? (zh ? '收起' : 'Hide') : zh ? '为什么?' : 'Why?'}
            </button>
          </div>
          {showWhy && (
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {zh
                ? '区域基准 = 该区近 12 个月 DLD 住宅销售（Unit/Villa）每平方米成交价分布，已剔除最高/最低 5% 极端值，取中位数。项目单价 = 各户型单价中位数换算 AED/m²。数据为 DLD 定期快照（非实时），二手登记通常滞后 4–8 周。'
                : 'Area baseline = the area’s last-12-month DLD residential (Unit/Villa) price/m² distribution, top/bottom 5% trimmed, median taken. Project price = median of unit-type prices in AED/m². DLD periodic snapshot (not live); resale registrations lag 4–8 weeks.'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
