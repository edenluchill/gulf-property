/**
 * 增值率周期（1月…5年）前端单点配置 —— 见 docs/appreciation-yield-compare-spec.md §4.1
 *
 * 周期跟随市场口径（综合/期房/现房，见 [[marketSegment]]），持久化跨会话。
 * 短周期(1月/3月/半年)样本波动大 → UI 挂 ⓘ 提示但不隐藏（用户 2026-07-15 定：不藏私）。
 * 后端 APPRECIATION_PERIODS(routes/market.ts) 与此一一对应，改一处必改另一处。
 */
export type MetricPeriodKey = '1m' | '3m' | '6m' | '1y' | '2y' | '3y' | '5y'

export const PERIOD_KEYS: MetricPeriodKey[] = ['1m', '3m', '6m', '1y', '2y', '3y', '5y']

/** 短周期(区域中位价样本薄，抖动大) —— UI 挂「仅供参考」提示 */
export const SHORT_PERIODS: MetricPeriodKey[] = ['1m', '3m', '6m']

/** 默认周期：近 1 年（房产长周期决策，买家最常问「过去一年涨多少」） */
export const DEFAULT_PERIOD: MetricPeriodKey = '1y'

export function periodLabel(k: MetricPeriodKey, zh: boolean): string {
  switch (k) {
    case '1m': return zh ? '1月' : '1M'
    case '3m': return zh ? '3月' : '3M'
    case '6m': return zh ? '半年' : '6M'
    case '1y': return zh ? '1年' : '1Y'
    case '2y': return zh ? '2年' : '2Y'
    case '3y': return zh ? '3年' : '3Y'
    case '5y': return zh ? '5年' : '5Y'
  }
}

export const PERIOD_STORAGE_KEY = 'pinzos_metric_period'

export function loadSavedPeriod(): MetricPeriodKey {
  try {
    const s = localStorage.getItem(PERIOD_STORAGE_KEY)
    if (s && (PERIOD_KEYS as string[]).includes(s)) return s as MetricPeriodKey
  } catch { /* ignore */ }
  return DEFAULT_PERIOD
}

export function savePeriod(k: MetricPeriodKey) {
  try { localStorage.setItem(PERIOD_STORAGE_KEY, k) } catch { /* ignore */ }
}
