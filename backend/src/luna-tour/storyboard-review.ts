/**
 * Luna 对大纲的意见 —— 「这份剧本缺了什么」。
 *
 * 🔴 经纪拿到草稿时间线,面对的是十几拍旁白。他**不知道该看什么** ——
 *    于是要么全盘接受(那两段式就白做了),要么随便改两个字。
 *
 * Luna 读一遍,直接告诉他:**缺了什么、为什么这会让他丢单**。
 *
 * ── 两层,分工明确(和客户画像 coach 同构)────────────────────────────────
 *
 *   **规则层(0 次 LLM)** —— 查**结构性硬伤**。它们是有限集合,写死一次比让 LLM
 *   每次现编更稳(不会时好时坏),而且**零成本**:
 *     • 投资客,却没有一拍讲「凭什么是这里,而不是隔壁」(地理套利)
 *     • 说了短板,**却没有反驳** —— 比什么都不说更糟(Allen 的元分析)
 *     • 有真实户型数据,却没讲户型 —— 客户要买的就是户型
 *     • 某个项目只有到达、没有数字
 *     • 总时长超标
 *
 *   **LLM 层(1 次 Flash)** —— 基于**这个客户的画像**给个性化洞察。
 *   规则查得出「缺了一拍」,查不出「陈先生第一次在迪拜买房,而全程没人告诉他
 *   还要交 4% 的 DLD 费」。
 *
 * ⚠️ **不阻塞。** 意见只是意见 —— 经纪可以无视,直接发布。
 *    剧本糙 → 成交难,那是他的选择,不是我们的门禁。
 */
import { callGemini } from '../services/ai/gemini'
import type { TourScript, TourInput } from './tour-script.types'

export interface ReviewNote {
  /** gap = 缺了东西 · risk = 有东西会伤到他 · idea = 可以更强 */
  kind: 'gap' | 'risk' | 'idea'
  title: string
  /** 为什么这条重要 —— **必须说清代价**,不能只说「建议补充」 */
  why: string
  /** 经纪可以直接打给 AI 编辑器的一句话（点一下就改） */
  fix?: string
}

interface BeatLite {
  kind?: string
  narration: string
  property_id?: string
}

function flatten(script: TourScript): BeatLite[] {
  const out: BeatLite[] = []
  if (script.intro) out.push({ kind: 'intro', narration: script.intro.narration })
  for (const act of script.acts || []) {
    for (const b of act.beats || []) {
      out.push({ kind: b.kind, narration: b.narration, property_id: act.property_id })
    }
  }
  if (script.outro) out.push({ kind: 'outro', narration: script.outro.narration })
  return out
}

/** 规则层 —— 结构性硬伤。0 次 LLM。 */
export function reviewByRules(script: TourScript, input: TourInput): ReviewNote[] {
  const notes: ReviewNote[] = []
  const beats = flatten(script)
  const kinds = new Set(beats.map((b) => b.kind))
  const goal = (input.client as { goal?: string })?.goal

  // ① 说了短板,却没反驳 —— 比什么都不说更糟
  const weakness = beats.filter((b) => b.kind === 'weakness')
  const unrebutted = weakness.filter((b) => !/但是|但|不过|however|but /i.test(b.narration))
  if (unrebutted.length) {
    notes.push({
      kind: 'risk',
      title: '说了缺点，却没有反驳它',
      why:
        '这比什么都不说更糟（Allen 的元分析）。有效的机制不是「坦诚」，是**接种** —— ' +
        '你要让客户免疫下一个经纪要说的话。只留一个缺点在他脑子里，你是在帮竞争对手。',
      fix: '短板那一段说完缺点后，立刻用真实数据反驳它',
    })
  }

  // ② 投资客,却没讲「凭什么是这里,而不是隔壁」
  const hasNeighbors = input.properties.some((p) => p.area_context?.neighbors?.length)
  if (!kinds.has('arbitrage') && hasNeighbors && goal !== 'live') {
    notes.push({
      kind: 'gap',
      title: '没讲「为什么是这里，而不是走路 5 分钟外的那个区」',
      why:
        '投资客真正想知道的不是「这个项目涨多少」，而是**「凭什么是这里」**。' +
        '而我们手上有邻区的真实成交数据 —— 这是地图能做、PDF 楼书永远做不到的事，没用上等于白瞎。',
      fix: '加一段：对比隔壁区域的涨幅、回报和成交量，说清楚为什么是这里',
    })
  }

  // ③ 有真实户型数据,却没讲户型
  const hasUnits = input.properties.some((p) => p.units?.length)
  if (!kinds.has('homes') && hasUnits) {
    notes.push({
      kind: 'gap',
      title: '全程没讲户型',
      why: '客户要买的是**户型**，不是「项目」。讲完区域涨幅和地铁距离，他还是不知道自己的钱能买到什么。',
      fix: '每个项目加一段户型：几房、多大、多少钱起',
    })
  }

  // ④ 某个项目只有到达,没有数字
  for (const act of script.acts || []) {
    const ks = new Set((act.beats || []).map((b) => b.kind))
    if (!ks.has('numbers')) {
      const name = input.properties.find((p) => p.id === act.property_id)?.name || '某个项目'
      notes.push({
        kind: 'gap',
        title: `「${name}」没有投资数字`,
        why: '带客户去了，却没告诉他这笔钱值不值 —— 他回去之后什么都想不起来。',
        fix: `给「${name}」补一段投资测算`,
      })
    }
  }

  // ⑤ 总时长
  const target = input.config.target_seconds * 1000
  if (script.total_ms > target * 1.35) {
    notes.push({
      kind: 'risk',
      title: `太长了（${Math.round(script.total_ms / 1000)} 秒，目标 ${input.config.target_seconds} 秒）`,
      why: '客户是在手机上看的。讲太久，他会在中间划走 —— 而最重要的话通常在后半段。',
      fix: '整体短一点，去掉空洞的形容词和套话',
    })
  }

  return notes
}

/**
 * LLM 层 —— **基于这个客户的画像**给个性化洞察。
 * 规则查得出「缺了一拍」,查不出「他第一次在迪拜买房,而全程没人告诉他还要交 4% DLD 费」。
 */
export async function reviewByAi(script: TourScript, input: TourInput): Promise<ReviewNote[]> {
  const beats = flatten(script)
  const client = input.client as Record<string, unknown>
  if (!Object.keys(client).length) return []   // 不知道客户是谁 → 给不出个性化意见

  const prompt = `你是一位带过上千组客户的迪拜金牌经纪。下面是一份即将发给客户的导览剧本。
**请只指出「针对这一位客户」的问题** —— 泛泛的建议毫无价值。

客户画像:
${JSON.stringify(client, null, 2)}

剧本（按顺序）:
${beats.map((b, i) => `${i + 1}. [${b.kind || '?'}] ${b.narration}`).join('\n')}

只输出 JSON，不要解释:
{ "notes": [ { "kind": "gap"|"risk"|"idea", "title": "…", "why": "…", "fix": "…" } ] }

规则:
- **最多 2 条**。宁可一条都不给，也不要凑数 —— 噪音会让经纪把真正重要的那条一起划走。
- 每一条必须**说清代价**:不写「建议补充 X」，要写「不讲 X，他会在拿到账单时才发现」。
- "fix" 是一句**可以直接打给 AI 编辑器**的中文指令（例如「加一段讲清楚 DLD 手续费和物业费」）。
- 只说**这份剧本真的缺的**。剧本已经讲到的东西，不要再提。
- 不要建议编造数字。没有数据支撑的内容，不要建议加。`

  try {
    const { text } = await callGemini({
      task: 'storyboard-review',
      models: ['gemini-3.5-flash', 'gemini-3.1-flash-lite'],
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.5 },
    })
    const cleaned = (text || '{}').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(cleaned) as { notes?: ReviewNote[] }
    return (parsed.notes || [])
      .filter((n) => n && n.title && n.why)
      .slice(0, 2)
  } catch (err) {
    console.warn('[luna] storyboard review (ai) failed:', err instanceof Error ? err.message : err)
    return []   // AI 挂了不该挡住经纪发布
  }
}
