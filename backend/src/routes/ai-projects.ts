/**
 * AI Projects API — endpoints consumed by voice tools and future AI features.
 * Mounted at /api/ai/projects
 */

import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { calculateInvestment5yr, calculatePaybackYears } from '../services/investment-calculator'
import { resolveArea } from '../services/area-matcher'

const router = Router()

/**
 * 🔴 `dubai_area_rolling_metrics` 同一个区、同一个月有 **13 行**
 * (usage × segment 的笛卡尔积)。不带过滤直接 `ORDER BY period_end_month DESC LIMIT 1`
 * 拿到的是**随机一行** —— 2026-07-20 事故里 Business Bay 取到了 `commercial/all`
 * (写字楼,price_growth_pct = 79.9),而住宅那行是 10.9。
 *
 * 住宅项目只能看 `usage='residential' AND segment='all'`。
 */
const RESIDENTIAL_METRIC_FILTER = `dam.usage = 'residential' AND dam.segment = 'all'`

interface SearchFilters {
  area?: string
  /** resolveArea() 解析出的规范区名。见 buildSearchWhere 里的说明。 */
  areaCanonical?: string | null
  minPrice?: number | null
  maxPrice?: number | null
  bedrooms?: number | null
  developer?: string
  status?: string
}

/** 把 filters 拼成 WHERE 片段(接在 `WHERE rp.verified = true` 之后) */
function buildSearchWhere(f: SearchFilters): { sql: string; values: any[] } {
  let sql = ''
  const values: any[] = []
  let paramIndex = 1

  if (f.area) {
    /**
     * 🔴 **这里曾经藏着 area-matcher.ts 那个字母序抽奖 bug 的孪生兄弟。**
     *
     * 旧版第三层是:
     *   EXISTS (SELECT 1 FROM unnest(string_to_array(LOWER($2),' ')) AS word
     *           WHERE LENGTH(word) > 2 AND LOWER(rp.area) LIKE '%'||word||'%')
     *
     * 「用户说的任意一个 >2 字符的词出现在项目所在区名里就算命中」。于是:
     *   查 "Jumeirah Village Circle (JVC)" → `village` 一词命中
     *   → 返回 **Jebel Ali Village** 的项目。
     *
     * 2026-07-20 修 area-matcher.ts 时只修了 /api/ai/areas/match 那条路,**漏了这条**
     * —— 模型层跑分(luna-eval-live.ts 的 jvc-parens 用例)当场把它揪了出来:
     * 工具返回的是 Jebel Ali Village 的盘,Luna 却在讲 JVC。
     *
     * 现在:用 resolveArea() 解析出的**规范区名**去匹配(它已经处理了缩写、拼写变体、
     * 库里的首尾空格),外加用户原话本身。**词级 OR 那层整个删掉** —— 它命中的
     * 从来都是噪音。真查不到时有 diagnoseZeroResults() 给出路,不需要靠瞎命中凑数。
     */
    const raw = f.area.replace(/[%_]/g, '')
    const canon = (f.areaCanonical || '').replace(/[%_]/g, '')
    const pats = canon && canon.toLowerCase() !== raw.toLowerCase() ? [raw, canon] : [raw]
    const ors = pats.map((_, i) => {
      const p = paramIndex + i
      return `LOWER(rp.area) LIKE LOWER($${p})
        OR REPLACE(LOWER(rp.area), ' ', '') LIKE REPLACE(LOWER($${p}), ' ', '')`
    })
    sql += ` AND (${ors.join(' OR ')})`
    values.push(...pats.map((p) => `%${p}%`))
    paramIndex += pats.length
  }

  if (f.minPrice != null) {
    sql += ` AND rp.max_price >= $${paramIndex}`
    values.push(f.minPrice)
    paramIndex++
  }

  if (f.maxPrice != null) {
    sql += ` AND rp.min_price <= $${paramIndex}`
    values.push(f.maxPrice)
    paramIndex++
  }

  if (f.developer) {
    /**
     * 🔴 模糊匹配是**必须的**,不是锦上添花(2026-07-13 质量遥测挖出来的真 bug):
     *
     *   客户问「Al Ghadeer Gardens」→ Luna 查回 **0 条** → 她只能瞎聊。
     *   但库里**有**这个项目 —— 它被存成了「AIGHADEER GARDENS」
     *   (楼书抽取时把 `Al Ghadeer` 认成了 `AIGHADEER`:小写 l 读成大写 I,空格丢了)。
     *
     * 也就是说:**客户用正确的名字问,反而查不到**。楼书 OCR 出的项目名天生会有
     * 这种畸变(大小写、空格、l/I、O/0),精确 LIKE 撑不住。
     *
     * 三层:① 精确 LIKE ② 去空格 LIKE ③ trigram 相似度 ≥0.45
     * (AIGHADEER GARDENS ↔ Al Ghadeer Gardens 的相似度是 0.71,稳稳命中)
     * 这个字段同时匹配开发商和项目名 —— 模型经常把项目名塞进 developer。
     */
    const raw = f.developer
    sql += ` AND (
      LOWER(rp.developer) LIKE LOWER($${paramIndex})
      OR LOWER(rp.project_name) LIKE LOWER($${paramIndex})
      OR REPLACE(LOWER(rp.project_name), ' ', '') LIKE REPLACE(LOWER($${paramIndex}), ' ', '')
      OR REPLACE(LOWER(rp.developer), ' ', '')    LIKE REPLACE(LOWER($${paramIndex}), ' ', '')
      OR similarity(LOWER(rp.project_name), LOWER($${paramIndex + 1})) >= 0.45
      OR similarity(LOWER(rp.developer), LOWER($${paramIndex + 1}))    >= 0.45
    )`
    values.push(`%${raw}%`, raw)
    paramIndex += 2
  }

  if (f.status) {
    sql += ` AND rp.status = $${paramIndex}`
    values.push(f.status)
    paramIndex++
  }

  if (f.bedrooms != null) {
    sql += ` AND EXISTS (
      SELECT 1 FROM project_unit_types put
      WHERE put.project_id = rp.id AND put.bedrooms = $${paramIndex}
    )`
    values.push(f.bedrooms)
    paramIndex++
  }

  return { sql, values }
}

async function countMatching(f: SearchFilters): Promise<number> {
  const { sql, values } = buildSearchWhere(f)
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM residential_projects rp WHERE rp.verified = true ${sql}`,
    values
  )
  return r.rows[0]?.c ?? 0
}

/** filters → 可直接回传给 search 接口的 query 参数 */
function toParams(f: SearchFilters): Record<string, any> {
  const p: Record<string, any> = {}
  if (f.area) p.area = f.area
  if (f.minPrice != null) p.min_price = f.minPrice
  if (f.maxPrice != null) p.max_price = f.maxPrice
  if (f.bedrooms != null) p.bedrooms = f.bedrooms
  if (f.developer) p.developer = f.developer
  if (f.status) p.status = f.status
  return p
}

function fmtAED(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `AED ${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  return `AED ${Math.round(n / 1000)}K`
}

type BlockingFilter = 'area' | 'min_price' | 'max_price' | 'bedrooms' | 'developer' | 'status'

interface Relaxation {
  blocking_filter: BlockingFilter | null
  suggestions: { label: string; count: number; params: Record<string, any> }[]
}

/**
 * 0 结果不是死路:逐个放宽条件重查,找出到底是**哪个条件**把结果卡成 0,
 * 并给出至少 1-2 个可执行的备选。Luna 拿到这个才能说人话,而不是干巴巴一句 not found。
 */
async function diagnoseZeroResults(f: SearchFilters): Promise<Relaxation> {
  const areaSuffix = f.area ? ` in ${f.area}` : ''
  const candidates: { filter: BlockingFilter; label: string; next: SearchFilters }[] = []

  if (f.maxPrice != null) {
    for (const mult of [1.2, 1.5]) {
      const widened = Math.round(f.maxPrice * mult)
      candidates.push({
        filter: 'max_price',
        label: `raising the budget to ${fmtAED(widened)}${areaSuffix}`,
        next: { ...f, maxPrice: widened }
      })
    }
    candidates.push({
      filter: 'max_price',
      label: `dropping the budget cap${areaSuffix}`,
      next: { ...f, maxPrice: null }
    })
  }
  if (f.minPrice != null) {
    candidates.push({
      filter: 'min_price',
      label: `dropping the minimum price${areaSuffix}`,
      next: { ...f, minPrice: null }
    })
  }
  if (f.bedrooms != null) {
    candidates.push({
      filter: 'bedrooms',
      label: `allowing any bedroom count${areaSuffix}`,
      next: { ...f, bedrooms: null }
    })
  }
  if (f.area) {
    candidates.push({
      filter: 'area',
      label: 'searching all of Dubai instead of one area',
      next: { ...f, area: undefined }
    })
  }
  if (f.developer) {
    candidates.push({
      filter: 'developer',
      label: `allowing any developer/project name${areaSuffix}`,
      next: { ...f, developer: undefined }
    })
  }
  if (f.status) {
    candidates.push({
      filter: 'status',
      label: `allowing any sales status${areaSuffix}`,
      next: { ...f, status: undefined }
    })
  }

  if (candidates.length === 0) return { blocking_filter: null, suggestions: [] }

  const counts = await Promise.all(candidates.map(async c => {
    try {
      return { ...c, count: await countMatching(c.next) }
    } catch {
      return { ...c, count: 0 }
    }
  }))

  const viable = counts.filter(c => c.count > 0)
  if (viable.length === 0) return { blocking_filter: null, suggestions: [] }

  // 最小的有效放宽优先:能救回结果又改动最少的那个,才是真正卡住的条件
  viable.sort((a, b) => a.count - b.count)
  const picked: typeof viable = []
  for (const v of viable) {
    if (picked.length >= 2) break
    if (picked.some(p => p.filter === v.filter)) continue
    picked.push(v)
  }

  return {
    blocking_filter: picked[0].filter,
    suggestions: picked.map(p => ({ label: p.label, count: p.count, params: toParams(p.next) }))
  }
}

/**
 * GET /search — search projects with full enrichment
 * Query params: area, min_price, max_price, bedrooms, developer, near_metro, status
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { area, min_price, max_price, bedrooms, developer, status } = req.query

    const num = (v: any): number | null => {
      if (v === undefined || v === null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }

    let minPrice = num(min_price)
    let maxPrice = num(max_price)
    let interpreted_as: Record<string, any> | null = null
    let hint: string | null = null

    /**
     * 「100万左右」这种说法,模型会翻译成 min_price = max_price = 1000000,
     * 而 residential_projects 的价格是区间(min_price..max_price),
     * 卡死一个点几乎必然 0 结果。等号即「约等于」,展开成 ±20%。
     */
    if (minPrice != null && maxPrice != null && minPrice === maxPrice) {
      const budget = minPrice
      minPrice = Math.round(budget * 0.8)
      maxPrice = Math.round(budget * 1.2)
      interpreted_as = {
        min_price: minPrice,
        max_price: maxPrice,
        reason: 'min==max treated as approximate budget'
      }
    } else if (minPrice != null && maxPrice == null) {
      // 语义不动(仍按「最低价」处理),只把歧义如实告知上层
      hint = `Only min_price=${minPrice} was given and it is being applied as a price FLOOR. If the user meant "budget around/up to ${fmtAED(minPrice)}", re-query with max_price instead.`
    }

    // 先把用户说的区名解析成规范区名（"JVC" → "JVC Jumeirah Village Circle"、
    // "Dubai Harbor" → "Dubai Harbour"），再拿它去匹配项目表的自由文本 area 列。
    // 解析不确定就不传，让匹配退回用户原话——**宁可查不到，也不要查到别的区**。
    let areaCanonical: string | null = null
    if (area) {
      try {
        const r = await resolveArea(pool, String(area))
        if (r.status === 'matched' && r.match) areaCanonical = r.match.name
      } catch { /* 解析失败就用原话，不影响主流程 */ }
    }

    const filters: SearchFilters = {
      area: area ? String(area) : undefined,
      areaCanonical,
      minPrice,
      maxPrice,
      bedrooms: bedrooms !== undefined && bedrooms !== '' ? num(bedrooms) : null,
      developer: developer ? String(developer) : undefined,
      status: status ? String(status) : undefined
    }

    const { sql: whereSql, values } = buildSearchWhere(filters)
    const query = `
      SELECT
        rp.id, rp.project_name, rp.developer, rp.area, rp.address,
        rp.latitude, rp.longitude, rp.min_price, rp.max_price,
        rp.status, rp.completion_date, rp.primary_image
      FROM residential_projects rp
      WHERE rp.verified = true
      ${whereSql}
      ORDER BY rp.views_count DESC NULLS LAST LIMIT 20
    `

    const result = await pool.query(query, values)
    let projects = result.rows

    // Step 1: Auto-fill empty area via lat/lng polygon lookup
    const needsArea = projects.filter(p => (!p.area || p.area.trim() === '') && p.latitude && p.longitude)
    for (const p of needsArea) {
      try {
        const geoResult = await pool.query(`
          SELECT da.name FROM dubai_areas da
          WHERE ST_Contains(da.boundary::geometry, ST_SetSRID(ST_Point($1, $2), 4326))
            AND da.visible = true
          LIMIT 1
        `, [p.longitude, p.latitude])
        if (geoResult.rows[0]) {
          p.area = geoResult.rows[0].name
          p.resolved_area = true
        }
      } catch { /* skip */ }
    }

    // Step 2: Enrich with rental yield data
    if (projects.length > 0) {
      const areas = [...new Set(projects.map(p => p.area).filter(Boolean))]
      if (areas.length > 0) {
        const yieldQuery = `
          SELECT DISTINCT ON (da.name)
            da.name as area_name,
            dam.rental_yield_pct,
            dam.price_growth_pct,
            dam.median_price_sqm
          FROM dubai_area_rolling_metrics dam
          JOIN dubai_areas da ON da.id = dam.dubai_area_id
          WHERE ${RESIDENTIAL_METRIC_FILTER}
            AND (
              LOWER(da.name) = ANY($1)
              OR REPLACE(LOWER(da.name), ' ', '') = ANY($2)
            )
          ORDER BY da.name, dam.period_end_month DESC, dam.id
        `
        const lowerAreas = areas.map((a: string) => a.toLowerCase())
        const strippedAreas = areas.map((a: string) => a.toLowerCase().replace(/ /g, ''))
        const yieldResult = await pool.query(yieldQuery, [lowerAreas, strippedAreas])

        const yieldMap: Record<string, any> = {}
        for (const row of yieldResult.rows) {
          yieldMap[row.area_name.toLowerCase()] = row
          yieldMap[row.area_name.toLowerCase().replace(/ /g, '')] = row
        }

        projects = projects.map(p => {
          if (!p.area) return p
          const yieldData = yieldMap[p.area.toLowerCase()] || yieldMap[p.area.toLowerCase().replace(/ /g, '')]
          const yieldPct = yieldData ? parseFloat(yieldData.rental_yield_pct) : null
          const growthPct = yieldData ? parseFloat(yieldData.price_growth_pct) : null
          const price = parseFloat(p.min_price) || 0

          const investment_5yr = (yieldPct || growthPct)
            ? calculateInvestment5yr(price, yieldPct || 0, growthPct || 0)
            : null

          return {
            ...p,
            rental_yield_pct: yieldPct,
            price_growth_pct: growthPct,
            payback_years: calculatePaybackYears(yieldPct || 0),
            area_yield: yieldPct,
            area_growth: growthPct,
            investment_5yr
          }
        })

        projects.sort((a, b) => (parseFloat(b.rental_yield_pct) || 0) - (parseFloat(a.rental_yield_pct) || 0))
      }
    }

    // Step 3: Enrich with unit types within budget
    if (projects.length > 0) {
      const projectIds = projects.map(p => p.id)
      try {
        const unitQuery = `
          SELECT project_id, category, bedrooms,
                 COUNT(*) as type_count,
                 MIN(price) as min_price, MAX(price) as max_price,
                 MIN(area) as min_area, MAX(area) as max_area,
                 MIN(floor_plan_image) as sample_floor_plan
          FROM project_unit_types
          WHERE project_id = ANY($1)
            ${minPrice != null ? `AND price >= ${minPrice}` : ''}
            ${maxPrice != null ? `AND price <= ${maxPrice}` : ''}
          GROUP BY project_id, category, bedrooms
          ORDER BY bedrooms
        `
        const unitResult = await pool.query(unitQuery, [projectIds])
        const unitMap: Record<string, any[]> = {}
        for (const row of unitResult.rows) {
          if (!unitMap[row.project_id]) unitMap[row.project_id] = []
          unitMap[row.project_id].push({
            category: row.category,
            bedrooms: parseInt(row.bedrooms),
            type_count: parseInt(row.type_count),
            min_price: parseFloat(row.min_price),
            max_price: parseFloat(row.max_price),
            min_area_sqft: parseFloat(row.min_area),
            max_area_sqft: parseFloat(row.max_area),
            sample_floor_plan: row.sample_floor_plan
          })
        }

        // All unit types (unfiltered) for projects with no budget-matching units
        const allUnitsResult = await pool.query(`
          SELECT project_id, category, bedrooms,
                 COUNT(*) as type_count,
                 MIN(price) as min_price, MAX(price) as max_price,
                 MIN(area) as min_area, MAX(area) as max_area
          FROM project_unit_types
          WHERE project_id = ANY($1)
          GROUP BY project_id, category, bedrooms
          ORDER BY bedrooms
        `, [projectIds])
        const allUnitMap: Record<string, any[]> = {}
        for (const row of allUnitsResult.rows) {
          if (!allUnitMap[row.project_id]) allUnitMap[row.project_id] = []
          allUnitMap[row.project_id].push({
            category: row.category,
            bedrooms: parseInt(row.bedrooms),
            type_count: parseInt(row.type_count),
            min_price: parseFloat(row.min_price),
            max_price: parseFloat(row.max_price),
            min_area_sqft: parseFloat(row.min_area),
            max_area_sqft: parseFloat(row.max_area)
          })
        }

        projects = projects.map(p => ({
          ...p,
          unit_types_in_budget: unitMap[p.id] || [],
          all_unit_types: allUnitMap[p.id] || []
        }))
      } catch (e) {
        console.error('Error fetching unit types:', e)
      }
    }

    // Step 3.5: Refine investment with unit-specific prices
    if (projects.length > 0) {
      projects = projects.map(p => {
        if (p.unit_types_in_budget?.length > 0 && (p.area_yield || p.area_growth)) {
          const unitPrice = Math.min(...p.unit_types_in_budget.map((u: any) => u.min_price))
          const inv = calculateInvestment5yr(unitPrice, p.area_yield || 0, p.area_growth || 0)
          return inv ? { ...p, investment_5yr: inv } : p
        }
        return p
      })
    }

    // Step 3.6: Nearest metro station per project (batch)
    if (projects.length > 0) {
      const withCoords = projects.filter(p => p.latitude && p.longitude)
      if (withCoords.length > 0) {
        try {
          const metroQuery = `
            SELECT p_id, m.name as metro_name, m.distance_m FROM (
              ${withCoords.map(p => `SELECT '${p.id}'::text as p_id, ${parseFloat(p.longitude)} as lng, ${parseFloat(p.latitude)} as lat`).join(' UNION ALL ')}
            ) pts
            CROSS JOIN LATERAL (
              SELECT name, ROUND(ST_Distance(
                location::geography,
                ST_SetSRID(ST_Point(pts.lng, pts.lat), 4326)::geography
              )::numeric) as distance_m
              FROM dubai_pois WHERE category = 'metro_station'
              ORDER BY location <-> ST_SetSRID(ST_Point(pts.lng, pts.lat), 4326)
              LIMIT 1
            ) m
          `
          const metroResult = await pool.query(metroQuery)
          const metroMap: Record<string, any> = {}
          for (const row of metroResult.rows) {
            metroMap[row.p_id] = { name: row.metro_name, distance_m: parseInt(row.distance_m) }
          }
          projects = projects.map(p => ({ ...p, nearest_metro: metroMap[p.id] || null }))
        } catch (e) {
          console.error('Error fetching nearest metro:', e)
        }
      }
    }

    // Summary generation
    let summary = ''
    let relaxation: Relaxation | null = null
    if (projects.length === 0) {
      relaxation = await diagnoseZeroResults(filters)
      if (relaxation.suggestions.length > 0) {
        const parts = relaxation.suggestions.map(s => `${s.label} yields ${s.count} project${s.count === 1 ? '' : 's'}`)
        summary = `No projects match all criteria. ${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}.`
        if (parts[1]) summary += ` Alternatively, ${parts[1]}.`
        summary += ' Offer one of these instead of saying nothing was found.'
      } else {
        summary = 'No projects match these criteria, and no single relaxed filter brings any back — the combination is too narrow. Ask the client which requirement is flexible.'
      }
    } else {
      const withYield = projects.filter(p => p.rental_yield_pct)
      const bestYield = withYield.length > 0 ? withYield[0] : null

      const projectList = projects.slice(0, 4).map((p, i) => {
        let info = `${i + 1}. ${p.project_name} [STATUS: ${p.status || 'unknown'}] (${p.area || 'Dubai'}`
        if (p.status === 'sold-out') info += ` SOLD OUT`
        if (p.rental_yield_pct) info += `, yield ${p.rental_yield_pct.toFixed(1)}%`
        if (p.payback_years) info += `, ~${p.payback_years}yr payback`
        if (p.investment_5yr) info += `, 5yr return ${p.investment_5yr.annualized_return_pct}%/yr`
        if (p.status && !['completed', 'sold-out'].includes(p.status) && p.completion_date) info += `, completion ${p.completion_date}`
        if (p.unit_types_in_budget?.length > 0) {
          const unitSummary = p.unit_types_in_budget.map((u: any) =>
            `${u.category} from AED${Math.round(u.min_price / 10000)}万/${Math.round(u.min_area_sqft)}sqft`
          ).join(', ')
          info += `. Units in budget: ${unitSummary}`
        } else if (p.all_unit_types?.length > 0) {
          const cats = p.all_unit_types.map((u: any) => u.category).join('/')
          info += `. Available: ${cats} (outside budget range)`
        }
        if (p.nearest_metro) {
          info += `. Metro: ${p.nearest_metro.name}(${(p.nearest_metro.distance_m / 1000).toFixed(1)}km)`
        }
        info += ')'
        return info
      }).join('; ')

      if (bestYield) {
        summary = `Found ${projects.length} projects. Best ROI: ${bestYield.project_name} in ${bestYield.area || 'Dubai'} — ${bestYield.rental_yield_pct.toFixed(1)}% yield`
        if (bestYield.payback_years) summary += `, ~${bestYield.payback_years} year payback`
        if (bestYield.investment_5yr) {
          const inv = bestYield.investment_5yr
          summary += `. 5-year projection: ${Math.round(inv.rental_income_5yr / 10000)}万 rental + ${Math.round(inv.appreciation_5yr / 10000)}万 appreciation = ${Math.round(inv.total_profit_5yr / 10000)}万 profit (annualized ${inv.annualized_return_pct}%)`
        }
        summary += `. List: ${projectList}`
      } else {
        summary = `Found ${projects.length} projects: ${projectList}`
      }
    }

    res.json({
      projects,
      count: projects.length,
      summary,
      ...(interpreted_as ? { interpreted_as } : {}),
      ...(hint ? { hint } : {}),
      ...(relaxation ? { relaxation } : {})
    })
  } catch (error) {
    console.error('Error in AI project search:', error)
    res.json({ projects: [], count: 0, summary: 'Error searching projects.' })
  }
})

/**
 * GET /:id/detail — full project detail for navigate_to_project
 */
router.get('/:id/detail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const projectResult = await pool.query(`
      SELECT id, project_name, developer, area, latitude, longitude,
             min_price, max_price, status, completion_date, primary_image
      FROM residential_projects
      WHERE id = $1
    `, [id])

    if (projectResult.rows.length === 0) {
      return res.json({
        result: null,
        summary: `Could not find project ${id}.`
      })
    }

    const project = projectResult.rows[0]

    // Fetch unit types
    const unitResult = await pool.query(`
      SELECT category, bedrooms, bathrooms,
             area as area_sqft, built_up_area, price,
             floor_plan_image, description, features
      FROM project_unit_types
      WHERE project_id = $1
      ORDER BY bedrooms, price
    `, [project.id])

    const unitTypes = unitResult.rows.map(u => ({
      category: u.category,
      bedrooms: parseInt(u.bedrooms),
      bathrooms: parseFloat(u.bathrooms),
      area_sqft: parseFloat(u.area_sqft),
      built_up_area: u.built_up_area ? parseFloat(u.built_up_area) : null,
      price: parseFloat(u.price),
      floor_plan_image: u.floor_plan_image,
      features: u.features || []
    }))

    // Unit summary
    const unitSummary = unitTypes.length > 0
      ? unitTypes.reduce((acc: Record<string, any>, u) => {
          const key = u.category
          if (!acc[key]) acc[key] = { category: key, bedrooms: u.bedrooms, min_price: u.price, max_price: u.price, min_area: u.area_sqft, count: 0 }
          acc[key].min_price = Math.min(acc[key].min_price, u.price)
          acc[key].max_price = Math.max(acc[key].max_price, u.price)
          acc[key].min_area = Math.min(acc[key].min_area, u.area_sqft)
          acc[key].count++
          return acc
        }, {})
      : {}
    const unitList = Object.values(unitSummary).map((u: any) =>
      `${u.category}: from AED ${(u.min_price / 1000000).toFixed(2)}M, ${Math.round(u.min_area)}sqft`
    ).join('; ')

    // Area yield for investment
    let areaYieldPct = 0, areaGrowthPct = 0
    if (project.area) {
      try {
        const yieldResult = await pool.query(`
          SELECT dam.rental_yield_pct, dam.price_growth_pct
          FROM dubai_area_rolling_metrics dam
          JOIN dubai_areas da ON da.id = dam.dubai_area_id
          WHERE ${RESIDENTIAL_METRIC_FILTER}
            AND (
              LOWER(da.name) = LOWER($1)
              OR REPLACE(LOWER(da.name), ' ', '') = REPLACE(LOWER($1), ' ', '')
            )
          ORDER BY dam.period_end_month DESC, dam.id
          LIMIT 1
        `, [project.area])
        if (yieldResult.rows[0]) {
          areaYieldPct = parseFloat(yieldResult.rows[0].rental_yield_pct) || 0
          areaGrowthPct = parseFloat(yieldResult.rows[0].price_growth_pct) || 0
        }
      } catch { /* skip */ }
    }

    // 5-year investment projection
    const refPrice = unitTypes.length > 0
      ? Math.min(...unitTypes.map(u => u.price))
      : parseFloat(project.min_price) || 0
    const investment_5yr = calculateInvestment5yr(refPrice, areaYieldPct, areaGrowthPct)
    if (investment_5yr) {
      investment_5yr.area_yield_pct = areaYieldPct
      investment_5yr.area_growth_pct = areaGrowthPct
    }

    const invSummary = investment_5yr
      ? ` 5yr return: ${investment_5yr.annualized_return_pct}%/yr (rental ${Math.round(investment_5yr.rental_income_5yr / 10000)}万 + appreciation ${Math.round(investment_5yr.appreciation_5yr / 10000)}万).`
      : ''

    // Nearby POIs + landmarks
    let nearbyPOIs: any[] = []
    let nearbyLandmarks: any[] = []
    if (project.latitude && project.longitude) {
      try {
        const [poisRes, landmarkRes] = await Promise.all([
          pool.query(`
            SELECT DISTINCT ON (category) category, name,
              ROUND(ST_Distance(
                location::geography,
                ST_SetSRID(ST_Point($1, $2), 4326)::geography
              )::numeric) as distance_m
            FROM dubai_pois
            WHERE category IN ('metro_station','hospital','school','university','mall','supermarket','park')
            ORDER BY category, location <-> ST_SetSRID(ST_Point($1, $2), 4326)
          `, [project.longitude, project.latitude]),
          pool.query(`
            SELECT name, landmark_type,
              ROUND(ST_Distance(
                location::geography,
                ST_SetSRID(ST_Point($1, $2), 4326)::geography
              )::numeric) as distance_m
            FROM dubai_landmarks
            WHERE visible = true
            ORDER BY location <-> ST_SetSRID(ST_Point($1, $2), 4326)
            LIMIT 5
          `, [project.longitude, project.latitude])
        ])
        nearbyPOIs = poisRes.rows
        nearbyLandmarks = landmarkRes.rows
      } catch { /* skip */ }
    }

    const poiSummary = nearbyPOIs.length > 0
      ? ` Nearby: ${nearbyPOIs.map(p => `${p.category.replace('_', ' ')}=${p.name}(${(p.distance_m / 1000).toFixed(1)}km)`).join(', ')}.`
      : ''
    const landmarkSummary = nearbyLandmarks.length > 0
      ? ` Nearby landmarks: ${nearbyLandmarks.slice(0, 3).map(l => `${l.name}(${(l.distance_m / 1000).toFixed(1)}km)`).join(', ')}.`
      : ''
    const areaSummary = areaYieldPct || areaGrowthPct
      ? ` Area metrics: yield ${areaYieldPct.toFixed(1)}%, growth ${areaGrowthPct.toFixed(1)}%.`
      : ''

    res.json({
      result: {
        projectId: project.id,
        projectName: project.project_name,
        developer: project.developer,
        area: project.area,
        minPrice: project.min_price,
        maxPrice: project.max_price,
        status: project.status,
        completionDate: project.completion_date,
        image: project.primary_image,
        latitude: project.latitude,
        longitude: project.longitude,
        unitTypes,
        investment_5yr,
        nearbyPOIs,
        nearbyLandmarks,
        areaYieldPct,
        areaGrowthPct
      },
      summary: `${project.project_name} [STATUS: ${project.status}] by ${project.developer} in ${project.area || 'Dubai'}. ${unitTypes.length > 0 ? `Unit types: ${unitList}.` : 'No unit type data available.'}${invSummary}${poiSummary}${landmarkSummary}${areaSummary}`
    })
  } catch (error) {
    console.error('Error in AI project detail:', error)
    res.json({ result: null, summary: 'Error getting project details.' })
  }
})

export default router
