/**
 * AI Areas API — endpoints consumed by voice tools and future AI features.
 * Mounted at /api/ai/areas
 */

import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { findAreaByName, findAreaWithCentroid, findAreasWithMetrics } from '../services/area-matcher'
import { calculateInvestment5yr } from '../services/investment-calculator'

const router = Router()

/**
 * GET /match — cascading name match + centroid for fly_to_area
 * Query: q (area name)
 */
router.get('/match', async (req: Request, res: Response) => {
  try {
    const name = String(req.query.q || '')
    if (!name) return res.json({ area: null })

    const area = await findAreaWithCentroid(pool, name)
    if (area) {
      res.json({ area: { id: area.id, name: area.name, lat: area.lat, lng: area.lng } })
    } else {
      res.json({ area: null })
    }
  } catch (error) {
    console.error('Error in AI area match:', error)
    res.json({ area: null })
  }
})

/**
 * GET /info — name match + metrics + investment in one call (replaces get_area_info)
 * Query: name
 */
router.get('/info', async (req: Request, res: Response) => {
  try {
    const areaName = String(req.query.name || '')
    if (!areaName) {
      return res.json({ area: null, metrics: null, nearby_benchmarks: [], investment_5yr: null, centroid: null, summary: 'No area name provided.' })
    }

    // Cascading area name match
    const area = await findAreaByName(pool, areaName, 'ST_AsGeoJSON(boundary) as boundary_geojson')

    // Get centroid for map fly-to
    const centroid = await findAreaWithCentroid(pool, areaName)

    // Get area metrics
    let metrics = null
    if (area) {
      const metricsResult = await pool.query(`
        SELECT
          da.name as area_name,
          dam.median_price_sqm,
          dam.rental_yield_pct,
          dam.price_growth_pct,
          dam.sales_transaction_count
        FROM dubai_area_rolling_metrics dam
        JOIN dubai_areas da ON da.id = dam.dubai_area_id
        WHERE da.id = $1
        ORDER BY dam.period_end_month DESC
        LIMIT 1
      `, [area.id])
      metrics = metricsResult.rows[0] || null
    }

    // Fallback: if area found but no metrics, get 3 nearest areas WITH metrics
    let nearby_benchmarks: any[] = []
    if (area && !metrics) {
      const nearbyResult = await pool.query(`
        SELECT
          da.name,
          dam.rental_yield_pct,
          dam.price_growth_pct,
          dam.median_price_sqm,
          dam.sales_transaction_count,
          ROUND(ST_Distance(
            da.boundary::geography,
            (SELECT boundary::geography FROM dubai_areas WHERE id = $1)
          )::numeric) as distance_m
        FROM dubai_areas da
        JOIN dubai_area_rolling_metrics dam ON da.id = dam.dubai_area_id
        WHERE da.id != $1
          AND dam.rental_yield_pct IS NOT NULL
          AND da.visible = true
        ORDER BY ST_Distance(
          da.boundary::geography,
          (SELECT boundary::geography FROM dubai_areas WHERE id = $1)
        )
        LIMIT 3
      `, [area.id])
      nearby_benchmarks = nearbyResult.rows
    }

    // Compute 5-year projection (median_price_sqm * 75sqm as reference)
    let investment_5yr = null
    if (metrics) {
      const refPrice = parseFloat(metrics.median_price_sqm) * 75
      const yieldVal = parseFloat(metrics.rental_yield_pct) || 0
      const growthVal = parseFloat(metrics.price_growth_pct) || 0
      investment_5yr = calculateInvestment5yr(refPrice, yieldVal, growthVal)
      if (investment_5yr) {
        investment_5yr.reference_note = 'Based on area median price x 75sqm (typical 1BR)'
      }
    }

    // Build summary
    let summary = ''
    if (metrics) {
      const yieldPct = parseFloat(metrics.rental_yield_pct)?.toFixed(1) || 'N/A'
      const growthPct = parseFloat(metrics.price_growth_pct)?.toFixed(1) || 'N/A'
      summary = `${area.name}: Rental yield ${yieldPct}%, growth ${growthPct}%, ${metrics.sales_transaction_count || 0} transactions.`
      if (investment_5yr) {
        summary += ` 5-year projection (based on ${Math.round(investment_5yr.purchase_price / 10000)}万 reference): ${Math.round(investment_5yr.rental_income_5yr / 10000)}万 rent + ${Math.round(investment_5yr.appreciation_5yr / 10000)}万 appreciation = ${Math.round(investment_5yr.total_profit_5yr / 10000)}万 total profit, annualized ${investment_5yr.annualized_return_pct}%.`
      }
    } else if (area && nearby_benchmarks.length > 0) {
      const benchList = nearby_benchmarks.map(b =>
        `${b.name} (yield ${parseFloat(b.rental_yield_pct).toFixed(1)}%, ${Math.round(b.distance_m)}m away)`
      ).join('; ')
      summary = `${area.name} has no transaction data yet. Nearby benchmarks: ${benchList}.`
    } else if (area) {
      summary = `${area.name}: ${area.description || 'A popular area in Dubai.'}`
    } else {
      summary = `Could not find information about ${areaName}.`
    }

    res.json({
      area,
      metrics,
      nearby_benchmarks,
      investment_5yr,
      centroid: centroid ? { lat: centroid.lat, lng: centroid.lng } : null,
      summary
    })
  } catch (error) {
    console.error('Error in AI area info:', error)
    res.json({ area: null, metrics: null, nearby_benchmarks: [], investment_5yr: null, centroid: null, summary: `Error getting information about ${req.query.name}.` })
  }
})

/**
 * GET /compare — compare two areas with metrics
 * Query: area1, area2
 */
router.get('/compare', async (req: Request, res: Response) => {
  try {
    const area1 = String(req.query.area1 || '')
    const area2 = String(req.query.area2 || '')
    if (!area1 || !area2) {
      return res.json({ comparison: null, summary: 'Two area names required.' })
    }

    const areas = await findAreasWithMetrics(pool, area1, area2)
    if (areas.length < 2) {
      return res.json({
        comparison: null,
        summary: `Could not find metrics for both areas. Found: ${areas.map(a => a.area_name).join(', ')}`
      })
    }

    const [a, b] = areas
    const aYield = parseFloat(a.rental_yield_pct) || 0
    const bYield = parseFloat(b.rental_yield_pct) || 0
    const aGrowth = parseFloat(a.price_growth_pct) || 0
    const bGrowth = parseFloat(b.price_growth_pct) || 0

    const summary = `${a.area_name} vs ${b.area_name}: Yield ${aYield.toFixed(1)}% vs ${bYield.toFixed(1)}%, Growth ${aGrowth.toFixed(1)}% vs ${bGrowth.toFixed(1)}%. ${aYield > bYield ? a.area_name : b.area_name} has better yield.`

    res.json({
      comparison: { area1: a, area2: b },
      summary
    })
  } catch (error) {
    console.error('Error in AI area compare:', error)
    res.json({ comparison: null, summary: 'Error comparing areas.' })
  }
})

export default router
