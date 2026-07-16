import { Loader2, Clock, Calendar } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PaymentMilestone {
  milestone: string
  percentage: number
  date?: string
  intervalMonths?: number
  intervalDescription?: string
}

interface PaymentPlanSectionProps {
  paymentPlan: PaymentMilestone[]
  isProcessing: boolean
}

/**
 * Compact payment plan — single card with a percentage bar and one slim row
 * per milestone (was: one full-width card per instalment, far too tall).
 */
export function PaymentPlanSection({ paymentPlan, isProcessing }: PaymentPlanSectionProps) {
  const { t } = useTranslation('upload')
  const hasPlan = paymentPlan && paymentPlan.length > 0
  const total = hasPlan ? paymentPlan.reduce((sum, m) => sum + (parseFloat(String(m.percentage)) || 0), 0) : 0
  const totalOk = Math.abs(total - 100) < 0.01

  const timingLabel = (m: PaymentMilestone): string | null => {
    if (m.intervalDescription) return m.intervalDescription
    if (m.intervalMonths !== undefined && m.intervalMonths !== null) {
      return m.intervalMonths === 0 ? 'At booking' : `+${m.intervalMonths} mo`
    }
    return m.date || null
  }

  return (
    <div className="space-y-3 pt-6 border-t border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
          <h3 className="text-lg font-bold text-gray-900">{t('paymentPlan.title')}</h3>
        </div>
        {hasPlan && (
          <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${
            totalOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}>
            {total.toFixed(0)}%{!totalOk && ` (${total > 100 ? t('paymentPlan.exceeded') : t('paymentPlan.insufficient')} ${Math.abs(100 - total).toFixed(0)}%)`}
          </span>
        )}
      </div>

      {hasPlan ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Proportional percentage bar */}
          <div className="flex h-2">
            {paymentPlan.map((m, idx) => (
              <div
                key={idx}
                className={idx % 2 === 0 ? 'bg-teal-500' : 'bg-teal-300'}
                style={{ width: `${Math.max(parseFloat(String(m.percentage)) || 0, 1)}%` }}
                title={`${m.milestone} ${m.percentage}%`}
              />
            ))}
          </div>
          <div className="divide-y divide-gray-50">
            {paymentPlan.map((milestone, idx) => {
              const timing = timingLabel(milestone)
              return (
                <div key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold shrink-0">
                    {idx + 1}
                  </span>
                  <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">
                    {milestone.milestone || `${t('paymentPlan.stage')} ${idx + 1}`}
                  </span>
                  {timing && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-400 shrink-0">
                      {milestone.date && !milestone.intervalDescription
                        ? <Calendar className="h-3 w-3" />
                        : <Clock className="h-3 w-3" />}
                      {timing}
                    </span>
                  )}
                  <span className="font-bold text-teal-600 tabular-nums w-12 text-end shrink-0">
                    {parseFloat(String(milestone.percentage)) || 0}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
          {isProcessing ? (
            <div className="text-gray-600">
              <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin text-teal-600" />
              <p className="text-sm font-medium">{t('paymentPlan.aiExtracting')}</p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('paymentPlan.noPlan')}</p>
          )}
        </div>
      )}
    </div>
  )
}
