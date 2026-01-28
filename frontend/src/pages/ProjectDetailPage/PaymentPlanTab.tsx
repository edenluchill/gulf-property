import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { formatDate } from '../../lib/utils'
import { PaymentPlan } from '../../types'
import { useTranslation } from 'react-i18next'

interface PaymentPlanTabProps {
  paymentPlan: PaymentPlan[]
}

export function PaymentPlanTab({ paymentPlan }: PaymentPlanTabProps) {
  const { t } = useTranslation(['project', 'common'])

  if (paymentPlan.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('project:paymentPlanTab.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-600">
            <p>{t('project:paymentPlanTab.emptyMessage')}</p>
            <Button className="mt-4">{t('common:buttons.requestPaymentPlan')}</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('project:paymentPlanTab.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {paymentPlan.map((milestone, index) => (
            <div 
              key={milestone.id || index} 
              className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-10 h-10 bg-primary text-white rounded-full font-bold">
                  {index + 1}
                </div>
                <div>
                  <div className="font-semibold text-lg">{milestone.milestone_name}</div>
                  {milestone.interval_description ? (
                    <div className="text-sm text-slate-600 flex items-center gap-1">
                      <span>⏱️</span>
                      <span>{milestone.interval_description}</span>
                    </div>
                  ) : milestone.interval_months !== undefined && milestone.interval_months !== null ? (
                    <div className="text-sm text-slate-600 flex items-center gap-1">
                      <span>⏱️</span>
                      <span>
                        {milestone.interval_months === 0 
                          ? 'At booking' 
                          : `${milestone.interval_months} month${milestone.interval_months !== 1 ? 's' : ''} later`
                        }
                      </span>
                    </div>
                  ) : milestone.milestone_date ? (
                    <div className="text-sm text-slate-600">
                      Due: {formatDate(milestone.milestone_date)}
                    </div>
                  ) : null}
                  {milestone.description && (
                    <div className="text-sm text-slate-600 mt-1">{milestone.description}</div>
                  )}
                </div>
              </div>
              <div className="text-2xl font-bold text-primary">
                {parseFloat(milestone.percentage.toString()).toFixed(0)}%
              </div>
            </div>
          ))}
          
          {/* Total */}
          <div className="flex items-center justify-between p-4 bg-primary text-white rounded-lg font-bold">
            <div className="text-lg">Total</div>
            <div className="text-2xl">
              {paymentPlan.reduce((sum, m) => sum + parseFloat(m.percentage.toString()), 0).toFixed(0)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
