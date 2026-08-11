/**
 * Luna 的**数据边界单一真相源** —— 我们有什么数据，没有什么数据。
 *
 * ## 为什么需要这个文件
 *
 * 2026-08-10 审计（`docs/reports/2026-08-10-luna-conversation-quality-audit.md`）：
 * **客户问「有没有二手房」，Luna 答「有」—— 全库零二手房源。**
 *
 * 根因不是模型爱幻觉，是**结构性的**：
 *   · 22 个工具**全是**「去查某个具体东西」，没有一个能回答「你们有什么数据」
 *   · system prompt 只禁止编造价格 / 收益率 / 项目名 —— **没禁止编造能力**
 *   · prompt 里还写着「pivot to what you can show」
 *
 * 一个手上没有任何工具、又被要求积极正面的模型，遇到能力问题只能猜。
 * 猜「有」比猜「没有」听起来更有用，所以它猜「有」。
 *
 * **编造能力比编造数字更贵**：编错价格客户会当场质疑；说「有二手房」客户会
 * 一直等你发房源，等到放弃。
 *
 * ## 使用方式
 *
 * 1. 注入 Brain 的 system prompt（`describeBoundaries()`）
 * 2. Brain 在选工具前先跑 `checkScope()`，命中越界直接短路，不浪费一轮工具调用
 *
 * ⚠️ **加数据源 / 下线数据源时必须同步这里**，否则 Luna 会继续按旧边界说话。
 */

/** 越界判定结果。`have_instead` 是**强制**的 —— 见下方 WHY。 */
export interface ScopeVerdict {
  /** 命中的越界类别 id */
  id: string
  /** 人话解释：我们为什么没有这个 */
  lacks: string
  /**
   * **我们有的、最接近的东西**。
   *
   * 这个字段不允许为空。2026-07-20 把「自信地说谎」修成了「诚实地说找不到」，
   * 结果生产上出现连续两三轮纯澄清（session 51/53），用户直接走人。
   * 诚实但没有出路，体感和说谎一样烂 —— 只是换了种烂法。
   */
  have_instead: string
}

interface Boundary {
  id: string
  /** 命中词。小写匹配，中英阿都要覆盖 —— 客户不一定说英文。 */
  patterns: RegExp
  lacks: string
  have_instead: string
}

/**
 * 越界清单。**只列真的没有的东西** —— 误判成越界会把能答的问题也堵死，
 * 比漏判更伤（漏判至少还有工具兜着，误判是直接拒绝）。
 */
const BOUNDARIES: Boundary[] = [
  {
    id: 'resale_listings',
    // 「二手房」这条是 2026-08-10 生产实例。注意区分:
    //   二手**成交价** = 有（DLD transactions）
    //   二手**在售房源** = 没有
    patterns: /\b(resale|re-sale|second[- ]?hand|secondary market|existing home|ready proper?ty for sale)\b|二手房|二手房源|现房转售|转售房源|再售/i,
    lacks: 'we have NO resale / secondary-market listings — the project database is off-plan and new-build inventory sold by developers',
    have_instead:
      'DLD **transaction** history for resale units in the same area and bedroom count — that gives the real going rate, ' +
      'which is what you would use to judge whether an asking price you saw elsewhere is fair (project_value_check does exactly this)',
  },
  {
    id: 'rental_listings',
    // ⚠️ 「rent or buy」是**能答的**（有 rent_vs_buy 工具）—— 负向前瞻别删,
    //    否则会把一个正常问题误判成越界,那就是自己制造 session 52。
    patterns: /\b(rent(al)? listings?|for rent\b|(?:want|looking|like|need|wish|hoping|plan(?:ning)?)(?:ing)?\s+to\s+rent\b(?!\s+or\s+buy)|short[- ]?term (?:rental|let|stay)|airbnb|holiday home)\b|租房源|出租房源|我想租|想租个|短租|民宿/i,
    lacks: 'we have NO rental listings and no short-term/holiday-let inventory',
    have_instead:
      'DLD rental **contract** data — median rents, new-vs-renewal spread and rent stability by area and unit size, ' +
      'plus the rent-vs-buy calculator',
  },
  {
    id: 'outside_dubai',
    patterns: /\b(abu ?dhabi|sharjah|ajman|ras al khaimah|rak\b|fujairah|umm al quwain|qatar|doha|riyadh|saudi|oman|muscat|bahrain)\b|阿布扎比|沙迦|阿治曼|哈伊马角|富查伊拉|卡塔尔|多哈|利雅得|沙特|阿曼|巴林/i,
    lacks: 'coverage is **Dubai only** — no data for other emirates or Gulf countries',
    have_instead: 'full Dubai coverage across every community, including the newer master-plans',
  },
  {
    id: 'mortgage_approval',
    patterns: /\b(mortgage (approval|pre-?approval|rate)|loan approval|bank (rate|offer)|interest rate (today|now|current))\b|贷款审批|房贷利率|批贷|银行利率/i,
    lacks: 'we do NOT quote live bank rates and cannot pre-approve or arrange financing',
    have_instead:
      'the affordability calculator and full purchase-cost breakdown (DLD fee, agency, registration), ' +
      'which is what determines how much cash they actually need up front',
  },
  {
    // 黄金签证是买房的**核心动机**之一,一刀切拒绝就是丢客户;乱答是法律风险。
    // 所以这条的 have_instead 特别重要:承认边界,但把话头接回我们能做的事。
    id: 'residency_visa',
    patterns: /\b(golden visa|residency|residence (visa|permit)|investor visa|citizenship|green visa)\b|黄金签证|迪拜身份|居留(权|签证)|投资移民|拿身份|绿卡/i,
    lacks:
      'we do not hold official immigration rules and must not give legal or visa advice — ' +
      'eligibility is set by the GDRFA and changes',
    have_instead:
      'the property side of it: we can filter projects at the investment levels people usually ask about for this, ' +
      'and show the real transaction prices at that level — then their agent or an immigration lawyer confirms eligibility',
  },
  {
    id: 'live_inventory',
    patterns: /\b(units? (left|remaining|available (right )?now)|real[- ]?time (stock|inventory|availability)|how many left)\b|还剩几套|剩余房源|实时库存|还有没有房/i,
    lacks: 'unit-level availability is a **snapshot**, not a live feed from the developer — it can be out of date',
    have_instead:
      'the recorded sales status per project plus DLD transaction velocity for the building, ' +
      'which shows how fast it is actually moving — say the count needs confirming with the developer',
  },
]

/**
 * 检查用户问题是否越界。命中返回裁决，没命中返回 null。
 *
 * 故意做得**保守**:只按明确的关键词命中。宁可漏判（工具层还有 NOT_FOUND 兜底）
 * 也不误判 —— 误判会让能答的问题被拒绝，那是自己给自己制造 session 52。
 */
export function checkScope(question: string): ScopeVerdict | null {
  const q = String(question || '')
  if (!q.trim()) return null
  for (const b of BOUNDARIES) {
    if (b.patterns.test(q)) {
      return { id: b.id, lacks: b.lacks, have_instead: b.have_instead }
    }
  }
  return null
}

/**
 * 注入 Brain system prompt 的边界说明。
 *
 * 写成散文而不是 JSON —— 模型对散文的遵守度更高，而且这段是要它**理解**的，
 * 不是要它解析的。
 */
export function describeBoundaries(): string {
  return `## WHAT THIS PRODUCT ACTUALLY HAS

You answer from these sources and nothing else:

- **Off-plan / new-build projects** sold by developers in Dubai — units, floor plans, payment plans, handover dates, sales status.
- **DLD transaction history** — recorded sales (this is where resale prices come from) and rental contracts.
- **Area metrics** — median price, rent, gross and net yield, growth, transaction volume, per area and unit size.
- **Location data** — POIs, schools, metro, commute distances, amenity scoring.
- **Calculators** — purchase costs, affordability, rent-vs-buy, investment breakdown.

## WHAT IT DOES NOT HAVE — never imply otherwise

${BOUNDARIES.map(b => `- ${b.lacks}\n  → instead offer: ${b.have_instead}`).join('\n')}

**Inventing a capability is worse than inventing a number.** A wrong price gets
challenged on the spot; "yes, we have resale listings" makes someone wait for
something that will never arrive. If you do not have it, say so in one clause and
move straight to what you do have — never leave them with only a refusal.`
}

/** 导出给跑分用 —— Tier1 要逐条验证边界命中。 */
export const BOUNDARY_IDS = BOUNDARIES.map(b => b.id)
