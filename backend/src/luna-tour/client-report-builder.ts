/**
 * Comprehensive client investment proposal — enriches the matched projects with
 * REAL DLD data (per-project insights/comps/supply) and adds an overall
 * market/policy/trend section. Runs async, writing progress to lt_client_reports.
 */
import pool from '../db/pool'
import { buildClientReport } from './auto-report'
import { getProjectInsights, getProjectTransactions } from '../services/projectInsights'

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

/** Aggregate the matched areas' real metrics into a market-overview section. */
async function buildMarketSection(properties: { area: string | null }[]) {
  const areas = [...new Set(properties.map((p) => (p.area || '').trim()).filter(Boolean))]
  let agg: any = null
  if (areas.length) {
    const r = await pool.query(
      `SELECT ROUND(AVG(rental_yield_pct)::numeric,1) AS yield, ROUND(AVG(price_growth_pct)::numeric,1) AS growth,
              SUM(COALESCE(s.units_pipeline,0))::bigint AS supply
         FROM dubai_areas da
         LEFT JOIN v_area_supply s ON s.dubai_area_id = da.id
        WHERE da.name = ANY($1)`,
      [areas]
    ).catch(() => null)
    agg = r?.rows?.[0] || null
  }
  return {
    areas,
    avg_yield_pct: agg?.yield != null ? Number(agg.yield) : null,
    avg_growth_pct: agg?.growth != null ? Number(agg.growth) : null,
    pipeline_units: agg?.supply != null ? Number(agg.supply) : null,
    policy: POLICY,
  }
}

export async function generateClientReport(reportId: string, client: Record<string, unknown>, oneLiner: string) {
  try {
    // 1) Match + base projection + AI scenarios (existing builder)
    const report = await buildClientReport(client, oneLiner, 3)
    await mark(reportId, 'match')

    // 2) Enrich each property with REAL data (replaces placeholder projection)
    const enriched = await Promise.all(report.properties.map(async (p) => {
      const [insights, tx] = await Promise.all([
        getProjectInsights(p.id).catch(() => null),
        getProjectTransactions(p.id).catch(() => null),
      ])
      let supply: any = null
      const areaId = insights?.area?.id
      if (areaId) {
        const s = await pool.query(
          `SELECT pipeline_projects, units_pipeline, units_handover_1y FROM v_area_supply WHERE dubai_area_id=$1`, [areaId]
        ).catch(() => null)
        supply = s?.rows?.[0] || null
      }
      return {
        ...p,
        // prefer the real, data-backed projection when available
        projection: insights?.investment ? {
          buy: insights.investment.buy, future: insights.investment.future,
          total_profit_5yr: insights.investment.total_profit_5yr,
          rental_income_5yr: insights.investment.rental_income_5yr,
          appreciation_5yr: insights.investment.appreciation_5yr,
          annualized_return_pct: insights.investment.annualized_return_pct,
          yield_pct: insights.investment.yield_pct, payback_years: insights.investment.payback_years,
        } : p.projection,
        area_metrics: insights?.area ? {
          median_price_sqm: insights.area.median_price_sqm, rental_yield_pct: insights.area.rental_yield_pct,
          price_growth_pct: insights.area.price_growth_pct, transaction_count: insights.area.sales_transaction_count,
        } : null,
        comps: (tx?.sales || []).slice(0, 4),
        supply,
        nearby: insights?.nearby || null,
      }
    }))
    await mark(reportId, 'data')

    // 3) Overall market + policy + trends
    const market = await buildMarketSection(report.properties)
    await mark(reportId, 'market')

    // 4) Finalize
    const full = { ...report, properties: enriched, market }
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

export { initialProgress }
