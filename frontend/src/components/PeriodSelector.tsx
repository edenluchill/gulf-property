/**
 * 增值率周期选择器 —— 见 docs/appreciation-yield-compare-spec.md §4.1
 * 全档位平铺(1月…5年),短周期不藏但选中时挂「样本波动大」提示(用户 2026-07-15 定)。
 * 宽处 wrap 铺满,窄处横向滚动不占高。选中态紫色(全站 segmented 范式)。
 */
import { MetricPeriodKey, PERIOD_KEYS, SHORT_PERIODS, periodLabel } from '../lib/metricPeriod'

export function PeriodSelector({
  value,
  onChange,
  zh,
  className = '',
}: {
  value: MetricPeriodKey
  onChange: (k: MetricPeriodKey) => void
  zh: boolean
  className?: string
}) {
  const isShort = SHORT_PERIODS.includes(value)
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {PERIOD_KEYS.map((k) => {
          const active = k === value
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              aria-pressed={active}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition active:scale-90 ${
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {periodLabel(k, zh)}
              {SHORT_PERIODS.includes(k) && <span className="ml-0.5 opacity-70">ⓘ</span>}
            </button>
          )
        })}
      </div>
      {isShort && (
        <div className="mt-1.5 text-[11px] leading-snug text-amber-600">
          {zh
            ? '短周期区域样本薄、中位价波动大，仅供参考；已按滚动窗口平滑，样本不足会显示「—」'
            : 'Short windows have thin samples and volatile medians — indicative only; smoothed by rolling window, insufficient samples show “—”.'}
        </div>
      )}
    </div>
  )
}
