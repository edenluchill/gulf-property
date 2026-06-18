import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { PaymentPlan } from '../../types'
import { useTranslation } from 'react-i18next'
import PaymentTimeline from '../../components/project/PaymentTimeline'

interface PaymentPlanTabProps {
  paymentPlan: PaymentPlan[]
  referencePrice?: number
}

export function PaymentPlanTab({ paymentPlan, referencePrice }: PaymentPlanTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])

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
        <PaymentTimeline paymentPlan={paymentPlan} referencePrice={referencePrice} lang={i18n.language} />
      </CardContent>
    </Card>
  )
}
