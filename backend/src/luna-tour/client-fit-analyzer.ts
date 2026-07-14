/**
 * 客户 × 项目 × 户型 —— 两层深度论证 (2026-07-12)。
 *
 * owner 定性:**「用 AI 解释清楚为啥适合客户、特点是什么、为啥值得 —— 说服客户」**
 *            **「要用特点对特点,一个户型要读懂客户的情况,做 2 层深层分析」**
 *
 * 所以 AI 的活是**论证**,不是选盘 —— 经纪心里早知道要推哪个项目,他缺的是
 * 「怎么说服客户这个值得」。
 *
 *   Layer 1  项目 × 客户 —— 区域/回报/配套/交付 ↔ 目标/预算/偏好
 *   Layer 2  户型 × 客户 —— **特点对特点**,逐条咬合,并说清**为什么不推另外那个**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 数据现实(实测 project_unit_types 468 行的填充率)—— 决定 AI 能咬什么:
 *      bedrooms / bathrooms / area   100%  ✅
 *      features(数组)                100%  ✅ ← 金矿,见下
 *      floor_plan_image              100%  ✅
 *      balcony_area                   88%  ✅
 *      price                          51%  ⚠️ 半数缺价 → 标「价格待定」,不猜
 *      orientation(朝向)               0%  ❌
 *      view_type(景观)                 0%  ❌
 *      floor_level(楼层)               0%  ❌
 *
 * 🔴 **朝向/景观/楼层一律不进 prompt**。给 AI 一个空字段它就会开始编,而这份报告
 *    是**要发给客户的** —— 编一句「南向采光好」就是在经纪的品牌上撒谎。
 *    没有的数据,就不提。(prompt 里也明确禁止。)
 *
 * 💡 features 是「特点对特点」的原料,每条都能读出客户的处境:
 *      Maid's room(194个)   → 中东/亚洲**大家庭刚需**
 *      Laundry / Storage    → **长期自住**信号(投资客不在乎)
 *      Open kitchen(277个)  → 对中国客户可能是**减分项**(爆炒油烟大)
 *      Powder room(332个)   → 常**接待客人**
 *      En-suite bathroom    → 多代同住 / **好分租**
 *
 * ISOLATION: 只读 project_unit_types。删 luna-tour 目录即移除。
 */
import { GoogleGenAI } from '@google/genai'
import { DEFAULT_CHAIN } from '../services/ai/models'
import pool from '../db/pool'
import type { ExtractedProfile } from './client-profile-coach'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
/** 见 docs/reports/2026-07-12-gemini-model-lineup.md —— 别写 gemini-3-flash(404)。 */
const MODELS = DEFAULT_CHAIN
/** 这是**论证**任务(要推理),不是抽取 —— 给一点思考预算,但别放飞。 */
const THINKING = { thinkingLevel: 'low' as const }
const MAX_OUTPUT_TOKENS = 4000

// ── 户型(带全部可用特征)────────────────────────────────────────────────────

export interface UnitRow {
  id: string
  name: string
  bedrooms: number | null
  bathrooms: number | null
  area: number | null
  balcony_area: number | null
  price: number | null
  price_per_sqft: number | null
  features: string[]
  floor_plan_image: string | null
  description: string | null
}

/**
 * 项目的户型 —— **把能用的特征全取出来**。
 *
 * ⚠️ 旧实现只 SELECT 了 (name, bedrooms, area, price, price_per_sqft) 5 个字段,
 *    把 100% 填充的 features / bathrooms / balcony / floor_plan **全丢了** ——
 *    AI 想「特点对特点」也无米下锅。
 * ⚠️ 旧实现还 `WHERE price IS NOT NULL`,而 price 只有 51% 填充 → **一半户型被静默
 *    过滤掉**,经纪看到的「适合的户型」里可能根本不含真正适合的那个(只是它没录价)。
 *    现在无价户型照常参与,只是标「价格待定」。
 */
export async function projectUnits(projectId: string): Promise<UnitRow[]> {
  try {
    const r = await pool.query(
      `SELECT id::text, unit_type_name, bedrooms, bathrooms, area, balcony_area,
              price, price_per_sqft, features, floor_plan_image, description
         FROM project_unit_types
        WHERE project_id = $1
        ORDER BY bedrooms NULLS LAST, price ASC NULLS LAST
        LIMIT 12`,
      [projectId]
    )
    return r.rows.map((u) => ({
      id: u.id,
      name: u.unit_type_name,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms != null ? Number(u.bathrooms) : null,
      area: u.area != null ? Number(u.area) : null,
      balcony_area: u.balcony_area != null ? Number(u.balcony_area) : null,
      price: u.price != null ? Number(u.price) : null,
      price_per_sqft: u.price_per_sqft != null ? Number(u.price_per_sqft) : null,
      features: Array.isArray(u.features) ? u.features : [],
      floor_plan_image: u.floor_plan_image,
      description: u.description,
    }))
  } catch { return [] }
}

// ── 规则打分:先筛掉明显不合适的,别让 AI 在 12 个户型里瞎猜 ──────────────────

export interface ScoredUnit extends UnitRow {
  fit: number                  // 0-100
  hard_fails: string[]         // 硬伤(超预算 / 卧室不够)
}

/**
 * 户型 × 客户 的**规则**打分 —— 跑在 AI 之前。
 *
 * 为什么要规则:AI 擅长论证,不擅长算数。预算够不够、卧室数够不够,这些是**事实**,
 * 不该交给模型去"感觉"。规则先排好序 + 标出硬伤,AI 只负责把「为什么」讲透。
 */
export function scoreUnits(units: UnitRow[], p: ExtractedProfile): ScoredUnit[] {
  const budget = p.budget_max ?? p.budget_min ?? null
  const fam = p.family_size ?? null
  const invest = p.goal === 'invest'

  return units.map((u) => {
    let fit = 50
    const fails: string[] = []

    // 预算(price 只有 51% 填充 —— 无价的不扣分,只标待定)
    if (budget && u.price) {
      if (u.price <= budget) fit += 20
      else if (u.price <= budget * 1.1) { fit += 5; fails.push(`超预算 ${Math.round((u.price / budget - 1) * 100)}%（可谈）`) }
      else { fit -= 30; fails.push(`超预算 ${Math.round((u.price / budget - 1) * 100)}%`) }
    }

    // 卧室 vs 家庭人数(自住才算 —— 投资客不住)
    if (!invest && fam && u.bedrooms != null) {
      const need = fam <= 2 ? 1 : fam <= 4 ? 2 : 3
      if (u.bedrooms >= need) fit += 15
      else { fit -= 25; fails.push(`${u.bedrooms} 房住不下 ${fam} 口人`) }
    }
    // 客户明确要几房
    if (p.bedrooms != null && u.bedrooms != null) {
      if (u.bedrooms === p.bedrooms) fit += 15
      else if (Math.abs(u.bedrooms - p.bedrooms) === 1) fit += 3
    }

    const f = u.features.map((x) => x.toLowerCase())
    const has = (kw: string) => f.some((x) => x.includes(kw))

    // 女佣房 —— 请保姆 / 大家庭的刚需(194 个户型有)
    if (p.has_maid === true && has('maid')) fit += 12
    if (p.has_maid === true && !has('maid')) { fit -= 10; fails.push('没有女佣房') }
    if ((fam ?? 0) >= 4 && has('maid')) fit += 5

    // 开放厨房 —— 中式爆炒的减分项
    if (p.cooking === 'often' && has('open kitchen')) { fit -= 8; fails.push('开放式厨房（常做饭油烟大）') }

    // 长期自住的信号
    if ((p.goal === 'live' || p.goal === 'both') && (has('laundry') || has('storage') || has('utility'))) fit += 4

    // 投资:小户型好出租好转手;en-suite 好分租
    if (invest) {
      if (u.bedrooms != null && u.bedrooms <= 1) fit += 8
      if (has('en-suite')) fit += 4
      if (p.horizon === 'flip' && u.bedrooms != null && u.bedrooms >= 2) fit += 4 // 转手:2房受众更广
    }

    return { ...u, fit: Math.max(0, Math.min(100, fit)), hard_fails: fails }
  }).sort((a, b) => b.fit - a.fit)
}

// ── 两层 AI 论证 ───────────────────────────────────────────────────────────

const N = (t: string) => ({ type: [t, 'null'] })
const SARR = { type: ['array', 'null'], items: { type: 'string' } }

/** 全 required + 允许 null —— 见 gemini-model-lineup 报告:optional 会**静默丢字段**。 */
const FIT_SCHEMA = {
  type: 'object',
  properties: {
    // Layer 1 — 项目 × 客户
    project_fit: N('number'),
    project_why: { ...SARR, description: '3-5 条「为什么这个项目适合他」，每条都要引用他的具体情况' },
    project_tradeoffs: { ...SARR, description: '1-2 条诚实的取舍/风险。客户不傻，全是优点反而不可信' },
    // Layer 2 — 户型 × 客户
    recommended_unit: N('string'),
    unit_why: { ...SARR, description: '主推户型：特点对特点，逐条咬合他的情况' },
    unit_why_not: { ...SARR, description: '**为什么不推另外那个** —— 说清不推什么，比只夸一个更有说服力' },
    summary: N('string'),
  },
  required: ['project_fit', 'project_why', 'project_tradeoffs', 'recommended_unit', 'unit_why', 'unit_why_not', 'summary'],
}

export interface FitAnalysis {
  project_fit: number | null
  project_why: string[]
  project_tradeoffs: string[]
  recommended_unit: string | null
  unit_why: string[]
  unit_why_not: string[]
  summary: string | null
}

function profileLines(p: ExtractedProfile): string {
  const L: string[] = []
  const goal = p.goal === 'live' ? '自住' : p.goal === 'invest' ? '投资' : p.goal === 'both' ? '先出租、以后自住' : null
  if (goal) L.push(`目的：${goal}`)
  if (p.budget_max || p.budget_min) L.push(`预算：AED ${(p.budget_max ?? p.budget_min)!.toLocaleString('en-US')}`)
  if (p.payment) L.push(`付款：${{ cash: '全款', installment: '开发商分期', mortgage: '银行贷款' }[p.payment]}`)
  if (p.horizon) L.push(`投资周期：${{ rent_long: '长期收租', flip: '3-5 年转手', rent_then_live: '先租后自住' }[p.horizon]}`)
  if (p.family_size) L.push(`家庭：${p.family_size} 口人${p.has_children ? '，有小孩' : ''}`)
  if (p.has_maid === true) L.push('请保姆（需要女佣房）')
  if (p.cooking === 'often') L.push('常在家做饭（开放式厨房是减分项）')
  if (p.nationality) L.push(`来自：${p.nationality}`)
  if (p.bedrooms) L.push(`想要 ${p.bedrooms} 房`)
  if (p.preferred_areas?.length) L.push(`偏好区域：${p.preferred_areas.join('、')}`)
  if (p.golden_visa === true) L.push('想办黄金签证（房产需 ≥ AED 200 万）')
  if (p.first_time_buyer === true) L.push('第一次在迪拜买房（要把 DLD 手续费、物业费讲清楚）')
  if (p.offplan_ok === false) L.push('只要现房，不接受期房')
  return L.length ? L.join('\n') : '（经纪没提供画像 —— 只能做通用论证，说服力会打折）'
}

function unitLines(units: ScoredUnit[]): string {
  return units.slice(0, 6).map((u, i) => {
    const bits = [
      `${i + 1}. ${u.name}`,
      u.bedrooms != null ? `${u.bedrooms} 房` : null,
      u.bathrooms != null ? `${u.bathrooms} 卫` : null,
      u.area != null ? `${u.area} ft²` : null,
      u.balcony_area ? `阳台 ${u.balcony_area} ft²` : null,
      // ⚠️ price 只有 51% 填充 —— 没有就明说「价格待定」,别让 AI 猜
      u.price != null ? `AED ${u.price.toLocaleString('en-US')}` : '价格待定（需向开发商询价）',
      u.price_per_sqft != null ? `单价 ${Math.round(u.price_per_sqft)}/ft²` : null,
    ].filter(Boolean).join(' · ')
    const feat = u.features.length ? `\n   配置：${u.features.join('、')}` : ''
    const fail = u.hard_fails.length ? `\n   ⚠️ ${u.hard_fails.join('；')}` : ''
    return bits + feat + fail
  }).join('\n')
}

const PROMPT = `你是迪拜顶级房产经纪的分析师。经纪要把这个项目推给这位客户，你要写出**说服他的弹药**。

# 客户（经纪掌握的全部情况）
{{PROFILE}}

# 项目
{{PROJECT}}

# 该项目的户型（按规则初筛后的顺序，⚠️ 是已经算出来的硬伤）
{{UNITS}}

# 你的任务：两层论证

**第 1 层 · 项目 × 客户**
逐条说清「为什么**这个项目**适合**这位客户**」。每一条都必须扣住他的**具体情况**
（他的预算、目的、家庭、周期），不要写放之四海皆准的套话。
再给 1-2 条**诚实的取舍或风险** —— 客户不傻，一份全是优点的报告反而不可信。

**第 2 层 · 户型 × 客户（特点对特点）**
选出**一个**主推户型，然后**逐条咬合**：
- 面积/卧室 ↔ 他家几口人、有没有小孩
- 配置逐条对他的处境（例：有女佣房 ↔ 他请保姆；有洗衣房/储物间 ↔ 长期自住；
  开放式厨房 ↔ 如果他常做中餐，这是**减分项**，要明说；en-suite ↔ 好分租/多代同住）
- 总价/单价 ↔ 他的预算和付款方式
- 投资客还要讲：好不好出租、好不好转手
最后**必须**说清「**为什么不推另外那个**」—— 比如「B2 便宜 8 万，但没有女佣房，
你们一家四口加保姆住不开」。**说清不推什么，比只夸一个更有说服力。**

# 🔴 铁律
1. **只用上面给你的数据。没给你的，一个字都不许提。**
   特别是：**朝向、景观、楼层、车位 —— 这些数据我们没有，你敢写就是编。**
   这份报告要发给真实客户，编一句「南向采光好」就是在经纪的品牌上撒谎。
2. 价格标了「价格待定」的，**不许猜价**，就说需要向开发商询价。
3. 客户画像里没有的信息（比如他没说要办签证），**不要假设**。
4. **语气：专业、亲切的书面语。**
   这是一份**客户会自己打开来读的书面报告**，不是微信聊天：
   ❌ 不要用「哥」「兄弟」「咱」这类称呼 —— 客户可能是他刚认识的人
   ❌ 不要写成报告腔/学术腔（「综上所述」「本方案具备」）
   ✅ 就像一个专业顾问当面跟他讲清楚一件事：直接、具体、有数字、敢说实话
5. 全部用中文。`

/**
 * 跑两层论证。best-effort —— 挂了返回 null,报告照样出(只是少了论证段)。
 */
export async function analyzeFit(
  profile: ExtractedProfile,
  project: { name: string; area?: string | null; developer?: string | null; [k: string]: unknown },
  units: ScoredUnit[]
): Promise<FitAnalysis | null> {
  if (!units.length) return null

  // 项目侧:只喂**真实有的**数据(AI 编不出它没见过的东西)
  const pj = project as any
  const projectLines = [
    `名称：${pj.name}`,
    pj.developer ? `开发商：${pj.developer}` : null,
    pj.area ? `区域：${pj.area}` : null,
    pj.area_metrics?.median_price ? `区域中位价：AED ${Number(pj.area_metrics.median_price).toLocaleString('en-US')}` : null,
    pj.area_metrics?.rental_yield_pct ? `区域租金回报：${pj.area_metrics.rental_yield_pct}%` : null,
    pj.area_metrics?.price_growth_pct ? `区域年涨幅：${pj.area_metrics.price_growth_pct}%` : null,
    pj.net?.net_annualized_pct ? `5 年净年化回报（已扣 DLD 费/中介费/物业费）：${pj.net.net_annualized_pct}%` : null,
    pj.net?.net_profit ? `5 年净收益：AED ${Number(pj.net.net_profit).toLocaleString('en-US')}` : null,
    Array.isArray(pj.nearby) && pj.nearby.length
      ? `周边：${pj.nearby.slice(0, 6).map((n: any) => `${n.name || n.category}${n.distance_km ? ` ${n.distance_km}km` : ''}`).join('、')}`
      : null,
    Array.isArray(pj.comps) && pj.comps.length ? `真实 DLD 成交：${pj.comps.length} 笔可比` : null,
  ].filter(Boolean).join('\n')

  const contents = PROMPT
    .replace('{{PROFILE}}', profileLines(profile))
    .replace('{{PROJECT}}', projectLines)
    .replace('{{UNITS}}', unitLines(units))

  for (const model of MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: 'application/json',
          responseSchema: FIT_SCHEMA as any,
          temperature: 0.4,          // 论证要有点文采,但别放飞
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: THINKING,
        } as any,
      })
      const j = JSON.parse((res.text || '{}').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
      return {
        project_fit: j.project_fit ?? null,
        project_why: j.project_why ?? [],
        project_tradeoffs: j.project_tradeoffs ?? [],
        recommended_unit: j.recommended_unit ?? null,
        unit_why: j.unit_why ?? [],
        unit_why_not: j.unit_why_not ?? [],
        summary: j.summary ?? null,
      }
    } catch (e) {
      console.error(`[fit-analyzer] failed (${model}):`, e instanceof Error ? e.message : e)
    }
  }
  return null
}
