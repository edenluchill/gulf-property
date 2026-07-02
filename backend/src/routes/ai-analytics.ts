/**
 * AI Analytics API — investment/ROI/budget analysis over real DLD data.
 * Wraps the SQL functions (recommend_for_budget / investment_analysis / market_stats).
 * Mounted at /api/ai/analytics. Consumed by voice tools.
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { DEFAULT_SEGMENT, SEGMENT_MIN_SAMPLE, parseSegment, segmentToOffplan } from '../lib/marketSegment'

const router = Router()

const toBeds = (v: any): number | null =>
  v !== undefined && v !== '' && v !== null ? Number(v) : null

/**
 * AI 链路默认期房口径（marketSegment.DEFAULT_SEGMENT，env 可回滚）。
 * 显式 ?offplan=true/false 或 ?segment=offplan|ready|all 覆盖默认。
 */
function requestedSegment(req: Request) {
  if (req.query.offplan !== undefined && req.query.offplan !== '')
    return req.query.offplan === 'true' ? ('offplan' as const) : ('ready' as const)
  return parseSegment(req.query.segment, DEFAULT_SEGMENT)
}

// GET /recommend?budget=&goal=&property_type=&bedrooms=&limit=
router.get('/recommend', async (req: Request, res: Response) => {
  try {
    const budget = Number(req.query.budget)
    if (!budget || Number.isNaN(budget)) return res.status(400).json({ error: 'budget required' })
    const goal = ['yield', 'growth', 'balanced'].includes(String(req.query.goal)) ? String(req.query.goal) : 'balanced'
    const ptype = String(req.query.property_type || 'apartment')
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 10) : 5
    const r = await pool.query(
      'SELECT recommend_for_budget($1,$2,$3,$4,$5) AS data',
      [budget, goal, ptype, toBeds(req.query.bedrooms), limit]
    )
    res.json({ results: r.rows[0].data })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /investment?area=&property_type=&bedrooms=&offplan=  —— 默认期房口径
router.get('/investment', async (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || '')
    if (!area) return res.status(400).json({ error: 'area required' })
    const ptype = String(req.query.property_type || 'apartment')
    const seg = requestedSegment(req)
    const offplan = segmentToOffplan(seg)
    let r = await pool.query(
      'SELECT investment_analysis($1,$2,$3,$4) AS data',
      [area, ptype, toBeds(req.query.bedrooms), offplan]
    )
    let data = r.rows[0].data
    // 样本护栏：该口径无数据/样本太薄 → 回退全口径重算，segment_used 如实标注
    if (offplan !== null && (data.error || (data.sample?.sales_count ?? 0) < SEGMENT_MIN_SAMPLE)) {
      r = await pool.query(
        'SELECT investment_analysis($1,$2,$3,$4) AS data',
        [area, ptype, toBeds(req.query.bedrooms), null]
      )
      data = { ...r.rows[0].data, segment_requested: seg, segment_used: 'all' }
    } else {
      data = { ...data, segment_requested: seg, segment_used: seg }
    }
    res.json(data)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /compare?vary=&property_type=&bedrooms=&area=&date_from=
// 受控对照:vary = 被观察变量,其余 = 控制变量
router.get('/compare', async (req: Request, res: Response) => {
  try {
    const vary = String(req.query.vary || '')
    const allowed = ['is_offplan', 'bedrooms', 'area_name', 'ptype', 'size_band', 'year']
    if (!allowed.includes(vary)) return res.status(400).json({ error: `vary must be one of ${allowed.join(', ')}` })
    const filters: any = {}
    if (req.query.property_type) filters.ptype = String(req.query.property_type)
    if (req.query.bedrooms !== undefined && req.query.bedrooms !== '') filters.bedrooms = Number(req.query.bedrooms)
    if (req.query.area) filters.area_like = String(req.query.area)
    filters.date_from = String(req.query.date_from || '2024-01-01')
    // 默认期房口径（除非被对比维度就是 is_offplan，那就不能过滤它）
    const seg = requestedSegment(req)
    if (vary !== 'is_offplan' && seg !== 'all') filters.is_offplan = seg === 'offplan'
    const r = await pool.query(
      'SELECT market_stats($1::jsonb,$2::text[],$3::text[]) AS data',
      [JSON.stringify(filters), [vary], ['txn_count', 'median_price_aed', 'median_price_sqm']]
    )
    res.json({ results: r.rows[0].data })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /report?area=&property_type=&bedrooms= —— 复合"全维"投资报告
router.get('/report', async (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || '')
    if (!area) return res.status(400).json({ error: 'area required' })
    const ptype = String(req.query.property_type || 'apartment')
    // 默认期房口径；函数内置样本护栏（<10 笔自动回退全口径，segment_used 标注）
    const r = await pool.query(
      'SELECT area_investment_report($1,$2,$3,$4) AS data',
      [area, ptype, toBeds(req.query.bedrooms), segmentToOffplan(requestedSegment(req))]
    )
    res.json(r.rows[0].data)
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /affordability?income=&cash=&down_pct=&rate=&years=&property_type=&bedrooms=
// 给月收入或首付现金 → 反推可买总价 → 推荐预算内区域
router.get('/affordability', async (req: Request, res: Response) => {
  try {
    const income = req.query.income ? Number(req.query.income) : null      // 月收入 AED
    const cash = req.query.cash ? Number(req.query.cash) : null            // 可付首付现金 AED
    if (!income && !cash) return res.status(400).json({ error: 'income or cash required' })
    const downPct = req.query.down_pct ? Number(req.query.down_pct) : 0.20  // 外籍常见 20–25%
    const rate = req.query.rate ? Number(req.query.rate) : 0.045
    const years = req.query.years ? Number(req.query.years) : 25
    const dbr = 0.40                                                        // 月供 / 月收入 上限(保守)

    const candidates: number[] = []
    let monthlyPayment: number | null = null
    if (income) {
      const pay = income * dbr
      const r = rate / 12, n = years * 12
      const loan = pay * (1 - Math.pow(1 + r, -n)) / r
      candidates.push(loan / (1 - downPct))
      monthlyPayment = Math.round(pay)
    }
    if (cash) candidates.push(cash / downPct)
    const maxPrice = Math.floor(Math.min(...candidates) / 1000) * 1000

    const ptype = String(req.query.property_type || 'apartment')
    const rec = await pool.query(
      'SELECT recommend_for_budget($1,$2,$3,$4,$5) AS data',
      [maxPrice, 'balanced', ptype, toBeds(req.query.bedrooms), 5]
    )
    res.json({
      max_price_aed: maxPrice,
      down_payment_aed: Math.round(maxPrice * downPct),
      monthly_payment_aed: monthlyPayment,
      assumptions: { down_pct: downPct, rate, years, dbr },
      affordable_areas: rec.rows[0].data,
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /project-value?project_id= —— 在售盘报价 vs DLD 片区同卧室中位价
router.get('/project-value', async (req: Request, res: Response) => {
  try {
    const id = String(req.query.project_id || '')
    if (!id) return res.status(400).json({ error: 'project_id required' })
    const pr = await pool.query(
      `SELECT project_name, area, min_bedrooms, status, COALESCE(starting_price, min_price) AS price
       FROM residential_projects WHERE id = $1`, [id]
    )
    if (!pr.rows[0]) return res.status(404).json({ error: 'project not found' })
    const { project_name, area, min_bedrooms, status, price } = pr.rows[0]
    if (!area || !price) return res.json({ project_name, note: '项目缺少区域或报价,无法对标' })
    // 在售盘报价对标默认期房口径（新盘 vs 同区期房成交才是同类对比）
    const rep = await pool.query('SELECT area_investment_report($1,$2,$3,$4) AS d',
      [area, 'apartment', min_bedrooms, segmentToOffplan(DEFAULT_SEGMENT)])
    const d = rep.rows[0].d
    if (d.error) return res.json({ project_name, area, asking_price_aed: Number(price), market: null, note: '片区近2年无可比公寓成交' })
    const mkt = d.pricing.median_price_aed
    const premium = Math.round((Number(price) / mkt - 1) * 1000) / 10
    res.json({
      project_name, area, bedrooms: min_bedrooms, status,
      asking_price_aed: Number(price), area_median_aed: mkt, premium_pct: premium,
      area_yield_pct: d.yield.gross_yield_pct, area_cagr_pct: d.trend.cagr_3y_pct, confidence: d.sample.confidence,
      segment_used: d.segment_used,
      note: d.segment_used === 'offplan'
        ? '报价 vs DLD 同区期房成交中位价;仅按 min_bedrooms 公寓对标'
        : '报价 vs DLD 同区成交中位价(期房样本不足,含现房);仅按 min_bedrooms 公寓对标'
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

// GET /costs?price=&mortgage=true —— 购房一次性费用(迪拜)
router.get('/costs', (req: Request, res: Response) => {
  const price = Number(req.query.price)
  if (!price) return res.status(400).json({ error: 'price required' })
  const mortgage = req.query.mortgage === 'true'
  const dld = price * 0.04
  const agent = price * 0.02
  const dldAdmin = 4200
  const trustee = price > 500000 ? 4200 : 2100
  const mortReg = mortgage ? price * 0.8 * 0.0025 + 290 : 0
  const total = dld + agent + dldAdmin + trustee + mortReg
  res.json({
    price_aed: price,
    costs: { dld_transfer_4pct: Math.round(dld), agent_2pct: Math.round(agent), dld_admin: dldAdmin, trustee_fee: trustee, mortgage_registration: Math.round(mortReg) },
    total_fees_aed: Math.round(total), total_fees_pct: Math.round(total / price * 1000) / 10,
    all_in_aed: Math.round(price + total),
    note: '估算;DLD 过户4% + 中介2% 为大头'
  })
})

// GET /rent-vs-buy?area=&property_type=&bedrooms=&years= —— 租 vs 买(指示性)
router.get('/rent-vs-buy', async (req: Request, res: Response) => {
  try {
    const area = String(req.query.area || '')
    if (!area) return res.status(400).json({ error: 'area required' })
    const ptype = String(req.query.property_type || 'apartment')
    const years = req.query.years ? Number(req.query.years) : 5
    const rep = await pool.query('SELECT area_investment_report($1,$2,$3,$4) AS d',
      [area, ptype, toBeds(req.query.bedrooms), segmentToOffplan(requestedSegment(req))])
    const d = rep.rows[0].d
    if (d.error) return res.json({ error: 'no_data', area })
    const price = d.pricing.median_price_aed
    const yld = d.yield.gross_yield_pct || 4
    const annualRent = price * yld / 100
    const g = Math.min(0.20, Math.max(-0.10, (d.trend.cagr_3y_pct || 3) / 100))
    const fees = price * 0.06
    const apprec = price * (Math.pow(1 + g, years) - 1)
    const buyNetCost = fees - apprec
    let rentTotal = 0
    for (let t = 0; t < years; t++) rentTotal += annualRent * Math.pow(1 + g, t)
    res.json({
      area: d.area, years, median_price_aed: price, annual_rent_aed: Math.round(annualRent),
      assumed_growth_pct: Math.round(g * 1000) / 10,
      buy_net_cost_aed: Math.round(buyNetCost), rent_total_aed: Math.round(rentTotal),
      verdict: buyNetCost < rentTotal ? 'buy' : 'rent',
      note: '指示性;未计房贷利息与物业费(数据缺口);假设持有满 ' + years + ' 年'
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

export default router
