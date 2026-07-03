import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { PaymentPlan, UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import PaymentTimeline from '../../components/project/PaymentTimeline'
import PaymentChart from '../../components/project/PaymentChart'
import { formatMoneyCompact } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'

interface PaymentPlanTabProps {
  paymentPlan: PaymentPlan[]
  referencePrice?: number
  units?: UnitType[]
}

/**
 * 付款计划:户型选择(每个户型总价不同)→ 交互式付款时间线图表 + 里程碑明细。
 * 默认选起价/参考价;选中某户型后,图表与每期金额全部按该户型总价换算。
 */
export function PaymentPlanTab({ paymentPlan, referencePrice, units = [] }: PaymentPlanTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])
  const zh = (i18n.language || 'en').startsWith('zh')

  // 有报价的户型(按价格升序);参考价作为默认第一项
  const priced = useMemo(
    () => units.filter((u) => (u.price ?? 0) > 0).sort((a, b) => (a.price! - b.price!)),
    [units]
  )
  const [selected, setSelected] = useState<string>('ref')
  const activePrice = selected === 'ref'
    ? (referencePrice || 0)
    : (priced.find((u) => u.id === selected)?.price || referencePrice || 0)

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
      <CardContent className="space-y-5">
        {/* 户型选择:金额按所选户型总价换算 */}
        {(priced.length > 0 && (referencePrice || 0) > 0) && (
          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              {zh ? '按户型算每期应付' : 'Calculate by unit type'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelected('ref')}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selected === 'ref' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {zh ? '起价' : 'From'} <DirhamSymbol size="0.8em" />{formatMoneyCompact(referencePrice!, i18n.language)}
              </button>
              {priced.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelected(u.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected === u.id ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {u.unit_type_name || `${u.bedrooms}${zh ? ' 居' : ' BR'}`}
                  <span className={selected === u.id ? 'ml-1.5 opacity-90' : 'ml-1.5 text-slate-400'}>
                    <DirhamSymbol size="0.8em" />{formatMoneyCompact(u.price!, i18n.language)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 交互式付款时间线(hover 看每期/累计金额) */}
        {activePrice > 0 && (
          <PaymentChart paymentPlan={paymentPlan} price={activePrice} lang={i18n.language} />
        )}

        <PaymentTimeline paymentPlan={paymentPlan} referencePrice={activePrice || undefined} lang={i18n.language} />
      </CardContent>
    </Card>
  )
}
