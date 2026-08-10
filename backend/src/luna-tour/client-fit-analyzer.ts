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
import { callGemini } from '../services/ai/gemini'
import pool from '../db/pool'
import { langInstruction, type LangCode } from '../lib/lang'
import type { ExtractedProfile } from './client-profile-coach'

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
/**
 * 硬伤原因 —— 同样会被模型抄进输出,所以也要按语言出。
 * (见 UNIT_LABELS 上面那段:任何进入提示词的字面量都会漏进输出。)
 */
const FAIL_LABELS: Record<LangCode, {
  overBudget: (pct: number) => string
  tooSmall: (bed: number, fam: number) => string
  noMaid: string
  openKitchen: string
}> = {
  zh: { overBudget: (n) => `超预算 ${n}%`, tooSmall: (b, f) => `${b} 房住不下 ${f} 口人`,
        noMaid: '没有女佣房', openKitchen: '开放式厨房（常做饭油烟大）' },
  en: { overBudget: (n) => `${n}% over budget`, tooSmall: (b, f) => `${b} bed is tight for ${f} people`,
        noMaid: 'no maid’s room', openKitchen: 'open kitchen (a drawback if you cook often)' },
  fr: { overBudget: (n) => `${n}% au-dessus du budget`, tooSmall: (b, f) => `${b} ch. est juste pour ${f} personnes`,
        noMaid: 'pas de chambre de bonne', openKitchen: 'cuisine ouverte (gênant si vous cuisinez souvent)' },
  ru: { overBudget: (n) => `на ${n}% выше бюджета`, tooSmall: (b, f) => `${b} спальни маловато для ${f} человек`,
        noMaid: 'нет комнаты для помощницы', openKitchen: 'открытая кухня (минус при частой готовке)' },
  ar: { overBudget: (n) => `يتجاوز الميزانية بنسبة ${n}%`, tooSmall: (b, f) => `${b} غرفة ضيّقة على ${f} أشخاص`,
        noMaid: 'لا توجد غرفة خادمة', openKitchen: 'مطبخ مفتوح (عيب لمن يطبخ كثيرًا)' },
}

export function scoreUnits(units: UnitRow[], p: ExtractedProfile, lang: LangCode = 'zh'): ScoredUnit[] {
  const F = FAIL_LABELS[lang] || FAIL_LABELS.en
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
      else { fit -= 30; fails.push(F.overBudget(Math.round((u.price / budget - 1) * 100))) }
    }

    // 卧室 vs 家庭人数(自住才算 —— 投资客不住)
    if (!invest && fam && u.bedrooms != null) {
      const need = fam <= 2 ? 1 : fam <= 4 ? 2 : 3
      if (u.bedrooms >= need) fit += 15
      else { fit -= 25; fails.push(F.tooSmall(u.bedrooms, fam)) }
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
    if (p.has_maid === true && !has('maid')) { fit -= 10; fails.push(F.noMaid) }
    if ((fam ?? 0) >= 4 && has('maid')) fit += 5

    // 开放厨房 —— 中式爆炒的减分项
    if (p.cooking === 'often' && has('open kitchen')) { fit -= 8; fails.push(F.openKitchen) }

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
    // ⚠️ **量表必须写进 description。** 不写的话模型会自己挑一个 —— 实测它给过 4,
    //    前端照着 0-100 画就是一条几乎空的进度条,客户看到「Match 4」。
    project_fit: { ...N('number'), description: '0-100 的整数匹配度。60 以下=勉强，60-75=不错，75-90=很合适，90+=极其合适。**必须落在 0-100**，不要用 0-5 或 0-10 的量表' },
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

/**
 * 客户画像 —— 喂给 AI 的上下文。
 *
 * 只有中文和英文两套(不是五套):这是**提示词上下文**,模型会重写成目标语言,
 * 真正会被原样抄走的是 unitLines 那种逐条枚举。中文上下文漏进英文报告刺眼,
 * 英文上下文漏进法/俄/阿则基本无害(而且 budget / Golden Visa 这些词本来就通用)。
 */
function profileLines(p: ExtractedProfile, lang: LangCode = 'zh'): string {
  const zh = lang === 'zh'
  const L: string[] = []
  const goal = p.goal === 'live' ? (zh ? '自住' : 'to live in')
    : p.goal === 'invest' ? (zh ? '投资' : 'investment')
    : p.goal === 'both' ? (zh ? '先出租、以后自住' : 'rent out first, live in it later') : null
  if (goal) L.push(zh ? `目的：${goal}` : `Purpose: ${goal}`)
  if (p.budget_max || p.budget_min) L.push(`${zh ? '预算' : 'Budget'}: AED ${(p.budget_max ?? p.budget_min)!.toLocaleString('en-US')}`)
  if (p.payment) L.push(`${zh ? '付款' : 'Payment'}: ${(zh
    ? { cash: '全款', installment: '开发商分期', mortgage: '银行贷款' }
    : { cash: 'cash in full', installment: 'developer payment plan', mortgage: 'bank mortgage' })[p.payment]}`)
  if (p.horizon) L.push(`${zh ? '投资周期' : 'Horizon'}: ${(zh
    ? { rent_long: '长期收租', flip: '3-5 年转手', rent_then_live: '先租后自住' }
    : { rent_long: 'long-term rental income', flip: 'resell in 3-5 years', rent_then_live: 'rent first, move in later' })[p.horizon]}`)
  if (p.family_size) L.push(zh
    ? `家庭：${p.family_size} 口人${p.has_children ? '，有小孩' : ''}`
    : `Household: ${p.family_size} people${p.has_children ? ', with children' : ''}`)
  if (p.has_maid === true) L.push(zh ? '请保姆（需要女佣房）' : 'Employs a live-in helper (needs a maid’s room)')
  if (p.cooking === 'often') L.push(zh ? '常在家做饭（开放式厨房是减分项）' : 'Cooks at home often (an open kitchen is a drawback)')
  if (p.nationality) L.push(`${zh ? '来自' : 'From'}: ${p.nationality}`)
  if (p.bedrooms) L.push(zh ? `想要 ${p.bedrooms} 房` : `Wants ${p.bedrooms} bedroom(s)`)
  if (p.preferred_areas?.length) L.push(`${zh ? '偏好区域' : 'Preferred areas'}: ${p.preferred_areas.join(zh ? '、' : ', ')}`)
  if (p.golden_visa === true) L.push(zh ? '想办黄金签证（房产需 ≥ AED 200 万）' : 'Wants the Golden Visa (property must be AED 2M or more)')
  if (p.first_time_buyer === true) L.push(zh
    ? '第一次在迪拜买房（要把 DLD 手续费、物业费讲清楚）'
    : 'First-time buyer in Dubai (spell out DLD fees and service charges)')
  if (p.offplan_ok === false) L.push(zh ? '只要现房，不接受期房' : 'Ready properties only — will not consider off-plan')
  if (L.length) return L.join('\n')
  return zh
    ? '（经纪没提供画像 —— 只能做通用论证，说服力会打折）'
    : '(The agent provided no client profile — the argument can only be generic, which is less persuasive.)'
}

/**
 * 喂给 AI 的户型清单。
 *
 * 🔴 **标签必须按报告语言出。** 这段是**提示词上下文**,不是最终文案 ——
 *    但模型会把上下文里的字面量原样抄进输出。写死中文的后果是:
 *    一份英文报告里出现「Top pick · 1 Bedroom · 1 房 · 1 卫 · 757.46 ft²」
 *    (owner 2026-08-09 实拍 /cr/emte3b)。英语买家看到这个只会觉得不专业。
 *
 *    教训比这一处大:**任何进入提示词的字面量都会漏进输出**,
 *    所以提示词里的语言必须和目标语言一致。
 */
const UNIT_LABELS: Record<LangCode, { bed: string; bath: string; balcony: string; tbd: string; psf: string; feat: string; sep: string }> = {
  zh: { bed: '房', bath: '卫', balcony: '阳台', tbd: '价格待定（需向开发商询价）', psf: '单价', feat: '配置', sep: '、' },
  en: { bed: 'bed', bath: 'bath', balcony: 'balcony', tbd: 'price on request (ask the developer)', psf: 'per sqft', feat: 'Features', sep: ', ' },
  fr: { bed: 'ch.', bath: 'sdb', balcony: 'balcon', tbd: 'prix sur demande (à confirmer auprès du promoteur)', psf: 'au pied carré', feat: 'Équipements', sep: ', ' },
  ru: { bed: 'спальни', bath: 'санузла', balcony: 'балкон', tbd: 'цена по запросу (уточнить у застройщика)', psf: 'за кв. фут', feat: 'Оснащение', sep: ', ' },
  ar: { bed: 'غرفة', bath: 'حمام', balcony: 'شرفة', tbd: 'السعر عند الطلب (يُراجع مع المطوّر)', psf: 'للقدم المربع', feat: 'المواصفات', sep: '، ' },
}

function unitLines(units: ScoredUnit[], lang: LangCode = 'zh'): string {
  const L = UNIT_LABELS[lang] || UNIT_LABELS.en
  return units.slice(0, 6).map((u, i) => {
    const bits = [
      `${i + 1}. ${u.name}`,
      u.bedrooms != null ? `${u.bedrooms} ${L.bed}` : null,
      u.bathrooms != null ? `${u.bathrooms} ${L.bath}` : null,
      u.area != null ? `${u.area} ft²` : null,
      u.balcony_area ? `${L.balcony} ${u.balcony_area} ft²` : null,
      // ⚠️ price 只有 51% 填充 —— 没有就明说「价格待定」,别让 AI 猜
      u.price != null ? `AED ${u.price.toLocaleString('en-US')}` : L.tbd,
      u.price_per_sqft != null ? `${L.psf} ${Math.round(u.price_per_sqft)}/ft²` : null,
    ].filter(Boolean).join(' · ')
    const feat = u.features.length ? `\n   ${L.feat}: ${u.features.join(L.sep)}` : ''
    const fail = u.hard_fails.length ? `\n   ⚠️ ${u.hard_fails.join('; ')}` : ''
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
5. {{LANG}}`

/**
 * 跑两层论证。best-effort —— 挂了返回 null,报告照样出(只是少了论证段)。
 */
export async function analyzeFit(
  profile: ExtractedProfile,
  project: { name: string; area?: string | null; developer?: string | null; [k: string]: unknown },
  units: ScoredUnit[],
  lang: LangCode = 'zh'
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
    .replace('{{PROFILE}}', profileLines(profile, lang))
    .replace('{{PROJECT}}', projectLines)
    .replace('{{UNITS}}', unitLines(units, lang))
    .replace('{{LANG}}', langInstruction(lang))

  try {
    const { text } = await callGemini({
      task: 'client-fit',
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: FIT_SCHEMA as any,
        temperature: 0.4,          // 论证要有点文采,但别放飞
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: THINKING,
      },
    })
    const j = JSON.parse((text || '{}').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
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
    console.error('[fit-analyzer] failed:', e instanceof Error ? e.message : e)
    return null
  }
}
