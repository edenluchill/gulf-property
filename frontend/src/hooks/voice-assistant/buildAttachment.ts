/**
 * buildBubbleAttachment — pure tool-result → bubble attachment mapping.
 *
 * Extracted VERBATIM from VoiceAssistantContext.executeTool so voice and text share
 * ONE mapping (zero drift, identical cards). The voice path calls this and behaves
 * exactly as before; the text-mode agent calls it per step. Side effects (map
 * navigation, timers) stay in the callers — this function is pure.
 *
 * `params` is optional and only used for the get_area_info name fallback (present on
 * the voice path, absent for text where the model already sends canonical names).
 */
import { MessageAttachment } from './types'

export function buildBubbleAttachment(
  toolName: string,
  result: any,
  params?: any
): MessageAttachment | null {
  if (!result) return null

  if (toolName === 'search_projects' && result.projects?.length > 0) {
    return {
      type: 'projects',
      projects: result.projects.map((p: any) => ({
        id: p.id,
        name: p.project_name,
        developer: p.developer,
        area: p.area,
        minPrice: p.min_price ? parseFloat(p.min_price) : undefined,
        maxPrice: p.max_price ? parseFloat(p.max_price) : undefined,
        image: p.primary_image,
        status: p.status,
        rentalYield: p.rental_yield_pct,
        priceGrowth: p.price_growth_pct,
        unitTypes: (p.unit_types_in_budget || []).map((u: any) => ({
          category: u.category,
          bedrooms: u.bedrooms,
          minPrice: u.min_price,
          maxPrice: u.max_price,
          minAreaSqft: u.min_area_sqft,
          sampleFloorPlan: u.sample_floor_plan
        }))
      }))
    }
  }

  if (toolName === 'navigate_to_project' && result?.projectId) {
    // Show project with unit types + investment chart
    return {
      type: 'projects',
      projects: [{
        id: result.projectId,
        name: result.projectName,
        developer: result.developer,
        area: result.area || '',
        minPrice: result.minPrice ? parseFloat(result.minPrice) : undefined,
        maxPrice: result.maxPrice ? parseFloat(result.maxPrice) : undefined,
        image: result.image,
        status: result.status,
        unitTypes: (result.unitTypes || []).map((u: any) => ({
          category: u.category,
          bedrooms: u.bedrooms,
          minPrice: u.price,
          maxPrice: u.price,
          minAreaSqft: u.area_sqft
        }))
      }],
      investment: result.investment_5yr ? {
        projectName: result.projectName,
        purchasePrice: result.investment_5yr.purchase_price,
        rentalIncome5yr: result.investment_5yr.rental_income_5yr,
        appreciation5yr: result.investment_5yr.appreciation_5yr,
        totalProfit5yr: result.investment_5yr.total_profit_5yr,
        annualizedReturnPct: result.investment_5yr.annualized_return_pct,
        growthPct: result.investment_5yr.area_growth_pct || 0
      } : undefined
    }
  }

  if (toolName === 'get_area_info') {
    if (result.metrics) {
      // Area has direct metrics
      return {
        type: 'area_info',
        areaInfo: {
          name: result.metrics.area_name || params?.area_name,
          rentalYield: result.metrics.rental_yield_pct,
          priceGrowth: result.metrics.price_growth_pct,
          transactionCount: result.metrics.sales_transaction_count,
          medianPrice: result.metrics.median_price_sqm
        }
      }
    }
    if (result.nearby_benchmarks?.length > 0) {
      // No direct metrics — use best nearby benchmark as reference
      const best = result.nearby_benchmarks[0]
      return {
        type: 'area_info',
        areaInfo: {
          name: `${result.area?.name || params?.area_name} (≈${best.name})`,
          rentalYield: best.rental_yield_pct ? parseFloat(best.rental_yield_pct) : undefined,
          priceGrowth: best.price_growth_pct ? parseFloat(best.price_growth_pct) : undefined,
          transactionCount: best.sales_transaction_count,
          medianPrice: best.median_price_sqm ? parseFloat(best.median_price_sqm) : undefined
        }
      }
    }
    return null
  }

  if (toolName === 'compare_areas' && result.area1 && result.area2) {
    return {
      type: 'comparison',
      comparison: {
        area1: {
          name: result.area1.area_name,
          rentalYield: result.area1.rental_yield_pct,
          priceGrowth: result.area1.price_growth_pct,
          transactionCount: result.area1.sales_transaction_count
        },
        area2: {
          name: result.area2.area_name,
          rentalYield: result.area2.rental_yield_pct,
          priceGrowth: result.area2.price_growth_pct,
          transactionCount: result.area2.sales_transaction_count
        }
      }
    }
  }

  return null
}
