/**
 * Investment Calculator — pure functions, no DB dependency.
 * Extracted from voice-assistant-tools.ts where it was duplicated 3×.
 */

export interface Investment5yr {
  purchase_price: number
  rental_income_5yr: number
  appreciation_5yr: number
  total_profit_5yr: number
  annualized_return_pct: number
  reference_note?: string
  area_yield_pct?: number
  area_growth_pct?: number
}

export function calculateInvestment5yr(
  price: number,
  yieldPct: number,
  growthPct: number
): Investment5yr | null {
  if (price <= 0 || (!yieldPct && !growthPct)) return null

  const totalRent5yr = yieldPct ? price * yieldPct / 100 * 5 : 0
  const appreciation5yr = growthPct ? price * (Math.pow(1 + growthPct / 100, 5) - 1) : 0
  const totalProfit5yr = totalRent5yr + appreciation5yr
  const annualizedReturn = price > 0
    ? (Math.pow((price + totalProfit5yr) / price, 1 / 5) - 1) * 100
    : 0

  return {
    purchase_price: price,
    rental_income_5yr: Math.round(totalRent5yr),
    appreciation_5yr: Math.round(appreciation5yr),
    total_profit_5yr: Math.round(totalProfit5yr),
    annualized_return_pct: parseFloat(annualizedReturn.toFixed(1))
  }
}

export function calculatePaybackYears(yieldPct: number): number | null {
  if (!yieldPct || yieldPct <= 0) return null
  return Math.round(100 / yieldPct)
}
