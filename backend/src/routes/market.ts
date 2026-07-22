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
import { beginMaintenance, endMaintenance, yieldToLiveTraffic } from '../services/perfSink'
import { cached, prime } from '../services/microCache'
import { readPersisted, persisting } from '../services/persistentCache'

const router = Router()

/**
 * 住宅价格口径 —— 算 price/sqft、中位总价、涨幅时用它。
 *
 * 原来只取 Unit/Villa,排除所有 Land。设计意图是对的:沙漠荒地(便宜/巨大)会把
 * 住宅单价拉垮(如 Shharrj ₫262/sqft 实为地价)。
 *
 * 🔴 但它误伤了**期房别墅社区**。owner 实测:「DAMAC Lagoons 别墅没有搜出来」——
 *    根因:DLD 把期房别墅登记成 **property_type='Land'**(买的是「地块+建villa合同」)。
 *    Portofino / Santorini / Costa Brava 这些最有名的别墅子社区,**全是 Land**,
 *    于是被这个口径整个剔掉 —— 13000+ 笔真实别墅成交,一笔都搜不到。
 *
 *    区分很干净(实测):
 *      • Land **有项目名** → 36,123 笔,中位 13,110/㎡ —— 真别墅社区,价格合理
 *      • Land **无项目名** → 4,010 笔,中位 5,217/㎡ —— 荒地/自建地块,继续排除
 *
 *    所以纯增量放行:Land 且有 project_name = 开发商别墅社区,该算进住宅。
 *    (property_usage='Residential' 的上游过滤保证了这里的 Land 不含工商业地块。)
 */
const RES_PT = `(dt.property_type IN ('Unit','Villa') OR (dt.property_type = 'Land' AND dt.project_name IS NOT NULL AND dt.project_name <> ''))`

const SQFT_PER_SQM = 10.7639

/**
 * 价格判断**只回 level**,不回文案。
 *
 * 这里以前还拼 `label` + `explanation` 两段中文 —— 而唯一的消费方
 * (frontend PriceCheckModule) 早就改成读 level 自己走 t('compare:priceCheck.*') 渲染,
 * **那两个字段算完、序列化、传过网络,然后被整个丢弃**。典型的死负载:
 * 白烧 CPU/带宽,还让人误以为后端在负责这段文案(于是 i18n 盘点时被算成"待翻译")。
 *
 * 阈值语义(前端 VERDICT_KEY / eAbove|eBelow|eInline 与此一一对应,改这里必须同步那里):
 *   sampleCount < 30 → insufficient(样本不足,不给判断)
 *   premium > 25%    → high
 *   premium > 10%    → above
 *   premium < -10%   → below
 *   其余             → inline
 */
function verdictFor(premiumPct: number, sampleCount: number) {
  if (sampleCount < 30) return { level: 'insufficient' as const }
  if (premiumPct > 25) return { level: 'high' as const }
  if (premiumPct > 10) return { level: 'above' as const }
  if (premiumPct < -10) return { level: 'below' as const }
  return { level: 'inline' as const }
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
        // (summary 已删:PriceCheckModule 只读 matched/reason,自己走 t() 出文案。)
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
            AND ${RES_PT}
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
        // (summary 已删:同上,前端按 sampleCount===0 自己出文案。)
      })
    }

    const median = Number(d.p50)
    const premiumPct =
      projectPricePerSqm != null && median > 0
        ? ((projectPricePerSqm - median) / median) * 100
        : null

    const verdict =
      premiumPct == null
        ? { level: 'no_project_price' as const }
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
      // (methodology 已删:PriceCheckModule 用自己的 tk('methodology') 译文,
      //  后端这段中文算完传过去就被丢弃 —— 死负载。)
    })
  } catch (err) {
    console.error('[market/price-check] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// 成交查询（功能 B）—— 直接面向 dld_transactions 的多维聚合
// ---------------------------------------------------------------------------

/**
 * 户型下拉。**必须是 dld_transactions.rooms 的原值**（该列是白名单校验用的，
 * 见 buildTxFilter），DLD 全量取值只有：
 *   Studio / 1-7 B/R / 9 B/R / PENTHOUSE / Single Room / Shop / Office
 * ⛔ 经纪要的「1.5 房 / 2+1 保姆房 / 3+1 / 4+1」**DLD 根本不记录**，靠面积倒推
 *    就是编数据 —— 别加。(2026-07-21 客户反馈，已当面回绝。)
 * 排除 Single Room(58 笔，劳工房)/Shop/Office(非住宅，被 property_usage 挡掉)、
 * 9 B/R(全库 4 笔)。6/7 B/R + PENTHOUSE 原来被砍掉了 → 顶豪户型一条都筛不出来。
 * ⚠️ 改这里必须同步 backend/scripts/market-precompute.ts 的同名常量并重跑预计算，
 *    否则缓存的下拉还是旧的（那份才是生产实际吐给前端的）。
 */
const ROOM_OPTIONS = ['Studio', '1 B/R', '2 B/R', '3 B/R', '4 B/R', '5 B/R', '6 B/R', '7 B/R', 'PENTHOUSE']

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

// area-insights lives in microCache (TTL + single-flight), keyed by area AND usage.
const INSIGHTS_TTL_MS = 6 * 60 * 60 * 1000
const insightsKey = (areaId: string, usage: string) => `mkt:insights:${areaId}:${usage}`
// Only 'all' is worth prewarming: the frontend OMITS the usage param for its
// default lens (api.ts) and this route maps a missing param to 'all', so every
// ordinary area click reads insights:<id>:all. No caller ever asks for
// usage=residential. The rare explicit lenses fall back to single-flight.
const WARM_USAGES = ['all'] as const

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
    RES_PT,
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
  // 楼栋筛选 —— 「同一社区分 A/B/C 栋要能分开查」。选楼盘 = 该盘全部楼栋,
  // 选楼栋 = 只看这一栋。与 project 一样支持多选(经纪常把 Tower A+B 合起来看)。
  if (q.building) {
    const list = (Array.isArray(q.building) ? q.building : [q.building])
      .map((b: any) => String(b).trim().toUpperCase())
      .filter(Boolean)
    if (list.length > 0) {
      params.push(list)
      parts.push(`UPPER(dt.building_name) = ANY($${params.length}::text[])`)
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
          AND ${RES_PT}
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
        AND ${RES_PT}
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

/**
 * 统一搜索建议 —— 一个搜索框同时搜「区域 / 楼盘 / 楼栋」。
 *
 * 经纪的原话:「搜索框直接搜社区名、building 名;如果一个社区分 ABCD 栋或 1-10 栋,
 * 能分开查成交,也能用社区名查全部。」DLD 的数据结构正好支持:
 *   project_name = 社区/楼盘(Sobha Creek Vistas Heights)
 *   building_name = 楼栋(… - Tower A / Tower B)  填充率 82.4%
 * 所以 project 项 = 「全部楼栋」,building 项 = 单栋,两级都能选。
 *
 * 三类候选一次算好缓存(6h + market_cache 持久化):全表 group-by 冷算要数秒,
 * 而这是用户敲第一个字母就要响应的接口。
 */
interface SuggestIndex {
  areas: { name: string; count: number }[]
  projects: { name: string; area: string | null; count: number; buildings: number }[]
  buildings: { name: string; project: string | null; area: string | null; count: number }[]
}

async function loadSuggestIndex(): Promise<SuggestIndex> {
  const cached = txCacheGet('suggest')
  if (cached) return cached
  const pc = await txPrecomputed('suggest')
  if (pc) { txCacheSet('suggest', pc); return pc }
  const [areas, projects, buildings] = await Promise.all([
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.area_name) AS name, COUNT(*)::int AS count
         FROM dld_transactions dt
        WHERE dt.trans_group = 'Sales' AND dt.property_usage = 'Residential' AND ${RES_PT}
          AND dt.meter_sale_price BETWEEN 1000 AND 250000 AND dt.procedure_area > 0
          AND dt.area_name IS NOT NULL AND dt.area_name <> ''
        GROUP BY UPPER(dt.area_name) HAVING COUNT(*) >= 50 ORDER BY count DESC`
    ),
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.project_name) AS name,
              mode() WITHIN GROUP (ORDER BY dt.area_name) AS area,
              COUNT(*)::int AS count,
              COUNT(DISTINCT UPPER(dt.building_name))::int AS buildings
         FROM dld_transactions dt
        WHERE dt.trans_group = 'Sales' AND dt.property_usage = 'Residential' AND ${RES_PT}
          AND dt.meter_sale_price BETWEEN 1000 AND 250000 AND dt.procedure_area > 0
          AND dt.project_name IS NOT NULL AND dt.project_name <> ''
        GROUP BY UPPER(dt.project_name) HAVING COUNT(*) >= 10 ORDER BY count DESC`
    ),
    pool.query(
      `SELECT mode() WITHIN GROUP (ORDER BY dt.building_name) AS name,
              mode() WITHIN GROUP (ORDER BY dt.project_name) AS project,
              mode() WITHIN GROUP (ORDER BY dt.area_name) AS area,
              COUNT(*)::int AS count
         FROM dld_transactions dt
        WHERE dt.trans_group = 'Sales' AND dt.property_usage = 'Residential' AND ${RES_PT}
          AND dt.meter_sale_price BETWEEN 1000 AND 250000 AND dt.procedure_area > 0
          AND dt.building_name IS NOT NULL AND dt.building_name <> ''
        GROUP BY UPPER(dt.building_name) HAVING COUNT(*) >= 5 ORDER BY count DESC`
    ),
  ])
  const data: SuggestIndex = { areas: areas.rows, projects: projects.rows, buildings: buildings.rows }
  txCacheSet('suggest', data)
  return data
}

/** 打分排序:前缀命中 > 词首命中 > 子串命中;同档按成交量。 */
function scoreMatch(name: string, q: string): number {
  const n = name.toLowerCase()
  if (!n.includes(q)) return -1
  if (n.startsWith(q)) return 3
  // 「lagoon」应该命中「DAMAC LAGOONS - NICE 1」的第二个词
  if (new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(n)) return 2
  return 1
}

router.get('/transactions/suggest', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase()
    const idx = await loadSuggestIndex()
    if (!q) {
      // 空查询 = 刚点开搜索框:给最活跃的区域,别一上来就糊一脸楼盘名
      return res.json({ suggestions: idx.areas.slice(0, 8).map(a => ({ type: 'area', ...a })) })
    }
    type S = { type: 'area' | 'project' | 'building'; name: string; count: number; score: number
               area?: string | null; project?: string | null; buildings?: number }
    const out: S[] = []
    for (const a of idx.areas) {
      const s = scoreMatch(a.name, q)
      if (s > 0) out.push({ type: 'area', name: a.name, count: a.count, score: s })
    }
    for (const p of idx.projects) {
      const s = scoreMatch(p.name, q)
      if (s > 0) out.push({ type: 'project', name: p.name, count: p.count, score: s, area: p.area, buildings: p.buildings })
    }
    for (const b of idx.buildings) {
      const s = scoreMatch(b.name, q)
      // 楼栋名常与楼盘名几乎重复(project「Creek Waters」/ building「Creek Waters」),
      // 完全同名的楼栋不再单列 —— 选楼盘就已经覆盖它,列出来只是噪音。
      if (s > 0 && b.name.toLowerCase() !== (b.project || '').toLowerCase())
        out.push({ type: 'building', name: b.name, count: b.count, score: s, project: b.project, area: b.area })
    }
    // 区域优先(买家先想"哪个区"),其次匹配质量,再次成交量
    const typeRank = { area: 0, project: 1, building: 2 }
    out.sort((x, y) => (y.score - x.score) || (typeRank[x.type] - typeRank[y.type]) || (y.count - x.count))
    res.json({ suggestions: out.slice(0, 12).map(({ score, ...rest }) => rest) })
  } catch (err) {
    console.error('[market/transactions/suggest] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

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
    if (!q.area && !q.areaId && !q.project && !q.building && !q.rooms && !q.from && !q.to && !q.minPrice && !q.maxPrice) {
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

// 增值率周期(月)。与前端 PeriodSelector 一一对应。
export const APPRECIATION_PERIODS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12, '2y': 24, '3y': 36, '5y': 60 } as const

export type AppreciationPeriod = keyof typeof APPRECIATION_PERIODS
export type Appreciation = Partial<Record<AppreciationPeriod, number | null>>

/**
 * 增值率 = 滚动窗口中位价之比(非点对点)。用 3 个月平滑后的中位价/㎡ 序列，
 * 取「最新窗口」vs「往前推 N 个月的窗口」。护栏:任一端点 3 个月窗口成交量
 * < MIN → 该周期返回 null(前端显示样本不足，绝不硬报抖动数)。
 * @param smoothed 63 个月的 3-月平滑中位价/㎡(index 0=最早, 末位=最新)
 * @param counts   同轴逐月成交量(未平滑)
 */
function computeAppreciation(smoothed: (number | null)[], counts: number[]): Appreciation {
  const MIN_ENDPOINT = 10 // 端点 3 个月窗口最少成交量
  // 合理带:超出即判为户型/地块结构漂移的假信号(稀疏沙漠/工业区常见,如某季只卖
  // 地块、下季卖别墅 → 中位价跳 20 倍)。宁可显示「—」也不报 +2000% 这种数。
  const MAX_GAIN = 400, MAX_LOSS = -80
  const end = smoothed.length - 1
  const win3 = (i: number) => (counts[i] || 0) + (counts[i - 1] || 0) + (counts[i - 2] || 0)
  const out: Appreciation = {}
  const endVal = smoothed[end]
  const endOk = endVal != null && endVal > 0 && win3(end) >= MIN_ENDPOINT
  for (const [k, months] of Object.entries(APPRECIATION_PERIODS) as [AppreciationPeriod, number][]) {
    const start = end - months
    if (!endOk || start < 0) { out[k] = null; continue }
    const startVal = smoothed[start]
    if (startVal == null || startVal <= 0 || win3(start) < MIN_ENDPOINT) { out[k] = null; continue }
    const pct = Number((((endVal! - startVal) / startVal) * 100).toFixed(1))
    out[k] = pct > MAX_GAIN || pct < MAX_LOSS ? null : pct
  }
  return out
}

/**
 * 毛租金回报的两道护栏 —— **三条路径共用,别再各写各的**。
 *
 * `YIELD_BAND`:迪拜住宅毛回报实际落在 4-10%,超过 15% 或低于 1% 说明租金与成交
 *   描述的根本不是同一批房子(户型/产权/新旧结构错配),宁可显示「—」。
 * `MIN_YIELD_SALES`:回报率的**分母**(中位价/㎡)必须有像样的成交样本。
 *   实测 Wadi Al Amardi 3 年只成交 4 笔却有 124 份租约、Al Qusais 2 成交 5 笔 /
 *   租约 7178 份、Al Khawaneej 2 成交**1 笔** —— 拿一两笔成交的中位价当分母就是胡说。
 *
 * 三条路径:周期指标(computeWindowedMetrics)/ 年份时间轴(loadAreaMonthly)/
 * 区域详情顶层曲线(loadAreaInsightsData 的 rentalYield)。
 * 这三处**各写各的硬编码,已经因此栽了三次**(最近一次:顶层曲线两道护栏全无,
 * 32 个区画假曲线,Wadi Al Amardi 峰值 20125%)。改阈值只改这里。
 */
export const YIELD_BAND_MIN = 1
export const YIELD_BAND_MAX = 15
export const MIN_YIELD_SALES = 30

/** 单个周期窗口内的全指标值(「近N期」口径)。 */
export interface PeriodMetrics {
  growth: number | null      // 窗口涨幅(端点滚动窗口中位价之比)
  priceSqm: number | null    // 窗口内中位价/㎡(成交量加权月度中位;标「近N期」非现价)
  unitPrice: number | null   // 窗口内中位总价(同上)
  count: number              // 窗口内成交量(精确)
  yield: number | null       // 窗口内中位租金/㎡ ÷ 窗口内中位价/㎡(仅 all 口径)
}
export type MetricsByPeriod = Partial<Record<AppreciationPeriod, PeriodMetrics>>

/**
 * 各周期窗口的全指标。价格/总价/回报=窗口内成交量加权的月度中位(近似真·窗口中位，
 * 免 63×percentile 重查;UI 标「近N期」而非现价)。成交量=窗口内笔数(精确)。
 * 增值率沿用端点滚动比(computeAppreciation)。回报只在 all 口径(rentSqm 非空)算。
 * @param pps/unit/cnt 63 月月度中位价/㎡、中位总价、成交量(index 末位=最新)
 * @param rentSqm 63 月月度中位租金/㎡(仅 all 口径传;其余传 null)
 */
export function computeWindowedMetrics(
  pps: (number | null)[], unit: (number | null)[], cnt: number[], rentSqm: (number | null)[] | null
): MetricsByPeriod {
  const MIN_WIN = 5
  const growth = computeAppreciation(smooth3(pps), cnt)
  const end = pps.length - 1
  const round = (n: number) => Math.round(n)
  const out: MetricsByPeriod = {}
  for (const [k, months] of Object.entries(APPRECIATION_PERIODS) as [AppreciationPeriod, number][]) {
    const from = Math.max(0, end - months + 1)
    let wCnt = 0, pSum = 0, pW = 0, uSum = 0, uW = 0, rSum = 0, rN = 0
    for (let i = from; i <= end; i++) {
      const c = cnt[i] || 0
      wCnt += c
      if (pps[i] != null && c > 0) { pSum += (pps[i] as number) * c; pW += c }
      if (unit[i] != null && c > 0) { uSum += (unit[i] as number) * c; uW += c }
      if (rentSqm && rentSqm[i] != null) { rSum += rentSqm[i] as number; rN += 1 }
    }
    const enough = wCnt >= MIN_WIN
    const priceSqm = enough && pW > 0 ? pSum / pW : null
    const unitPrice = enough && uW > 0 ? round(uSum / uW) : null
    const rentAvg = rN > 0 ? rSum / rN : null
    // 🔴 回报率的**分母**(中位价/㎡)必须有像样的成交样本,MIN_WIN=5 对它远远不够。
    // 实测:Wadi Al Amardi 3 年只成交 4 笔却有 124 份租约 → 回报率 35.7%;
    // Al Qusais 2 成交 5 笔 / 租约 7178 份 → 23.0%;Al Khawaneej 2 成交**1 笔** → 13.1%。
    // 这些是本地人自住、几乎不交易的老城区,拿一两笔成交的中位价当分母就是胡说。
    // 另加合理带:迪拜住宅毛回报实际落在 4-10%,超过 15% 或低于 1% 说明租金与成交
    // 描述的根本不是同一批房子(户型/产权/新旧结构错配),宁可显示「—」。
    // 同 computeAppreciation 的 MAX_GAIN/MAX_LOSS 思路。
    const yieldRaw = priceSqm != null && priceSqm > 0 && rentAvg != null
      ? Number(((rentAvg / priceSqm) * 100).toFixed(2)) : null
    const yieldPct = yieldRaw != null && wCnt >= MIN_YIELD_SALES
      && yieldRaw >= YIELD_BAND_MIN && yieldRaw <= YIELD_BAND_MAX ? yieldRaw : null
    out[k] = {
      growth: growth[k] ?? null,
      priceSqm: priceSqm != null ? round(priceSqm) : null,
      unitPrice,
      count: wCnt,
      yield: yieldPct,
    }
  }
  return out
}

/** 以 endYm（'YYYY-MM'）结尾、共 n 个月的连续日历月份轴 */
export function monthRange(endYm: string, n: number): string[] {
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
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE ${RES_PT}) AS median_pps,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) FILTER (WHERE ${RES_PT}) AS median_up,
                COUNT(*) FILTER (WHERE dt.is_offplan)::int AS count_offplan,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
                  FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS median_pps_offplan,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS median_up_offplan,
                COUNT(*) FILTER (WHERE NOT dt.is_offplan)::int AS count_ready,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
                  FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS median_pps_ready,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS median_up_ready
           FROM dld_transactions dt
           ${txJoin}
          CROSS JOIN bounds b
          WHERE ${txWhere}
            AND dt.trans_group = 'Sales' AND ($2 = 'all' OR dld_usage_bucket(dt.property_usage) = $2)
            AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
            -- 63 个月:24 个月展示 + t-12 同比 需 37;增值率/窗口指标最长 5 年(60)+3 个月
            -- 滚动窗口 需 63。一次扫全，切周期零额外查询。
            AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '63 months'
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
            -- 🔴 排除劳工宿舍/整栋打包合同(整栋多床位记在一个小单元面积上)。
            -- 这条护栏 bulk 侧一直有、dialog 侧漏了 → 顶层 rentalYield 序列被污染,
            -- 而它**没有 1-15% 合理带兜底**(见下方 rentalYield 计算),直接喂前端画图。
            -- 租金中位数偏离 >5% 的区有 9 个,但其中多数(Madinat Hind 3 / Grayteesah /
            -- Jebel Ali Industrial / Muhaisnah 2)住宅成交量是个位数、**没有分母**,
            -- 曲线本来就是空的 → 护栏对它们无可见影响。
            -- **真正被这条护栏救回来的是 Al Layyan**:2 年 1876 笔成交、价 14,370/㎡,
            -- 而污染后的租金中位 14,145/㎡ → 前端画出 ~98% 的回报率曲线。
            -- ⚠️ 查这类问题必须同时看「租金偏差」和「有没有成交价分母」,
            --    只按租金偏差排序会得出夸大的结论(本次就先犯了一次)。
            AND rc.annual_amount / rc.property_area BETWEEN 100 AND 6000
            -- 63 月:回报率窗口最长 5 年(60)+ 平滑;原 25 月只够 2 年展示序列
            AND rc.start_date >= date_trunc('month', b.d) - INTERVAL '63 months'
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
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) FILTER (WHERE ${RES_PT}) AS median_unit_price,
                COUNT(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS median_unit_price_offplan,
                COUNT(*) FILTER (WHERE dt.is_offplan)::int AS n_offplan,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
                  FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS median_unit_price_ready,
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

    // 展示序列长度 48 个月:前端图表按所选周期(最长 3 年=36)切片放大 → 序列必须够长,
    // 否则 2 年/3 年图撞 24 个月天花板一模一样。48+12(同比 lookback)=60 ≤ SQL 取的 63,
    // 且 months=slice(-48) 的首月在 lookback 轴 index 12 → 全 48 个月同比都有效不缺头。
    const DISPLAY_MONTHS = 48
    const monthsWithLookback = monthRange(endYm, DISPLAY_MONTHS + 12)  // 含 t-12，给同比用
    const months = monthsWithLookback.slice(-DISPLAY_MONTHS)
    const idxOf = new Map(monthsWithLookback.map((m, i) => [m, i]))
    const apprMonths = monthRange(endYm, 63)  // 增值率用(最长 5 年 + 平滑窗口)

    // 每口径一套 价格/量/同比 序列（列名后缀区分；'all' 用无后缀列）
    const segCols = (r: any, seg: 'all' | 'offplan' | 'ready') => seg === 'all'
      ? { count: r.count, pps: r.median_pps, up: r.median_up }
      : seg === 'offplan'
        ? { count: r.count_offplan, pps: r.median_pps_offplan, up: r.median_up_offplan }
        : { count: r.count_ready, pps: r.median_pps_ready, up: r.median_up_ready }
    // 63 月月度中位租金/㎡(仅 all;期房价格做分母无意义),给回报率窗口用
    const rent63 = apprMonths.map(m => rentByMonth.get(m) ?? null)
    const mkSeries = (seg: 'all' | 'offplan' | 'ready') => {
      const ppsAxis = monthsWithLookback.map(m => {
        const r = byMonth.get(m)
        const v = r ? segCols(r, seg).pps : null
        return v != null ? Number(v) : null
      })
      const smooth = smooth3(ppsAxis)
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
      // 增值率:63 个月平滑序列 + 逐月成交量 → 各周期滚动窗口之比
      const pps63 = apprMonths.map(m => {
        const r = byMonth.get(m)
        const v = r ? segCols(r, seg).pps : null
        return v != null ? Number(v) : null
      })
      const cnt63 = apprMonths.map(m => {
        const r = byMonth.get(m)
        return r ? Number(segCols(r, seg).count || 0) : 0
      })
      const unit63 = apprMonths.map(m => {
        const r = byMonth.get(m)
        const v = r ? segCols(r, seg).up : null
        return v != null ? Number(v) : null
      })
      const appreciation = computeAppreciation(smooth3(pps63), cnt63)
      // 🔴 三个口径都喂同一份租金基数 —— 与 loadAllAreaAppreciation 的 seg() 完全一致。
      // 原来是 `seg === 'all' ? rent63 : null`,那是地图 bulk 侧早已修掉、dialog 侧
      // 漏改的同一行。后果:只要该区默认落到期房/现房口径(新盘几乎必然),
      // metricsByPeriod.yield 就是 null —— 实测抽样 40 个区,**32 个的周期回报率是空的**,
      // 其中 25 个正是栽在这里。且与自定义区无关,官方区一样中招。
      // 租约本身没有期房/现房之分(能出租的必然是现房),但那不该让指标整个消失:
      // 回报率 = 现房市场租金 ÷ 该口径成交价,对期房就是「按期房价买入、按当前市场价
      // 出租能拿多少」。租金基数是现房这件事由 UI 的「existing stock」角标说明。
      const metrics = computeWindowedMetrics(pps63, unit63, cnt63, rent63)
      return { smooth, price, volume, growth, appreciation, metrics }
    }
    const sAll = mkSeries('all')
    const sOffplan = mkSeries('offplan')
    const sReady = mkSeries('ready')

    // 收益率永远用全口径价格做分母（租金全部来自已交付现房，期房价格做分母无意义）
    //
    // 🔴 这条序列**前端直接拿去画图**,却曾经一道护栏都没有 —— 越是给客户看的越没护栏。
    // 稀疏区就拿一两笔非住宅成交当分母:Wadi Al Amardi 每月只成交 1-3 笔且全是
    // Building/Land/Villa(整栋楼/地块),其中有 **8 迪拉姆/㎡** 的地块成交 →
    // 曲线画到 **20125%**。全站 32 个区有越界点(Al Layyan 287% / Al Aweer 182%)。
    //
    // ⚠️ 只加合理带,**故意不加分母样本门槛**。第一版跟着时间轴抄了
    // `roll3(pps, cnt, 30)`,结果是过度杀伤 —— 实测阈值扫描:
    //   门槛 0(仅合理带) → 32 个越界区全清,正常区被砍 0 个
    //   门槛 10          → 32 个,正常区被砍 24 个
    //   门槛 30          → 32 个,正常区被砍 31 个,21 个成熟区曲线整条抹光
    //                      (Al Barsha Second / Al Satwa / Al Manara / Al Bada …)
    // 收益恒为 32,代价随门槛单调上升 → 门槛毫无价值。原因:分母只有一两笔成交
    // 的后果**必然是比值离谱**,而离谱本身就会被合理带挡掉,不需要再数一遍样本。
    // (周期指标那层的 MIN_YIELD_SALES=30 是**周期窗口**口径,别再往 3 个月窗口上套。)
    // 这些老城区本地人自住、季度成交不足 30 笔,但租赁市场很活跃,曲线是真实有效的。
    const rentSmooth = smooth3(months.map(m => rentByMonth.get(m) ?? null))
    const rentalYield = months.map((m, i) => {
      const rent = rentSmooth[i]
      const pps = sAll.smooth[idxOf.get(m)!]
      if (rent == null || pps == null || pps <= 0) return null
      const y = Number(((rent / pps) * 100).toFixed(2))
      return y >= YIELD_BAND_MIN && y <= YIELD_BAND_MAX ? y : null
    })

    const mr = medianRes.rows[0] || {}
    const roundOrNull = (v: any) => v != null ? Math.round(Number(v)) : null
    const data = {
      months,
      rentalYield,
      dataThrough: endYm,
      variants: {
        all: { price: sAll.price, volume: sAll.volume, growth: sAll.growth, appreciation: sAll.appreciation, metrics: sAll.metrics,
               medianUnitPrice: roundOrNull(mr.median_unit_price), count12m: Number(mr.n || 0) },
        offplan: { price: sOffplan.price, volume: sOffplan.volume, growth: sOffplan.growth, appreciation: sOffplan.appreciation, metrics: sOffplan.metrics,
                   medianUnitPrice: roundOrNull(mr.median_unit_price_offplan), count12m: Number(mr.n_offplan || 0) },
        ready: { price: sReady.price, volume: sReady.volume, growth: sReady.growth, appreciation: sReady.appreciation, metrics: sReady.metrics,
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
 * 全市增值率基准(三口径)。与区域视图默认口径(usage='all',不加 usage 过滤)一致，
 * 供 AreaBlock 显示「本区 vs 全市」。全表 percentile 较重 → microCache 6h + 预热。
 */
async function loadCityAppreciation(): Promise<Record<'all' | 'offplan' | 'ready', Appreciation>> {
  const boundsRes = await pool.query(
    `SELECT to_char(date_trunc('month', MAX(instance_date)), 'YYYY-MM') AS m FROM dld_transactions`
  )
  const endYm: string = boundsRes.rows[0]?.m
  const empty = { all: {}, offplan: {}, ready: {} }
  if (!endYm) return empty
  const trend = await pool.query(
    `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
     SELECT to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS month,
            COUNT(*)::int AS count,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE ${RES_PT}) AS median_pps,
            COUNT(*) FILTER (WHERE dt.is_offplan)::int AS count_offplan,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
              FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS median_pps_offplan,
            COUNT(*) FILTER (WHERE NOT dt.is_offplan)::int AS count_ready,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
              FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS median_pps_ready
       FROM dld_transactions dt CROSS JOIN bounds b
      WHERE dt.trans_group = 'Sales' AND dt.meter_sale_price > 0
        AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '63 months'
        AND dt.instance_date <= b.d
      GROUP BY 1 ORDER BY 1`
  )
  const byMonth = new Map<string, any>(trend.rows.map(r => [r.month, r]))
  const apprMonths = monthRange(endYm, 63)
  const seg = (col: 'all' | 'offplan' | 'ready') => {
    const pps = apprMonths.map(m => {
      const r = byMonth.get(m)
      const v = r ? (col === 'all' ? r.median_pps : col === 'offplan' ? r.median_pps_offplan : r.median_pps_ready) : null
      return v != null ? Number(v) : null
    })
    const cnt = apprMonths.map(m => {
      const r = byMonth.get(m)
      return r ? Number((col === 'all' ? r.count : col === 'offplan' ? r.count_offplan : r.count_ready) || 0) : 0
    })
    return computeAppreciation(smooth3(pps), cnt)
  }
  return { all: seg('all'), offplan: seg('offplan'), ready: seg('ready') }
}

const CITY_APPR_KEY = 'mkt:appr:city'

/**
 * 全部官方区域的各周期增值率(三口径),给地图按周期上色。一次聚合查全区 ×
 * 月度中位价,JS 里算各区各口径的滚动窗口增值率。手绘区(synthetic 900000+ 桥)
 * 天然不匹配真实 area_id → 不在此 → 地图对手绘区不按周期着色(与其常缺 rolling
 * metrics 的现状一致)。全表 percentile 较重 → microCache 6h + 预热。
 */
// 增值率月度聚合的 SELECT 列 —— 官方区(area_id bridge)与自定义手绘区(geocode 空间匹配)
// 共用同一份列,保证两条路(以及 dialog 的 /area-insights)口径一致。
// 价格中位(pps/up)按 Unit/Villa 过滤:排除 Land/Building,避免沙漠地价冒充住宅单价
// (如 Shharrj 的 ₫262/sqft 实为大地块 —— 中位 1058㎡、最大 32874㎡)。
// 成交量 count 仍全口径(活跃度信号,含地块),与既有 volumeAll 约定一致。RES_PT 见文件顶部。
const apprMonthlyCols = (areaIdSql: string) => `${areaIdSql} AS area_id,
              to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS month,
              COUNT(*)::int AS count,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE ${RES_PT}) AS pps,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) FILTER (WHERE ${RES_PT}) AS up,
              COUNT(*) FILTER (WHERE dt.is_offplan)::int AS count_offplan,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS pps_offplan,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) FILTER (WHERE dt.is_offplan AND ${RES_PT}) AS up_offplan,
              COUNT(*) FILTER (WHERE NOT dt.is_offplan)::int AS count_ready,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS pps_ready,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) FILTER (WHERE NOT dt.is_offplan AND ${RES_PT}) AS up_ready`

type AllAreaAppr = { dataThrough: string | null; areas: Record<string, Record<'all' | 'offplan' | 'ready', MetricsByPeriod>> }
async function loadAllAreaAppreciation(): Promise<AllAreaAppr> {
  const boundsRes = await pool.query(
    `SELECT to_char(date_trunc('month', MAX(instance_date)), 'YYYY-MM') AS m FROM dld_transactions`
  )
  const endYm: string = boundsRes.rows[0]?.m
  if (!endYm) return { dataThrough: null, areas: {} }
  const [officialRows, customRows, rentRows, customRentRows] = await Promise.all([
    // 官方区:走真实 area_id bridge。
    pool.query(
      `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
       SELECT ${apprMonthlyCols('dla.dubai_area_id')}
         FROM dld_transactions dt
         JOIN dld_areas dla ON dla.area_id = dt.area_id
         CROSS JOIN bounds b
        WHERE dt.trans_group = 'Sales' AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
          AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '63 months'
          AND dt.instance_date <= b.d
        GROUP BY 1, 2`
    ),
    // 自定义手绘区:无真实 area_id bridge → 走 geocode 空间匹配(与 /area-insights 同口径)。
    // 不加这条,地图周期着色对 107 个自定义区一律灰,但 dialog 却有数 → 地图≠dialog。
    // 空间聚合实测 ~0.7s(走 GiST 索引),6h 缓存 + 预热,可接受。
    pool.query(
      `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
       SELECT ${apprMonthlyCols('da.id')}
         FROM dubai_areas da
         JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
         JOIN dld_transactions dt ON dt.area_name = loc.area_name
              AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__') = loc.project_name
         CROSS JOIN bounds b
        WHERE da.visible AND da.boundary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000)
          AND dt.trans_group = 'Sales' AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
          AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '63 months'
          AND dt.instance_date <= b.d
        GROUP BY 1, 2`
    ),
    // 各区月度中位租金/㎡(residential;仅 all 口径回报用)。dubai_area_id 已回填。
    // 官方区走 bridge(rc.dubai_area_id);自定义手绘区没有 bridge,由下面那条
    // spatial 查询补(见 customRentRows)。
    pool.query(
      `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
       SELECT rc.dubai_area_id AS area_id,
              to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS month,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS rent_sqm
         FROM dld_rent_contracts rc CROSS JOIN bounds b
        WHERE rc.usage_type = 'Residential' AND rc.dubai_area_id IS NOT NULL
          AND rc.property_area BETWEEN 15 AND 2000 AND rc.annual_amount BETWEEN 5000 AND 5000000
          -- 🔴 排除劳工宿舍/整栋打包合同。实测:Jebel Ali Industrial 中位「住宅」
          -- 租金 38.4 万/年而中位面积只有 20 ㎡(每㎡ 21,857),Muhaisnah 2(Sonapur)
          -- 同款。那是整栋/多床位合同记在一个小单元面积上,混进来会让工业区在地图上
          -- 显示成全市最贵的租金区 —— 迪拜经纪一眼就知道是假的。
          -- 全样本每㎡年租中位数 1018,p95 却到 50,454,明显是两个不同的人群。
          -- 棕榈岛豪宅约 3000/㎡,6000 上限对真实住宅足够宽松。
          AND rc.annual_amount / rc.property_area BETWEEN 100 AND 6000
          AND rc.start_date >= date_trunc('month', b.d) - INTERVAL '63 months' AND rc.start_date <= b.d
        GROUP BY 1, 2`
    ),
    // 🔴 自定义手绘区的月度租金 —— 与上面那条的唯一区别是「怎么找到这个区的租约」。
    // 手绘区没有 DLD area_id bridge,rc.dubai_area_id 永远是 NULL,所以上面那条
    // 对它们一条都取不到 → rent63 全 null → yield 全 null。实测 176 个区里
    // 100 个没有回报率,客户直接圈图反馈(Sobha Heartland / Villanova /
    // Dubai Residence complex / Azizi Rivera 都是成交上千笔却没有回报率)。
    // 成交侧上次已经补了 spatial 分支(customRows),租金侧漏了 —— 同款
    // 「地图 ≠ dialog 双路径不对齐」,见 [[map-dialog-metric-path-parity]]。
    // 匹配口径与 /area-insights 的 rentJoin 完全一致(项目名落点 + 区中心兜底),
    // 实测 2.4s / 出 40 个区,与其余三条并行 + 6h 缓存 + 预热,可接受。
    pool.query(
      `WITH bounds AS (SELECT MAX(instance_date) AS d FROM dld_transactions)
       SELECT da.id AS area_id,
              to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS month,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area) AS rent_sqm
         FROM dubai_areas da
         JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
         JOIN dld_rent_contracts rc ON rc.area_name = loc.area_name
              AND COALESCE(NULLIF(rc.project_name, ''), '__AREA__') = loc.project_name
         CROSS JOIN bounds b
        WHERE da.visible AND da.boundary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000)
          AND rc.usage_type = 'Residential'
          AND rc.property_area BETWEEN 15 AND 2000 AND rc.annual_amount BETWEEN 5000 AND 5000000
          -- 同上:排除劳工宿舍/整栋打包合同(理由见上一条查询的注释)
          AND rc.annual_amount / rc.property_area BETWEEN 100 AND 6000
          AND rc.start_date >= date_trunc('month', b.d) - INTERVAL '63 months' AND rc.start_date <= b.d
        GROUP BY 1, 2`
    ),
  ])
  const apprMonths = monthRange(endYm, 63)
  const byArea = new Map<string, Map<string, any>>()
  // 官方区与自定义区 id 互斥(前者有 bridge,后者 NOT EXISTS),合并不冲突。
  for (const r of [...officialRows.rows, ...customRows.rows]) {
    const id = String(r.area_id)
    if (!byArea.has(id)) byArea.set(id, new Map())
    byArea.get(id)!.set(r.month, r)
  }
  const rentByArea = new Map<string, Map<string, number>>()
  // 官方区(bridge)与自定义区(spatial)的 id 互斥,同 byArea 的合并理由。
  for (const r of [...rentRows.rows, ...customRentRows.rows]) {
    if (r.rent_sqm == null) continue
    const id = String(r.area_id)
    if (!rentByArea.has(id)) rentByArea.set(id, new Map())
    rentByArea.get(id)!.set(r.month, Number(r.rent_sqm))
  }
  const areas: AllAreaAppr['areas'] = {}
  for (const [id, months] of byArea) {
    const rentMonths = rentByArea.get(id)
    const rent63 = apprMonths.map(m => rentMonths?.get(m) ?? null)
    const seg = (col: 'all' | 'offplan' | 'ready') => {
      const pps = apprMonths.map(m => {
        const r = months.get(m); const v = r ? (col === 'all' ? r.pps : col === 'offplan' ? r.pps_offplan : r.pps_ready) : null
        return v != null ? Number(v) : null
      })
      const up = apprMonths.map(m => {
        const r = months.get(m); const v = r ? (col === 'all' ? r.up : col === 'offplan' ? r.up_offplan : r.up_ready) : null
        return v != null ? Number(v) : null
      })
      const cnt = apprMonths.map(m => {
        const r = months.get(m)
        return r ? Number((col === 'all' ? r.count : col === 'offplan' ? r.count_offplan : r.count_ready) || 0) : 0
      })
      // 🔴 三个口径都喂同一份租金基数。
      // 原来是 `col === 'all' ? rent63 : null` —— 结果选「现房」或「期房」+ 回报率时
      // 整张地图一个数都没有(实测 ready/offplan 下 yield 非空的区 = 0),而界面还照常
      // 显示「Yield · 3Y · existing stock」,是典型的静默失败(见 [[silent-failure-paths]])。
      // 租约本身没有期房/现房之分(能出租的必然是现房),但那不该让指标整个消失:
      // 回报率 = 现房市场租金 ÷ 该口径成交价。对期房就是「按期房价买入、按当前市场价
      // 出租能拿多少」—— 恰恰是买家要的数。租金基数是现房这件事由 UI 的
      // 「existing stock / 现楼出租参考」角标说明。
      return computeWindowedMetrics(pps, up, cnt, rent63)
    }
    areas[id] = { all: seg('all'), offplan: seg('offplan'), ready: seg('ready') }
  }
  return { dataThrough: endYm, areas }
}

const ALL_AREA_APPR_KEY = 'mkt:appr:areas'

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
    appreciation: v.appreciation,   // 各周期增值率(跟随 segment 口径);全市基准由 route 注入
    metricsByPeriod: v.metrics,     // 各周期全指标窗口值(价格/总价/成交量/回报;跟随 segment)
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
    // Single-flight matters here: the map dialog fires several area-insights calls
    // at once, and on a cold key N concurrent misses would each run the full
    // aggregate in parallel. They now share ONE query.
    const [data, cityAppr] = await Promise.all([
      cached(insightsKey(areaId, usage), INSIGHTS_TTL_MS, () => loadAreaInsightsData(areaId, usage)),
      cached(CITY_APPR_KEY, INSIGHTS_TTL_MS, persisting(CITY_APPR_KEY, loadCityAppreciation)),
    ])
    const composed = composeAreaInsights(data, segment, strict)
    // 全市基准跟随实际展示口径(priceSegment),保证「本区 vs 全市」同口径可比。
    composed.appreciationCity = cityAppr[(composed.priceSegment as 'all' | 'offplan' | 'ready')] ?? cityAppr.all
    res.json(composed)
  } catch (err) {
    console.error('[market/area-insights] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ─────────────────────────── 月度时间轴 (地图 timeline 模式) ───────────────────────────
//
// 口径说明(改这里前先读完):
//   · 原始表最早只到 2021-01-01 —— dld_rent_contracts / dld_transactions 皆然。
//     所以时间轴只能是 2021-01 起,再往前没有。**别去碰 dubai_area_yearly_metrics**:
//     它带 1975-2026 的 year 列看着正合适,但 2020 年前的值无法从现有原始表复算、
//     无法校验(源快照已不存在),median_unit_price 更是只有 2025/2026 有值。
//   · **必须 3 个月滚动窗口,不能用单月值。** 实测单月 ≥30 样本只覆盖 65%(租金)/
//     46%(成交)的「区×月」,3 个月滚动提到 78%/58%。但更要命的不是覆盖率而是**噪声**:
//     薄样本的单月中位数会乱跳,拖时间轴时那些抖动看着像市场在动,其实是采样噪声 ——
//     而拖时间轴的全部目的就是看趋势。滚动窗口口径与 /area-appreciation 的 smooth3 一致。
//   · 滚动值 = 窗口内**月度中位数按成交量加权平均**(非真·窗口中位数)。这是全站既有
//     近似(见 computeWindowedMetrics),免去逐窗口重跑 percentile。UI 标「近3个月」。
//   · 成交必须 trans_group='Sales' —— 22% 是 Mortgages/Gifts,不加这条会得出反向结论。
//   · 成交价沿用 RES_PT(Unit/Villa),排除 Land/Building,否则沙漠地块拉垮住宅单价。
//   · 租金取 New:迪拜续约受 RERA 租金指数管制,把续约混进来会**压平**波动 ——
//     而时间轴要展示的正是波动。
//   · 自定义手绘区没有 area_id bridge,必须走 ST_Covers 空间匹配 —— 不加这条分支,
//     地图上 100+ 个自定义区在 timeline 模式下会整片变灰。
const MONTHLY_MIN_SALES = 30   // 3 个月窗口内少于此不出成交中位数
const MONTHLY_MIN_RENT = 30    // 同上,租约
const ROLL = 3                 // 滚动窗口月数
const FIRST_DATA_YEAR = 2021   // 原始表起点,硬事实

/** 各区一条按月轴对齐的序列。null = 该窗口样本不足 → 地图上是灰的。 */
type AreaSeries = {
  rent: (number | null)[]     // 近3个月中位年租金(AED, New)
  price: (number | null)[]    // 近3个月中位成交总价(AED)
  priceSqm: (number | null)[] // 近3个月中位价/㎡
  growth: (number | null)[]   // 同比:priceSqm 对 12 个月前之比 %
  count: number[]             // 近3个月成交笔数(精确,不做样本门槛)
  yieldPct: (number | null)[] // 毛租金回报 = 中位租金/㎡ ÷ 中位价/㎡
}
type AreaMonthly = {
  dataThrough: string | null
  months: string[]           // 'YYYY-MM',升序
  areas: Record<string, AreaSeries>
}

/** 成交量加权的 3 个月滚动平均(权重=当月样本数)。窗口内总量 < min 则 null。 */
function roll3(vals: (number | null)[], cnts: number[], min: number): (number | null)[] {
  return vals.map((_, i) => {
    let sum = 0, w = 0, n = 0
    for (let k = Math.max(0, i - (ROLL - 1)); k <= i; k++) {
      const c = cnts[k] || 0
      n += c
      if (vals[k] != null && c > 0) { sum += (vals[k] as number) * c; w += c }
    }
    if (n < min || w === 0) return null
    return Math.round(sum / w)
  })
}

export async function loadAreaMonthly(): Promise<AreaMonthly> {
  const bounds = await pool.query(
    `SELECT to_char(date_trunc('month', MAX(instance_date)), 'YYYY-MM') AS m FROM dld_transactions`
  )
  const endYm: string | null = bounds.rows[0]?.m ?? null
  if (!endYm) return { dataThrough: null, months: [], areas: {} }

  // 从 2021-01 到最新月的连续月轴
  const [ey, em] = endYm.split('-').map(Number)
  const months: string[] = []
  for (let y = FIRST_DATA_YEAR; y <= ey; y++) {
    for (let mo = 1; mo <= 12; mo++) {
      if (y === ey && mo > em) break
      months.push(`${y}-${String(mo).padStart(2, '0')}`)
    }
  }
  const idx = new Map(months.map((m, i) => [m, i]))

  const salesCols = (idExpr: string) => `
        ${idExpr} AS area_id,
        to_char(date_trunc('month', dt.instance_date), 'YYYY-MM') AS mo,
        COUNT(*) FILTER (WHERE ${RES_PT}) AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)
          FILTER (WHERE ${RES_PT}) AS unit_price,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)
          FILTER (WHERE ${RES_PT}) AS price_sqm`

  const [officialRows, customRows, rentRows, customRentRows] = await Promise.all([
    pool.query(
      `SELECT ${salesCols('dla.dubai_area_id')}
         FROM dld_transactions dt
         JOIN dld_areas dla ON dla.area_id = dt.area_id
        WHERE dt.trans_group = 'Sales' AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
          AND dt.instance_date >= make_date($1, 1, 1)
          AND dla.dubai_area_id IS NOT NULL
        GROUP BY 1, 2`,
      [FIRST_DATA_YEAR]
    ),
    pool.query(
      `SELECT ${salesCols('da.id')}
         FROM dubai_areas da
         JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
         JOIN dld_transactions dt ON dt.area_name = loc.area_name
              AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__') = loc.project_name
        WHERE da.visible AND da.boundary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000)
          AND dt.trans_group = 'Sales' AND dt.meter_sale_price > 0 AND dt.actual_worth > 0
          AND dt.instance_date >= make_date($1, 1, 1)
        GROUP BY 1, 2`,
      [FIRST_DATA_YEAR]
    ),
    pool.query(
      `SELECT rc.dubai_area_id AS area_id,
              to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS mo,
              COUNT(*) FILTER (WHERE rc.registration_type = 'New') AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount)
                FILTER (WHERE rc.registration_type = 'New') AS rent,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area)
                FILTER (WHERE rc.registration_type = 'New') AS rent_sqm
         FROM dld_rent_contracts rc
        WHERE rc.usage_type = 'Residential' AND rc.dubai_area_id IS NOT NULL
          AND rc.property_area BETWEEN 15 AND 2000
          AND rc.annual_amount BETWEEN 5000 AND 5000000
          -- 🔴 排除劳工宿舍/整栋打包合同。实测:Jebel Ali Industrial 中位「住宅」
          -- 租金 38.4 万/年而中位面积只有 20 ㎡(每㎡ 21,857),Muhaisnah 2(Sonapur)
          -- 同款。那是整栋/多床位合同记在一个小单元面积上,混进来会让工业区在地图上
          -- 显示成全市最贵的租金区 —— 迪拜经纪一眼就知道是假的。
          -- 全样本每㎡年租中位数 1018,p95 却到 50,454,明显是两个不同的人群。
          -- 棕榈岛豪宅约 3000/㎡,6000 上限对真实住宅足够宽松。
          AND rc.annual_amount / rc.property_area BETWEEN 100 AND 6000
          AND rc.start_date >= make_date($1, 1, 1)
        GROUP BY 1, 2`,
      [FIRST_DATA_YEAR]
    ),
    // 自定义手绘区的租金(spatial)。理由同 loadAllAreaAppreciation 里的 customRentRows:
    // 上面那条只认 rc.dubai_area_id,手绘区永远 NULL → 时间轴切到「回报率」时
    // 这些区整条时间线全灰。成交侧(customRows)早已补过 spatial,租金侧漏了。
    pool.query(
      `SELECT da.id AS area_id,
              to_char(date_trunc('month', rc.start_date), 'YYYY-MM') AS mo,
              COUNT(*) FILTER (WHERE rc.registration_type = 'New') AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount)
                FILTER (WHERE rc.registration_type = 'New') AS rent,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / rc.property_area)
                FILTER (WHERE rc.registration_type = 'New') AS rent_sqm
         FROM dubai_areas da
         JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
         JOIN dld_rent_contracts rc ON rc.area_name = loc.area_name
              AND COALESCE(NULLIF(rc.project_name, ''), '__AREA__') = loc.project_name
        WHERE da.visible AND da.boundary IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000)
          AND rc.usage_type = 'Residential'
          AND rc.property_area BETWEEN 15 AND 2000
          AND rc.annual_amount BETWEEN 5000 AND 5000000
          AND rc.annual_amount / rc.property_area BETWEEN 100 AND 6000
          AND rc.start_date >= make_date($1, 1, 1)
        GROUP BY 1, 2`,
      [FIRST_DATA_YEAR]
    ),
  ])

  const N = months.length
  const blank = () => new Array(N).fill(null) as (number | null)[]
  const zeros = () => new Array(N).fill(0) as number[]
  // 先按月轴摊平成裸序列,再统一做滚动
  const raw = new Map<string, {
    up: (number | null)[]; ps: (number | null)[]; sc: number[]
    rt: (number | null)[]; rs: (number | null)[]; rc: number[]
  }>()
  const bucket = (id: string) => {
    let b = raw.get(id)
    if (!b) { b = { up: blank(), ps: blank(), sc: zeros(), rt: blank(), rs: blank(), rc: zeros() }; raw.set(id, b) }
    return b
  }
  for (const r of [...officialRows.rows, ...customRows.rows]) {
    const i = idx.get(r.mo); if (r.area_id == null || i === undefined) continue
    const b = bucket(String(r.area_id))
    b.sc[i] = Number(r.n || 0)
    if (r.unit_price != null) b.up[i] = Number(r.unit_price)
    if (r.price_sqm != null) b.ps[i] = Number(r.price_sqm)
  }
  for (const r of [...rentRows.rows, ...customRentRows.rows]) {
    const i = idx.get(r.mo); if (r.area_id == null || i === undefined) continue
    const b = bucket(String(r.area_id))
    b.rc[i] = Number(r.n || 0)
    if (r.rent != null) b.rt[i] = Number(r.rent)
    if (r.rent_sqm != null) b.rs[i] = Number(r.rent_sqm)
  }

  const areas: AreaMonthly['areas'] = {}
  for (const [id, b] of raw) {
    const price = roll3(b.up, b.sc, MONTHLY_MIN_SALES)
    const priceSqm = roll3(b.ps, b.sc, MONTHLY_MIN_SALES)
    const rent = roll3(b.rt, b.rc, MONTHLY_MIN_RENT)
    const rentSqm = roll3(b.rs, b.rc, MONTHLY_MIN_RENT)
    // 成交量:窗口内笔数,精确值,**不设样本门槛** —— 「这仨月只成交了 3 笔」本身
    // 就是有效信息(冷清),不该因为「样本不足」被抹成灰。
    const count = b.sc.map((_, i) => {
      let n = 0
      for (let k = Math.max(0, i - (ROLL - 1)); k <= i; k++) n += b.sc[k] || 0
      return n
    })
    // 毛回报 = 中位租金/㎡ ÷ 中位价/㎡。两端任一为空则空。
    // 合理带同 computeWindowedMetrics:超 15% / 低于 1% 说明租金与成交不是同一批房子。
    // (priceSqm 本身已有 MONTHLY_MIN_SALES=30 的门槛,分母样本问题在那一层已挡住。)
    const yieldPct = rentSqm.map((r, i) => {
      const p = priceSqm[i]
      if (r == null || p == null || p <= 0) return null
      const y = Number(((r / p) * 100).toFixed(2))
      return y >= YIELD_BAND_MIN && y <= YIELD_BAND_MAX ? y : null
    })
    // 同比:两端都要有值。合理带同 computeAppreciation,免得稀疏区因户型结构漂移
    // 报出 +2000% 这种假信号。
    const growth = priceSqm.map((v, i) => {
      const prev = i >= 12 ? priceSqm[i - 12] : null
      if (v == null || prev == null || prev <= 0) return null
      const pct = Number((((v - prev) / prev) * 100).toFixed(1))
      return pct > 400 || pct < -80 ? null : pct
    })
    areas[id] = { rent, price, priceSqm, growth, count, yieldPct }
  }
  // 裁掉开头 ROLL-1 个月:那几帧的滚动窗口不满(2021-01 只有 1 个月的量),覆盖率
  // 明显偏低。留着的话时间轴开头会呈现「区域由少变多」的假象 —— 看着像市场在扩张,
  // 其实只是窗口在填满。每一帧都用完整窗口才诚实。
  const cut = ROLL - 1
  for (const id of Object.keys(areas)) {
    const a = areas[id]
    areas[id] = {
      rent: a.rent.slice(cut), price: a.price.slice(cut),
      priceSqm: a.priceSqm.slice(cut), growth: a.growth.slice(cut),
      count: a.count.slice(cut), yieldPct: a.yieldPct.slice(cut),
    }
  }
  return { dataThrough: endYm, months: months.slice(cut), areas }
}

const AREA_MONTHLY_KEY = 'mkt:monthly:areas'

/**
 * GET /area-monthly — 各区逐月(近3个月滚动)中位租金/成交价/同比,地图 timeline 拖动条用。
 * 前端一次全取、拖动零请求(着色走 feature-state,见 lib/map/timeline.ts)。
 */
router.get('/area-monthly', async (_req: Request, res: Response) => {
  try {
    const data = await cached(AREA_MONTHLY_KEY, INSIGHTS_TTL_MS, persisting(AREA_MONTHLY_KEY, loadAreaMonthly))
    res.set('Cache-Control', 'public, max-age=1800')
    res.json(data)
  } catch (err) {
    console.error('[market/area-monthly] error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})


/** GET /area-appreciation — 全部官方区各周期增值率(三口径),地图按周期上色用。 */
router.get('/area-appreciation', async (_req: Request, res: Response) => {
  try {
    const data = await cached(ALL_AREA_APPR_KEY, INSIGHTS_TTL_MS, persisting(ALL_AREA_APPR_KEY, loadAllAreaAppreciation))
    res.set('Cache-Control', 'public, max-age=1800')
    res.json(data)
  } catch (err) {
    console.error('[market/area-appreciation] error:', err)
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
    // 全市基准 + 全区各周期增值率先暖(全表 percentile 重,别让第一个客户等它)。
    try { prime(CITY_APPR_KEY, await persisting(CITY_APPR_KEY, loadCityAppreciation)()) } catch { /* 非致命 */ }
    await yieldToLiveTraffic()
    try { prime(ALL_AREA_APPR_KEY, await persisting(ALL_AREA_APPR_KEY, loadAllAreaAppreciation)()) } catch { /* 非致命 */ }
    await yieldToLiveTraffic()
    try { prime(AREA_MONTHLY_KEY, await persisting(AREA_MONTHLY_KEY, loadAreaMonthly)()) } catch { /* 非致命 */ }
    const r = await pool.query(`SELECT id FROM dubai_areas WHERE visible = true`)
    let ok = 0
    const want = r.rows.length * WARM_USAGES.length
    for (const row of r.rows) {
      // 有真人在飞就等 —— 预热没有 deadline,客户有。见 perfSink.yieldToLiveTraffic。
      await yieldToLiveTraffic()
      // Warm the SAME keys the request path reads (insightsKey), or the warm round
      // is a no-op that only burns DB while starving live requests.
      for (const usage of WARM_USAGES) {
        try {
          const data = await loadAreaInsightsData(row.id, usage)
          prime(insightsKey(row.id, usage), data)  // 刷新 TTL
          ok++
        } catch { /* 单区域/单口径失败不影响整轮 */ }
      }
      await new Promise(resolve => setTimeout(resolve, 250))  // 让出 DB
    }
    console.log(`[market] area insights warmed: ${ok}/${want} (${WARM_USAGES.join(',')})`)
  } catch (e) {
    console.error('[market] insights warm failed:', e)
  } finally {
    warmingInsights = false
    endMaintenance()
  }
}
/**
 * 启动即从 DB 端出上次算好的结果 —— 这是修「每次发版后第一个开地图的用户等 12-14 秒」
 * 的关键一步。预热器要 30 秒后才开跑,而且自己也得先算完;在那之前来的请求原本只能冷算。
 * 数据一天才更一次,端出几小时前的版本不损失新鲜度。
 */
async function hydrateFromDb() {
  for (const key of [CITY_APPR_KEY, ALL_AREA_APPR_KEY, AREA_MONTHLY_KEY]) {
    try {
      const hit = await readPersisted(key)
      if (hit) {
        prime(key, hit.data)
        console.log(`[market] 持久缓存水合 ${key}(算于 ${hit.computedAt.toISOString()})`)
      }
    } catch { /* 拿不到就照常冷算,绝不因此挂掉启动 */ }
  }
}
void hydrateFromDb()

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

  // 分级结果**只回结构化的 tag + reason code + 参数**,不回中文文案。
  //
  // 以前这里还拼 label(「增长区」)、reasons(「成交活跃（123 笔，处于全市前 1/3）」)
  // 和 perspective(两段投资/自住建议)—— 全是中文,而 /area-classification 是面向
  // 客户的接口。更要命的是前端把 label 当插值塞进 t('filter.tag', { label }) ——
  // **中文就这么漏进了已经翻好的译文里**。
  //
  // label 和 perspective 完全由 tag 决定(一一映射),属于纯冗余 → 删掉,前端按 tag
  // 自己 t()。reasons 带数字,改成 { code, params } 由前端 t(code, params) 渲染
  // (与价格体检 verdict.level 同一范式)。
  const classified = rows.map(r => {
    const vol = r.transaction_count == null ? null : Number(r.transaction_count)
    const grow = r.capital_growth_pct == null ? null : Number(r.capital_growth_pct)
    let tag = 'stable'
    const reasons: { code: string; params?: Record<string, number> }[] = []

    if (vol == null || grow == null) {
      tag = 'insufficient'
      reasons.push({ code: 'insufficientSample' })
    } else if (vol >= volHi && grow >= growHi) {
      tag = 'growth'
      reasons.push({ code: 'volActiveTop', params: { n: vol } })
      reasons.push({ code: 'growTop', params: { pct: Number(grow.toFixed(1)) } })
    } else if (vol >= volHi && grow < 0) {
      tag = 'supply_pressure'
      reasons.push({ code: 'volHighGrowNeg', params: { n: vol, pct: Number(grow.toFixed(1)) } })
      reasons.push({ code: 'volHighGrowNegNote' })
    } else if (vol >= volHi) {
      tag = 'mature'
      reasons.push({ code: 'volActiveLiquid', params: { n: vol } })
      reasons.push({ code: 'growModerate', params: { pct: Number(grow.toFixed(1)) } })
    } else if (vol <= volLo) {
      tag = 'future'
      reasons.push({ code: 'volLowBottom', params: { n: vol } })
      reasons.push({ code: 'earlyStageNote' })
    } else {
      reasons.push({ code: 'volGrowMedian', params: { n: vol, pct: Number(grow.toFixed(1)) } })
    }

    return {
      id: r.id,
      name: r.name,
      tag,
      reasons,
      metrics: {
        transactionCount: vol,
        capitalGrowthPct: grow,
        rentalYieldPct: r.rental_yield_pct != null ? Number(r.rental_yield_pct) : null,
        medianUnitPrice: r.median_unit_price != null ? Number(r.median_unit_price) : null,
        medianPriceSqm: r.median_price_sqm != null ? Number(r.median_price_sqm) : null
      },
      // label / perspective 已删 —— 二者都是 tag 的一一映射,前端按 tag 出 t() 即可。
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
      // methodology 文案已移到前端(t('areaInsights:classification.methodology'))——
      // 这是面向客户的接口,后端不产中文散文。阈值本身在 thresholds 里,是数据不是文案。
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
      return res.json({ matched: false, reason: 'area_unmatched' })
    }

    // summary 曾是后端拼好的一整句中文。这句话的每个成分(两个区名、两组数字、
    // 两个"谁占优")前端全都有 —— 拼句子是**展示**,不是数据。且中文语序也不适用于
    // 其他 4 种语言。改成回结构化裁决,前端用 t(..., params) 出句。
    const yA = A.metrics.rentalYieldPct ?? 0
    const yB = B.metrics.rentalYieldPct ?? 0
    const gA = A.metrics.capitalGrowthPct ?? 0
    const gB = B.metrics.capitalGrowthPct ?? 0
    const verdict = {
      yieldWinner: (yA >= yB ? 'a' : 'b') as 'a' | 'b',
      growthWinner: (gA >= gB ? 'a' : 'b') as 'a' | 'b',
    }

    res.json({ matched: true, a: A, b: B, verdict })
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
        // label / perspective 已删 —— 都是 tag 的一一映射,前端按 tag 出 t()。
        tag: a.tag,
        why: a.reasons,   // 现在是 [{ code, params }],前端 t(code, params) 渲染
        metrics: a.metrics,
        assumedPrice: price,
        paybackYears: calculatePaybackYears(yieldPct),
        // 文案交前端:回 code 就够了(这里没有参数)。
        dataQualityNote: growthClamped ? 'growth_clamped' : null,
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
