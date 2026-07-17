/**
 * Rental market layer — Ejari rent contracts (dld_rent_contracts).
 * Mirrors /api/market/transactions/* but for rent. Isolated router mounted at
 * /api/market/rent. Rent has no bedroom count; uses annual_amount + per-sqm
 * (annual_amount / property_area). Sane date window excludes garbage future dates.
 *
 *   GET /api/market/rent/filters | /summary | /list
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

const TTL = 6 * 60 * 60 * 1000
const cache = new Map<string, { at: number; data: any }>()
const cGet = (k: string) => {
  const h = cache.get(k)
  if (!h) return null
  if (Date.now() - h.at > TTL) { cache.delete(k); return null }
  return h.data
}
const cSet = (k: string, data: any) => {
  if (cache.size >= 1000) { const o = cache.keys().next().value; if (o !== undefined) cache.delete(o) }
  cache.set(k, { at: Date.now(), data })
}

/** Persistent precomputed default (market_cache, refreshed daily). Null if absent/error. */
async function precomputed(key: string): Promise<any | null> {
  try {
    const r = await pool.query(`SELECT payload FROM market_cache WHERE market='rent' AND key=$1`, [key])
    return r.rows[0]?.payload ?? null
  } catch { return null }
}

/** Common WHERE for residential rent, sane dates, positive amounts/area. */
function buildRentFilter(q: any): { clause: string; params: any[] } {
  const params: any[] = []
  const parts: string[] = [
    `rc.usage_type = 'Residential'`,
    `rc.annual_amount > 0`,
    `rc.property_area > 0`,
    `rc.start_date >= '2000-01-01'`,
    `rc.start_date <= CURRENT_DATE`,
  ]
  if (q.area) {
    params.push(String(q.area).trim().toUpperCase())
    parts.push(`UPPER(rc.area_name) = $${params.length}`)
  }
  if (q.areaId) {
    params.push(String(q.areaId).trim())
    parts.push(`rc.dubai_area_id = $${params.length}`)
  }
  // project 多选(同社区多个 phase 合看),与成交侧一致
  if (q.project) {
    const projectList = (Array.isArray(q.project) ? q.project : [q.project])
      .map((p: any) => String(p).trim().toUpperCase())
      .filter(Boolean)
    if (projectList.length > 0) {
      params.push(projectList)
      parts.push(`UPPER(rc.project_name) = ANY($${params.length}::text[])`)
    }
  }
  // 年份(起租日)区间 —— 之前前端传了 from/to 但后端没接,年份筛选形同虚设
  if (q.from) {
    params.push(q.from)
    parts.push(`rc.start_date >= $${params.length}`)
  }
  if (q.to) {
    params.push(q.to)
    parts.push(`rc.start_date <= $${params.length}`)
  }
  // 按年租金(annual_amount)区间过滤
  if (q.minPrice && Number(q.minPrice) > 0) {
    params.push(Number(q.minPrice))
    parts.push(`rc.annual_amount >= $${params.length}`)
  }
  if (q.maxPrice && Number(q.maxPrice) > 0) {
    params.push(Number(q.maxPrice))
    parts.push(`rc.annual_amount <= $${params.length}`)
  }
  return { clause: parts.join(' AND '), params }
}

/** GET /filters — area dropdown (consistent with summary/list). */
router.get('/filters', async (_req: Request, res: Response) => {
  try {
    const cached = cGet('filters')
    if (cached) return res.json(cached)
    const pc = await precomputed('filters')
    if (pc) { cSet('filters', pc); return res.json(pc) }
    const areas = await pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY rc.area_name) AS name, COUNT(*)::int AS count
         FROM dld_rent_contracts rc
        WHERE rc.usage_type = 'Residential' AND rc.annual_amount > 0 AND rc.property_area > 0
          AND rc.start_date >= '2000-01-01' AND rc.start_date <= CURRENT_DATE
          AND rc.area_name IS NOT NULL AND rc.area_name <> ''
        GROUP BY UPPER(rc.area_name)
       HAVING COUNT(*) >= 100
        ORDER BY count DESC`
    )
    const data = { areas: areas.rows }
    cSet('filters', data)
    res.json(data)
  } catch (err) {
    console.error('[market/rent/filters] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /projects?area=&q= — 可搜索项目列表(租约口径),供多选筛选用 */
async function loadRentProjects(area: string): Promise<{ name: string; count: number }[]> {
  const cacheKey = area ? `projects:${area.toUpperCase()}` : 'projects:ALL'
  const cached = cGet(cacheKey)
  if (cached) return cached
  if (!area) {
    const pc = await precomputed('projects:ALL')
    if (pc) { cSet(cacheKey, pc); return pc }
  }
  const r = await pool.query(
    `SELECT mode() WITHIN GROUP (ORDER BY rc.project_name) AS name, COUNT(*)::int AS count
       FROM dld_rent_contracts rc
      WHERE rc.usage_type = 'Residential' AND rc.annual_amount > 0 AND rc.property_area > 0
        AND rc.start_date >= '2000-01-01' AND rc.start_date <= CURRENT_DATE
        ${area ? 'AND UPPER(rc.area_name) = $1' : ''}
        AND rc.project_name IS NOT NULL AND rc.project_name <> ''
      GROUP BY UPPER(rc.project_name)
     HAVING COUNT(*) >= 10
      ORDER BY count DESC`,
    area ? [area.toUpperCase()] : []
  )
  cSet(cacheKey, r.rows)
  return r.rows
}

router.get('/projects', async (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || '').trim()
    const q = String(req.query.q || '').trim().toLowerCase()
    let projects = await loadRentProjects(area)
    if (q) projects = projects.filter((p) => p.name.toLowerCase().includes(q))
    res.json({ projects: projects.slice(0, q ? 50 : 100) })
  } catch (err) {
    console.error('[market/rent/projects] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /summary — aggregate rent metrics + 24-month trend. */
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const { clause, params } = buildRentFilter(req.query)
    const key = `summary:${clause}:${JSON.stringify(params)}`
    const cached = cGet(key)
    if (cached) return res.json(cached)
    // unfiltered default → serve the daily-precomputed payload (avoids the ~14s full scan)
    const q = req.query
    const unfiltered = !q.area && !q.areaId && !q.project && !q.from && !q.to && !q.minPrice && !q.maxPrice
    if (unfiltered) {
      const pc = await precomputed('summary')
      if (pc) { cSet(key, pc); return res.json(pc) }
    }
    const stats = await pool.query(
      `SELECT COUNT(*)::int AS n,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS p25_sqm,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS median_sqm,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS p75_sqm,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount) AS median_annual,
              AVG(rc.property_area) AS avg_size_sqm,
              SUM(rc.annual_amount) AS total_volume
         FROM dld_rent_contracts rc
        WHERE ${clause}`,
      params
    )
    const trend = await pool.query(
      `SELECT to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS month,
              COUNT(*)::int AS count,
              round(percentile_cont(0.50) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area)) AS median_sqm
         FROM dld_rent_contracts rc
        WHERE ${clause}
          AND rc.start_date >= (SELECT MAX(start_date) FROM dld_rent_contracts WHERE start_date <= CURRENT_DATE) - INTERVAL '24 months'
        GROUP BY 1 ORDER BY 1`,
      params
    )
    const s = stats.rows[0]
    const data = {
      count: s.n,
      rentPerSqm: s.n ? {
        p25: Math.round(Number(s.p25_sqm)), median: Math.round(Number(s.median_sqm)), p75: Math.round(Number(s.p75_sqm)),
      } : null,
      medianAnnualRent: s.median_annual ? Math.round(Number(s.median_annual)) : null,
      avgSizeSqm: s.avg_size_sqm ? Math.round(Number(s.avg_size_sqm)) : null,
      totalVolume: s.total_volume ? Math.round(Number(s.total_volume)) : null,
      trend: trend.rows.map((r) => ({ month: r.month, count: r.count, medianSqm: Number(r.median_sqm) })),
      note: 'DLD/Ejari 住宅租约。租金/sqft = 年租金 ÷ 面积。数据为定期快照,非实时。',
    }
    cSet(key, data)
    res.json(data)
  } catch (err) {
    console.error('[market/rent/summary] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /list — paginated rent contracts. */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { clause, params } = buildRentFilter(req.query)
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '25'), 10) || 25, 1), 100)
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)
    const rows = await pool.query(
      `SELECT rc.start_date AS date, rc.area_name, rc.project_name, rc.property_subtype,
              rc.property_area AS size_sqm, rc.annual_amount,
              round(rc.annual_amount / rc.property_area) AS rent_per_sqm,
              rc.registration_type
         FROM dld_rent_contracts rc
        WHERE ${clause}
        ORDER BY rc.start_date DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    )
    res.json({
      rows: rows.rows.map((r) => ({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        area: r.area_name,
        building: r.project_name || '—',
        subtype: r.property_subtype || '—',
        sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
        annualRent: r.annual_amount ? Math.round(Number(r.annual_amount)) : null,
        rentPerSqm: r.rent_per_sqm ? Number(r.rent_per_sqm) : null,
        regType: r.registration_type === 'Renew' || r.registration_type === 'تجديد' ? 'renew' : 'new',
      })),
      limit,
      offset,
    })
  } catch (err) {
    console.error('[market/rent/list] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
