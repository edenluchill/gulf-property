import { PaymentPlan } from '../../types'
import { calcInvestment5yr, paybackYears } from '../../lib/investment'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import ReturnsBar from './ReturnsBar'

/**
 * Per-unit economics: this unit's 5yr ROI (from its own price + area yield/
 * growth) and the payment plan translated into actual AED amounts for this
 * unit's price. Reused by the desktop sub-page and the mobile detail sheet.
 * Renders nothing if there's neither investment signal nor a payment plan.
 */
export default function UnitEconomics({
  price,
  yieldPct,
  growthPct,
  paymentPlan,
  lang,
}: {
  price?: number
  yieldPct?: number | null
  growthPct?: number | null
  paymentPlan?: PaymentPlan[]
  lang: string
}) {
  const zh = lang?.startsWith('zh')
  const y = yieldPct || 0
  const g = growthPct || 0
  const inv = price ? calcInvestment5yr(price, y, g) : null
  const hasPlan = !!paymentPlan && paymentPlan.length > 0
  if (!inv && !hasPlan) return null

  const Amount = ({ v }: { v: number }) => (
    <span className="tabular-nums">
      <DirhamSymbol size="0.85em" className="mr-0.5 text-slate-400" />
      {formatMoneyCompact(v, lang)}
    </span>
  )

  return (
    <div className="mt-6 space-y-4">
      {inv && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">{zh ? '这套的投资估算' : 'This unit · investment'}</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-lg font-bold text-teal-600">{y ? `${y}%` : '—'}</div>
              <div className="text-[11px] text-slate-500">{zh ? '租金回报' : 'Yield'}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-600">{inv.annualized_return_pct}%</div>
              <div className="text-[11px] text-slate-500">{zh ? '5 年年化' : '5yr annualized'}</div>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">{paybackYears(y) ?? '—'}{paybackYears(y) ? (zh ? ' 年' : 'y') : ''}</div>
              <div className="text-[11px] text-slate-500">{zh ? '回本年限' : 'Payback'}</div>
            </div>
          </div>
          <div className="mt-3">
            <ReturnsBar rental={inv.rental_income_5yr} appreciation={inv.appreciation_5yr} lang={lang} />
          </div>
        </div>
      )}

      {hasPlan && price ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 text-sm font-semibold text-slate-800">
            {zh ? '这套的付款节奏' : 'Payment for this unit'}
          </div>
          <div className="space-y-1.5">
            {paymentPlan!.map((m, i) => {
              const pct = parseFloat(String(m.percentage)) || 0
              return (
                <div key={m.id || i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-slate-600">
                    {m.milestone_name}
                    {m.interval_description ? <span className="ml-1 text-xs text-slate-400">· {m.interval_description}</span> : ''}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">{pct}%</span>
                    <span className="font-medium text-slate-800"><Amount v={(price * pct) / 100} /></span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
