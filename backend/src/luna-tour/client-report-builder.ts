/**
 * Comprehensive client investment proposal — enriches the matched projects with
 * REAL DLD data (per-project insights/comps/supply) and adds an overall
 * market/policy/trend section. Runs async, writing progress to lt_client_reports.
 */
import pool from '../db/pool'
import { buildClientReport } from './auto-report'
import { getProjectInsights, getProjectTransactions } from '../services/projectInsights'
import { analyzeProperties } from '../services/property-analyzer'

const STEPS = [
  { key: 'match', label: '匹配最优项目' },
  { key: 'data', label: '深度数据分析（成交 / 回报 / 供给）' },
  { key: 'market', label: '市场与政策趋势' },
  { key: 'finalize', label: '编排报告' },
]

function initialProgress() {
  return STEPS.map((s) => ({ ...s, done: false }))
}

async function mark(reportId: string, key: string) {
  await pool.query(
    `UPDATE lt_client_reports
        SET progress = (SELECT jsonb_agg(CASE WHEN e->>'key' = $2 THEN jsonb_set(e,'{done}','true') ELSE e END)
                          FROM jsonb_array_elements(progress) e)
      WHERE id = $1`,
    [reportId, key]
  ).catch(() => {})
}

// Stable, well-known Dubai facts (policy context for any proposal).
const POLICY = [
  '0% 个人所得税、0% 资本利得税 —— 租金与增值收益免税。',
  '房产投资 ≥ 200 万 AED 可申请 10 年黄金签证（含家属）。',
  '指定 freehold 区域外国人可 100% 持有永久产权。',
  '期房常见灵活付款计划（如交付前分期 + 交付后尾款），资金占用低。',
]

/** Market overview from the already-resolved per-project metrics (reliable). */
function buildMarketSection(enriched: any[]) {
  const areas = [...new Set(enriched.map((p) => (p.area || '').trim()).filter(Boolean))]
  const avg = (vals: number[]) => vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : null
  const yields = enriched.map((p) => p.area_metrics?.rental_yield_pct).filter((v: any) => v != null).map(Number)
  const growths = enriched.map((p) => p.area_metrics?.price_growth_pct).filter((v: any) => v != null).map(Number)
  const supply = enriched.reduce((sum, p) => sum + (Number(p.supply?.units_pipeline) || 0), 0)
  return {
    areas,
    avg_yield_pct: avg(yields),
    avg_growth_pct: avg(growths),
    pipeline_units: supply || null,
    policy: POLICY,
  }
}

/** Real price trend (24mo median AED/sqm) + YoY evidence for a dubai_area. */
async function areaPriceEvidence(dubaiAreaId: string) {
  try {
    const t = await pool.query(
      `WITH ids AS (SELECT area_id FROM dld_areas WHERE dubai_area_id=$1),
            b AS (SELECT MAX(instance_date) d FROM dld_transactions)
       SELECT to_char(date_trunc('month', dt.instance_date),'YYYY-MM') AS m,
              ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price)) AS med
         FROM dld_transactions dt, b
        WHERE dt.area_id IN (SELECT area_id FROM ids) AND dt.trans_group='Sales' AND dt.meter_sale_price>0
          AND dt.instance_date >= date_trunc('month', b.d) - INTERVAL '23 months'
        GROUP BY 1 ORDER BY 1`,
      [dubaiAreaId]
    )
    const trend = t.rows.map((r) => ({ m: r.m, v: r.med != null ? Number(r.med) : null }))
    // YoY: median of last 12 months vs the prior 12 months
    const y = await pool.query(
      `WITH ids AS (SELECT area_id FROM dld_areas WHERE dubai_area_id=$1),
            b AS (SELECT MAX(instance_date) d FROM dld_transactions)
       SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE dt.instance_date >= b.d - INTERVAL '12 months')) AS this_y,
              ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) FILTER (WHERE dt.instance_date >= b.d - INTERVAL '24 months' AND dt.instance_date < b.d - INTERVAL '12 months')) AS last_y,
              COUNT(*) FILTER (WHERE dt.instance_date >= b.d - INTERVAL '12 months') AS n
         FROM dld_transactions dt, b
        WHERE dt.area_id IN (SELECT area_id FROM ids) AND dt.trans_group='Sales' AND dt.meter_sale_price>0
          AND dt.instance_date >= b.d - INTERVAL '24 months'`,
      [dubaiAreaId]
    )
    const r = y.rows[0] || {}
    const thisY = r.this_y != null ? Number(r.this_y) : null
    const lastY = r.last_y != null ? Number(r.last_y) : null
    const yoy = thisY != null && lastY != null && lastY > 0 ? Number((((thisY - lastY) / lastY) * 100).toFixed(1)) : null
    return { trend, yoy: { this_year_sqm: thisY, last_year_sqm: lastY, growth_pct: yoy, count: Number(r.n || 0) } }
  } catch { return { trend: [], yoy: null } }
}

/** Cost-adjusted net 5yr profit (transparent: appreciation + net rent − fees). */
function netCalc(proj: any) {
  if (!proj?.buy) return null
  const buy = proj.buy
  const appreciation = Math.max(0, proj.appreciation_5yr || 0)
  const grossRent = Math.max(0, proj.rental_income_5yr || 0)
  const netRent = Math.round(grossRent * 0.75)          // ~25% for service charge + maintenance
  const dldFee = Math.round(buy * 0.04)                 // DLD transfer 4%
  const agentFee = Math.round(buy * 0.02)               // agency 2%
  const netProfit = Math.round(appreciation + netRent - dldFee - agentFee)
  const netAnnualized = Number(((Math.pow((buy + netProfit) / buy, 1 / 5) - 1) * 100).toFixed(1))
  return { buy, appreciation: Math.round(appreciation), gross_rent: Math.round(grossRent), net_rent: netRent,
           dld_fee: dldFee, agent_fee: agentFee, net_profit: netProfit, net_annualized_pct: netAnnualized }
}

/** The project's unit types (for "适合户型"), cheapest first. */
async function projectUnits(projectId: string) {
  try {
    const r = await pool.query(
      `SELECT unit_type_name, bedrooms, area, price, price_per_sqft FROM project_unit_types
        WHERE project_id=$1 AND price IS NOT NULL ORDER BY price ASC LIMIT 8`, [projectId]
    )
    return r.rows.map((u) => ({
      name: u.unit_type_name, bedrooms: u.bedrooms,
      area: u.area != null ? Number(u.area) : null,
      price: u.price != null ? Number(u.price) : null,
      price_per_sqft: u.price_per_sqft != null ? Number(u.price_per_sqft) : null,
    }))
  } catch { return [] }
}

/** 5-axis radar scores (0–100) — an at-a-glance investment rating. */
function radarScores(am: any, nearby: any, net: any, yoy: any, compsCount = 0): { k: string; v: number }[] {
  const yld = am?.rental_yield_pct ?? 5
  const grw = Math.max(0, am?.price_growth_pct ?? 6)
  // recent real DLD activity — area YoY count, else project comps as a presence signal
  const txn = Math.max(yoy?.count ?? 0, am?.transaction_count ?? 0, compsCount * 50)
  const nearestKm = (cat: string) => {
    const arr = cat === 'metro' ? (nearby?.metro || []) : (nearby?.pois || []).filter((x: any) => String(x.category || '').toLowerCase().includes(cat))
    return arr.length ? Math.min(...arr.map((x: any) => x.distance_m)) / 1000 : null
  }
  const dist = (km: number | null, full: number, zero: number) => km == null ? 45 : Math.max(0, Math.min(100, Math.round(((zero - km) / (zero - full)) * 100)))
  const amenity = Math.round((dist(nearestKm('metro'), 0.5, 5) + dist(nearestKm('school'), 1, 6) + dist(nearestKm('mall'), 1, 8)) / 3)
  const netA = net?.net_annualized_pct ?? 8
  // floor at 15 so a data-gap axis renders as a sensible shape, not a broken "0"
  const fl = (n: number) => Math.max(15, Math.round(Math.min(100, n)))
  return [
    { k: '租金回报', v: fl((yld / 8) * 100) },
    { k: '增值潜力', v: fl((grw / 12) * 100) },
    { k: '生活配套', v: fl(amenity) },
    { k: '市场活跃', v: fl((txn / 400) * 100) },
    { k: '综合净回报', v: fl((netA / 12) * 100) },
  ]
}

/** Enrich one base property with REAL DLD data (shared by proposal + compare). */
async function enrichProperty(p: any) {
  const [insights, tx] = await Promise.all([
    getProjectInsights(p.id).catch(() => null),
    getProjectTransactions(p.id).catch(() => null),
  ])
  let supply: any = null, evidence: any = { trend: [], yoy: null }
  const areaId = insights?.area?.id
  if (areaId) {
    const s = await pool.query(
      `SELECT pipeline_projects, units_pipeline, units_handover_1y FROM v_area_supply WHERE dubai_area_id=$1`, [areaId]
    ).catch(() => null)
    supply = s?.rows?.[0] || null
    evidence = await areaPriceEvidence(areaId)
  }
  const inv = insights?.investment as any
  const projection = inv ? {
    buy: inv.buy, future: inv.future,
    total_profit_5yr: inv.total_profit_5yr,
    rental_income_5yr: inv.rental_income_5yr,
    appreciation_5yr: inv.appreciation_5yr,
    annualized_return_pct: inv.annualized_return_pct,
    yield_pct: inv.yield_pct, payback_years: inv.payback_years,
  } : p.projection
  const area_metrics = insights?.area ? {
    median_price_sqm: insights.area.median_price_sqm, rental_yield_pct: insights.area.rental_yield_pct,
    price_growth_pct: insights.area.price_growth_pct, transaction_count: insights.area.sales_transaction_count,
  } : null
  const net = netCalc(projection)
  const nearby = insights?.nearby || null
  const units = await projectUnits(p.id)
  const comps = (tx?.sales || []).slice(0, 6)
  return {
    ...p,
    project_id: p.id,
    area_id: areaId || null,
    projection,
    net,
    area_metrics,
    price_trend: evidence.trend,
    yoy: evidence.yoy,
    comps,
    supply,
    nearby,
    units,
    scores: radarScores(area_metrics, nearby, net, evidence.yoy, comps.length),
  }
}

export async function generateClientReport(reportId: string, client: Record<string, unknown>, oneLiner: string) {
  try {
    // 1) Match + base projection + AI scenarios (existing builder)
    const report = await buildClientReport(client, oneLiner, 3)
    await mark(reportId, 'match')

    // 2) Enrich each property with REAL data (replaces placeholder projection)
    const enriched = await Promise.all(report.properties.map(enrichProperty))
    await mark(reportId, 'data')

    // 3) Overall market + policy + trends (from the resolved per-project metrics)
    const market = buildMarketSection(enriched)
    await mark(reportId, 'market')

    // Structured (non-chatty) executive overview from the numbers.
    const nets = enriched.map((p: any) => p.net?.net_annualized_pct).filter((v: any) => v != null)
    const avgNet = nets.length ? Number((nets.reduce((a: number, b: number) => a + b, 0) / nets.length).toFixed(1)) : null
    const best = enriched.reduce((m: any, p: any) => (p.net?.net_annualized_pct != null && (!m || p.net.net_annualized_pct > (m.net?.net_annualized_pct ?? -1)) ? p : m), null)
    const prices = enriched.map((p: any) => p.net?.buy).filter((v: any) => v != null)
    const overview = {
      count: enriched.length,
      avg_net_annualized_pct: avgNet,
      best_name: best?.name || null,
      best_net_pct: best?.net?.net_annualized_pct ?? null,
      price_min: prices.length ? Math.min(...prices) : null,
      price_max: prices.length ? Math.max(...prices) : null,
    }

    // 4) Finalize
    const full = { ...report, properties: enriched, market, overview }
    await pool.query(
      `UPDATE lt_client_reports SET report=$2, status='ready' WHERE id=$1`,
      [reportId, JSON.stringify(full)]
    )
    await mark(reportId, 'finalize')
  } catch (err) {
    console.error('[client-report] generate failed:', err)
    await pool.query(`UPDATE lt_client_reports SET status='error' WHERE id=$1`, [reportId]).catch(() => {})
  }
}

/**
 * Agent-driven COMPARISON report (策略: 把分析变成经纪给客户的弹药). Unlike the
 * proposal it does NOT AI-match projects — the agent hand-picks 2-4. Same real
 * DLD enrichment per project + an AI side-by-side verdict (winner + dimensions).
 * Stored in the SAME lt_client_reports row (kind='compare') so it reuses the
 * branded, shareable, tracked /cr/:code page. Async; writes progress.
 */
export async function generateCompareReport(
  reportId: string,
  clientName: string,
  projectIds: string[],
  profile: { budget?: { min: number; max: number }; freeformDescription?: string } = {}
) {
  try {
    // 1) Base projects (agent's hand-picked shortlist), preserve the picked order.
    const r = await pool.query(
      `SELECT id, project_name AS name, area, min_price, primary_image FROM residential_projects WHERE id = ANY($1::uuid[])`,
      [projectIds]
    )
    const byId = new Map(r.rows.map((row) => [row.id, row]))
    const bases = projectIds.map((id) => byId.get(id)).filter(Boolean).map((row: any) => ({
      id: row.id, name: row.name, area: row.area, min_price: row.min_price,
      primary_image: row.primary_image, projection: null,
    }))
    await mark(reportId, 'match')

    // 2) Same real-DLD enrichment as the proposal.
    const enriched = await Promise.all(bases.map(enrichProperty))
    await mark(reportId, 'data')

    // 3) AI side-by-side verdict (best-effort: a missing key → mock; any error → skip).
    let comparison: any = null
    try {
      const propData = enriched.map((e: any) => ({
        id: e.project_id, projectId: e.project_id, projectName: e.name || '项目',
        developer: '', area: e.area || '', address: e.area || '',
        bedrooms: 0, size: 0, price: e.net?.buy ?? e.min_price ?? 0,
        status: 'offplan', amenities: [] as string[],
      }))
      comparison = await analyzeProperties(propData as any, profile as any, 'zh')
    } catch (e) {
      console.error('[compare-report] analyze failed (kept table only):', e instanceof Error ? e.message : e)
    }
    await mark(reportId, 'market')

    const market = buildMarketSection(enriched)
    const nets = enriched.map((p: any) => p.net?.net_annualized_pct).filter((v: any) => v != null)
    const overview = {
      count: enriched.length,
      avg_net_annualized_pct: nets.length ? Number((nets.reduce((a: number, b: number) => a + b, 0) / nets.length).toFixed(1)) : null,
      winner_name: comparison?.recommendation?.winnerIndex != null ? enriched[comparison.recommendation.winnerIndex]?.name : null,
    }

    const full = {
      kind: 'compare',
      client_name: clientName || null,
      properties: enriched,
      comparison,
      market,
      overview,
    }
    await pool.query(`UPDATE lt_client_reports SET report=$2, status='ready' WHERE id=$1`, [reportId, JSON.stringify(full)])
    await mark(reportId, 'finalize')
  } catch (err) {
    console.error('[compare-report] generate failed:', err)
    await pool.query(`UPDATE lt_client_reports SET status='error' WHERE id=$1`, [reportId]).catch(() => {})
  }
}

export { initialProgress }
