/**
 * Investment Calculator — pure functions, no DB dependency.
 * Extracted from voice-assistant-tools.ts where it was duplicated 3×.
 */

/**
 * 🔴 增值率钳制区间(2026-07-20 事故修复)
 *
 * `price_growth_pct` 的定义是**滚动 12 个月 YoY 中位价变动**(见
 * `src/db/add-rent-stability-and-median-yield.sql`),SQL 层放行到 ±120%。
 * 它**不是 CAGR**,拿单年 YoY 当永续复利外推 5 年会得出荒谬数字:
 * Business Bay 的 79.9%(那还是**写字楼**行)代入 → 270 万的 1 居室算出
 * 「5 年增值 4818 万、年化 79.9%」,Luna 当事实播报给了客户。
 *
 * 口径与 `routes/ai-analytics.ts` 的买租对比一致(那份一直是对的)。
 */
export const GROWTH_CLAMP_PCT = { min: -10, max: 20 }

/** 交易成本:DLD 转让费 4% + 中介佣金 2%,与 ai-analytics 同口径 */
export const TRANSACTION_FEE_PCT = 6

/**
 * 超过这个年化就说明上游数据仍然有问题(取错行/口径错),
 * 宁可不显示也不能让 Luna 播错 —— 见 calculateInvestment5yr 的返回 null 分支。
 */
export const MAX_PLAUSIBLE_ANNUALIZED_PCT = 30

export interface Investment5yr {
  purchase_price: number
  rental_income_5yr: number
  appreciation_5yr: number
  total_profit_5yr: number
  annualized_return_pct: number
  /** clamp 之后实际参与计算的年增值率 */
  assumed_growth_pct: number
  /** 原始值是否被钳制过 —— 为 true 时上游数据可疑,展示层应弱化措辞 */
  growth_was_clamped: boolean
  /** 交易成本(已从 total_profit_5yr 中扣除) */
  fees_aed: number
  reference_note?: string
  area_yield_pct?: number
  area_growth_pct?: number
}

export function clampGrowthPct(raw: number): { pct: number; clamped: boolean } {
  if (!Number.isFinite(raw)) return { pct: 0, clamped: false }
  const pct = Math.min(GROWTH_CLAMP_PCT.max, Math.max(GROWTH_CLAMP_PCT.min, raw))
  return { pct, clamped: pct !== raw }
}

/**
 * 5 年持有测算。返回 null = 不可信,调用方**不要**自己兜底编数字。
 *
 * @param price      买入价 (AED)
 * @param yieldPct   毛租金回报率 (%)
 * @param growthPct  年增值率 (%),内部会 clamp 到 GROWTH_CLAMP_PCT
 * @param opts.years 持有年限,默认 5(新增参数,保持三参调用向后兼容)
 */
export function calculateInvestment5yr(
  price: number,
  yieldPct: number,
  growthPct: number,
  opts?: { years?: number }
): Investment5yr | null {
  if (price <= 0 || (!yieldPct && !growthPct)) return null

  const years = opts?.years && opts.years > 0 ? opts.years : 5
  const { pct: growth, clamped } = clampGrowthPct(growthPct || 0)

  const totalRent = yieldPct ? price * yieldPct / 100 * years : 0
  const appreciation = price * (Math.pow(1 + growth / 100, years) - 1)
  const fees = price * TRANSACTION_FEE_PCT / 100
  const totalProfit = totalRent + appreciation - fees
  const annualizedReturn = (Math.pow((price + totalProfit) / price, 1 / years) - 1) * 100

  if (!Number.isFinite(annualizedReturn) || annualizedReturn > MAX_PLAUSIBLE_ANNUALIZED_PCT) {
    console.warn(
      '[investment-calculator] implausible result suppressed — upstream data is wrong.',
      JSON.stringify({
        price,
        yield_pct: yieldPct,
        growth_pct_raw: growthPct,
        growth_pct_used: growth,
        years,
        annualized_return_pct: annualizedReturn
      })
    )
    return null
  }

  return {
    purchase_price: price,
    rental_income_5yr: Math.round(totalRent),
    appreciation_5yr: Math.round(appreciation),
    total_profit_5yr: Math.round(totalProfit),
    annualized_return_pct: parseFloat(annualizedReturn.toFixed(1)),
    assumed_growth_pct: parseFloat(growth.toFixed(1)),
    growth_was_clamped: clamped,
    fees_aed: Math.round(fees)
  }
}

/**
 * 回本年限 = 100 / 毛租金回报率。
 *
 * ⚠️ **毛租金口径**:不扣物业费(service charge)、不扣空置期、不扣管理费,
 * 也不含增值。迪拜物业费通常吃掉 15-25% 的毛租金,真实回本年限比这个长。
 * 需要净口径请另算,别把这个数当净回报。
 */
export function calculatePaybackYears(yieldPct: number): number | null {
  if (!yieldPct || yieldPct <= 0) return null
  return Math.round(100 / yieldPct)
}
