import { Loader2, Clock, Calendar, Plus, X, CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface PaymentMilestone {
  milestone: string
  /** 该期对总额的**总贡献** %。按月分期行 = monthlyPct × monthlyCount(始终存总贡献,
   *  这样合计/百分比条/付款结构标签这些只读 percentage 的地方全自动正确)。 */
  percentage: number
  date?: string
  intervalMonths?: number
  intervalDescription?: string
  /** 按月分期(「1%/月 × 40月」)元数据。有 monthlyCount = 递延分期行;无 = 普通单次。 */
  monthlyPct?: number | null
  monthlyCount?: number | null
}

interface PaymentPlanSectionProps {
  paymentPlan: PaymentMilestone[]
  isProcessing: boolean
  /** 传了 = 可编辑(增删改 + 按月分期);不传 = 只读展示(原行为)。 */
  onChange?: (plan: PaymentMilestone[]) => void
}

const num = (v: unknown) => parseFloat(String(v ?? '')) || 0
/** 一行的总贡献 % —— 按月行是 每月% × 月数,普通行就是 percentage 本身。 */
const rowTotal = (m: PaymentMilestone) =>
  m.monthlyCount ? num(m.monthlyPct) * num(m.monthlyCount) : num(m.percentage)

/**
 * 付款计划 —— 只读展示 + (传 onChange 时)可编辑。
 *
 * 可编辑:admin 上传后也能自己增删改每一期;支持迪拜常见的「每月 1%」递延分期
 * (建造期 1%/月 × N 月),折叠成一行显示,买家项目页看到「1%/月 × 40月 = 40%」。
 * 合计实时校验 100%。
 */
export function PaymentPlanSection({ paymentPlan, isProcessing, onChange }: PaymentPlanSectionProps) {
  const { t, i18n } = useTranslation('upload')
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (z: string, e: string) => (zh ? z : e)
  const editable = typeof onChange === 'function'
  const plan = paymentPlan || []
  const hasPlan = plan.length > 0
  const total = plan.reduce((sum, m) => sum + rowTotal(m), 0)
  const totalOk = Math.abs(total - 100) < 0.01

  const timingLabel = (m: PaymentMilestone): string | null => {
    if (m.intervalDescription) return m.intervalDescription
    if (m.intervalMonths !== undefined && m.intervalMonths !== null) {
      return m.intervalMonths === 0 ? L('签约时', 'At booking') : `+${m.intervalMonths} ${L('月', 'mo')}`
    }
    return m.date || null
  }

  // ── 编辑操作 ────────────────────────────────────────────────────────────────
  const emit = (next: PaymentMilestone[]) => onChange?.(next)
  const patch = (idx: number, p: Partial<PaymentMilestone>) => {
    emit(plan.map((m, i) => (i === idx ? normalizeRow({ ...m, ...p }) : m)))
  }
  // 改了按月的每月%/月数 → 重算 percentage(总贡献)+ 自动写「X%/月 × N月」标签
  const normalizeRow = (m: PaymentMilestone): PaymentMilestone => {
    if (m.monthlyCount) {
      const per = num(m.monthlyPct)
      const cnt = num(m.monthlyCount)
      return { ...m, percentage: Math.round(per * cnt * 100) / 100, intervalDescription: `${per}%/${L('月', 'mo')} × ${cnt}${L('月', ' mo')}` }
    }
    return m
  }
  const addSingle = () => emit([...plan, { milestone: '', percentage: 0 }])
  const addMonthly = () => emit([...plan, normalizeRow({ milestone: L('建造期分期', 'During construction'), percentage: 0, monthlyPct: 1, monthlyCount: 40, intervalMonths: plan.length ? undefined : 0 })])
  const remove = (idx: number) => emit(plan.filter((_, i) => i !== idx))

  const inputCls = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100'

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
            {total.toFixed(total % 1 === 0 ? 0 : 1)}%{!totalOk && ` (${total > 100 ? t('paymentPlan.exceeded') : t('paymentPlan.insufficient')} ${Math.abs(100 - total).toFixed(0)}%)`}
          </span>
        )}
      </div>

      {/* ── 只读展示(没传 onChange)────────────────────────────────────────── */}
      {!editable && hasPlan && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex h-2">
            {plan.map((m, idx) => (
              <div key={idx} className={idx % 2 === 0 ? 'bg-teal-500' : 'bg-teal-300'}
                style={{ width: `${Math.max(rowTotal(m), 1)}%` }} title={`${m.milestone} ${rowTotal(m)}%`} />
            ))}
          </div>
          <div className="divide-y divide-gray-50">
            {plan.map((milestone, idx) => {
              const timing = timingLabel(milestone)
              return (
                <div key={idx} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold shrink-0">{idx + 1}</span>
                  <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">{milestone.milestone || `${t('paymentPlan.stage')} ${idx + 1}`}</span>
                  {timing && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-400 shrink-0">
                      {milestone.monthlyCount ? <CalendarClock className="h-3 w-3" /> : milestone.date && !milestone.intervalDescription ? <Calendar className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                      {timing}
                    </span>
                  )}
                  <span className="font-bold text-teal-600 tabular-nums w-12 text-end shrink-0">{rowTotal(milestone)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 可编辑(传了 onChange)────────────────────────────────────────────── */}
      {editable && (
        <div className="space-y-2">
          {plan.map((m, idx) => {
            const monthly = !!m.monthlyCount
            return (
              <div key={idx} className="rounded-xl border border-gray-200 bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-teal-50 text-teal-700 text-[11px] font-bold shrink-0">{idx + 1}</span>
                  <input
                    value={m.milestone}
                    onChange={(e) => patch(idx, { milestone: e.target.value })}
                    placeholder={`${t('paymentPlan.stage')} ${idx + 1}`}
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                  {/* 单次 / 按月 切换 */}
                  <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-gray-200 text-xs">
                    <button type="button" onClick={() => patch(idx, { monthlyPct: null, monthlyCount: null })}
                      className={`px-2 py-1.5 font-medium ${!monthly ? 'bg-teal-500 text-white' : 'bg-white text-gray-500'}`}>{L('单次', 'Once')}</button>
                    <button type="button" onClick={() => patch(idx, normalizeRow({ ...m, monthlyPct: num(m.monthlyPct) || 1, monthlyCount: num(m.monthlyCount) || 12 }))}
                      className={`px-2 py-1.5 font-medium ${monthly ? 'bg-teal-500 text-white' : 'bg-white text-gray-500'}`}>{L('按月', 'Monthly')}</button>
                  </div>
                  <button type="button" onClick={() => remove(idx)} aria-label={L('删除该期', 'Remove')}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-rose-50 hover:text-rose-500"><X className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 ps-7">
                  {monthly ? (
                    <>
                      <span className="text-xs text-gray-500">{L('每月', 'Each month')}</span>
                      <input type="number" step="0.1" value={m.monthlyPct ?? ''} onChange={(e) => patch(idx, { monthlyPct: e.target.value === '' ? null : num(e.target.value) })} className={`${inputCls} w-16 text-end`} />
                      <span className="text-xs text-gray-500">% ×</span>
                      <input type="number" step="1" value={m.monthlyCount ?? ''} onChange={(e) => patch(idx, { monthlyCount: e.target.value === '' ? null : Math.round(num(e.target.value)) })} className={`${inputCls} w-16 text-end`} />
                      <span className="text-xs text-gray-500">{L('个月', 'months')}</span>
                      <span className="ms-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-bold text-teal-700">= {rowTotal(m)}%</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-gray-500">{L('占比', 'Share')}</span>
                      <input type="number" step="0.5" value={m.percentage ?? ''} onChange={(e) => patch(idx, { percentage: e.target.value === '' ? 0 : num(e.target.value) })} className={`${inputCls} w-20 text-end`} />
                      <span className="text-xs text-gray-500">%</span>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="text-xs text-gray-500">{L('时点', 'Timing')}</span>
                      <input value={m.intervalDescription ?? ''} onChange={(e) => patch(idx, { intervalDescription: e.target.value || undefined })} placeholder={L('如 签约时 / +3月 / 交房', 'e.g. At booking / +3mo / Handover')} className={`${inputCls} min-w-[8rem] flex-1`} />
                    </>
                  )}
                </div>
              </div>
            )
          })}

          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={addSingle} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">
              <Plus className="h-4 w-4" />{L('添加一期', 'Add stage')}
            </button>
            <button type="button" onClick={addMonthly} className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-700 transition hover:bg-teal-100">
              <CalendarClock className="h-4 w-4" />{L('添加按月分期', 'Add monthly plan')}
            </button>
          </div>
          {!hasPlan && <p className="text-sm text-gray-400">{L('还没有付款计划,点上面按钮添加。', 'No payment plan yet — add stages above.')}</p>}
        </div>
      )}

      {/* 处理中占位(只读态) */}
      {!editable && !hasPlan && (
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
