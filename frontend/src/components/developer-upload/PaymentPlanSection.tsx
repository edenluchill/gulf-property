import { Loader2, Clock } from 'lucide-react'

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

export function PaymentPlanSection({ paymentPlan, isProcessing }: PaymentPlanSectionProps) {
  const hasPlan = paymentPlan && paymentPlan.length > 0
  const total = hasPlan ? paymentPlan.reduce((sum, m) => sum + (parseFloat(String(m.percentage)) || 0), 0) : 0

  return (
    <div className="space-y-4 pt-6 border-t-2 border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            💰 付款计划
          </h3>
          {hasPlan && (
            <p className="text-sm text-gray-600">
              共 {paymentPlan.length} 个付款阶段
            </p>
          )}
        </div>
      </div>

      {hasPlan ? (
        <div className="space-y-3">
          {paymentPlan.map((milestone, idx) => (
            <div 
              key={idx} 
              className="flex items-center justify-between p-5 bg-white rounded-xl border-2 border-gray-200 hover:border-amber-400 hover:shadow-md transition-all"
            >
              <div className="flex-1">
                <div className="font-semibold text-gray-900 flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white text-sm font-bold shadow-md">
                    {idx + 1}
                  </span>
                  <span className="text-base">
                    {milestone.milestone || `阶段 ${idx + 1}`}
                  </span>
                </div>
                {/* 优先显示间隔描述，否则显示日期 */}
                {milestone.intervalDescription ? (
                  <div className="text-sm text-gray-500 mt-2 ml-11 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span>{milestone.intervalDescription}</span>
                  </div>
                ) : milestone.intervalMonths !== undefined && milestone.intervalMonths !== null ? (
                  <div className="text-sm text-gray-500 mt-2 ml-11 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span>
                      {milestone.intervalMonths === 0 
                        ? 'At booking' 
                        : `${milestone.intervalMonths} month${milestone.intervalMonths !== 1 ? 's' : ''} later`
                      }
                    </span>
                  </div>
                ) : milestone.date ? (
                  <div className="text-sm text-gray-500 mt-2 ml-11 flex items-center gap-2">
                    <span>📅</span>
                    <span>{milestone.date}</span>
                  </div>
                ) : null}
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-amber-600">
                  {parseFloat(String(milestone.percentage)) || 0}%
                </div>
              </div>
            </div>
          ))}
          
          {/* Total Summary */}
          <div className="flex items-center justify-between p-6 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 rounded-xl border-2 border-amber-400 shadow-lg mt-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎯</span>
              <span className="text-lg font-bold text-gray-900">总计</span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`text-3xl font-bold ${Math.abs(total - 100) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                {total.toFixed(2)}%
              </div>
              {Math.abs(total - 100) >= 0.01 && (
                <span className="text-sm font-semibold px-3 py-1 rounded-full bg-red-100 text-red-600">
                  {total > 100 ? '超出' : '不足'} {Math.abs(100 - total).toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
          {isProcessing ? (
            <div className="text-gray-600">
              <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin text-amber-600" />
              <p className="font-medium">AI 正在提取付款计划...</p>
            </div>
          ) : (
            <p className="text-gray-500">暂无付款计划</p>
          )}
        </div>
      )}
    </div>
  )
}
