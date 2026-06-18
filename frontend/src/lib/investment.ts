/**
 * Per-unit 5-year investment estimate — client-side mirror of the backend
 * services/investment-calculator.ts, so each unit's ROI can be computed from its
 * own price + the area's yield/growth without an extra round-trip.
 */
export interface UnitReturns {
  rental_income_5yr: number
  appreciation_5yr: number
  total_profit_5yr: number
  annualized_return_pct: number
}

export function calcInvestment5yr(price: number, yieldPct: number, growthPct: number): UnitReturns | null {
  if (price <= 0 || (!yieldPct && !growthPct)) return null
  const totalRent = yieldPct ? (price * yieldPct) / 100 * 5 : 0
  const appreciation = growthPct ? price * (Math.pow(1 + growthPct / 100, 5) - 1) : 0
  const profit = totalRent + appreciation
  const annualized = (Math.pow((price + profit) / price, 1 / 5) - 1) * 100
  return {
    rental_income_5yr: Math.round(totalRent),
    appreciation_5yr: Math.round(appreciation),
    total_profit_5yr: Math.round(profit),
    annualized_return_pct: parseFloat(annualized.toFixed(1)),
  }
}

export function paybackYears(yieldPct: number): number | null {
  return yieldPct > 0 ? Math.round(100 / yieldPct) : null
}
