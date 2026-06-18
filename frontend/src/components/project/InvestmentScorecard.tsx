import { TrendingUp } from 'lucide-react'
import { ProjectInsights } from '../../lib/api'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import ReturnsBar from './ReturnsBar'

/**
 * Investment outlook — the hero of the overview tab for this investment-focused
 * site. Surfaces rental yield, 5yr annualized return, payback and price growth
 * (from /insights), plus a 5yr returns breakdown bar. Honest: always shows the
 * reference price + data-as-of + a not-a-promise disclaimer.
 */
export default function InvestmentScorecard({
  insights,
  lang,
}: {
  insights: ProjectInsights
  lang: string
}) {
  const zh = lang?.startsWith('zh')
  const inv = insights.investment
  const area = insights.area
  if (!inv) return null

  const pct = (v?: number | null) => (v != null ? `${v}%` : '—')
  const tiles = [
    { label: zh ? '租金回报' : 'Rental yield', value: pct(area?.rental_yield_pct), accent: 'text-teal-600' },
    { label: zh ? '5 年年化' : '5yr annualized', value: pct(inv.annualized_return_pct), accent: 'text-emerald-600' },
    { label: zh ? '回本年限' : 'Payback', value: inv.payback_years != null ? `${inv.payback_years}${zh ? ' 年' : 'y'}` : '—', accent: 'text-slate-800' },
    { label: zh ? '区域涨幅' : 'Area growth', value: pct(area?.price_growth_pct), accent: 'text-amber-600' },
  ]

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
          <TrendingUp className="h-4 w-4" />
        </span>
        <h3 className="text-base font-semibold text-slate-900">{zh ? '投资评估' : 'Investment outlook'}</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tl) => (
          <div key={tl.label} className="rounded-xl bg-slate-50 p-3">
            <div className={`text-2xl font-bold ${tl.accent}`}>{tl.value}</div>
            <div className="mt-0.5 text-xs text-slate-500">{tl.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-slate-500">
          {zh ? '5 年收益拆解（以参考价估算）' : '5-year returns (at reference price)'}
        </div>
        <ReturnsBar rental={inv.rental_income_5yr} appreciation={inv.appreciation_5yr} lang={lang} />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        {zh ? '参考价 ' : 'Reference price '}
        <DirhamSymbol size="0.85em" className="mx-0.5" />
        {formatMoneyCompact(inv.reference_price, lang)}
        {area?.data_through && (zh ? ` · 区域数据截止 ${area.data_through}` : ` · area data through ${area.data_through}`)}
        {area?.sales_transaction_count
          ? zh
            ? ` · 基于近期 ${area.sales_transaction_count.toLocaleString()} 笔成交`
            : ` · based on ${area.sales_transaction_count.toLocaleString()} recent sales`
          : ''}
        {'. '}
        {zh ? '估算来自该区域 DLD 成交,非投资回报承诺。' : 'Estimates from area DLD sales — not a guarantee of returns.'}
      </p>
    </div>
  )
}
