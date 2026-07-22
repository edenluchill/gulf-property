/**
 * Precompute the EXPENSIVE unfiltered market defaults (overall summary + filter
 * dropdowns + all-projects) for both rent and sale into market_cache. These are
 * full-scan percentile/mode/group-by aggregates over ~5M rows that cost 6-14s cold;
 * the page-load defaults hit them every cold cache. Precomputed daily (by the box
 * timer) + on demand, the endpoints serve these instantly.
 *
 * Payload shapes MUST match the route handlers (market.ts / market-rent.ts) exactly
 * so the endpoints can return market_cache rows verbatim for the unfiltered case.
 *
 *   npx ts-node --transpile-only scripts/market-precompute.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

// ⚠️ 必须与 market.ts 的同名常量完全一致（那边是筛选白名单，这边是下拉数据源）。
const ROOM_OPTIONS = ['Studio', '1 B/R', '2 B/R', '3 B/R', '4 B/R', '5 B/R', '6 B/R', '7 B/R', 'PENTHOUSE']
const RENT_BASE = `rc.usage_type = 'Residential' AND rc.annual_amount > 0 AND rc.property_area > 0 AND rc.start_date >= '2000-01-01' AND rc.start_date <= CURRENT_DATE`
// ⚠️ 口径必须和 market.ts 的 RES_PT 完全一致 —— 否则「实时查询」和「缓存的默认视图」
//    会给出不同结果。含命名别墅社区的 Land(DAMAC Lagoons 等期房别墅)。
//    改这里 → 必须重跑 market-precompute 并 scp 到迪拜盒子。
const TX_BASE = `dt.trans_group = 'Sales' AND dt.property_usage = 'Residential' AND (dt.property_type IN ('Unit','Villa') OR (dt.property_type = 'Land' AND dt.project_name IS NOT NULL AND dt.project_name <> '')) AND dt.meter_sale_price BETWEEN 1000 AND 250000 AND dt.procedure_area > 0`

async function store(market: string, key: string, payload: any) {
  await pool.query(
    `INSERT INTO market_cache (market, key, payload, updated_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (market, key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
    [market, key, JSON.stringify(payload)]
  )
  console.log(`[precompute] stored ${market}:${key}`)
}

async function rentFilters() {
  const areas = await pool.query(
    `SELECT mode() WITHIN GROUP (ORDER BY rc.area_name) AS name, COUNT(*)::int AS count
       FROM dld_rent_contracts rc
      WHERE ${RENT_BASE} AND rc.area_name IS NOT NULL AND rc.area_name <> ''
      GROUP BY UPPER(rc.area_name) HAVING COUNT(*) >= 100 ORDER BY count DESC`
  )
  await store('rent', 'filters', { areas: areas.rows })
}

async function rentSummary() {
  const stats = await pool.query(
    `SELECT COUNT(*)::int AS n,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS p25_sqm,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS median_sqm,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS p75_sqm,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount) AS median_annual,
            AVG(rc.property_area) AS avg_size_sqm, SUM(rc.annual_amount) AS total_volume
       FROM dld_rent_contracts rc WHERE ${RENT_BASE}`
  )
  const trend = await pool.query(
    `SELECT to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS month, COUNT(*)::int AS count,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area)) AS median_sqm
       FROM dld_rent_contracts rc
      WHERE ${RENT_BASE}
        AND rc.start_date >= (SELECT MAX(start_date) FROM dld_rent_contracts WHERE start_date <= CURRENT_DATE) - INTERVAL '24 months'
      GROUP BY 1 ORDER BY 1`
  )
  const s = stats.rows[0]
  await store('rent', 'summary', {
    count: s.n,
    rentPerSqm: s.n ? { p25: Math.round(+s.p25_sqm), median: Math.round(+s.median_sqm), p75: Math.round(+s.p75_sqm) } : null,
    medianAnnualRent: s.median_annual ? Math.round(+s.median_annual) : null,
    avgSizeSqm: s.avg_size_sqm ? Math.round(+s.avg_size_sqm) : null,
    totalVolume: s.total_volume ? Math.round(+s.total_volume) : null,
    trend: trend.rows.map((r) => ({ month: r.month, count: r.count, medianSqm: Number(r.median_sqm) })),
    note: 'DLD/Ejari 住宅租约。租金/sqft = 年租金 ÷ 面积。数据为定期快照,非实时。',
  })
}

async function txFilters() {
  const areas = await pool.query(
    `SELECT mode() WITHIN GROUP (ORDER BY dt.area_name) AS name, COUNT(*)::int AS count
       FROM dld_transactions dt
      WHERE ${TX_BASE} AND dt.area_name IS NOT NULL AND dt.area_name <> ''
      GROUP BY UPPER(dt.area_name) HAVING COUNT(*) >= 50 ORDER BY count DESC`
  )
  await store('tx', 'filters', { areas: areas.rows, rooms: ROOM_OPTIONS })
}

/** 统一搜索框(区域/楼盘/楼栋)的候选索引 —— 用户敲第一个字母就要响应,不能冷算。
 *  ⚠️ payload 形状必须与 market.ts 的 loadSuggestIndex 完全一致。 */
async function txSuggest() {
  const [areas, projects, buildings] = await Promise.all([
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.area_name) AS name, COUNT(*)::int AS count
         FROM dld_transactions dt
        WHERE ${TX_BASE} AND dt.area_name IS NOT NULL AND dt.area_name <> ''
        GROUP BY UPPER(dt.area_name) HAVING COUNT(*) >= 50 ORDER BY count DESC`
    ),
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.project_name) AS name,
              mode() WITHIN GROUP (ORDER BY dt.area_name) AS area,
              COUNT(*)::int AS count,
              COUNT(DISTINCT UPPER(dt.building_name))::int AS buildings
         FROM dld_transactions dt
        WHERE ${TX_BASE} AND dt.project_name IS NOT NULL AND dt.project_name <> ''
        GROUP BY UPPER(dt.project_name) HAVING COUNT(*) >= 10 ORDER BY count DESC`
    ),
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.building_name) AS name,
              mode() WITHIN GROUP (ORDER BY dt.project_name) AS project,
              mode() WITHIN GROUP (ORDER BY dt.area_name) AS area,
              COUNT(*)::int AS count
         FROM dld_transactions dt
        WHERE ${TX_BASE} AND dt.building_name IS NOT NULL AND dt.building_name <> ''
        GROUP BY UPPER(dt.building_name) HAVING COUNT(*) >= 5 ORDER BY count DESC`
    ),
  ])
  await store('tx', 'suggest', { areas: areas.rows, projects: projects.rows, buildings: buildings.rows })
}

async function txProjectsAll() {
  const r = await pool.query(
    `SELECT mode() WITHIN GROUP (ORDER BY dt.project_name) AS name, COUNT(*)::int AS count
       FROM dld_transactions dt
      WHERE ${TX_BASE} AND dt.project_name IS NOT NULL AND dt.project_name <> ''
      GROUP BY UPPER(dt.project_name) HAVING COUNT(*) >= 10 ORDER BY count DESC`
  )
  await store('tx', 'projects:ALL', r.rows)
}

// type: 期房/现房口径变体 —— 前端散客默认 type=offplan（frontend lib/marketSegment.ts），
// 该默认查询也必须命中预计算，否则每个冷访客都是 ~14s 全表扫描。
async function txSummary(type?: 'offplan' | 'ready') {
  const seg = type === 'offplan' ? ' AND dt.is_offplan' : type === 'ready' ? ' AND NOT dt.is_offplan' : ''
  const stats = await pool.query(
    `SELECT COUNT(*)::int AS n,
            percentile_cont(0.05) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p05,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p25,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS median_pps,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p75,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p95,
            AVG(dt.meter_sale_price) AS avg_pps,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.actual_worth) AS median_price,
            AVG(dt.procedure_area) AS avg_size_sqm, SUM(dt.actual_worth) AS total_volume
       FROM dld_transactions dt WHERE ${TX_BASE}${seg}`
  )
  const trend = await pool.query(
    `SELECT to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS month, COUNT(*)::int AS count,
            round(percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.meter_sale_price)) AS median_pps
       FROM dld_transactions dt
      WHERE ${TX_BASE}${seg} AND dt.instance_date >= (SELECT MAX(instance_date) FROM dld_transactions) - INTERVAL '24 months'
      GROUP BY 1 ORDER BY 1`
  )
  const s = stats.rows[0]
  await store('tx', type ? `summary:${type}` : 'summary', {
    count: s.n,
    pricePerSqm: s.n ? {
      min: Math.round(+s.p05), p25: Math.round(+s.p25), median: Math.round(+s.median_pps),
      p75: Math.round(+s.p75), max: Math.round(+s.p95), avg: Math.round(+s.avg_pps),
    } : null,
    medianUnitPrice: s.median_price ? Math.round(+s.median_price) : null,
    avgSizeSqm: s.avg_size_sqm ? Math.round(+s.avg_size_sqm) : null,
    totalVolume: s.total_volume ? Math.round(+s.total_volume) : null,
    trend: trend.rows.map((r) => ({ month: r.month, count: r.count, medianPps: Number(r.median_pps) })),
    note: 'DLD 住宅销售（Unit/Villa），已剔除最高/最低 5% 极端值。数据为定期快照,非实时。',
  })
}

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS market_cache (
    market TEXT, key TEXT, payload JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (market, key))`)
  const t0 = Date.now()
  await rentFilters(); await rentSummary()
  await txFilters(); await txSummary(); await txSummary('offplan'); await txSummary('ready'); await txProjectsAll(); await txSuggest()
  console.log(`[precompute] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await pool.end()
}
main().catch((e) => { console.error('[precompute] FAILED', e?.message || e); process.exit(1) })
