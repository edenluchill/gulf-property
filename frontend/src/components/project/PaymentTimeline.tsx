import { PaymentPlan } from '../../types'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../DirhamSymbol'
import i18n from '../../i18n'

/**
 * Payment plan as a proportional timeline: a cumulative segmented bar (each
 * milestone sized by its %) + milestone cards with timing and — when a
 * reference price is given — the actual AED due at each step. Replaces the plain
 * stacked list. See docs/project-detail-redesign-spec.md §4.3.
 */
const SEG_COLORS = ['bg-teal-400', 'bg-emerald-400', 'bg-sky-400', 'bg-indigo-400', 'bg-violet-400', 'bg-amber-400']

export default function PaymentTimeline({
  paymentPlan,
  referencePrice,
  lang,
}: {
  paymentPlan: PaymentPlan[]
  referencePrice?: number
  lang: string
}) {
  const t = (i18n.getFixedT as (l: string, ns: string) => (k: string, o?: Record<string, unknown>) => string)(lang, 'projectDetail')
  const pct = (m: PaymentPlan) => parseFloat(String(m.percentage)) || 0
  const total = paymentPlan.reduce((s, m) => s + pct(m), 0)

  const timing = (m: PaymentPlan): string => {
    if (m.interval_description) return m.interval_description
    if (m.interval_months != null) {
      if (m.interval_months === 0) return t('projectDetail:atBooking2')
      return t('projectDetail:moLater', { m_interval_months: m.interval_months })
    }
    if (m.milestone_date) return String(m.milestone_date).slice(0, 10)
    return ''
  }

  return (
    <div className="space-y-5">
      {/* Cumulative proportional bar */}
      <div>
        <div className="flex h-6 w-full overflow-hidden rounded-full bg-slate-100">
          {paymentPlan.map((m, i) => {
            const p = pct(m)
            return (
              <div
                key={m.id || i}
                className={`flex items-center justify-center ${SEG_COLORS[i % SEG_COLORS.length]} ${i > 0 ? 'border-l border-white' : ''}`}
                style={{ width: `${total ? (p / total) * 100 : 0}%` }}
                title={`${m.milestone_name} · ${p}%`}
              >
                {p / (total || 1) > 0.08 && <span className="text-[10px] font-semibold text-white">{p}%</span>}
              </div>
            )
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
          <span>{t('projectDetail:booking')}</span>
          <span>{t('projectDetail:handover')}</span>
        </div>
      </div>

      {/* Milestone cards */}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {paymentPlan.map((m, i) => {
          const p = pct(m)
          return (
            <div key={m.id || i} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${SEG_COLORS[i % SEG_COLORS.length]}`}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{m.milestone_name}</div>
                {timing(m) && <div className="text-xs text-slate-400">{timing(m)}</div>}
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{p}%</div>
                {referencePrice && referencePrice > 0 && (
                  <div className="text-[11px] text-slate-500">
                    <DirhamSymbol size="0.8em" className="mr-0.5 text-slate-400" />
                    {formatMoneyCompact((referencePrice * p) / 100, lang)}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-white">
        <span className="font-medium">{t('projectDetail:total2')}</span>
        <span className="text-xl font-bold">{total.toFixed(0)}%</span>
      </div>
      {referencePrice && referencePrice > 0 && (
        <p className="text-[11px] text-slate-400">
          {t('projectDetail:amountsAtReferencePrice')}
          <DirhamSymbol size="0.8em" className="mx-0.5" />
          {formatMoneyCompact(referencePrice, lang)}
          {t('projectDetail:actualDependsOnUnit')}
        </p>
      )}
    </div>
  )
}
