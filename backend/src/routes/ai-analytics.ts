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
 * 区名 → `dld_transactions.area_id[]` + **客户认识的那个名字**。
 *
 * 🔴 **两件事必须一起做,分开做就是 2026-08-13 那场事故。**
 *
 * DLD 的地籍名和客户嘴里的名字是两套词汇表:
 *   `Al Barsha South Fourth` = **JVC**   ·  `Al Hebiah First` = **Motor City**
 *   `Al Khairan First`       = **Dubai Creek Harbour**
 *
 * 生产事故(session voice_1786660799654_8qoieo 第 13 轮):客户聊完 JVC 问「哪些区更抗跌」,
 * `compare_market` 把**没翻译的地籍名**原样吐回去,Luna 照念成「阿尔巴沙南四区流动性极高」
 * —— **那就是客户刚问完的 JVC 本身**,被当成「另一个更抗跌的区」推荐了回去;
 * 同一句里的「阿尔希比亚一区」其实是人人都知道的 **Motor City**。
 *
 * 客户完全看不出来。这不是模型幻觉,是**工具层漏了一次翻译**。
 *
 * 解析口径与 `area_investment_report()` 完全一致(营销名 → dubai_areas 最短匹配 →
 * dld_areas.area_id),保证同一个区在所有工具里算出来是同一批成交。
 */
async function resolveArea(raw: string): Promise<{ ids: number[]; displayName: string } | null> {
  const like = `%${raw}%`
  // 营销名(dubai_areas.name)优先 —— 取最短匹配,最贴切
  const blk = await pool.query(
    `SELECT id, name FROM dubai_areas WHERE name ILIKE $1 ORDER BY length(name) ASC LIMIT 1`, [like]
  )
  if (blk.rows[0]) {
    const r = await pool.query(
      `SELECT array_agg(area_id) AS ids FROM dld_areas WHERE dubai_area_id = $1`, [blk.rows[0].id]
    )
    const ids = (r.rows[0]?.ids || []).filter((x: any) => x != null)
    if (ids.length) return { ids, displayName: blk.rows[0].name }
  }
  // 回退:用户直接说了地籍名 → 反查营销名,但**要过置信度门槛**(见 customerAreaNames)
  const r = await pool.query(
    `SELECT array_agg(da.area_id) AS ids, min(da.area_name) AS dld_name
       FROM dld_areas da WHERE da.area_name ILIKE $1`, [like]
  )
  const ids = (r.rows[0]?.ids || []).filter((x: any) => x != null)
  if (!ids.length) return null
  const dldName = r.rows[0].dld_name || raw
  const map = await customerAreaNames([dldName])
  return { ids, displayName: map.get(dldName) || dldName }
}

/**
 * DLD 地籍名 → 客户认识的名字。**翻不动就原样返回,绝不硬翻。**
 *
 * `dld_areas.dubai_area_id` 这张桥接表是模糊匹配建的,**有兜底垃圾桶**:
 * 光 `Deira` 一个营销名底下就挂了 **35 个** DLD 区,里面混着
 * `Al Barshaa South Second`(7,727 笔成交,实际在 Arjan 旁边,离 Deira 半个迪拜)
 * 和 `Al Yelayiss 3/4`(Dubai South 方向)。
 *
 * 🔴 **所以翻译必须带门槛,否则是拿一个更隐蔽的错去修一个明显的错** ——
 * 不翻译时客户听到「阿尔巴沙南二区」会觉得拗口;硬翻之后他听到的是「Deira」,
 * 一个**听起来完全合理、实际指鹿为马**的答案。后者危险得多。
 *
 * 判据用 `siblings`(同一营销名底下挂了几个地籍区):抽查成交量 top 45 的区,
 * 所有正确映射都 ≤4(1:1 的 JVC/Motor City/Arjan… 全对,2:1 的 DIP First/Second 也对),
 * 唯一一条错的正好是 siblings=35 那个垃圾桶。阈值卡 4,一刀切干净。
 */
const BRIDGE_MAX_SIBLINGS = 4

/** 区名分词:去掉阿拉伯语冠词和序数词后缀,只留有区分度的词。 */
const AREA_STOPWORDS = new Set(['al', 'the', 'first', 'second', 'third', 'fourth', 'fifth',
  'sixth', 'north', 'south', 'east', 'west', 'area', 'dubai', '1', '2', '3', '4', '5'])

function areaTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w && !AREA_STOPWORDS.has(w))
  )
}

/**
 * 地籍名和营销名的词重叠度(0-1)。JVC↔Al Barsha South Fourth 是 0,这没问题 —— 见下。
 *
 * 阿拉伯语转写在两张表里**拼法不统一**(`Muhaisanah` vs `Muhaisnnah`、
 * `Barsha` vs `Barshaa`),精确比对会把同一个地方判成两个,于是兜底项反而
 * 和真身同分、一起蒙混过关。前 5 个字母相同就算半分,专治转写差异。
 */
function nameAffinity(dldName: string, customerName: string): number {
  const a = [...areaTokens(dldName)], b = [...areaTokens(customerName)]
  if (!a.length || !b.length) return 0
  let score = 0
  for (const w of b) {
    if (a.includes(w)) { score += 1; continue }
    if (w.length >= 5 && a.some(x => x.length >= 5 && x.slice(0, 5) === w.slice(0, 5))) score += 0.5
  }
  return score / b.length
}

async function customerAreaNames(dldNames: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!dldNames.length) return map
  // 连同**所有兄弟**一起取回来 —— 判断某条是不是兜底,必须看它的竞争者
  const r = await pool.query(
    `SELECT da.area_name AS dld_name, a.name AS customer_name, da.dubai_area_id,
            (SELECT count(*)      FROM dld_areas x WHERE x.dubai_area_id = da.dubai_area_id) AS siblings,
            (SELECT array_agg(x.area_name) FROM dld_areas x WHERE x.dubai_area_id = da.dubai_area_id) AS sibling_names
       FROM dld_areas da JOIN dubai_areas a ON a.id = da.dubai_area_id
      WHERE da.area_name = ANY($1)`, [dldNames]
  )
  for (const row of r.rows) {
    // 门槛一:兜底垃圾桶(Deira 底下挂了 35 个区)一律不翻
    if (Number(row.siblings) > BRIDGE_MAX_SIBLINGS) continue

    /**
     * 门槛二:**同一营销名底下,有名字明显更贴近的兄弟时,其余的都是兜底。**
     *
     * siblings 门槛挡不住小垃圾桶:`Palm Jumeirah` 只挂了 2 个地籍区 ——
     * `Palm Jumeirah`(真身)和 `Al-Muhaisnah North`(内陆区,离棕榈岛半个迪拜)。
     * 前者词重叠 1.0,后者 0 → 只认前者。
     *
     * 而 `JVC Jumeirah Village Circle ← Al Barsha South Fourth` 重叠也是 0,
     * 却完全正确 —— 区别在于**它没有竞争者**(siblings=1,最高分就是它自己)。
     * 所以判据是「有没有比我更像的兄弟」,不是「我像不像」。
     * 同源分期(DIP First/Second)彼此同分,一起保留。
     */
    const sibs: string[] = row.sibling_names || [row.dld_name]
    const mine = nameAffinity(row.dld_name, row.customer_name)
    const best = Math.max(...sibs.map(s => nameAffinity(s, row.customer_name)))
    if (best > mine) continue

    map.set(row.dld_name, row.customer_name)
  }
  return map
}

/**
 * GET /recent-transactions?area=&bedrooms=&property_type=&segment=&limit=
 *
 * **逐笔真实成交** —— 「上周 Luma Park Views 一套 82 平的 1 房卖了 125 万」。
 *
 * 为什么值得单开一个端点:在此之前 Luna 的 23 个工具**全是聚合**(中位价/年化/收益率)。
 * 聚合数字答不了「你凭什么这么说」,于是模型只能拿形容词填 ——「需求强劲」「稳步上涨」
 * 「抗跌性强」,一句都不可核查。**给它可举证的原子事实,空话才会自己消失。**
 *
 * DLD 原始数据里同一套房会有完全相同的多行(同日同价同面积),直接展示会让客户
 * 觉得「这数据有问题」,所以按 (日期,项目,面积,价格) 去重。
 */
router.get('/recent-transactions', async (req: Request, res: Response) => {
  try {
    const rawArea = String(req.query.area || '')
    if (!rawArea) return res.status(400).json({ error: 'area required' })
    const resolved = await resolveArea(rawArea)
    if (!resolved) return res.json({ error: 'unknown_area', area: rawArea, transactions: [] })

    const ptype = String(req.query.property_type || 'apartment')
    const beds = toBeds(req.query.bedrooms)
    const seg = requestedSegment(req)
    const offplan = segmentToOffplan(seg)
    const limit = Math.min(Number(req.query.limit) || 6, 12)

    const run = (off: boolean | null) => pool.query(
      `SELECT DISTINCT ON (txn_date, project_name, size_sqm, price_aed)
              txn_date, project_name, bedrooms, is_offplan,
              round(size_sqm)  AS size_sqm,
              round(price_aed) AS price_aed,
              round(price_sqm) AS price_sqm
         FROM v_sales
        WHERE area_id = ANY($1) AND ptype = $2
          AND ($3::int  IS NULL OR bedrooms   = $3)
          AND ($4::bool IS NULL OR is_offplan = $4)
          AND price_aed > 0
          AND txn_date >= CURRENT_DATE - INTERVAL '6 months'
        ORDER BY txn_date DESC, project_name, size_sqm, price_aed DESC
        LIMIT $5`,
      [resolved.ids, ptype, beds, off, limit]
    )

    let r = await run(offplan)
    let usedSeg: string = seg
    // 该口径近半年没成交 → 回退全口径(宁可标注口径,也不要空手)
    if (!r.rowCount && offplan !== null) { r = await run(null); usedSeg = 'all' }

    res.json({
      area: resolved.displayName,
      area_query: rawArea,
      bedrooms: beds, ptype,
      segment_requested: seg, segment_used: usedSeg,
      count: r.rowCount,
      transactions: r.rows.map((x: any) => ({
        date: x.txn_date,
        project: x.project_name,
        bedrooms: x.bedrooms,
        size_sqm: Number(x.size_sqm),
        price_aed: Number(x.price_aed),
        price_sqm: Number(x.price_sqm),
        offplan: x.is_offplan,
      })),
      note: '来自 DLD 官方成交登记;已按(日期,项目,面积,价格)去重',
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

/**
 * GET /price-trend?area=&bedrooms=&property_type=&segment=&quarters=
 *
 * **逐季度中位单价 + 成交量**,外加从峰值算起的回撤。
 *
 * 存在的理由是一个具体的失败:客户问「未来交付量大,会不会压低这个区的成交价?」
 * —— 一个非常专业的问题。Luna 当时手上只有一个「近3年年化 +10.9%」的标量,
 * 于是答了「成熟社区、需求强劲、能消化新增供应」。
 *
 * 而真实数据(JVC 现房转售中位单价)是:
 *   2025Q4 14,553 → 2026Q1 14,326 → 2026Q2 13,836 → 2026Q3 12,733 AED/㎡
 * **已经连跌三个季度、从峰值回撤 12.5%。** 客户问的「未来会不会」,数据的答案是
 * 「已经在发生了」。一个三年期年化标量把一次正在进行的下行完全藏住了。
 *
 * 标量答不了拐点,序列才能。**`peak` / `drawdown_pct` 直接算好给模型**,
 * 因为「自己从序列里找峰值」正是模型最容易算错、也最容易含糊过去的一步。
 */
router.get('/price-trend', async (req: Request, res: Response) => {
  try {
    const rawArea = String(req.query.area || '')
    if (!rawArea) return res.status(400).json({ error: 'area required' })
    const resolved = await resolveArea(rawArea)
    if (!resolved) return res.json({ error: 'unknown_area', area: rawArea, quarters: [] })

    const ptype = String(req.query.property_type || 'apartment')
    const beds = toBeds(req.query.bedrooms)
    const seg = requestedSegment(req)
    const offplan = segmentToOffplan(seg)
    const nQ = Math.min(Number(req.query.quarters) || 12, 20)

    const r = await pool.query(
      `SELECT date_trunc('quarter', txn_date)::date AS quarter,
              count(*) AS txns,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_sqm)) AS median_sqm,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_aed)) AS median_price
         FROM v_sales
        WHERE area_id = ANY($1) AND ptype = $2
          AND ($3::int  IS NULL OR bedrooms   = $3)
          AND ($4::bool IS NULL OR is_offplan = $4)
          AND txn_date >= date_trunc('quarter', CURRENT_DATE) - ($5 || ' months')::interval
        GROUP BY 1 HAVING count(*) >= 5
        ORDER BY 1`,
      [resolved.ids, ptype, beds, offplan, String(nQ * 3)]
    )

    const qs = r.rows.map((x: any) => ({
      quarter: x.quarter, txns: Number(x.txns),
      median_sqm: Number(x.median_sqm), median_price: Number(x.median_price),
    }))
    if (qs.length < 3) {
      return res.json({ area: resolved.displayName, quarters: qs, error: 'insufficient_history',
        note: '季度样本太少,给不出可靠趋势' })
    }

    // 🔴 拐点比斜率重要。三年年化是正的、同时正在连跌三季 —— 这两件事完全可以同时为真,
    //    而客户问的永远是后者。峰值/回撤/连跌季数在这里算死,不留给模型口算。
    const last = qs[qs.length - 1]
    const peak = qs.reduce((a, b) => (b.median_sqm > a.median_sqm ? b : a))
    let falling = 0
    for (let i = qs.length - 1; i > 0; i--) {
      if (qs[i].median_sqm < qs[i - 1].median_sqm) falling++
      else break
    }
    const drawdown = Math.round((last.median_sqm / peak.median_sqm - 1) * 1000) / 10
    const first = qs[0]
    const span = (new Date(last.quarter).getTime() - new Date(first.quarter).getTime()) / (365.25 * 864e5)
    const cagr = span >= 1
      ? Math.round((Math.pow(last.median_sqm / first.median_sqm, 1 / span) - 1) * 1000) / 10
      : null

    res.json({
      area: resolved.displayName, area_query: rawArea, bedrooms: beds, ptype,
      segment_requested: seg, segment_used: seg,
      quarters: qs,
      latest: last, peak,
      drawdown_from_peak_pct: drawdown,
      consecutive_falling_quarters: falling,
      cagr_pct: cagr,
      direction: falling >= 2 ? 'falling' : drawdown <= -5 ? 'off_peak' : cagr != null && cagr > 3 ? 'rising' : 'flat',
      note: '中位单价(AED/㎡)按成交季度;单季少于5笔的季度已剔除',
    })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

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
    let results = r.rows[0].data || []

    /**
     * 🔴 **按区对比必须把地籍名翻回客户认识的名字。**
     *
     * `market_stats` 分组用的是 `dld_transactions.area_name` —— DLD 地籍名,
     * 客户一个都没听过,而且和他自己刚说的区名对不上号:
     *   `Al Barsha South Fourth` = **JVC**  ·  `Al Hebiah First` = **Motor City**
     *
     * 不翻译的后果不是「说得拗口」,是**同一个区被当成两个区**:客户聊完 JVC 问
     * 「哪个区更抗跌」,这里原样返回 `Al Barsha South Fourth`,Luna 就把 JVC 换个名字
     * 又推荐了一遍(2026-08-13 生产事故)。所以还要标 `same_as_query`,
     * 让模型知道「这条就是他刚问的那个区」,别拿它当新选项。
     */
    if (vary === 'area_name' && results.length) {
      const names = results.map((x: any) => x.area_name).filter(Boolean)
      // 带置信度门槛的翻译:翻不动的原样保留,绝不硬翻(见 customerAreaNames)
      const map = await customerAreaNames(names)
      const asked = filters.area_like ? String(filters.area_like).toLowerCase() : null
      results = results.map((x: any) => {
        const display = map.get(x.area_name) || x.area_name
        return {
          ...x,
          area_name: display,          // 模型只看得到客户认识的名字
          dld_area_name: x.area_name,  // 地籍名留档,便于溯源
          ...(asked && display.toLowerCase().includes(asked) ? { same_as_query: true } : {}),
        }
      })
    }
    res.json({ results })
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
    // 🔴 `if (!id)` 拦不住字面量 "undefined" —— 它是个非空字符串,会一路走到
    //    `WHERE id = $1`,Postgres uuid 转型报错 → catch 成 500。
    //    生产事故 #716(2026-08-11,3 次 500)就是这么来的:调用方(Luna 的
    //    project_value_check 工具)在没拿到 id 时把 undefined 拼进了 URL。
    //    2026-07-11/08-09 给 residential-projects 的 /:id 路由加过同样的守卫两次,
    //    **这个端点是 query 参数,两次都漏了**。见 routes/project-insights.ts。
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'valid project_id required' })
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
