/**
 * Market analytics — 成交真相层 (Transaction Truth)
 *
 * GET /api/market/price-check?projectId=<uuid>
 *   把项目单价 vs 同区近 12 个月真实成交分布做对比，给中性可解释的"价格体检"。
 *   数据：dld_transactions（经 dld_areas 桥接到 dubai_areas），与 get_dubai_area_metrics 同源。
 *   注意：数据为定期快照（非实时），响应内含数据时间窗口供前端如实标注。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { findAreaByName } from '../services/area-matcher'
import { calculateInvestment5yr, calculatePaybackYears } from '../services/investment-calculator'
import { DEFAULT_SEGMENT, SEGMENT_MIN_SAMPLE, parseSegment, MarketSegment } from '../lib/marketSegment'
import { beginMaintenance, endMaintenance } from '../services/perfSink'

const router = Router()

const SQFT_PER_SQM = 10.7639

function verdictFor(premiumPct: number, sampleCount: number) {
  if (sampleCount < 30) {
    return {
      level: 'insufficient' as const,
      label: '样本不足',
      explanation: '该区域近 12 个月可比成交样本不足，暂不给出价格判断，仅供参考。'
    }
  }
  if (premiumPct > 25) {
    return {
      level: 'high' as const,
      label: '显著高于区域成交中位数',
      explanation: `本项目单价相对同区近 12 个月成交中位数高约 ${premiumPct.toFixed(0)}%。新盘相对二手存在溢价较常见，建议结合付款计划、交付时间与楼层/景观综合判断。`
    }
  }
  if (premiumPct > 10) {
    return {
      level: 'above' as const,
      label: '高于区域成交中位数',
      explanation: `本项目单价相对同区近 12 个月成交中位数高约 ${premiumPct.toFixed(0)}%，可能反映新房、楼层、景观或付款计划的资金时间价值。`
    }
  }
  if (premiumPct < -10) {
    return {
      level: 'below' as const,
      label: '低于区域成交中位数',
      explanation: `本项目单价相对同区近 12 个月成交中位数低约 ${Math.abs(premiumPct).toFixed(0)}%，可能反映户型、楼龄或具体单元差异。`
    }
  }
  return {
    level: 'inline' as const,
    label: '与区域成交中位数基本一致',
    explanation: '本项目单价与同区近 12 个月成交中位数基本处于同一水平。'
  }
}

router.get('/price-check', async (req: Request, res: Response) => {
  try {
    const projectId = String(req.query.projectId || '').trim()
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' })
    }

    // 1) 项目信息 + 单价（来自户型 price_per_sqft 中位数，换算为 AED/sqm）
    const projRes = await pool.query(
      `SELECT rp.id, rp.area, rp.developer, rp.status, rp.min_price, rp.max_price, rp.starting_price,
              pm.median_pps
         FROM residential_projects rp
         LEFT JOIN (
           SELECT project_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sqft) AS median_pps
             FROM project_unit_types
            WHERE price_per_sqft IS NOT NULL AND price_per_sqft > 0
            GROUP BY project_id
         ) pm ON pm.project_id = rp.id
        WHERE rp.id = $1`,
      [projectId]
    )
    if (projRes.rowCount === 0) {
      return res.status(404).json({ error: 'project not found' })
    }
    const project = projRes.rows[0]
    const projectPricePerSqm = project.median_pps
      ? Number(project.median_pps) * SQFT_PER_SQM
      : null

    // 2) 匹配区域
    const area = project.area ? await findAreaByName(pool, project.area) : null
    if (!area) {
      return res.json({
        matched: false,
        reason: 'area_unmatched',
        projectArea: project.area || null,
        summary: '暂未能把该项目匹配到有成交数据的区域，无法做价格体检。'
      })
    }

    // 3) 同区近 12 个月真实成交分布（剔除极端值；Unit/Villa 住宅销售）
    const distRes = await pool.query(
      `WITH bounds AS (SELECT MAX(instance_date) AS max_d FROM dld_transactions),
       tx AS (
         SELECT dt.meter_sale_price AS pps
           FROM dld_transactions dt
           JOIN dld_areas dla ON dla.area_id = dt.area_id
           CROSS JOIN bounds b
          WHERE dla.dubai_area_id = $1
            AND dt.trans_group = 'Sales'
            AND dt.property_usage = 'Residential'
            AND dt.property_type IN ('Unit', 'Villa')
            AND dt.meter_sale_price BETWEEN 1000 AND 250000
            AND dt.instance_date >= (b.max_d - INTERVAL '12 months')
       )
       SELECT COUNT(*)::int AS n,
              percentile_cont(0.05) WITHIN GROUP (ORDER BY pps) AS p05,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY pps) AS p25,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY pps) AS p50,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY pps) AS p75,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY pps) AS p95,
              (SELECT max_d FROM bounds) AS data_through
         FROM tx`,
      [area.id]
    )
    const d = distRes.rows[0]
    const sampleCount = d?.n || 0

    if (sampleCount === 0) {
      return res.json({
        matched: true,
        areaName: area.name,
        sampleCount: 0,
        summary: `${area.name} 近 12 个月暂无可比住宅成交，无法做价格体检。`
      })
    }

    const median = Number(d.p50)
    const premiumPct =
      projectPricePerSqm != null && median > 0
        ? ((projectPricePerSqm - median) / median) * 100
        : null

    const verdict =
      premiumPct == null
        ? {
            level: 'no_project_price' as const,
            label: '缺少项目单价',
            explanation: '该项目未录入可用的户型单价（AED/sqft），仅展示区域成交区间供参考。'
          }
        : verdictFor(premiumPct, sampleCount)

    const dataThrough: Date = d.data_through
    return res.json({
      matched: true,
      areaName: area.name,
      projectArea: project.area,
      sampleCount,
      confidence: sampleCount >= 30 ? 'ok' : 'low',
      dataThrough: dataThrough ? dataThrough.toISOString().slice(0, 10) : null,
      windowMonths: 12,
      currency: 'AED',
      unit: 'per_sqm',
      area: {
        min: Math.round(Number(d.p05)),
        p25: Math.round(Number(d.p25)),
        median: Math.round(median),
        p75: Math.round(Number(d.p75)),
        max: Math.round(Number(d.p95))
      },
      project: {
        pricePerSqm: projectPricePerSqm ? Math.round(projectPricePerSqm) : null,
        source: projectPricePerSqm ? 'unit_types_median' : null
      },
      premiumPct: premiumPct != null ? Number(premiumPct.toFixed(1)) : null,
      verdict,
      methodology:
        '区域基准 = 该区近 12 个月 DLD 住宅销售（Unit/Villa）每平方米成交价分布，' +
        '已剔除最高/最低 5% 极端值，取中位数。项目单价 = 各户型 price_per_sqft 中位数换算 AED/sqm。' +
        '数据为 DLD 定期快照（非实时），二手登记通常滞后 4–8 周。'
    })
  } catch (err) {
    console.error('[market/price-check] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// 成交查询（功能 B）—— 直接面向 dld_transactions 的多维聚合
// ---------------------------------------------------------------------------

const ROOM_OPTIONS = ['Studio', '1 B/R', '2 B/R', '3 B/R', '4 B/R', '5 B/R']

// 数据是定期快照（非实时），聚合结果可放心缓存。
// dld_transactions 154 万行，无缓存时全表 percentile 聚合要数秒。
const TX_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const TX_CACHE_MAX = 1000  // 210 个区域的 insights 预热 + 各类聚合，留足余量
const txCache = new Map<string, { at: number; data: any }>()

function txCacheGet(key: string): any | null {
  const hit = txCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TX_CACHE_TTL_MS) { txCache.delete(key); return null }
  return hit.data
}

function txCacheSet(key: string, data: any) {
  if (txCache.size >= TX_CACHE_MAX) {
    const oldest = txCache.keys().next().value
    if (oldest !== undefined) txCache.delete(oldest)
  }
  txCache.set(key, { at: Date.now(), data })
}

/** Persistent precomputed default (market_cache, refreshed daily). Null if absent/error. */
async function txPrecomputed(key: string): Promise<any | null> {
  try {
    const r = await pool.query(`SELECT payload FROM market_cache WHERE market='tx' AND key=$1`, [key])
    return r.rows[0]?.payload ?? null
  } catch { return null }
}

/** 构造公共 WHERE（住宅销售、剔除极端值），返回 { clause, params } */
function buildTxFilter(q: any): { clause: string; params: any[] } {
  const params: any[] = []
  const parts: string[] = [
    `dt.trans_group = 'Sales'`,
    `dt.property_usage = 'Residential'`,
    `dt.property_type IN ('Unit','Villa')`,
    `dt.meter_sale_price BETWEEN 1000 AND 250000`,
    `dt.procedure_area > 0`
  ]
  if (q.area) {
    // DLD 原始数据同一区域存在大小写变体（'Business Bay' / 'BUSINESS BAY'），
    // 用 UPPER 等值匹配（吃 idx_dld_tx_res_area_upper 函数索引）把变体并在一起
    params.push(String(q.area).trim().toUpperCase())
    parts.push(`UPPER(dt.area_name) = $${params.length}`)
  }
  if (q.areaId) {
    // 地图区域（dubai_areas.id）→ 经 dld_areas 桥接到 DLD area_id（吃 idx_trans_area）
    params.push(String(q.areaId).trim())
    parts.push(`dt.area_id IN (SELECT area_id FROM dld_areas WHERE dubai_area_id = $${params.length})`)
  }
  // project 支持多选：经纪常把同一社区的多个 phase/楼盘合在一起看销售
  // (如 Sobha Hartland Greens 的 2 个 project)。前端可重复传 project 参数 →
  // Express 给出 string[]; 单选时是 string。统一成数组用 = ANY 匹配。
  if (q.project) {
    const projectList = (Array.isArray(q.project) ? q.project : [q.project])
      .map((p: any) => String(p).trim().toUpperCase())
      .filter(Boolean)
    if (projectList.length > 0) {
      params.push(projectList)
      parts.push(`UPPER(dt.project_name) = ANY($${params.length}::text[])`)
    }
  }
  if (q.rooms && ROOM_OPTIONS.includes(q.rooms)) {
    params.push(q.rooms)
    parts.push(`dt.rooms = $${params.length}`)
  }
  // 按成交总价(actual_worth)区间过滤
  if (q.minPrice && Number(q.minPrice) > 0) {
    params.push(Number(q.minPrice))
    parts.push(`dt.actual_worth >= $${params.length}`)
  }
  if (q.maxPrice && Number(q.maxPrice) > 0) {
    params.push(Number(q.maxPrice))
    parts.push(`dt.actual_worth <= $${params.length}`)
  }
  // 期房/现房用 DLD 官方 is_offplan 标志（比 procedure_name 文本匹配全：
  // Delayed Sell 等程序官方归现房，之前的 ='Sell' 会漏掉它们）
  if (q.type === 'offplan') {
    parts.push(`dt.is_offplan`)
  } else if (q.type === 'ready') {
    parts.push(`NOT dt.is_offplan`)
  }
  if (q.from) {
    params.push(q.from)
    parts.push(`dt.instance_date >= $${params.length}`)
  }
  if (q.to) {
    params.push(q.to)
    parts.push(`dt.instance_date <= $${params.length}`)
  }
  return { clause: parts.join(' AND '), params }
}

/** GET /transactions/filters — 下拉选项（区域、户型） */
router.get('/transactions/filters', async (_req: Request, res: Response) => {
  try {
    const cached = txCacheGet('filters')
    if (cached) return res.json(cached)
    const pc = await txPrecomputed('filters')
    if (pc) { txCacheSet('filters', pc); return res.json(pc) }
    // 口径与 summary/list 完全一致（Unit/Villa+价格区间+面积>0），
    // 否则下拉里的数量和选中后的 KPI 对不上（客户反馈）。
    // 大小写变体（'Business Bay'/'BUSINESS BAY'）按 UPPER 归并，名称取最常见写法。
    const areas = await pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.area_name) AS name, COUNT(*)::int AS count
         FROM dld_transactions dt
        WHERE dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
          AND dt.property_type IN ('Unit','Villa')
          AND dt.meter_sale_price BETWEEN 1000 AND 250000
          AND dt.procedure_area > 0
          AND dt.area_name IS NOT NULL AND dt.area_name <> ''
        GROUP BY UPPER(dt.area_name)
       HAVING COUNT(*) >= 50
        ORDER BY count DESC`
    )
    const data = { areas: areas.rows, rooms: ROOM_OPTIONS }
    txCacheSet('filters', data)
    res.json(data)
  } catch (err) {
    console.error('[market/transactions/filters] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * GET /transactions/projects?area=&q= — 项目筛选（可搜索，不强制先选区域）
 * - area 有值：该区域内的项目（走 area+date 索引，快）
 * - area 为空：全城项目列表（一次全表聚合，6h 缓存）+ 内存里按 q 过滤
 */
async function loadProjects(area: string): Promise<{ name: string; count: number }[]> {
  const cacheKey = area ? `projects:${area.toUpperCase()}` : 'projects:ALL'
  const cached = txCacheGet(cacheKey)
  if (cached) return cached
  if (!area) {
    const pc = await txPrecomputed('projects:ALL')
    if (pc) { txCacheSet(cacheKey, pc); return pc }
  }
  const r = await pool.query(
    `SELECT mode() WITHIN GROUP (ORDER BY dt.project_name) AS name, COUNT(*)::int AS count
       FROM dld_transactions dt
      WHERE dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
        AND dt.property_type IN ('Unit','Villa')
        AND dt.meter_sale_price BETWEEN 1000 AND 250000
        AND dt.procedure_area > 0
        ${area ? 'AND UPPER(dt.area_name) = $1' : ''}
        AND dt.project_name IS NOT NULL AND dt.project_name <> ''
      GROUP BY UPPER(dt.project_name)
     HAVING COUNT(*) >= 10
      ORDER BY count DESC`,
    area ? [area.toUpperCase()] : []
  )
  txCacheSet(cacheKey, r.rows)
  return r.rows
}

router.get('/transactions/projects', async (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || '').trim()
    const q = String(req.query.q || '').trim().toLowerCase()
    let projects = await loadProjects(area)
    if (q) projects = projects.filter(p => p.name.toLowerCase().includes(q))
    // 无关键词时给前 100（下拉初始展示），有关键词给前 50
    res.json({ projects: projects.slice(0, q ? 50 : 100) })
  } catch (err) {
    console.error('[market/transactions/projects] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /transactions/summary — 聚合指标 + 月度趋势 */
router.get('/transactions/summary', async (req: Request, res: Response) => {
  try {
    const { clause, params } = buildTxFilter(req.query)
    const cacheKey = `summary:${clause}:${JSON.stringify(params)}`
    const cached = txCacheGet(cacheKey)
    if (cached) return res.json(cached)
    // type-only default → serve the daily-precomputed payload (avoids the ~14s full scan)。
    // 前端散客默认 type=offplan（见 frontend lib/marketSegment.ts），所以期房/现房
    // 的无其它筛选场景也各有预计算 key（market-precompute.ts）。
    const q = req.query
    if (!q.area && !q.areaId && !q.project && !q.rooms && !q.from && !q.to && !q.minPrice && !q.maxPrice) {
      const pcKey = q.type === 'offplan' ? 'summary:offplan' : q.type === 'ready' ? 'summary:ready' : !q.type ? 'summary' : null
      if (pcKey) {
        const pc = await txPrecomputed(pcKey)
        if (pc) { txCacheSet(cacheKey, pc); return res.json(pc) }
      }
    }
    const stats = await pool.query(
      `SELECT COUNT(*)::int AS n,
              percentile_cont(0.05) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p05,
              percentile_cont(0.25) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p25,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS median_pps,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p75,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS p95,
              AVG(dt.meter_sale_price) AS avg_pps,
              percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.actual_worth) AS median_price,
              AVG(dt.procedure_area) AS avg_size_sqm,
              SUM(dt.actual_worth) AS total_volume
         FROM dld_transactions dt
        WHERE ${clause}`,
      params
    )
    const trend = await pool.query(
      `SELECT to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS month,
              COUNT(*)::int AS count,
              round(percentile_cont(0.50) WITHIN GROUP (ORDER BY dt.meter_sale_price)) AS median_pps
         FROM dld_transactions dt
        WHERE ${clause}
          AND dt.instance_date >= (SELECT MAX(instance_date) FROM dld_transactions) - INTERVAL '24 months'
        GROUP BY 1 ORDER BY 1`,
      params
    )
    const s = stats.rows[0]
    const data = {
      count: s.n,
      pricePerSqm: s.n ? {
        min: Math.round(Number(s.p05)), p25: Math.round(Number(s.p25)),
        median: Math.round(Number(s.median_pps)), p75: Math.round(Number(s.p75)),
        max: Math.round(Number(s.p95)), avg: Math.round(Number(s.avg_pps))
      } : null,
      medianUnitPrice: s.median_price ? Math.round(Number(s.median_price)) : null,
      avgSizeSqm: s.avg_size_sqm ? Math.round(Number(s.avg_size_sqm)) : null,
      totalVolume: s.total_volume ? Math.round(Number(s.total_volume)) : null,
      trend: trend.rows.map(r => ({ month: r.month, count: r.count, medianPps: Number(r.median_pps) })),
      note: 'DLD 住宅销售（Unit/Villa），已剔除最高/最低 5% 极端值。数据为定期快照，非实时。'
    }
    txCacheSet(cacheKey, data)
    res.json(data)
  } catch (err) {
    console.error('[market/transactions/summary] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /transactions/list — 分页明细 */
router.get('/transactions/list', async (req: Request, res: Response) => {
  try {
    const { clause, params } = buildTxFilter(req.query)
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '25'), 10) || 25, 1), 100)
    const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)
    const rows = await pool.query(
      `SELECT dt.instance_date AS date, dt.area_name, dt.building_name, dt.project_name,
              dt.rooms, dt.procedure_area AS size_sqm, dt.actual_worth AS price,
              round(dt.meter_sale_price) AS price_per_sqm,
              CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END AS sale_type
         FROM dld_transactions dt
        WHERE ${clause}
        ORDER BY dt.instance_date DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    )
    res.json({
      rows: rows.rows.map(r => ({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        area: r.area_name,
        building: r.building_name || r.project_name || '—',
        rooms: r.rooms || '—',
        sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
        price: r.price ? Math.round(Number(r.price)) : null,
        pricePerSqm: r.price_per_sqm ? Number(r.price_per_sqm) : null,
        saleType: r.sale_type
      })),
      limit,
      offset
    })
  } catch (err) {
    console.error('[market/transactions/list] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// 区域洞察（地图区域弹窗）—— 四指标月度序列 + 近期真实成交
// 价格/成交量直接按月聚合；增长=中位单价同比；收益率=月度租金中位数(/m²/年)÷售价中位数(/m²)
// ---------------------------------------------------------------------------

/** 3 个月滑动平均（首尾不足时用可得窗口），抹平小样本月度噪声 */
function smooth3(series: (number | null)[]): (number | null)[] {
  return series.map((_, i) => {
    const win = series.slice(Math.max(0, i - 2), i + 1).filter((v): v is number => v != null)
    if (!win.length) return null
    return win.reduce((a, b) => a + b, 0) / win.length
  })
}

/** 以 endYm（'YYYY-MM'）结尾、共 n 个月的连续日历月份轴 */
function monthRange(endYm: string, n: number): string[] {
  const [y, m] = endYm.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const mapTxRow = (r: any) => ({
  date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
  building: r.building_name || r.project_name || null,
  rooms: r.rooms || null,
  sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
  price: r.price ? Math.round(Number(r.price)) : null,
  pricePerSqm: r.price_per_sqm ? Number(r.price_per_sqm) : null,
  saleType: r.sale_type
})

async function loadAreaInsightsData(areaId: string, usage: string = 'all') {
    // Pick the matching mode for this dubai_area:
    //  • OFFICIAL area (has a real DLD bridge area_id < 900000) → join by the
    //    area_id bridge (reliable, covers every transaction in the community).
    //  • CUSTOM hand-drawn area (only a synthetic 900000+ bridge, or none) →
    //    SPATIAL: capture transactions whose geocoded project point falls inside
    //    the polygon (dld_project_locations). This is the only thing that works
    //    for arbitrary colleague-drawn shapes. See dld-geocode-cache.sql.
    const modeRes = await pool.query(
      `SELECT (da.boundary IS NOT NULL) AS has_boundary,
              EXISTS(SELECT 1 FROM dld_areas dla
                      WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000) AS official
         FROM dubai_areas da WHERE da.id = $1`,
      [areaId]
    )
    const spatial = !!modeRes.rows[0] && !modeRes.rows[0].official && !!modeRes.rows[0].has_boundary

    // Transaction ↔ area predicates, swapped by mode. $1 = dubai_areas.id.
    // COALESCE(...'__AREA__') falls records with no project/building back to the
    // area centroid row, so the 2% area-only sales + 78% area-only rent are
    // captured too (coarse — placed at area centre). See dld-area-centroids.sql.
    const txJoin = spatial
      ? `JOIN dld_project_locations loc ON loc.area_name = dt.area_name
           AND loc.project_name = COALESCE(NULLIF(dt.project_name, ''), NULLIF(dt.building_name, ''), '__AREA__')`
      : `JOIN dld_areas dla ON dla.area_id = dt.area_id`
    const txWhere = spatial
      ? `loc.geom IS NOT NULL AND ST_Covers((SELECT boundary FROM dubai_areas WHERE id = $1), loc.geom)`
      : `dla.dubai_area_id = $1`
    const rentJoin = spatial
      ? `JOIN dld_project_locations loc ON loc.area_name = rc.area_name
           AND loc.project_name = COALESCE(NULLIF(rc.project_name, ''), '__AREA__')`
      : ``
    const rentWhere = spatial
      ? `loc.geom IS NOT NULL AND ST_Covers((SELECT boundary FROM dubai_areas WHERE id = $1), loc.geom)`
      : `rc.dubai_area_id = $1`

    const [salesRes, rentRes, recentRes, recentOffplanRes, recentReadyRes, recentRentRes, medianRes] = await Promise.all([
      // 37 个月：算 24 个月同比需要 t-12 的数据。
      // 一次扫描同时聚合 全部/期房/现房 三口径（FILTER 聚合）——不用二次查询做
      // 样本回退，缓存里三口径齐全，切口径零额外成本。
      pool.query(
        `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
         SELECT to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS month,
                COUNT(*)::int AS count,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS median_pps,
                COUNT(*) FILTER (WHERE dt.is_offplan)::int AS count_offplan,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
                  FILTER (WHERE dt.is_offplan) AS median_pps_offplan,
                COUNT(*) FILTER (WHERE NOT dt.is_offplan)::int AS count_ready,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
                  FILTER (WHERE NOT dt.is_offplan) AS median_pps_ready
           FROM dld_transactions dt
           ${txJoin}
          CROSS JOIN bounds b
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0
            AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '37 months'
            AND dt.instance_date <= b.d
          GROUP BY 1 ORDER BY 1`,
        [areaId, usage]
      ),
      pool.query(
        `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
         SELECT to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS month,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS median_rent_sqm
           FROM dld_rent_contracts rc
           ${rentJoin}
          CROSS JOIN bounds b
          WHERE ${rentWhere}
            AND $2 IN ('all','residential')
            AND rc.usage_type = 'Residential'
            AND rc.property_area BETWEEN 15 AND 2000
            AND rc.annual_amount BETWEEN 5000 AND 5000000
            AND rc.start_date >= date_trunc('month', b.d) - INTERVAL '25 months'
            AND rc.start_date <= b.d
          GROUP BY 1 ORDER BY 1`,
        [areaId, usage]
      ),
      // 近期成交 30 条（混合，带期房/现房标签）—— 'all' 口径视图用
      pool.query(
        `SELECT dt.instance_date AS date, dt.building_name, dt.project_name, dt.rooms,
                dt.procedure_area AS size_sqm, dt.actual_worth AS price,
                round(dt.meter_sale_price) AS price_per_sqm,
                CASE WHEN dt.is_offplan THEN 'offplan' ELSE 'ready' END AS sale_type
           FROM dld_transactions dt
           ${txJoin}
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0
          ORDER BY dt.instance_date DESC
          LIMIT 30`,
        [areaId, usage]
      ),
      // 近期期房成交 30 条 —— 单独取！不能从混合 top-30 里筛：有的区（如 Palm
      // Jebel Ali）最近成交几乎全是非期房登记，筛完只剩 1 条，但更早的期房
      // 成交其实有几百笔。期房口径视图用这份。
      pool.query(
        `SELECT dt.instance_date AS date, dt.building_name, dt.project_name, dt.rooms,
                dt.procedure_area AS size_sqm, dt.actual_worth AS price,
                round(dt.meter_sale_price) AS price_per_sqm,
                'offplan' AS sale_type
           FROM dld_transactions dt
           ${txJoin}
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0 AND dt.is_offplan
          ORDER BY dt.instance_date DESC
          LIMIT 30`,
        [areaId, usage]
      ),
      // 近期现房成交 30 条 —— 口径筛选器的「现房」视图用（同上，单独取）
      pool.query(
        `SELECT dt.instance_date AS date, dt.building_name, dt.project_name, dt.rooms,
                dt.procedure_area AS size_sqm, dt.actual_worth AS price,
                round(dt.meter_sale_price) AS price_per_sqm,
                'ready' AS sale_type
           FROM dld_transactions dt
           ${txJoin}
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0 AND NOT dt.is_offplan
          ORDER BY dt.instance_date DESC
          LIMIT 30`,
        [areaId, usage]
      ),
      // Recent rental contracts (new + renewal) for the same area
      pool.query(
        `SELECT rc.start_date AS date, rc.project_name, rc.property_subtype, rc.property_type,
                rc.property_area AS size_sqm, rc.annual_amount AS annual_rent,
                round(rc.annual_amount / NULLIF(rc.property_area, 0)) AS rent_per_sqm,
                rc.registration_type
           FROM dld_rent_contracts rc
           ${rentJoin}
          WHERE ${rentWhere}
            AND $2 IN ('all','residential')
            AND rc.usage_type = 'Residential'
            AND rc.property_area BETWEEN 15 AND 2000
            AND rc.annual_amount BETWEEN 5000 AND 5000000
          ORDER BY rc.start_date DESC
          LIMIT 8`,
        [areaId, usage]
      ),
      // Median TOTAL transaction price (房子中位总价) over the last 12 months — 三口径。
      pool.query(
        `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) AS median_unit_price,
                COUNT(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE dt.is_offplan) AS median_unit_price_offplan,
                COUNT(*) FILTER (WHERE dt.is_offplan)::int AS n_offplan,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE NOT dt.is_offplan) AS median_unit_price_ready,
                COUNT(*) FILTER (WHERE NOT dt.is_offplan)::int AS n_ready
           FROM dld_transactions dt
           ${txJoin}
          CROSS JOIN bounds b
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
            AND dt.instance_date >= b.d - INTERVAL '12 months'`,
        [areaId, usage]
      )
    ])

    const byMonth = new Map<string, any>(salesRes.rows.map(r => [r.month, r]))
    const rentByMonth = new Map<string, number>(
      rentRes.rows
        .filter(r => r.median_rent_sqm != null)
        .map(r => [r.month, Number(r.median_rent_sqm)])
    )

    // 月份轴锚定全局数据时间（而不是该区域最后一笔成交）：
    // 稀疏区域近几个月没成交时，图表照样画到当前月，成交量显示 0
    const boundsRes = await pool.query(
      `SELECT to_char(date_trunc('month', MAX(instance_date)), 'YYYY-MM') AS m FROM dld_transactions`
    )
    const endYm: string = boundsRes.rows[0]?.m || salesRes.rows[salesRes.rows.length - 1]?.month
    const emptyVariant = { price: [], volume: [], growth: [], medianUnitPrice: null, count12m: 0 }
    if (!endYm) return {
      months: [], rentalYield: [], dataThrough: null,
      variants: { all: emptyVariant, offplan: emptyVariant, ready: emptyVariant },
      recentTransactions: [], recentTransactionsOffplan: [], recentTransactionsReady: [], recentRentals: []
    }

    const monthsWithLookback = monthRange(endYm, 37)  // 含 t-12，给同比用
    const months = monthsWithLookback.slice(-24)
    const idxOf = new Map(monthsWithLookback.map((m, i) => [m, i]))

    // 每口径一套 价格/量/同比 序列（列名后缀区分；'all' 用无后缀列）
    const segCols = (r: any, seg: 'all' | 'offplan' | 'ready') => seg === 'all'
      ? { count: r.count, pps: r.median_pps }
      : seg === 'offplan'
        ? { count: r.count_offplan, pps: r.median_pps_offplan }
        : { count: r.count_ready, pps: r.median_pps_ready }
    const mkSeries = (seg: 'all' | 'offplan' | 'ready') => {
      const pps37 = monthsWithLookback.map(m => {
        const r = byMonth.get(m)
        const v = r ? segCols(r, seg).pps : null
        return v != null ? Number(v) : null
      })
      const smooth = smooth3(pps37)
      const price = months.map(m => {
        const r = byMonth.get(m)
        const v = r ? segCols(r, seg).pps : null
        return v != null ? Number(v) : null
      })
      const volume = months.map(m => {
        const r = byMonth.get(m)
        return r ? Number(segCols(r, seg).count || 0) : 0
      })
      const growth = months.map(m => {
        const i = idxOf.get(m)!
        const cur = smooth[i]
        const prev = i >= 12 ? smooth[i - 12] : null
        if (cur == null || prev == null || prev <= 0) return null
        return Number((((cur - prev) / prev) * 100).toFixed(1))
      })
      return { smooth, price, volume, growth }
    }
    const sAll = mkSeries('all')
    const sOffplan = mkSeries('offplan')
    const sReady = mkSeries('ready')

    // 收益率永远用全口径价格做分母（租金全部来自已交付现房，期房价格做分母无意义）
    const rentSmooth = smooth3(months.map(m => rentByMonth.get(m) ?? null))
    const rentalYield = months.map((m, i) => {
      const rent = rentSmooth[i]
      const pps = sAll.smooth[idxOf.get(m)!]
      if (rent == null || pps == null || pps <= 0) return null
      return Number(((rent / pps) * 100).toFixed(2))
    })

    const mr = medianRes.rows[0] || {}
    const roundOrNull = (v: any) => v != null ? Math.round(Number(v)) : null
    const data = {
      months,
      rentalYield,
      dataThrough: endYm,
      variants: {
        all: { price: sAll.price, volume: sAll.volume, growth: sAll.growth,
               medianUnitPrice: roundOrNull(mr.median_unit_price), count12m: Number(mr.n || 0) },
        offplan: { price: sOffplan.price, volume: sOffplan.volume, growth: sOffplan.growth,
                   medianUnitPrice: roundOrNull(mr.median_unit_price_offplan), count12m: Number(mr.n_offplan || 0) },
        ready: { price: sReady.price, volume: sReady.volume, growth: sReady.growth,
                 medianUnitPrice: roundOrNull(mr.median_unit_price_ready), count12m: Number(mr.n_ready || 0) },
      },
      recentTransactions: recentRes.rows.map(mapTxRow),
      recentTransactionsOffplan: recentOffplanRes.rows.map(mapTxRow),
      recentTransactionsReady: recentReadyRes.rows.map(mapTxRow),
      recentRentals: recentRentRes.rows.map(r => ({
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        building: r.project_name || null,
        subtype: (r.property_subtype || r.property_type || '').trim() || null,
        sizeSqm: r.size_sqm ? Math.round(Number(r.size_sqm)) : null,
        annualRent: r.annual_rent ? Math.round(Number(r.annual_rent)) : null,
        rentPerSqm: r.rent_per_sqm ? Number(r.rent_per_sqm) : null,
        regType: (r.registration_type === 'New' ? 'new' : 'renew') as 'new' | 'renew',
      }))
    }
    return data
}

/**
 * 把三口径 raw 数据按请求的 segment 组装成响应（老字段形状不变 + 口径元信息）。
 * strict=true（前端口径筛选器显式选择）：尊重用户选择，不做样本回退——薄样本
 *   由前端凭 segmentCounts12m 出「样本少」警示。
 * strict=false（未显式传 segment 的调用方，如 Luna 工具走服务端默认口径）：
 *   保留样本护栏——近 12 个月样本 < SEGMENT_MIN_SAMPLE 回退 'all'，
 *   priceSegment/txSegment 如实标注实际口径。
 */
function composeAreaInsights(raw: any, segment: MarketSegment, strict = false) {
  const variants = raw?.variants
  if (!variants) return raw
  const eff: MarketSegment =
    segment === 'all' ? 'all'
      : strict ? segment
      : (variants[segment]?.count12m >= SEGMENT_MIN_SAMPLE ? segment : 'all')
  const v = variants[eff]
  // 成交列表：各口径都有专门取的 30 条（混合 top-30 里筛会漏掉更早的记录）。
  const lists: Record<'offplan' | 'ready' | 'all', any[]> = {
    offplan: raw.recentTransactionsOffplan || [],
    ready: raw.recentTransactionsReady || [],
    all: raw.recentTransactions || [],
  }
  const txSegment: MarketSegment = strict
    ? segment
    : (segment === 'offplan' && lists.offplan.length > 0 ? 'offplan' : 'all')
  return {
    months: raw.months,
    price: v.price,
    volume: v.volume,
    // 全口径月度成交量——成交量 tile 显示真实活跃度（含现房/地块），不随价格口径缩水
    volumeAll: variants.all.volume,
    growth: v.growth,
    rentalYield: raw.rentalYield,   // 固定全口径
    dataThrough: raw.dataThrough,
    medianUnitPrice: v.medianUnitPrice,
    segment,
    priceSegment: eff,
    segmentCounts12m: {
      all: variants.all.count12m,
      offplan: variants.offplan.count12m,
      ready: variants.ready.count12m,
    },
    txSegment,
    recentTransactions: lists[txSegment],
    recentRentals: raw.recentRentals,
  }
}

router.get('/area-insights', async (req: Request, res: Response) => {
  try {
    const areaId = String(req.query.areaId || '').trim()
    if (!areaId) return res.status(400).json({ error: 'areaId is required' })
    // areaId must be a dubai_areas UUID. Reject anything else with 400 — otherwise
    // a stray DLD integer area_id reaches `da.id = $1` and Postgres throws an
    // invalid-uuid error that surfaces as a 500 (this is what broke the project
    // detail page for City of Arabia). See projectInsights.ts area.id.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(areaId))
      return res.status(400).json({ error: 'areaId must be a valid area UUID' })
    // usage lens — default 'all' (the dialog shows everything, then filters); cache per usage.
    const usage = ['all','residential','commercial','hospitality','industrial','other'].includes(String(req.query.usage))
      ? String(req.query.usage) : 'all'
    // 市场口径 —— 显式传 segment（前端筛选器）= strict 尊重选择不回退；
    // 缺省调用（Luna 等）走 DEFAULT_SEGMENT + 样本护栏回退。
    // 缓存存的是三口径 raw，按口径组装零成本（同一份缓存服务所有口径）。
    const strict = req.query.segment !== undefined
    const segment = parseSegment(req.query.segment)
    const cacheKey = `insights:${areaId}:${usage}`
    const cached = txCacheGet(cacheKey)
    if (cached) return res.json(composeAreaInsights(cached, segment, strict))
    const data = await loadAreaInsightsData(areaId, usage)
    txCacheSet(cacheKey, data)
    res.json(composeAreaInsights(data, segment, strict))
  } catch (err) {
    console.error('[market/area-insights] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// 全区域预热：用户点任何区域都秒回（数据是定期快照，预热无副作用）。
// 启动 30s 后跑一轮，之后每 5 小时强制刷新（赶在 6h TTL 到期前续上）。
let warmingInsights = false
async function warmAreaInsights() {
  if (warmingInsights) return
  warmingInsights = true
  beginMaintenance() // 预热的慢查询不进 SLOW_QUERIES 报警(见 perfSink)
  try {
    const r = await pool.query(`SELECT id FROM dubai_areas WHERE visible = true`)
    let ok = 0
    for (const row of r.rows) {
      try {
        // Warm the SAME key the request path reads: `insights:${id}:${usage}`.
        // (Previously warmed `insights:${id}` — a key nothing ever looked up, so
        //  every first area click was a cold DB miss. That cold-miss storm is what
        //  saturated the pool under load — see docs/reports/2026-06-27-api-load-test.md.)
        const data = await loadAreaInsightsData(row.id, 'all')
        txCache.delete(`insights:${row.id}:all`)  // 重置插入序，刷新 TTL
        txCacheSet(`insights:${row.id}:all`, data)
        ok++
      } catch { /* 单区域失败不影响整轮 */ }
      await new Promise(resolve => setTimeout(resolve, 250))  // 让出 DB
    }
    console.log(`[market] area insights warmed: ${ok}/${r.rows.length}`)
  } catch (e) {
    console.error('[market] insights warm failed:', e)
  } finally {
    warmingInsights = false
    endMaintenance()
  }
}
setTimeout(warmAreaInsights, 30_000)
setInterval(warmAreaInsights, 5 * 60 * 60 * 1000)

// ---------------------------------------------------------------------------
// 区域分级判断（功能 C）—— 基于 get_dubai_area_metrics 的相对分位规则
// 方法论透明：阈值用全区域分位数（相对而非武断绝对值），reasons 可追溯
// ---------------------------------------------------------------------------

interface AreaMetricRow {
  id: string; name: string;
  transaction_count: number | null;
  capital_growth_pct: number | null;
  rental_yield_pct: number | null;
  median_unit_price: number | null;
  median_price_sqm: number | null;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

function classifyAreas(rows: AreaMetricRow[]) {
  const withData = rows.filter(r => r.transaction_count != null && r.capital_growth_pct != null)
  const vols = withData.map(r => Number(r.transaction_count)).sort((a, b) => a - b)
  const grows = withData.map(r => Number(r.capital_growth_pct)).sort((a, b) => a - b)
  const volHi = quantile(vols, 0.66)
  const volLo = quantile(vols, 0.33)
  const growHi = quantile(grows, 0.66)

  const thresholds = {
    volume_high: Math.round(volHi),
    volume_low: Math.round(volLo),
    growth_high_pct: Number(growHi.toFixed(1))
  }

  const classified = rows.map(r => {
    const vol = r.transaction_count == null ? null : Number(r.transaction_count)
    const grow = r.capital_growth_pct == null ? null : Number(r.capital_growth_pct)
    let tag = 'stable'
    let label = '平稳区'
    const reasons: string[] = []

    if (vol == null || grow == null) {
      tag = 'insufficient'; label = '数据不足'
      reasons.push('该区域成交样本不足，暂不分级。')
    } else if (vol >= volHi && grow >= growHi) {
      tag = 'growth'; label = '增长区'
      reasons.push(`成交活跃（${vol} 笔，处于全市前 1/3）`)
      reasons.push(`价格同比增长 ${grow.toFixed(1)}%（全市前 1/3）`)
    } else if (vol >= volHi && grow < 0) {
      tag = 'supply_pressure'; label = '供应压力区'
      reasons.push(`成交量大（${vol} 笔）但价格同比 ${grow.toFixed(1)}%（走弱）`)
      reasons.push('放量下跌通常提示供应充裕、议价空间较大')
    } else if (vol >= volHi) {
      tag = 'mature'; label = '成熟区'
      reasons.push(`成交活跃且流动性好（${vol} 笔，全市前 1/3）`)
      reasons.push(`价格增长温和（${grow.toFixed(1)}%），市场较成熟`)
    } else if (vol <= volLo) {
      tag = 'future'; label = '未来/新兴区'
      reasons.push(`成交量较低（${vol} 笔，全市后 1/3）`)
      reasons.push('早期/新兴区域，数据样本少、不确定性更高')
    } else {
      reasons.push(`成交量与价格增长均处中位（${vol} 笔，${grow.toFixed(1)}%）`)
    }

    return {
      id: r.id,
      name: r.name,
      tag,
      label,
      reasons,
      metrics: {
        transactionCount: vol,
        capitalGrowthPct: grow,
        rentalYieldPct: r.rental_yield_pct != null ? Number(r.rental_yield_pct) : null,
        medianUnitPrice: r.median_unit_price != null ? Number(r.median_unit_price) : null,
        medianPriceSqm: r.median_price_sqm != null ? Number(r.median_price_sqm) : null
      },
      perspective: {
        invest: tag === 'growth' ? '价格动能强，偏增值型投资可关注，但需注意是否已高位。'
          : tag === 'supply_pressure' ? '投资角度风险偏高（放量走弱）；但议价空间大，逢低布局者可留意。'
          : tag === 'mature' ? '流动性好、波动小，适合稳健收租型投资。'
          : tag === 'future' ? '高风险高潜在回报，押注未来兑现，需长期持有。'
          : '走势平稳，投资回报预期中性。',
        live: tag === 'supply_pressure' ? '自住角度反而是机会：选择多、价格有谈判余地。'
          : tag === 'mature' ? '配套成熟、转手容易，适合自住。'
          : tag === 'future' ? '新区配套可能未完善，自住需评估生活便利度。'
          : '自住体验取决于具体项目与配套。'
      }
    }
  })

  return { thresholds, areas: classified }
}

async function loadAreaMetricRows(): Promise<AreaMetricRow[]> {
  // 分级：增长按散客口径（默认期房，样本不足自动回退），成交量按全口径——
  // 流动性分位用期房数会把地块主导的区（如 Palm Jebel Ali）误判成低活跃。
  const r = await pool.query(
    `SELECT id, name, transaction_count_all AS transaction_count, capital_growth_pct,
            rental_yield_pct, median_unit_price, median_price_sqm
       FROM get_dubai_area_metrics('residential', $1)`,
    [DEFAULT_SEGMENT]
  )
  return r.rows
}

/** GET /area-classification — 全部区域分级（可选 ?name= 单区） */
router.get('/area-classification', async (req: Request, res: Response) => {
  try {
    const rows = await loadAreaMetricRows()
    const { thresholds, areas } = classifyAreas(rows)
    const name = String(req.query.name || '').trim().toLowerCase()
    const result = name
      ? areas.filter(a => a.name.toLowerCase().includes(name))
      : areas
    res.json({
      thresholds,
      methodology:
        '分级基于 DLD 成交：成交量与价格同比增长按全市分位数（前/后 1/3）相对划分，' +
        '而非武断绝对阈值。数据为定期快照，非实时。标签仅供参考，不构成投资建议。',
      count: result.length,
      areas: result.sort((a, b) => (b.metrics.transactionCount || 0) - (a.metrics.transactionCount || 0))
    })
  } catch (err) {
    console.error('[market/area-classification] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** GET /area-compare?a=&b= — 两区并排（按 id 或名称） */
router.get('/area-compare', async (req: Request, res: Response) => {
  try {
    const aKey = String(req.query.a || '').trim().toLowerCase()
    const bKey = String(req.query.b || '').trim().toLowerCase()
    if (!aKey || !bKey) return res.status(400).json({ error: 'a and b are required' })

    const rows = await loadAreaMetricRows()
    const { areas } = classifyAreas(rows)
    const pick = (k: string) =>
      areas.find(a => a.id.toLowerCase() === k) ||
      areas.find(a => a.name.toLowerCase() === k) ||
      areas.find(a => a.name.toLowerCase().includes(k))

    const A = pick(aKey)
    const B = pick(bKey)
    if (!A || !B) {
      return res.json({ matched: false, summary: '未能匹配到两个区域，请检查名称。' })
    }

    const yA = A.metrics.rentalYieldPct ?? 0
    const yB = B.metrics.rentalYieldPct ?? 0
    const gA = A.metrics.capitalGrowthPct ?? 0
    const gB = B.metrics.capitalGrowthPct ?? 0
    const summary =
      `${A.name}（${A.label}）vs ${B.name}（${B.label}）：` +
      `租金回报 ${yA.toFixed(1)}% vs ${yB.toFixed(1)}%，` +
      `价格增长 ${gA.toFixed(1)}% vs ${gB.toFixed(1)}%。` +
      `收租角度 ${yA >= yB ? A.name : B.name} 占优，` +
      `增值角度 ${gA >= gB ? A.name : B.name} 占优。`

    res.json({ matched: true, a: A, b: B, summary })
  } catch (err) {
    console.error('[market/area-compare] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// AI 买房决策报告（功能 E）—— 复用分级(C) + 投资测算
// 预测给区间(保守/中性/乐观)+ 明确免责，绝不给单一"稳赚"数字
// ---------------------------------------------------------------------------

type Goal = 'invest_growth' | 'invest_rent' | 'invest_both' | 'self_use' | 'self_invest'

const GOAL_LABEL: Record<Goal, string> = {
  invest_growth: '投资 · 资本增值优先',
  invest_rent: '投资 · 租金收益优先',
  invest_both: '投资 · 增值与收租兼顾',
  self_use: '自住',
  self_invest: '自住兼投资'
}

router.post('/buying-report', async (req: Request, res: Response) => {
  try {
    const goal: Goal = (req.body?.goal || 'invest_both')
    const budgetMax = Number(req.body?.budgetMax) || null
    const bedrooms = req.body?.bedrooms ? String(req.body.bedrooms) : null
    const horizon = Math.min(Math.max(Number(req.body?.horizonYears) || 5, 3), 10)
    if (!GOAL_LABEL[goal]) return res.status(400).json({ error: 'invalid goal' })

    const rows = await loadAreaMetricRows()
    const { areas } = classifyAreas(rows)

    // 只从流动性足够的区域推荐：低样本区指标(尤其增长率)不可靠，
    // 直接用会产生荒谬预测、损害信任。
    let pool0 = areas.filter(a =>
      (a.metrics.transactionCount ?? 0) >= 200 &&
      (a.metrics.rentalYieldPct != null || a.metrics.capitalGrowthPct != null)
    )
    if (budgetMax) {
      pool0 = pool0.filter(a => a.metrics.medianUnitPrice == null || a.metrics.medianUnitPrice <= budgetMax)
    }

    const score = (a: typeof pool0[number]) => {
      const y = a.metrics.rentalYieldPct ?? 0
      const g = a.metrics.capitalGrowthPct ?? 0
      const matureBonus = a.tag === 'mature' ? 1 : 0
      switch (goal) {
        case 'invest_growth': return g
        case 'invest_rent': return y
        case 'invest_both': return y * 1.2 + g
        case 'self_use': return matureBonus * 100 - (a.metrics.medianUnitPrice ?? 0) / 1e6
        case 'self_invest': return matureBonus * 50 + g + y
      }
    }
    const top = [...pool0].sort((x, y) => score(y) - score(x)).slice(0, 3)

    const recommendations = await Promise.all(top.map(async a => {
      const price = a.metrics.medianUnitPrice ||
        (budgetMax ? Math.min(budgetMax, 1_500_000) : 1_500_000)
      // 清洗：钳制到可辩护区间，杜绝低样本垃圾值导致的"稳赚"假象
      const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
      const rawGrowth = a.metrics.capitalGrowthPct ?? 0
      const rawYield = a.metrics.rentalYieldPct ?? 0
      const yieldPct = clamp(rawYield, 0, 11)
      const gNeutral = clamp(rawGrowth, -8, 15)
      const growthClamped = Math.abs(rawGrowth - gNeutral) > 0.1 || Math.abs(rawYield - yieldPct) > 0.1
      // 区间：保守 / 中性 / 乐观，三档均钳制
      const scen = (gp: number) => calculateInvestment5yr(price, yieldPct, gp)
      const projects = await pool.query(
        `SELECT id, developer, status, min_price, max_price, starting_price
           FROM residential_projects
          WHERE area ILIKE $1 ${budgetMax ? 'AND (min_price IS NULL OR min_price <= $2)' : ''}
          LIMIT 5`,
        budgetMax ? [`%${a.name}%`, budgetMax] : [`%${a.name}%`]
      )
      return {
        area: a.name,
        tag: a.tag,
        label: a.label,
        why: a.reasons,
        perspective: a.perspective,
        metrics: a.metrics,
        assumedPrice: price,
        paybackYears: calculatePaybackYears(yieldPct),
        dataQualityNote: growthClamped
          ? '该区原始增长/收益率为低样本极值，已钳制到可辩护区间后再测算。'
          : null,
        projection: {
          horizonYears: 5,
          conservative: scen(clamp(gNeutral * 0.4, 0, 5)),
          neutral: scen(gNeutral),
          optimistic: scen(clamp(gNeutral * 1.3, gNeutral, 18))
        },
        matchingProjects: projects.rows.map(p => ({
          id: p.id, developer: p.developer, status: p.status,
          minPrice: p.min_price ? Number(p.min_price) : null,
          maxPrice: p.max_price ? Number(p.max_price) : null
        }))
      }
    }))

    res.json({
      goal,
      goalLabel: GOAL_LABEL[goal],
      budgetMax,
      bedrooms,
      horizonYears: horizon,
      generatedAt: new Date().toISOString().slice(0, 10),
      recommendations,
      assumptions: [
        '价格基准为该区 DLD 成交中位总价（无则按预算估算）。',
        '收益率/增长率取该区近 12 个月 DLD 成交推导值。',
        '5 年预测三档：保守=历史增长×0.4(封顶6%)、中性=历史增长、乐观=×1.3。',
        '租金按当前收益率简单线性估算，未计空置、服务费、交易税费。'
      ],
      disclaimer:
        '本报告基于 Dubai Land Department 历史成交数据的结构化测算，仅供决策参考，' +
        '不构成投资建议或收益保证。房地产价格受政策、供需、宏观等多因素影响，' +
        '实际结果可能与预测区间存在显著差异。数据为定期快照，非实时。'
    })
  } catch (err) {
    console.error('[market/buying-report] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
