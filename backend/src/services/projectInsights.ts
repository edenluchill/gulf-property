/**
 * Project insights — investment + location intelligence for the detail page.
 *
 * The data was already computed in ai-projects.ts (voice tool) but never surfaced
 * on the project page. This service centralises it so the page can show: 5yr ROI,
 * rental yield / price growth, payback, nearby POIs/metro/landmarks, commute
 * estimates, and the area market context. Pure-ish (only reads the DB).
 *
 * See docs/project-detail-redesign-spec.md §2.
 */
import pool from '../db/pool'
import { calculateInvestment5yr, calculatePaybackYears, Investment5yr } from './investment-calculator'

// Key Dubai hubs for rough commute estimates (lng, lat).
const HUBS: { hub: string; lng: number; lat: number }[] = [
  { hub: 'Downtown', lng: 55.2744, lat: 25.1972 },
  { hub: 'DIFC', lng: 55.2796, lat: 25.211 },
  { hub: 'Dubai Marina', lng: 55.1403, lat: 25.0805 },
  { hub: 'DXB Airport', lng: 55.3644, lat: 25.2532 },
]

export interface ProjectInsights {
  area: {
    name: string | null
    median_price_sqm: number | null
    rental_yield_pct: number | null
    price_growth_pct: number | null
    sales_transaction_count: number | null
    data_through: string | null
  } | null
  investment: (Investment5yr & { payback_years: number | null; reference_price: number }) | null
  nearby: {
    metro: { name: string; distance_m: number }[]
    pois: { category: string; name: string; distance_m: number }[]
    landmarks: { name: string; type: string; distance_m: number }[]
  }
  commute: { hub: string; distance_m: number; mins_est: number }[]
}

/** Straight-line metres → rough driving minutes (1.4× detour, ~45 km/h). */
function minsEstimate(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * 1.4) / 1000 / 45 * 60))
}

export async function getProjectInsights(projectId: string): Promise<ProjectInsights | null> {
  const projRes = await pool.query(
    `SELECT id, area, latitude, longitude, min_price, starting_price
       FROM residential_projects WHERE id = $1`,
    [projectId]
  )
  if (projRes.rows.length === 0) return null
  const p = projRes.rows[0]

  // Reference price: cheapest unit, else starting/min price.
  const unitPriceRes = await pool.query(
    `SELECT MIN(price) AS min_price FROM project_unit_types WHERE project_id = $1 AND price > 0`,
    [projectId]
  )
  const refPrice =
    Number(unitPriceRes.rows[0]?.min_price) ||
    Number(p.starting_price) ||
    Number(p.min_price) ||
    0

  // Area market metrics (latest rolling window for the project's area).
  let area: ProjectInsights['area'] = null
  let yieldPct = 0
  let growthPct = 0
  if (p.area) {
    const m = await pool.query(
      `SELECT da.name AS area_name, dam.rental_yield_pct, dam.price_growth_pct,
              dam.median_price_sqm, dam.sales_transaction_count,
              to_char(dam.period_end_month, 'YYYY-MM-DD') AS period_end_month
         FROM dubai_area_rolling_metrics dam
         JOIN dubai_areas da ON da.id = dam.dubai_area_id
        WHERE LOWER(da.name) = LOWER($1)
           OR REPLACE(LOWER(da.name), ' ', '') = REPLACE(LOWER($1), ' ', '')
        ORDER BY dam.period_end_month DESC
        LIMIT 1`,
      [p.area]
    )
    if (m.rows[0]) {
      const r = m.rows[0]
      yieldPct = parseFloat(r.rental_yield_pct) || 0
      growthPct = parseFloat(r.price_growth_pct) || 0
      area = {
        name: r.area_name,
        median_price_sqm: r.median_price_sqm != null ? parseFloat(r.median_price_sqm) : null,
        rental_yield_pct: yieldPct || null,
        price_growth_pct: growthPct || null,
        sales_transaction_count: r.sales_transaction_count != null ? Number(r.sales_transaction_count) : null,
        data_through: r.period_end_month || null,
      }
    }
  }

  // 5yr investment projection from the reference price + area yield/growth.
  let investment: ProjectInsights['investment'] = null
  const inv = calculateInvestment5yr(refPrice, yieldPct, growthPct)
  if (inv) {
    investment = {
      ...inv,
      area_yield_pct: yieldPct,
      area_growth_pct: growthPct,
      payback_years: calculatePaybackYears(yieldPct),
      reference_price: refPrice,
    }
  }

  // Nearby POIs / landmarks / metro + commute (needs coordinates).
  const nearby: ProjectInsights['nearby'] = { metro: [], pois: [], landmarks: [] }
  const commute: ProjectInsights['commute'] = []
  if (p.latitude && p.longitude) {
    const lng = parseFloat(p.longitude)
    const lat = parseFloat(p.latitude)
    try {
      const [poisRes, landmarkRes] = await Promise.all([
        pool.query(
          `SELECT DISTINCT ON (category) category, name,
                  ROUND(ST_Distance(location::geography, ST_SetSRID(ST_Point($1,$2),4326)::geography)::numeric) AS distance_m
             FROM dubai_pois
            WHERE category IN ('metro_station','hospital','school','university','mall','supermarket','park','beach','gym')
            ORDER BY category, location <-> ST_SetSRID(ST_Point($1,$2),4326)`,
          [lng, lat]
        ),
        pool.query(
          `SELECT name, landmark_type,
                  ROUND(ST_Distance(location::geography, ST_SetSRID(ST_Point($1,$2),4326)::geography)::numeric) AS distance_m
             FROM dubai_landmarks WHERE visible = true
            ORDER BY location <-> ST_SetSRID(ST_Point($1,$2),4326)
            LIMIT 6`,
          [lng, lat]
        ),
      ])
      for (const r of poisRes.rows) {
        const item = { category: r.category, name: r.name, distance_m: Number(r.distance_m) }
        if (r.category === 'metro_station') nearby.metro.push({ name: r.name, distance_m: item.distance_m })
        else nearby.pois.push(item)
      }
      nearby.landmarks = landmarkRes.rows.map((r) => ({
        name: r.name,
        type: r.landmark_type,
        distance_m: Number(r.distance_m),
      }))
    } catch {
      /* geo optional — leave empty */
    }

    // Commute estimates to key hubs (straight-line → rough minutes).
    try {
      const hubRows = HUBS.map((h) => `SELECT '${h.hub}' AS hub, ${h.lng} AS lng, ${h.lat} AS lat`).join(' UNION ALL ')
      const dRes = await pool.query(
        `SELECT hub, ROUND(ST_Distance(
                  ST_SetSRID(ST_Point(lng,lat),4326)::geography,
                  ST_SetSRID(ST_Point($1,$2),4326)::geography)::numeric) AS distance_m
           FROM (${hubRows}) hubs`,
        [lng, lat]
      )
      for (const r of dRes.rows) {
        const dm = Number(r.distance_m)
        commute.push({ hub: r.hub, distance_m: dm, mins_est: minsEstimate(dm) })
      }
      commute.sort((a, b) => a.mins_est - b.mins_est)
    } catch {
      /* commute optional */
    }
  }

  return { area, investment, nearby, commute }
}
