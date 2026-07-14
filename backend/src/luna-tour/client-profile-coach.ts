/**
 * 客户画像教练 (2026-07-12) —— 自由文本 → 结构化画像 + 「还缺什么」引导。
 *
 * 经纪不填表,只写笔记(「陆先生,香港投资客,预算300万现金,一家四口有两个小孩…」)。
 * 手动点「AI 检查画像」→ 这里把它读懂,并告诉他**还缺哪几条关键信息、缺了会损失
 * 哪条论证**,每条都带**选项**(点一下就补上,一个字不用打)。
 *
 * ── 成本设计(owner 关切)────────────────────────────────────────────────
 * LLM 只干**抽取**这一件事(自由文本 → 结构化),1 次 Gemini Flash 调用(~几百 token)。
 * **问题和选项走模板,0 次 LLM**:
 *   • 它们是有限集合,精心写好一次比让 LLM 每次现编更稳(不会时好时坏)
 *   • 问题**按条件触发** —— 投资客才问退出周期;中国客户+自住才问做饭;
 *     家庭 ≥3 人才问保姆。这才叫「针对这个客户」,而不是一刀切甩 9 个问题
 *
 * ── 不阻塞(owner 定)───────────────────────────────────────────────────
 * 缺信息只提醒,不拦生成。画像糙 → 报告糙,那是经纪的选择。
 *
 * ISOLATION: 只读写 lt_clients。删 luna-tour 目录即移除。
 */
import { GoogleGenAI } from '@google/genai'
import { DEFAULT_CHAIN } from '../services/ai/models'
import pool from '../db/pool'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
/**
 * 模型 —— 依据 Google 官方文档(2026-07-12 核对 ai.google.dev/gemini-api/docs/models)。
 *
 *   ✅ gemini-3.5-flash        **GA 旗舰 Flash**(2026-05-19 发布)。首选。
 *                              `gemini-flash-latest` 就指向它。$1.50/$9.00 per 1M
 *   ✅ gemini-3.1-flash-lite   GA,最便宜($0.25/$1.50)。fallback
 *
 * 🔴 **别用这些**(踩过的坑,写清楚免得再踩):
 *   ❌ gemini-3-flash / gemini-3.1-flash / gemini-3.1-pro —— **不存在**(404)。
 *      CLAUDE.md 原来写的就是错的,全站 6 个文件跟着写,于是**每次调用先撞 404
 *      再 fallback 到 2.5** —— 整个项目的 AI 一直跑在 2.5 上。
 *   ❌ gemini-3-flash-preview —— **已 deprecated**(替代品就是 3.5-flash)
 *   ❌ gemini-3-pro-preview —— **2026-03-09 已关停**(还能 resolve,但只是 redirect)
 *   ❌ gemini-2.5-* 全系 —— deprecated,最早 2026-10-16 关停
 *   ❌ *-latest 别名 —— 会被静默热切换(官方只给 2 周邮件通知),抽取代码不能钉它
 */
const MODELS = DEFAULT_CHAIN

/**
 * 🔴 Gemini 3.x 用 **`thinkingLevel`**,不是 `thinkingBudget`(那是 2.5 的参数)。
 *
 * 写错的话参数会被**静默忽略** —— 我一开始写的 `thinkingBudget: 0` 就完全没生效。
 *
 * 抽取不需要推理。实测 `minimal` 把 thinking token 打到 **0**
 * (默认档要烧 1440 个,而 **thinking 是按 output 价 $9/1M 计费的** —— 白烧钱)。
 */
const THINKING_MINIMAL = { thinkingLevel: 'minimal' as const }
/** 画像 JSON 实测 ~79 token。2000 是防跑飞的硬顶(曾被一次 11 万字符的失控咬过)。 */
const MAX_OUTPUT_TOKENS = 2000

// ── 画像 schema ────────────────────────────────────────────────────────────
// 硬字段落 lt_clients 的真列;软字段落 preferences(jsonb)—— 零 migration。

export type Goal = 'live' | 'invest' | 'both'
export type Payment = 'cash' | 'installment' | 'mortgage'
export type Horizon = 'rent_long' | 'flip' | 'rent_then_live'
export type Cooking = 'often' | 'sometimes' | 'rarely'

export interface ExtractedProfile {
  // → lt_clients 真列
  name?: string | null
  goal?: Goal | null
  budget_min?: number | null
  budget_max?: number | null
  bedrooms?: number | null
  family_size?: number | null
  has_children?: boolean | null
  nationality?: string | null
  preferred_areas?: string[] | null
  // → preferences jsonb(软字段)
  payment?: Payment | null
  horizon?: Horizon | null          // 投资退出:长期收租 / 转手 / 先租后住
  has_maid?: boolean | null         // 女佣房(194 个户型带)咬不咬得上
  cooking?: Cooking | null          // 开放厨房对中式炒菜是**减分**
  golden_visa?: boolean | null      // 有房产金额门槛 → 预算贴门槛时值不值得垫
  first_time_buyer?: boolean | null // 报告里要不要解释 DLD 费 / service charge
  offplan_ok?: boolean | null       // 接受期房(交付风险)还是要现房(即时租金)
}

const SOFT_KEYS = ['payment', 'horizon', 'has_maid', 'cooking', 'golden_visa', 'first_time_buyer', 'offplan_ok'] as const

/** 一个「还缺的信息」+ 它的代价 + 可点的选项(经纪一个字都不用打)。 */
export interface Gap {
  key: keyof ExtractedProfile
  question: string
  /** 缺了会损失**哪条具体论证** —— 不是抽象的「完整度 60%」 */
  why: string
  options: { value: string; label: string }[]
}

/**
 * GAP 模板 —— 问题、选项、代价全部预写(0 LLM)。
 *
 * `when` 决定这条问不问 —— 问题必须**跟这个客户有关**,否则就是问卷轰炸。
 * 顺序 = 优先级,最多只出 §MAX_GAPS 条(问多了经纪就跑了)。
 */
const GAP_RULES: (Gap & { when: (p: ExtractedProfile) => boolean })[] = [
  {
    key: 'goal',
    when: (p) => !p.goal,
    question: '他是自住还是投资？',
    why: '整份论证的地基 —— 投资看回报，自住看住得舒不舒服，两条路完全不同',
    options: [
      { value: 'live', label: '自住' },
      { value: 'invest', label: '投资' },
      { value: 'both', label: '先出租，以后自住' },
    ],
  },
  {
    key: 'budget_max',
    when: (p) => !p.budget_max && !p.budget_min,
    question: '预算大概多少？',
    why: '没有预算，户型匹配无从谈起',
    options: [
      { value: '1500000', label: '150 万以下' },
      { value: '2500000', label: '150–250 万' },
      { value: '4000000', label: '250–400 万' },
      { value: '8000000', label: '400 万以上' },
    ],
  },
  {
    key: 'payment',
    when: (p) => !p.payment,
    question: '全款、开发商分期，还是银行贷款？',
    why: '期房的付款计划是迪拜最核心的卖点 —— 不知道这个，付款方案那段就写不出来',
    options: [
      { value: 'cash', label: '全款' },
      { value: 'installment', label: '开发商分期' },
      { value: 'mortgage', label: '银行贷款' },
    ],
  },
  {
    key: 'horizon',
    // 只问投资客 —— 自住客问「几年转手」很奇怪
    when: (p) => !p.horizon && (p.goal === 'invest' || p.goal === 'both'),
    question: '长期收租，还是 3–5 年转手？',
    why: '直接决定推 1 房还是 2 房 —— 收租看回报率，转手看增值空间',
    options: [
      { value: 'rent_long', label: '长期收租' },
      { value: 'flip', label: '3–5 年转手' },
      { value: 'rent_then_live', label: '先租后自住' },
    ],
  },
  {
    key: 'family_size',
    // 只问会自己住的
    when: (p) => !p.family_size && (p.goal === 'live' || p.goal === 'both'),
    question: '几口人住？',
    why: '决定卧室数、要不要女佣房、要不要考虑学区',
    options: [
      { value: '1', label: '单身' },
      { value: '2', label: '夫妻两人' },
      { value: '3', label: '一家三口' },
      { value: '4', label: '一家四口' },
      { value: '5', label: '五口以上 / 有长辈' },
    ],
  },
  {
    key: 'has_maid',
    // 家里 3 人以上才有意义 —— 单身问「请保姆吗」是浪费一条额度
    when: (p) => p.has_maid == null && (p.family_size ?? 0) >= 3,
    question: '请保姆吗？',
    why: '迪拜 194 个户型带女佣房 —— 不问这个，很可能推错户型',
    options: [
      { value: 'true', label: '请' },
      { value: 'false', label: '不请' },
    ],
  },
  {
    key: 'cooking',
    // 只问「会自己住 + 亚洲客户」—— 开放厨房对中式炒菜是减分项
    when: (p) => !p.cooking && (p.goal === 'live' || p.goal === 'both') && isAsian(p.nationality),
    question: '常在家做饭吗？',
    why: '迪拜很多户型是开放式厨房 —— 中式爆炒油烟大，这会是**减分项**，得避开',
    options: [
      { value: 'often', label: '经常做' },
      { value: 'sometimes', label: '偶尔' },
      { value: 'rarely', label: '基本不做' },
    ],
  },
  {
    key: 'golden_visa',
    /**
     * 只在**预算够得着门槛**时问 —— 黄金签证要房产 ≥ AED 200 万(2022 年从 500 万降下来的,
     * 官方 u.ae/DLD)。预算 500 万的人早知道自己够,预算 80 万的人问了也白问。
     * 真正值钱的是**卡在门槛下方**的那批人(150-200 万):垫 20 万换一张 10 年签证,
     * 这是能直接改变推荐的洞察 —— 而经纪常常想不到去问。
     */
    when: (p) => p.golden_visa == null && withinVisaReach(p),
    question: '要办黄金签证吗？',
    why: '房产满 AED 200 万可申请 10 年黄金签证 —— 他的预算刚好在门槛附近，垫一点就够，这个不问会错过',
    options: [
      { value: 'true', label: '要' },
      { value: 'false', label: '不要' },
      { value: 'true', label: '没想过，可以聊' },
    ],
  },
  {
    key: 'nationality',
    when: (p) => !p.nationality,
    question: '客户是哪里人？',
    why: '影响厨房、社区、学校这些文化维度的判断',
    options: [
      { value: '中国大陆', label: '中国大陆' },
      { value: '香港/台湾', label: '香港 / 台湾' },
      { value: '印度', label: '印度' },
      { value: '俄罗斯', label: '俄罗斯' },
      { value: '欧洲', label: '欧洲' },
    ],
  },
  {
    key: 'offplan_ok',
    when: (p) => p.offplan_ok == null,
    question: '接受期房（等交付），还是要现房（马上能收租/入住）？',
    why: '期房便宜有分期但要等，现房贵但立刻有租金 —— 两条完全不同的论证',
    options: [
      { value: 'true', label: '接受期房' },
      { value: 'false', label: '只要现房' },
    ],
  },
  {
    key: 'first_time_buyer',
    when: (p) => p.first_time_buyer == null,
    question: '第一次在迪拜买房吗？',
    why: '第一次的话，报告里要把 DLD 手续费、物业费这些成本讲清楚，不然客户会被后续账单吓到',
    options: [
      { value: 'true', label: '第一次' },
      { value: 'false', label: '买过' },
    ],
  },
]

/** 最多出几条 —— 问多了经纪直接跳过,不如只问最要命的几条。 */
const MAX_GAPS = 3

function isAsian(nat?: string | null): boolean {
  if (!nat) return false
  return /中国|大陆|香港|台湾|hong ?kong|taiwan|china|chinese|korea|韩|japan|日本|singapore|新加坡/i.test(nat)
}

/**
 * 黄金签证门槛(AED)—— 官方硬数字,2022 年 10 月从 500 万降到 200 万。
 * 来源:u.ae 长期居留页 / dubailand.gov.ae 黄金签证 e-service。可期房、可贷款。
 *
 * ⚠️ **贷款时「已付金额」的要求不写进代码** —— DLD 和 u.ae 两个官方页面互相矛盾
 *    (一个说只需银行 NOC,一个说要付满 200 万)。这个数字答错会让客户签证被拒。
 *    报告里只说「需向 DLD 核实」,绝不给死数字。
 */
export const GOLDEN_VISA_AED = 2_000_000

/** 预算够得着黄金签证门槛吗(±30% 视野内)—— 差太远问了白问,早就够的也不用问。 */
function withinVisaReach(p: ExtractedProfile): boolean {
  const b = p.budget_max ?? p.budget_min
  if (!b) return false
  return b >= GOLDEN_VISA_AED * 0.7 && b <= GOLDEN_VISA_AED * 3
}

// ── LLM 抽取 ───────────────────────────────────────────────────────────────

/**
 * 🔴 **每个字段都必须 required + 允许 null** —— 这是修「静默丢字段」的**根本解法**。
 *
 * 字段是 optional 时,模型可以合法地「不填」—— 于是**明说了的信息也会悄悄消失**。
 * 实测同一条笔记「王小姐，单身，自住，预算120万，第一次在迪拜买房」:
 *   optional schema → 只回 {name, payment:"cash"}(goal/budget/first_time_buyer 全丢,
 *                     payment 还是**编的**)
 *   required+null   → goal=live ✓ budget=1200000 ✓ first_time_buyer=true ✓
 *                     nationality=**null** ✓(没说 → 老实返回 null,不编)
 *
 * 换句话说:这**不是模型不行,是 schema 给了它藏起来的权利**。
 * required 之后它填不出来就**必须**交出一个 null,再也藏不住。
 * (官方文档也是这么建议的 —— 结构化输出只保证 JSON 合法,不保证语义完整。)
 */
const N = (t: string, description?: string) => ({ type: [t, 'null'], ...(description ? { description } : {}) })
const NE = (values: string[], description?: string) =>
  ({ type: ['string', 'null'], enum: [...values, null], ...(description ? { description } : {}) })

const EXTRACT_FIELDS = {
  name: N('string', '客户称呼,如「陈先生」'),
  goal: NE(['live', 'invest', 'both'], '自住 / 投资 / 先租后住'),
  budget_min: N('number', '预算下限(AED)。「300万」= 3000000'),
  budget_max: N('number', '预算上限(AED)'),
  bedrooms: N('number', '想要几居室'),
  family_size: N('number', '几口人住'),
  has_children: N('boolean'),
  nationality: N('string', '国籍/来源地,如「香港」「中国大陆」'),
  preferred_areas: { type: ['array', 'null'], items: { type: 'string' }, description: '偏好区域' },
  payment: NE(['cash', 'installment', 'mortgage'], '全款 / 开发商分期 / 银行贷款'),
  horizon: NE(['rent_long', 'flip', 'rent_then_live'], '长期收租 / 转手 / 先租后住'),
  has_maid: N('boolean', '是否请保姆'),
  cooking: NE(['often', 'sometimes', 'rarely'], '做饭频率'),
  golden_visa: N('boolean', '是否想办黄金签证'),
  first_time_buyer: N('boolean'),
  offplan_ok: N('boolean', '是否接受期房'),
}

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: EXTRACT_FIELDS,
  required: Object.keys(EXTRACT_FIELDS),   // ⭐ 全部 required —— 填不出就得给 null
}

const EXTRACT_PROMPT = `你是迪拜房产经纪的助手。把经纪写的客户笔记读成结构化画像。

铁律：
1. **没提到的字段一律填 null，绝不猜测。**
   宁可交 null，也不能编 —— 这份画像会拿去给客户生成报告，编一条就是在客户面前撒谎。
   但**明说了的必须抽出来**，别把 null 当偷懒的出口。
2. 金额统一成 AED 数字：「300万」→ 3000000；「2-3M」→ min 2000000, max 3000000。
3. 能明确推断的可以抽：
   · 「一家四口有两个小孩」→ family_size 4, has_children true
   · 「全款」→ payment cash
   · 「首次置业迪拜」/「第一次买」→ first_time_buyer true
   · 「自住」→ goal live ；「投资」/「出租」→ goal invest

4. **horizon（收租 vs 转手）只有明说才抽**，这是最容易被过度推断的字段：
   ✅ 「长期持有收租」→ rent_long ；「几年后卖掉」/「转手」→ flip
   ❌ 「投资客」→ 推不出（收租还是转手，他没说）
   ❌ 「重视 5 年回报」→ **推不出**（5 年回报可以是租金，也可以是增值转手）
   推不出就**省略这个字段**。宁可等会儿问经纪一句，也不能替客户做决定。

客户笔记：
"""
{{TEXT}}
"""`

export interface CoachResult {
  extracted: ExtractedProfile
  gaps: Gap[]
  /** 已经知道的字段数 / 关键字段总数 —— 给个进度感,但不当门槛 */
  known: number
  total: number
}

/**
 * 读懂笔记 → 补上已知字段 → 算出还缺什么(带选项)。
 *
 * `existing` = 该客户在 CRM 里已有的画像(可能之前答过)。已知的不再问。
 */
export async function coachProfile(text: string, existing: ExtractedProfile = {}): Promise<CoachResult> {
  let extracted: ExtractedProfile = { ...existing }

  const note = (text || '').trim()
  if (note) {
    for (const model of MODELS) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: EXTRACT_PROMPT.replace('{{TEXT}}', note.slice(0, 4000)),
          config: {
            responseMimeType: 'application/json',
            responseSchema: EXTRACT_SCHEMA as any,
            temperature: 0,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            thinkingConfig: THINKING_MINIMAL,   // ⚠️ 是 thinkingLevel,不是 thinkingBudget
          } as any,
        })
        const parsed = JSON.parse((res.text || '{}').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''))
        // 笔记里的新信息覆盖旧的(经纪刚写的最新)
        for (const [k, v] of Object.entries(parsed)) {
          if (v !== null && v !== undefined && v !== '') (extracted as any)[k] = v
        }
        break
      } catch (e) {
        // 抽取挂了不阻塞 —— 退回「只用已有画像算 gap」,经纪照样能点选补全
        console.error(`[profile-coach] extract failed (${model}):`, e instanceof Error ? e.message : e)
      }
    }
  }

  const gaps = GAP_RULES.filter((g) => g.when(extracted)).slice(0, MAX_GAPS)
    .map(({ when: _when, ...g }) => g)

  const KEY_FIELDS: (keyof ExtractedProfile)[] = [
    'goal', 'budget_max', 'payment', 'family_size', 'nationality', 'offplan_ok',
  ]
  const known = KEY_FIELDS.filter((k) => extracted[k] != null && extracted[k] !== '').length

  return { extracted, gaps, known, total: KEY_FIELDS.length }
}

/**
 * 把画像写回 lt_clients —— **这一步不能省**。
 *
 * 不回写的话,经纪每次生成报告都要重答一遍(那只是换了个形式的「太难填」),
 * 而且 CRM 里的 goal/bedrooms/family_size 会**永远是空的** —— 现在就是这样
 * (实测 2 个客户,这些结构化字段全空),匹配引擎从建客户那刻起就无米下锅。
 */
export async function saveProfile(clientId: string, agentId: string, p: ExtractedProfile, note?: string): Promise<void> {
  const soft: Record<string, unknown> = {}
  for (const k of SOFT_KEYS) if (p[k] != null) soft[k] = p[k]

  await pool.query(
    `UPDATE lt_clients SET
       name            = COALESCE(NULLIF($3,''), name),
       goal            = COALESCE($4,  goal),
       budget_min      = COALESCE($5,  budget_min),
       budget_max      = COALESCE($6,  budget_max),
       bedrooms        = COALESCE($7,  bedrooms),
       family_size     = COALESCE($8,  family_size),
       has_children    = COALESCE($9,  has_children),
       nationality     = COALESCE($10, nationality),
       preferred_areas = COALESCE($11, preferred_areas),
       background      = COALESCE(NULLIF($12,''), background),
       -- 软字段深合并:别用 = 覆盖,那会抹掉这次没答的旧答案
       preferences     = COALESCE(preferences, '{}'::jsonb) || $13::jsonb,
       updated_at      = now()
     WHERE id = $1 AND agent_id = $2`,
    [
      clientId, agentId,
      p.name ?? '', p.goal ?? null, p.budget_min ?? null, p.budget_max ?? null,
      p.bedrooms ?? null, p.family_size ?? null, p.has_children ?? null,
      p.nationality ?? null, p.preferred_areas ?? null,
      note ?? '', JSON.stringify(soft),
    ]
  )
}

/** 从 lt_clients 读回画像(硬列 + preferences 软字段)。 */
export async function loadProfile(clientId: string, agentId: string): Promise<ExtractedProfile & { note?: string }> {
  const { rows } = await pool.query(
    `SELECT name, goal, budget_min, budget_max, bedrooms, family_size, has_children,
            nationality, preferred_areas, background, preferences
       FROM lt_clients WHERE id = $1 AND agent_id = $2`,
    [clientId, agentId]
  )
  const r = rows[0]
  if (!r) return {}
  return {
    name: r.name, goal: r.goal, budget_min: r.budget_min, budget_max: r.budget_max,
    bedrooms: r.bedrooms, family_size: r.family_size, has_children: r.has_children,
    nationality: r.nationality, preferred_areas: r.preferred_areas,
    note: r.background || '',
    ...(r.preferences || {}),
  }
}

/**
 * 画像 → 一句话客户描述（给 tour / match 的 prompt 用）。
 *
 * ⚠️ 这里**故意不调 LLM**：画像已经是结构化的，把它拼成一句话是纯字符串拼接。
 *    为了这个再烧一次模型调用是纯浪费。
 *
 * 存在的意义：AI 导览页原来让经纪**手打一句话画像**（「香港投资客, 预算300万, 重回报」），
 * 而 CRM 里早就有全套结构化字段 —— 同一个客户，经纪要在报告页填一遍画像、
 * 再在导览页手打一遍。现在两边读**同一份画像**。
 */
export function profileToOneLiner(p: ExtractedProfile & { note?: string }): string {
  const bits: string[] = []
  if (p.nationality) bits.push(String(p.nationality))
  if (p.goal) bits.push({ live: '自住', invest: '投资', both: '先租后住' }[p.goal] ?? String(p.goal))
  const b = p.budget_max ?? p.budget_min
  if (b) bits.push(`预算约 ${(b / 10000).toFixed(0)} 万迪拉姆`)
  if (p.bedrooms) bits.push(`${p.bedrooms} 房`)
  if (p.family_size) bits.push(`${p.family_size} 口人`)
  if (p.has_children) bits.push('有小孩(学区重要)')
  if (p.has_maid) bits.push('请保姆(需要女佣房)')
  if (p.cooking === 'often') bits.push('常做中餐(开放厨房是减分)')
  if (p.payment) bits.push({ cash: '全款', installment: '分期', mortgage: '贷款' }[p.payment] ?? String(p.payment))
  if (p.horizon) bits.push({ rent_long: '长期收租', flip: '3-5 年转手', rent_then_live: '先租后住' }[p.horizon] ?? String(p.horizon))
  if (p.golden_visa) bits.push('要黄金签证')
  if (p.first_time_buyer) bits.push('首次置业')
  if (p.offplan_ok === false) bits.push('只要现房')
  if (p.preferred_areas?.length) bits.push(`偏好 ${p.preferred_areas.join('/')}`)
  if (p.note) bits.push(p.note)
  return bits.join('，')
}
