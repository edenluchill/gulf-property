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
      {/* 5 档等分一行,不再 flex-wrap。
          wrap 的问题是 3M/6M 带 ⓘ 比别的宽,在窄容器里排成 3+2 且右边空一块,
          看着像没排完(owner 2026-07-29 手机截图)。等分网格宽度恒定、永远一行,
          中英文和 ⓘ 都不影响布局。 */}
      <div className="grid grid-cols-5 gap-1">
        {PERIOD_KEYS.map((k) => {
          const active = k === value
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              aria-pressed={active}
              className={`flex min-w-0 items-center justify-center gap-px rounded-full px-1 py-1 text-xs font-semibold transition active:scale-90 ${
                active
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {periodLabel(k, zh)}
              {SHORT_PERIODS.includes(k) && <span className="text-[9px] opacity-70">ⓘ</span>}
            </button>
          )
        })}
      </div>
      {/* 短周期的告警:**一行说完**。
          原文是两句带实现细节的长句(「已按滚动窗口平滑,样本不足会显示「—」」),
          在 367px 手机上占 4–5 行,比选择器本身还高(owner 2026-07-29:「这个 popup
          太多字了 手机版一点都不好看」)。要保住的判断只有一个:**这个数字别当准数用**。
          「样本不足显示 —」那句删了 —— 地图上直接就是灰的,看到了自然会问,
          而在这里预先解释一个还没发生的现象是把说明书塞进决策路径。 */}
      {isShort && (
        <div className="mt-1.5 text-[11px] leading-snug text-amber-600">
          {zh ? '短周期样本薄、波动大,仅供参考' : 'Short window — thin samples, indicative only.'}
        </div>
      )}
    </div>
  )
}
