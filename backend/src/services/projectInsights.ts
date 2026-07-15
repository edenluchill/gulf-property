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
import { cached, prime, invalidate } from './microCache'

// Key Dubai hubs for rough commute estimates (lng, lat).
const HUBS: { hub: string; lng: number; lat: number }[] = [
  { hub: 'Downtown', lng: 55.2744, lat: 25.1972 },
  { hub: 'DIFC', lng: 55.2796, lat: 25.211 },
  { hub: 'Dubai Marina', lng: 55.1403, lat: 25.0805 },
  { hub: 'DXB Airport', lng: 55.3644, lat: 25.2532 },
]

/** One driver of the project↔area yield gap. `est_pp` sums across factors to
 *  the measured gap (price + rent decomposition is exact); qualitative notes
 *  (e.g. offplan) carry est_pp = null. */
export interface YieldFactor {
  key: 'price' | 'rent' | 'offplan'
  dir: 'up' | 'down' | 'flat'   // effect on the project's yield vs area
  label: string                 // headline chip, e.g. '溢价 12%'
  detail: string                // one honest clause of explanation
  est_pp: number | null         // contribution in percentage points (signed)
}

export interface YieldComparison {
  // 'measured'       — development has its own rentals → real project yield, full
  //                    price×rent split.
  // 'price_adjusted' — development has sales but no settled rentals yet (the common
  //                    new-launch case) → project yield ESTIMATED at area rents from
  //                    the project's own sale price. Isolates the premium's drag on
  //                    yield — the number a buyer of a new project actually needs.
  basis: 'measured' | 'price_adjusted'
  estimated: boolean            // true ⇢ project_yield_pct is an estimate (label it)
  project_yield_pct: number     // measured dev yield, or price-adjusted estimate
  area_yield_pct: number        // surrounding community baseline
  gap_pp: number                // project − area, 1 decimal (signed)
  verdict: 'above' | 'inline' | 'below'
  premium_pct: number | null    // dev median price/㎡ vs area median (signed %)
  tier: 'development'           // only computed at the tightest tier
  confidence: 'high' | 'medium' | 'low'
  sample_n: number | null       // development sales count behind the price
  data_through: string | null
  factors: YieldFactor[]
}

export interface ProjectInsights {
  area: {
    id: string | null
    name: string | null
    median_price_sqm: number | null
    rental_yield_pct: number | null
    price_growth_pct: number | null
    sales_transaction_count: number | null
    data_through: string | null
    // Matching precision (see development-metrics.sql + the matching report):
    // 'development' = master_project (tightest), 'area' = spatially-resolved
    // official community, 'area_name' = legacy dirty-string fallback.
    tier: 'development' | 'area' | 'area_name'
    label: string | null            // the unit the numbers describe (dev or area name)
    confidence: 'high' | 'medium' | 'low'
    rent_count: number | null
  } | null
  investment: (Investment5yr & { payback_years: number | null; reference_price: number }) | null
  // Project (development) rental yield vs its surrounding community, with an
  // EXACT price×rent decomposition of the gap. Only present when we have a
  // genuine development-level yield distinct from the area baseline (tier 1 with
  // its own rentals); null otherwise (project too new → we only know the area).
  yield_comparison: YieldComparison | null
  nearby: {
    metro: { name: string; distance_m: number; lat?: number; lng?: number }[]
    pois: { category: string; name: string; distance_m: number; lat?: number; lng?: number; khda_rating?: string; description_zh?: string }[]
    landmarks: { name: string; type: string; distance_m: number; lat?: number; lng?: number }[]
  }
  commute: { hub: string; distance_m: number; mins_est: number }[]
}

/** Straight-line metres → rough driving minutes (1.4× detour, ~45 km/h). */
function minsEstimate(distanceM: number): number {
  return Math.max(1, Math.round((distanceM * 1.4) / 1000 / 45 * 60))
}

/**
 * Compare a development's rental yield to its community, decomposed by the two
 * levers of yield (= rent/㎡ ÷ price/㎡):
 *
 *  • 'measured'       — the development has its own settled rentals. Real project
 *                       yield; EXACT price×rent split (holding rent at area level
 *                       isolates the price contribution, the residual is rent
 *                       level). price_pp + rent_pp == gap by construction.
 *  • 'price_adjusted' — sales but no settled rentals yet (the common new-launch
 *                       case). Yield ESTIMATED at area rents from the project's
 *                       OWN sale price, so the whole gap is the premium's drag —
 *                       exactly what a new-project buyer needs. Rent is flagged as
 *                       assumed, not measured.
 *
 * Needs both prices (dev + area median/㎡). Returns null when it can't produce a
 * meaningful, honest comparison.
 */
function buildYieldComparison(args: {
  rawDevYield: number | null    // development's own yield, or null (borrowed)
  areaYield: number
  devPsm: number | null
  areaPsm: number | null
  offplan: boolean
  confidence: 'high' | 'medium' | 'low'
  sampleN: number | null
  dataThrough: string | null
}): YieldComparison | null {
  const { rawDevYield, areaYield, devPsm, areaPsm, offplan } = args
  const round1 = (n: number) => Math.round(n * 10) / 10
  const havePrices = devPsm != null && areaPsm != null && devPsm > 0 && areaPsm > 0
  if (!havePrices && rawDevYield == null) return null // nothing project-specific to say

  const premiumPct = havePrices ? ((devPsm! - areaPsm!) / areaPsm!) * 100 : null
  const factors: YieldFactor[] = []

  // Round the two headline yields FIRST, then derive gap and factor pp from the
  // rounded numbers — so "4.4% vs 5.2% ⇒ gap −0.8pp" and "price + rent == gap"
  // always reconcile on screen (independent rounding drifted 0.1 apart).
  const basis: YieldComparison['basis'] = rawDevYield != null ? 'measured' : 'price_adjusted'
  const projectYield =
    rawDevYield != null ? round1(rawDevYield) : round1(areaYield * (areaPsm! / devPsm!))
  const areaY = round1(areaYield)
  const gap = round1(projectYield - areaY)
  const prem = premiumPct ?? 0

  if (basis === 'measured' && havePrices) {
    // Exact split: price effect from the price ratio, rent as the residual so the
    // two sum to the displayed gap.
    const priceOnlyYield = areaYield * (areaPsm! / devPsm!)
    const pricePp = round1(priceOnlyYield - areaYield)
    const rentPp = round1(gap - pricePp)
    factors.push({
      key: 'price',
      dir: pricePp >= 0 ? 'up' : 'down',
      label: prem >= 0 ? `溢价 ${Math.round(prem)}%` : `折价 ${Math.round(-prem)}%`,
      detail: prem >= 0 ? '成交价高于区域中位，摊薄回报' : '成交价低于区域中位，抬升回报',
      est_pp: pricePp,
    })
    factors.push({
      key: 'rent',
      dir: rentPp >= 0 ? 'up' : 'down',
      label: rentPp >= 0 ? '租金高于区域' : '租金低于区域',
      detail:
        rentPp >= 0
          ? '本开发体新签租金/㎡ 高于区域，多因户型偏小、楼龄或精装'
          : '本开发体新签租金/㎡ 低于区域，多因大户型占比高或楼龄',
      est_pp: rentPp,
    })
  } else if (basis === 'price_adjusted') {
    // Buy at this project's price, rent at area rates → the whole gap is price.
    factors.push({
      key: 'price',
      dir: gap >= 0 ? 'up' : 'down',
      label: prem >= 0 ? `溢价 ${Math.round(prem)}%` : `折价 ${Math.round(-prem)}%`,
      detail:
        prem >= 0
          ? '成交价高于区域中位，同等租金下摊薄回报'
          : '成交价低于区域中位，同等租金下抬升回报',
      est_pp: gap,
    })
    factors.push({
      key: 'rent',
      dir: 'flat',
      label: '租金按区域估算',
      detail: '本开发体暂无稳定租赁记录，租金以区域水平估算；若实际跑赢区域，回报会更高',
      est_pp: null,
    })
  }

  const verdict: YieldComparison['verdict'] = gap > 0.3 ? 'above' : gap < -0.3 ? 'below' : 'inline'

  if (offplan) {
    factors.push({
      key: 'offplan',
      dir: 'flat',
      label: '期房阶段',
      detail: '尚未交付，回报为持有期估算',
      est_pp: null,
    })
  }

  // Dominant (largest |pp|) driver first; qualitative notes fall to the end.
  factors.sort((a, b) => Math.abs(b.est_pp ?? -1) - Math.abs(a.est_pp ?? -1))

  return {
    basis,
    estimated: basis === 'price_adjusted',
    project_yield_pct: projectYield,
    area_yield_pct: areaY,
    gap_pp: gap,
    verdict,
    premium_pct: premiumPct != null ? round1(premiumPct) : null,
    tier: 'development',
    confidence: args.confidence,
    sample_n: args.sampleN,
    data_through: args.dataThrough,
    factors,
  }
}

// 缓存:构建一次要 ~8.5s(resolve_project_development ~1.3s + get_development_metrics
// ~7.1s,DLD 全表聚合)。2026-07-07 生产实测该端点 avg 7.8s / p95 15s,是 HIGH_LATENCY
// 报警的主源。项目只有 ~21 个且底层是周更快照 → 进程内缓存 + 定时预热(见
// routes/project-insights.ts 的 warm loop),用户请求永远打热缓存。
const INSIGHTS_TTL_MS = 7 * 60 * 60 * 1000 // 预热每 6h 一轮,7h TTL 让热度无缝衔接

export async function getProjectInsights(projectId: string): Promise<ProjectInsights | null> {
  return cached(`proj-insights:${projectId}`, INSIGHTS_TTL_MS, () => buildProjectInsights(projectId))
}

/** 强制重建并原子换入两份缓存(insights + transactions)。预热器/项目编辑后调用。 */
export async function refreshProjectInsightsCache(projectId: string): Promise<void> {
  const data = await buildProjectInsights(projectId)
  prime(`proj-insights:${projectId}`, data)
  projTxCache.delete(projectId)
  await getProjectTransactions(projectId) // 重建自身缓存
}

/** 项目数据被编辑时让缓存立即失效(下一个请求走冷加载拿到新数据)。 */
export function invalidateProjectInsights(projectId: string): void {
  invalidate(`proj-insights:${projectId}`)
  projTxCache.delete(projectId)
}

async function buildProjectInsights(projectId: string): Promise<ProjectInsights | null> {
  const projRes = await pool.query(
    `SELECT id, project_name, area, latitude, longitude, min_price, starting_price, status
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

  // ── Precise market metrics, tightest tier first ─────────────────────────
  //   1. development (master_project)  — the precise unit, beats the area blend
  //   2. area (spatially-resolved official community via ST_Covers)
  //   3. area_name (legacy dirty-string match) — last resort
  // See development-metrics.sql + docs/reports/2026-06-24-...matching-accuracy.md
  const lng = p.longitude != null ? parseFloat(p.longitude) : null
  const lat = p.latitude != null ? parseFloat(p.latitude) : null
  const titleCase = (s: string) =>
    s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

  let area: ProjectInsights['area'] = null
  let yieldPct = 0
  let growthPct = 0
  // Development-level figures kept RAW (before any area fallback), so we can tell
  // a genuine development yield apart from a borrowed one and decompose the gap.
  let rawDevYield: number | null = null
  let devMedianPsm: number | null = null
  let devSalesCount: number | null = null

  // Resolve project → DLD development (master_project) + official area_id.
  let resolvedMaster: string | null = null
  let resolvedAreaId: number | null = null
  let resolverSim = 0
  try {
    const rr = await pool.query(
      `SELECT master_project, area_id, similarity FROM resolve_project_development($1, $2, $3)`,
      [p.project_name || p.area || '', lng, lat]
    )
    if (rr.rows[0]) {
      resolvedMaster = rr.rows[0].master_project
      resolvedAreaId = rr.rows[0].area_id != null ? Number(rr.rows[0].area_id) : null
      resolverSim = parseFloat(rr.rows[0].similarity) || 0
    }
  } catch { /* resolver optional */ }

  // Spatial-area rolling metrics for the resolved official community. Computed
  // once; serves as tier 2 AND as the yield/growth fallback for a brand-new
  // development that has no rentals / price history of its own yet.
  let areaMetrics: {
    area_id: string | null; name: string | null; yield: number | null
    growth: number | null; median_psm: number | null; sales: number | null; thru: string | null
  } | null = null
  if (resolvedAreaId != null) {
    const am = await pool.query(
      `SELECT da.id AS area_id, da.name AS area_name, dam.rental_yield_pct, dam.price_growth_pct,
              dam.median_price_sqm, dam.sales_transaction_count,
              to_char(dam.period_end_month, 'YYYY-MM-DD') AS period_end_month
         FROM dld_areas dla
         JOIN dubai_areas da ON da.id = dla.dubai_area_id
         JOIN dubai_area_rolling_metrics dam ON dam.dubai_area_id = da.id
        WHERE dla.area_id = $1
          -- yield/growth only live on the residential 'all' row (offplan/commercial
          -- rows carry null yield); without this filter LIMIT 1 grabs an arbitrary
          -- same-month row and returns null yield → the comparison silently vanishes.
          AND dam.usage = 'residential' AND dam.segment = 'all'
        ORDER BY dam.period_end_month DESC LIMIT 1`,
      [resolvedAreaId]
    )
    if (am.rows[0]) {
      const r = am.rows[0]
      areaMetrics = {
        area_id: r.area_id != null ? String(r.area_id) : null,
        name: r.area_name,
        yield: r.rental_yield_pct != null ? parseFloat(r.rental_yield_pct) : null,
        growth: r.price_growth_pct != null ? parseFloat(r.price_growth_pct) : null,
        median_psm: r.median_price_sqm != null ? parseFloat(r.median_price_sqm) : null,
        sales: r.sales_transaction_count != null ? Number(r.sales_transaction_count) : null,
        thru: r.period_end_month || null,
      }
    }
  }

  // Tier 1: development metrics (good name match + enough sample). Sale median is
  // the development's own; yield/growth borrow the area when the development is
  // too new to have them (e.g. offplan with no leases yet).
  if (resolvedMaster && resolvedAreaId != null && resolverSim >= 0.45) {
    try {
      const dr = await pool.query(`SELECT * FROM get_development_metrics($1, $2)`, [resolvedMaster, resolvedAreaId])
      const d = dr.rows[0]
      if (d && Number(d.sales_count) >= 30) {
        const devYield = d.rental_yield_pct != null ? parseFloat(d.rental_yield_pct) : null
        const devGrowth = d.price_growth_pct != null ? parseFloat(d.price_growth_pct) : null
        rawDevYield = devYield
        devMedianPsm = d.median_price_sqm != null ? parseFloat(d.median_price_sqm) : null
        devSalesCount = d.sales_count != null ? Number(d.sales_count) : null
        yieldPct = devYield ?? areaMetrics?.yield ?? 0
        growthPct = devGrowth ?? areaMetrics?.growth ?? 0
        area = {
          // area.id is consumed by the frontend to call /market/area-insights,
          // which keys on the dubai_areas UUID — NOT the DLD integer area_id.
          // Emit the UUID (from areaMetrics, resolved off the same area_id); fall
          // back to null when the area has no rolling metrics so the client simply
          // skips the area-insights fetch instead of 500-ing on a bad UUID cast.
          id: areaMetrics?.area_id ?? null,
          name: titleCase(resolvedMaster),
          median_price_sqm: d.median_price_sqm != null ? parseFloat(d.median_price_sqm) : null,
          rental_yield_pct: yieldPct || null,
          price_growth_pct: growthPct || null,
          sales_transaction_count: d.sales_count != null ? Number(d.sales_count) : null,
          data_through: d.data_through ? new Date(d.data_through).toISOString().slice(0, 10) : null,
          tier: 'development',
          label: titleCase(resolvedMaster),
          confidence: resolverSim >= 0.7 ? 'high' : 'medium',
          rent_count: d.rent_count != null ? Number(d.rent_count) : null,
        }
      }
    } catch { /* dev metrics optional → fall through */ }
  }

  // Tier 2: spatially-resolved official area (correct community, by area_id).
  if (!area && areaMetrics) {
    yieldPct = areaMetrics.yield ?? 0
    growthPct = areaMetrics.growth ?? 0
    area = {
      id: areaMetrics.area_id,
      name: areaMetrics.name,
      median_price_sqm: areaMetrics.median_psm,
      rental_yield_pct: areaMetrics.yield,
      price_growth_pct: areaMetrics.growth,
      sales_transaction_count: areaMetrics.sales,
      data_through: areaMetrics.thru,
      tier: 'area',
      label: areaMetrics.name,
      confidence: 'medium',
      rent_count: null,
    }
  }

  // Tier 3: legacy dirty-string area match (last resort).
  if (!area && p.area) {
    const m = await pool.query(
      `SELECT da.id AS area_id, da.name AS area_name, dam.rental_yield_pct, dam.price_growth_pct,
              dam.median_price_sqm, dam.sales_transaction_count,
              to_char(dam.period_end_month, 'YYYY-MM-DD') AS period_end_month
         FROM dubai_area_rolling_metrics dam
         JOIN dubai_areas da ON da.id = dam.dubai_area_id
        WHERE (LOWER(da.name) = LOWER($1)
           OR REPLACE(LOWER(da.name), ' ', '') = REPLACE(LOWER($1), ' ', ''))
          AND dam.usage = 'residential' AND dam.segment = 'all'
        ORDER BY dam.period_end_month DESC
        LIMIT 1`,
      [p.area]
    )
    if (m.rows[0]) {
      const r = m.rows[0]
      yieldPct = parseFloat(r.rental_yield_pct) || 0
      growthPct = parseFloat(r.price_growth_pct) || 0
      area = {
        id: r.area_id != null ? String(r.area_id) : null,
        name: r.area_name,
        median_price_sqm: r.median_price_sqm != null ? parseFloat(r.median_price_sqm) : null,
        rental_yield_pct: yieldPct || null,
        price_growth_pct: growthPct || null,
        sales_transaction_count: r.sales_transaction_count != null ? Number(r.sales_transaction_count) : null,
        data_through: r.period_end_month || null,
        tier: 'area_name',
        label: r.area_name,
        confidence: 'low',
        rent_count: null,
      }
    }
  }

  // Project (development) yield vs its community. Fires when we matched a
  // development (tier 1) with an area baseline yield: 'measured' if the dev has
  // its own rentals, else a 'price_adjusted' estimate from the dev's own sale
  // price. Returns null when there's nothing project-specific to compare.
  let yield_comparison: YieldComparison | null = null
  if (area?.tier === 'development' && areaMetrics?.yield != null) {
    yield_comparison = buildYieldComparison({
      rawDevYield,
      areaYield: areaMetrics.yield,
      devPsm: devMedianPsm,
      areaPsm: areaMetrics.median_psm,
      offplan: p.status === 'upcoming' || p.status === 'under-construction',
      confidence: area.confidence,
      sampleN: devSalesCount,
      dataThrough: area.data_through,
    })
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
          `SELECT DISTINCT ON (dp.category) dp.category, dp.name,
                  ST_X(dp.location::geometry) AS lng, ST_Y(dp.location::geometry) AS lat,
                  ROUND(ST_Distance(dp.location::geography, ST_SetSRID(ST_Point($1,$2),4326)::geography)::numeric) AS distance_m,
                  e.khda_rating, e.description_zh
             FROM dubai_pois dp
             LEFT JOIN dubai_poi_enrichment e ON e.poi_id = dp.id
            WHERE dp.category IN ('metro_station','hospital','school','university','mall','supermarket','park','beach','gym')
            ORDER BY dp.category, dp.location <-> ST_SetSRID(ST_Point($1,$2),4326)`,
          [lng, lat]
        ),
        pool.query(
          `SELECT name, landmark_type,
                  ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat,
                  ROUND(ST_Distance(location::geography, ST_SetSRID(ST_Point($1,$2),4326)::geography)::numeric) AS distance_m
             FROM dubai_landmarks WHERE visible = true
            ORDER BY location <-> ST_SetSRID(ST_Point($1,$2),4326)
            LIMIT 6`,
          [lng, lat]
        ),
      ])
      for (const r of poisRes.rows) {
        const ll = { lat: r.lat != null ? Number(r.lat) : undefined, lng: r.lng != null ? Number(r.lng) : undefined }
        if (r.category === 'metro_station') nearby.metro.push({ name: r.name, distance_m: Number(r.distance_m), ...ll })
        else nearby.pois.push({ category: r.category, name: r.name, distance_m: Number(r.distance_m), khda_rating: r.khda_rating || undefined, description_zh: r.description_zh || undefined, ...ll })
      }
      nearby.landmarks = landmarkRes.rows.map((r) => ({
        name: r.name,
        type: r.landmark_type,
        distance_m: Number(r.distance_m),
        lat: r.lat != null ? Number(r.lat) : undefined,
        lng: r.lng != null ? Number(r.lng) : undefined,
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

  return { area, investment, yield_comparison, nearby, commute }
}

// ── Real DLD transactions for a project's development ───────────────────────
export interface ProjectTx {
  matched: boolean
  development: string | null          // master_project label
  sales: { date: string | null; building: string | null; rooms: string | null; sizeSqm: number | null; price: number | null; pricePerSqm: number | null; saleType: 'offplan' | 'ready' }[]
  rentals: { date: string | null; building: string | null; subtype: string | null; sizeSqm: number | null; annualRent: number | null; rentPerSqm: number | null; regType: 'new' | 'renew' }[]
}

const titleCaseDev = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

// Per-project cache. DLD data is a periodic snapshot, so repeat opens of the
// same project should be instant instead of re-running the spatial resolve + scans.
// 7h(与 insights 一致):预热每 6h 强刷,TTL 略长保证用户永远命中。
const PROJ_TX_TTL_MS = 7 * 60 * 60 * 1000
const projTxCache = new Map<string, { at: number; data: ProjectTx }>()

/**
 * Recent DLD sales + rentals for the project's matched development
 * (master_project + official area, via resolve_project_development). Honest:
 * matched=false when the project can't be resolved to a development.
 */
export async function getProjectTransactions(projectId: string, limit = 40): Promise<ProjectTx | null> {
  const cached = projTxCache.get(projectId)
  if (cached && Date.now() - cached.at < PROJ_TX_TTL_MS) return cached.data

  const projRes = await pool.query(
    `SELECT project_name, latitude, longitude FROM residential_projects WHERE id = $1`,
    [projectId]
  )
  if (projRes.rows.length === 0) return null
  const p = projRes.rows[0]
  const lng = p.longitude != null ? parseFloat(p.longitude) : null
  const lat = p.latitude != null ? parseFloat(p.latitude) : null

  const rr = await pool.query(
    `SELECT master_project, area_id, similarity FROM resolve_project_development($1, $2, $3)`,
    [p.project_name || '', lng, lat]
  )
  const master = rr.rows[0]?.master_project as string | undefined
  const areaId = rr.rows[0]?.area_id != null ? Number(rr.rows[0].area_id) : null
  const sim = parseFloat(rr.rows[0]?.similarity) || 0
  if (!master || areaId == null || sim < 0.45) {
    const miss: ProjectTx = { matched: false, development: null, sales: [], rentals: [] }
    projTxCache.set(projectId, { at: Date.now(), data: miss })
    return miss
  }

  // master_project is stored upper-case in DLD and the resolver returns it verbatim,
  // so plain equality (no upper()) lets the planner use the index — ~6x faster.
  const [salesRes, rentRes] = await Promise.all([
    pool.query(
      `SELECT dt.instance_date AS date, dt.building_name, dt.project_name, dt.rooms,
              dt.procedure_area AS size_sqm, dt.actual_worth AS price, round(dt.meter_sale_price) AS pps,
              CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END AS sale_type
         FROM dld_transactions dt
        WHERE dt.master_project = $1 AND dt.area_id = $2
          AND dt.trans_group = 'Sales' AND dt.meter_sale_price > 0
        ORDER BY dt.instance_date DESC LIMIT $3`,
      [master, areaId, limit]
    ),
    // Rentals carry no master_project — match by the development's project_name set.
    // Plain IN (no per-row regexp) keeps this off a full area scan.
    pool.query(
      `WITH pset AS (
         SELECT DISTINCT project_name FROM dld_transactions
          WHERE master_project = $1 AND area_id = $2 AND project_name IS NOT NULL AND project_name <> ''
       )
       SELECT rc.start_date AS date, rc.project_name, rc.property_subtype, rc.property_type,
              rc.property_area AS size_sqm, rc.annual_amount AS annual_rent,
              round(rc.annual_amount / NULLIF(rc.property_area, 0)) AS rps, rc.registration_type
         FROM dld_rent_contracts rc
        WHERE rc.area_id = $2 AND rc.usage_type = 'Residential'
          AND rc.project_name IN (SELECT project_name FROM pset)
        ORDER BY rc.start_date DESC LIMIT $3`,
      [master, areaId, limit]
    ),
  ])

  const out: ProjectTx = {
    matched: true,
    development: titleCaseDev(master),
    sales: salesRes.rows.map((r) => ({
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
      building: r.building_name || r.project_name || null,
      rooms: r.rooms || null,
      sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
      price: r.price ? Math.round(Number(r.price)) : null,
      pricePerSqm: r.pps ? Number(r.pps) : null,
      saleType: r.sale_type as 'offplan' | 'ready',
    })),
    rentals: rentRes.rows.map((r) => ({
      date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
      building: r.project_name || null,
      subtype: (r.property_subtype || r.property_type || '').trim() || null,
      sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
      annualRent: r.annual_rent ? Math.round(Number(r.annual_rent)) : null,
      rentPerSqm: r.rps ? Number(r.rps) : null,
      regType: (r.registration_type === 'New' ? 'new' : 'renew') as 'new' | 'renew',
    })),
  }
  projTxCache.set(projectId, { at: Date.now(), data: out })
  return out
}
