/**
 * Luna 模型层跑分（Tier 2）—— 真模型、真提示词、真工具。
 *
 * ## 跟 Tier 1 的分工
 *
 * `luna-eval.ts` 测**工具有没有说真话**（确定性、秒级、免费）。
 * 这一层测**模型拿到真话之后有没有好好说**——那些只有真跑一遍才会暴露的问题：
 *
 *   · 客户说英文，Luna 突然蹦中文
 *   · 工具说「这个区我不确定」，Luna 照样自信地开始介绍
 *   · 工具没返回的数字，Luna 自己编一个
 *   · 明明该调工具却先开口说空话（"好的我这就带您看看…"，然后地图毫无反应）
 *
 * ## 怎么做到「真」
 *
 * 用 `ai.live.connect()` 从 Node 直连**生产同款** Live 模型，喂
 * `getSystemInstruction()` 的真实提示词 + `voiceAssistantTools` 的真实声明，
 * 工具调用走 `executeTool()` 真执行。差别只有一个:**用文字注入代替麦克风**
 * （`sendClientContent`），回复从 `outputTranscription` 取。
 *
 * ⚠️ **这一层测不到的**:VAD/打断/音频质量。文字注入没有麦克风，
 *    所以「被背景噪音掐断」这类问题它抓不到 —— 那个只能真机复核。
 *
 * ⚠️ **保真度缺口:工具声明用的是后端那份，不是生产那份。**
 *    `convertToolsForSDK()` 读的是 `voice-assistant-tools.ts` 的声明(22 个执行器)，
 *    而**生产环境 Luna 实际拿到的是前端 `VoiceAssistantContext.tsx` 里的 16 个声明** ——
 *    两份历来会漂移(字段集都不一样)。所以:
 *      · 改**前端** schema 的效果，这一层验证不到（例如 min/max 区间语义那次改动）
 *      · 跑分绿了不等于生产同样绿
 *    跑 `frontend/scripts/check-voice-tools.mjs` 看两份差在哪。
 *    根治要么把声明收口到一处，要么让这个脚本去读前端那份。
 *
 * ⚠️ **有随机性**。同一条用例可能这次过下次挂。判定失败先跑两遍再下结论，
 *    别对着单次结果改代码。
 *
 * ## 判定方式
 *
 * 先跑**确定性检查**（语言一致性、数字溯源、是否听工具的话），这些是硬证据；
 * 再让 gemini-3.5-flash 当裁判打分（对话是否自然、有没有答非所问）。
 * **裁判只是补充信号 —— 确定性检查说挂就是挂，不给裁判翻案的机会。**
 *
 * ## 用法（backend/ 下）
 *
 *   npx ts-node -T scripts/luna-eval-live.ts
 *   npx ts-node -T scripts/luna-eval-live.ts --json after.json --diff before.json
 *   npx ts-node -T scripts/luna-eval-live.ts --only lang    # 只跑某类
 *   npx ts-node -T scripts/luna-eval-live.ts --verbose      # 打印完整对话
 *
 * 会真实消耗 Gemini 额度（每条用例一次 Live 会话 + 一次裁判调用）。
 */
import 'dotenv/config'
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { LIVE_AUDIO, FLASH } from '../src/services/ai/models'
import { getSystemInstruction } from '../src/routes/voice-token'
import { executeTool } from '../src/services/voice-assistant-tools'
import { askLuna } from '../src/services/luna-brain'

/**
 * **Live 层的工具声明** —— 必须和 `frontend/src/contexts/VoiceAssistantContext.tsx`
 * 的 `voiceTools` 保持一致。
 *
 * 2026-08-10 两层架构之前,这里读的是 `convertToolsForSDK()`(后端 22 个执行器),
 * 而生产 Luna 拿到的是前端的 16 个声明 —— **两份历来漂移,跑分绿≠生产绿**
 * (memory `voice-tool-declaration-drift`)。
 *
 * 拆层把这个缺口收窄到了 2 个工具:后端那 22 个执行器现在只有 Brain 会看见,
 * 而 Brain 在这个脚本里是**真的被调用**的。`frontend/scripts/check-voice-tools.mjs`
 * 守着 `ask_luna` 不许从前端声明里消失。
 */
const LIVE_TOOLS = [
  {
    name: 'ask_luna',
    description: 'The ONLY way you can answer anything real. You have NO knowledge of your own: you cannot see the map, and you do not know a single project, area, price, yield, distance, or product feature. Call this for EVERY question that is not pure greeting or small talk. Pass the customer\'s words through VERBATIM. It returns a "speech" field — say exactly that, as written.',
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        question: { type: 'STRING' as any, description: "The customer's question in their own words, verbatim." },
        context: { type: 'STRING' as any, description: 'Optional: what the conversation has been about so far.' },
      },
      required: ['question'],
    },
  },
  {
    name: 'capture_contact',
    description: "Save the customer's contact details so the agent can follow up. Call this ONLY after the customer has shown clear interest and agreed to share contact.",
    parameters: {
      type: 'OBJECT' as any,
      properties: {
        name: { type: 'STRING' as any, description: "Customer's name if given" },
        whatsapp: { type: 'STRING' as any, description: 'WhatsApp number with country code' },
        phone: { type: 'STRING' as any, description: 'Phone number if different from WhatsApp' },
        email: { type: 'STRING' as any, description: 'Email address if given' },
      },
    },
  },
]

const VERBOSE = process.argv.includes('--verbose')
const jsonIdx = process.argv.indexOf('--json')
const OUT = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const diffIdx = process.argv.indexOf('--diff')
const DIFF = diffIdx >= 0 ? process.argv[diffIdx + 1] : null
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

// ════════════════════════════════════════════════════════════════════════════
// 用例 —— 全部取自 2026-07-08~17 的真实对话
// ════════════════════════════════════════════════════════════════════════════

interface Scenario {
  id: string
  tag: 'lang' | 'area' | 'number' | 'deadend' | 'scope' | 'human' | 'product'
  /** 依次注入的用户话术 */
  turns: string[]
  /** 期望说的语言（确定性检查） */
  wantLang?: 'en' | 'zh'
  /** 回复里绝不能出现的字符串（区域名张冠李戴） */
  forbidMentions?: string[]
  /** 必须体现「拿不准/没有」的态度，而不是自信地给一个 */
  mustHedge?: boolean
  /** 回复里**必须**出现其中至少一个（用来验产品指路答对了没有） */
  mustMentionAny?: string[]
  why: string
}

const SCENARIOS: Scenario[] = [
  {
    id: 'en-stays-en', tag: 'lang', wantLang: 'en',
    turns: ['Hi Luna, where are Emaar projects?', 'Tell me more about the first one.'],
    why: '真实事故：用户全程英文，Luna 第二轮突然中文（工具 summary 里的中文祈使句所致）',
  },
  {
    id: 'en-walkthrough-stays-en', tag: 'lang', wantLang: 'en',
    turns: ['Take me through Dubai Marina, I want to show it to my client.'],
    why: '真实事故：present_place 的中文 summary "请用口语顺着把这三站讲出来" 把模型带偏',
  },
  {
    id: 'zh-stays-zh', tag: 'lang', wantLang: 'zh',
    turns: ['你好，帮我看看国际城的房子怎么样？'],
    why: '反向对照：中文用户必须得到中文，别矫枉过正全说英文',
  },
  {
    id: 'harbor-typo', tag: 'area',
    turns: ['I want to show projects in Dubai Harbor to my client. Can you take me there?'],
    // ⚠️ 第一版把 'Creek Harbour' 也列进禁词 → 误判。
    // Luna 当时的回答是「搜到的多是 Dubai Creek Harbour，不是 Dubai Harbour」——
    // 这恰恰是**我们想要的诚实行为**，却被判成了错配。
    // 禁词只该列「张冠李戴地当成答案讲」的区，不该列「主动指出差异」时提到的区。
    forbidMentions: ['Design District', 'D3'],
    why: '真实事故：美式拼写 Harbor → 工具返回 D3 Dubai Design District，Luna 照着介绍了 D3',
  },
  {
    id: 'jvc-parens', tag: 'area',
    turns: ['Show me Jumeirah Village Circle (JVC).'],
    forbidMentions: ['Jebel Ali'],
    why: '真实事故：工具返回 Jebel Ali Village，Luna 全程在讲另一个区',
  },
  {
    id: 'ambiguous-village', tag: 'area', mustHedge: true,
    turns: ['Take me to the village area.'],
    forbidMentions: [],
    why: '工具现在会回 AREA_AMBIGUOUS —— Luna 必须回头问，不许自己挑一个',
  },
  {
    id: 'nonexistent-area', tag: 'area', mustHedge: true,
    turns: ['Show me properties in Manhattan.'],
    why: '工具回 AREA_NOT_FOUND —— 必须老实说没有，绝不能拿另一个区顶替',
  },
  {
    id: 'roi-sane', tag: 'number', wantLang: 'zh',
    turns: ['帮我分析一下商业湾一居室的投资回报，五年能赚多少？'],
    why: '真实事故：对 270 万的 1 居室播报「5 年增值 4818 万，年化 79.9%」',
  },
  {
    id: 'budget-around', tag: 'number', wantLang: 'zh',
    turns: ['帮我查一下100万左右的房产，有哪些选择？'],
    why: '真实事故：模型填 min==max 退化成精确匹配，只剩 1-3 个盘',
  },
  {
    id: 'no-result-pivot', tag: 'deadend',
    turns: ['Do you have anything from Al Ghadeer Gardens developer under 500 thousand dirhams?'],
    mustHedge: true,
    why: '真实事故：0 结果 → Luna 说 "no projects found" → 对话当场死掉',
  },
  {
    id: 'out-of-scope', tag: 'scope',
    turns: ['How can I do live calling with this?'],
    why: '真实事故：Luna 硬邦邦一句 "I can\'t help with live calling"，客户直接走了',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 人类真实说话的样子 —— 不是干净的检索式提问
  //
  // 前面 11 条测的是「功能对不对」，这一组测的是**「像不像个人在跟她说话」**。
  // 真实日志里客户从来不说 "Show me projects in Dubai Marina under 2M"，
  // 他们说的是「哎? 他這個有收出來。問他,我說100萬左右」。
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'asr-garbled-zh', tag: 'human', wantLang: 'zh',
    turns: ['科學權有哪些項目?'],
    why: '真实日志原句：ASR 把「科学城」听成「科學權」。她当时靠猜蒙对了，但这属于运气',
  },
  {
    id: 'asr-offplan-confusion', tag: 'human', wantLang: 'zh',
    turns: ['我现在想找一套100万的二手房', '嗯,我要的是線房哦,你現在給我說的是七房吧。'],
    why: '真实日志原句：「線房」=现房、「七房」=期房。她当时答「抱歉…没找到现房」直接把天聊死',
  },
  {
    id: 'rambling-multi-intent', tag: 'human', wantLang: 'zh',
    turns: ['我想在迪拜马丽娜找个两室的，预算200万左右，另外那边学校怎么样，还有能不能把资料发给我老婆看一下'],
    why: '一句话三个意图（找房+配套+分享）。人就是这么说话的，不会一次只问一件事',
  },
  {
    id: 'is-this-a-bot', tag: 'human',
    turns: ['Are you a real person or a bot?'],
    why: '几乎每个新用户都会试探一次。答得僵硬就再也不聊了',
  },
  {
    id: 'price-pushback', tag: 'human', wantLang: 'zh',
    turns: ['迪拜房子是不是太贵了？现在买是不是接盘啊'],
    why: '带情绪的质疑。这时候堆数据是最差的答法，但也不能顺着说「是的很贵」',
  },
  {
    id: 'vague-browsing', tag: 'human', wantLang: 'zh',
    turns: ['随便看看'],
    why: '最常见的开场。她必须能把话头接住并收敛到一个具体问题，不能反问一串',
  },
  {
    id: 'gibberish', tag: 'human', mustHedge: true,
    turns: ['asdfgh qwerty'],
    why: 'ASR 噪音/误触。不该假装听懂，也不该报错，要自然地请对方再说一次',
  },
  {
    id: 'adjacent-scope-visa', tag: 'human', wantLang: 'zh',
    turns: ['买房能拿迪拜身份吗？'],
    why: '擦边但强相关（黄金签证是买房核心动机）。一刀切拒绝=丢客户；乱答=法律风险。要能承认边界又给方向',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // 产品指路 —— Luna 得知道自己身处什么产品里
  //
  // 她的 16 个工具全是买家侧找房/数据分析，对产品自身一无所知，于是犯两种错：
  //   · 把**存在**的功能拒绝掉（"How can I do live calling?" → "I can't help"）
  //   · 发明**不存在**的能力（「我可以把资料发给您」—— 她发不了任何东西）
  // 后者更糟：客户会一直等一个永远不会来的东西。
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'product-live-call', tag: 'product',
    turns: ['How can I do live calling with this?'],
    mustMentionAny: ['live tour', 'workbench', 'agent'],
    why: '生产事故原句。实时带看真实存在（房间免费不限场次），她当时答「帮不了」，客户再没回来',
  },
  {
    id: 'product-share-to-client', tag: 'product', wantLang: 'zh',
    turns: ['我想把这个项目的资料发给我老婆看一下，能发吗？'],
    why: '生产事故变体：她曾答「我可以通过文本或截图发给您」—— 凭空发明能力。正确做法是教对方用可分享链接',
  },
  {
    id: 'product-quote', tag: 'product', wantLang: 'zh',
    turns: ['能给客户出个正式的付款计划报价单吗？在哪弄？'],
    mustMentionAny: ['付款计划', 'sales offer', '报价'],
    why: '报价单是经纪最高频的产出物，入口藏在项目详情页的 tab 里，不指路根本找不到',
  },
  {
    id: 'product-no-such-feature', tag: 'product', mustHedge: true,
    turns: ['Can you automatically post my listings to Instagram every morning?'],
    why: '产品**没有**这个功能。必须老实说没有，绝不能为了讨好客户编一个出来',
  },
]

// ════════════════════════════════════════════════════════════════════════════
// 跑一场真实 Live 会话（文字注入）
// ════════════════════════════════════════════════════════════════════════════

interface Turn { user: string; reply: string; tools: { name: string; args: any; result: any }[] }

async function runScenario(sc: Scenario): Promise<Turn[]> {
  const turns: Turn[] = []
  let replyBuf = ''
  const toolLog: { name: string; args: any; result: any }[] = []
  let turnDone: (() => void) | null = null

  const session = await ai.live.connect({
    model: LIVE_AUDIO,
    config: {
      responseModalities: [Modality.AUDIO],
      // 只要文字转写 —— 音频我们不听，但 native-audio 模型必须开 AUDIO 模态
      outputAudioTranscription: {},
      systemInstruction: { parts: [{ text: getSystemInstruction('auto') }] },
      tools: [{ functionDeclarations: LIVE_TOOLS }],
    },
    callbacks: {
      onopen: () => {},
      onmessage: async (m: LiveServerMessage) => {
        const c = m.serverContent
        if (c?.outputTranscription?.text) replyBuf += c.outputTranscription.text
        if (m.toolCall) {
          const responses: any[] = []
          for (const fc of m.toolCall.functionCalls || []) {
            let result: any = null, summary = ''
            try {
              if (fc.name === 'ask_luna') {
                // 两层架构:Live 层唯一的知识入口。走真 Brain,和生产完全一致。
                const a = await askLuna({
                  question: String((fc.args as any)?.question || ''),
                  context: (fc.args as any)?.context,
                  sessionId: sc.id,
                })
                // **把 Brain 内部调用过的工具原样摊进 toolLog** —— 下面的
                // 「数字溯源」「遵守不确定信号」两条断言读的就是它。不摊开的话
                // 拆层等于把这两条断言弄瞎(它们只会看到一个 ask_luna)。
                for (const t of a.debug.toolLog) {
                  toolLog.push({ name: t.name, args: t.args, result: { result: t.result, summary: t.summary } })
                }
                result = { speech: a.speech }; summary = a.speech
              } else if (fc.name === 'capture_contact') {
                // 前端直连 /api/leads/contact,这里不真写库。
                result = { ok: true }; summary = 'Contact saved.'
              } else {
                const r = await executeTool(fc.name!, (fc.args as any) || {})
                result = r.result; summary = r.summary
              }
            } catch (e: any) {
              summary = `Failed: ${e?.message}`
            }
            if (fc.name !== 'ask_luna') {
              toolLog.push({ name: fc.name!, args: fc.args, result: { result, summary } })
            }
            responses.push({ id: fc.id, name: fc.name, response: { result: JSON.stringify(result), summary } })
          }
          session.sendToolResponse({ functionResponses: responses })
        }
        if (c?.turnComplete) turnDone?.()
      },
      onerror: (e: any) => console.error(`  [${sc.id}] live error:`, e?.message || e),
      onclose: () => {},
    },
  })

  try {
    for (const user of sc.turns) {
      replyBuf = ''
      const before = toolLog.length
      const done = new Promise<void>((res) => { turnDone = res })
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: user }] }], turnComplete: true })
      await Promise.race([done, new Promise<void>((r) => setTimeout(r, 45_000))])
      turns.push({ user, reply: replyBuf.trim(), tools: toolLog.slice(before) })
      if (VERBOSE) {
        console.log(`\n  👤 ${user}`)
        console.log(`  🤖 ${replyBuf.trim() || '(无回复)'}`)
        for (const t of toolLog.slice(before)) console.log(`  🔧 ${t.name}(${JSON.stringify(t.args)})`)
      }
    }
  } finally {
    try { session.close() } catch { /* ignore */ }
  }
  return turns
}

// ════════════════════════════════════════════════════════════════════════════
// 确定性检查 —— 硬证据，裁判不能翻案
// ════════════════════════════════════════════════════════════════════════════

const hasCJK = (s: string) => /[一-鿿]/.test(s)
/** 拉丁字母占比高且没有中文 → 判定为英文 */
const looksEnglish = (s: string) => !hasCJK(s) && /[a-z]{3,}/i.test(s)

interface Finding { ok: boolean; name: string; detail: string }

function checkLanguage(sc: Scenario, turns: Turn[]): Finding[] {
  if (!sc.wantLang) return []
  const out: Finding[] = []
  turns.forEach((t, i) => {
    if (!t.reply) return
    const ok = sc.wantLang === 'zh' ? hasCJK(t.reply) : looksEnglish(t.reply)
    out.push({
      ok,
      name: `${sc.id} 第${i + 1}轮说${sc.wantLang === 'zh' ? '中文' : '英文'}`,
      detail: ok ? 'ok' : `❌ 回复是「${t.reply.slice(0, 60)}…」`,
    })
  })
  return out
}

/** 产品指路答对了没有 —— 必须点到正确的功能名/入口，光说"可以的"不算 */
function checkMentions(sc: Scenario, turns: Turn[]): Finding[] {
  if (!sc.mustMentionAny?.length) return []
  const all = turns.map(t => t.reply).join(' ').toLowerCase()
  const hit = sc.mustMentionAny.filter(m => all.includes(m.toLowerCase()))
  return [{
    ok: hit.length > 0,
    name: `${sc.id} 指到了正确的功能`,
    detail: hit.length ? `ok（提到 ${hit[0]}）` : `❌ 没提到 ${sc.mustMentionAny.join(' / ')} 中的任何一个`,
  }]
}

function checkForbidden(sc: Scenario, turns: Turn[]): Finding[] {
  if (!sc.forbidMentions?.length) return []
  const all = turns.map(t => t.reply).join(' ')
  const hit = sc.forbidMentions.filter(f => all.toLowerCase().includes(f.toLowerCase()))
  return [{
    ok: hit.length === 0,
    name: `${sc.id} 不提错区域`,
    detail: hit.length ? `❌ 提到了 ${hit.join('、')}（${sc.why}）` : 'ok',
  }]
}

/**
 * 工具说不确定的时候，Luna 有没有听话。
 *
 * 这是**新工具契约的验收点** —— 工具现在会回 AREA_AMBIGUOUS / AREA_NOT_FOUND，
 * 如果模型无视它继续自信地讲，那这套契约就是白做的。
 */
function checkObeyedUncertainty(sc: Scenario, turns: Turn[]): Finding[] {
  const out: Finding[] = []
  for (const t of turns) {
    const unsure = t.tools.find(x =>
      typeof x.result?.summary === 'string' &&
      /AREA_AMBIGUOUS|AREA_NOT_FOUND/.test(x.result.summary))
    if (!unsure) continue
    const kind = /AMBIGUOUS/.test(unsure.result.summary) ? '歧义' : '查无此区'
    // 听话的表现：反问 / 明说没有。不听话的表现：直接开始介绍某个区。
    const hedged = /\?|？|which|哪一个|哪个|don'?t have|不确定|没有|no .*(area|match)/i.test(t.reply)
    out.push({
      ok: hedged,
      name: `${sc.id} 遵守工具的「${kind}」信号`,
      detail: hedged ? 'ok' : `❌ 工具说不确定，Luna 仍答「${t.reply.slice(0, 70)}…」`,
    })
  }
  return out
}

/**
 * 数字溯源 —— 回复里的每个大额数字都必须在工具返回里找得到。
 *
 * 只查「大额」（≥10万 AED 量级），小数字（楼层、卧室数、公里、百分比）噪音太大。
 * 中文「万」「亿」先换算成绝对值再比。
 */
function checkNumbersGrounded(sc: Scenario, turns: Turn[]): Finding[] {
  const out: Finding[] = []
  for (const t of turns) {
    if (!t.tools.length || !t.reply) continue
    const pool: number[] = []
    const walk = (v: any) => {
      if (v == null) return
      if (typeof v === 'number') { pool.push(v); return }
      if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) pool.push(n); return }
      if (Array.isArray(v)) { v.forEach(walk); return }
      if (typeof v === 'object') Object.values(v).forEach(walk)
    }
    t.tools.forEach(x => walk(x.result))
    if (!pool.length) continue

    // ⚠️ **用户自己说的数字也算有出处。**
    // 第一版漏了这条 → 客户说「100万左右」，Luna 复述「in your 1 million budget」
    // 被判成「编数字」。复述客户的话是好顾问的表现，不是幻觉。
    for (const m of t.user.matchAll(/([\d]+(?:\.\d+)?)\s*(万|亿|million|m\b|k\b)?/gi)) {
      let n = parseFloat(m[1])
      const u = (m[2] || '').toLowerCase()
      if (u === '万') n *= 1e4
      else if (u === '亿') n *= 1e8
      else if (u === 'million' || u === 'm') n *= 1e6
      else if (u === 'k') n *= 1e3
      pool.push(n)
    }

    const spoken: number[] = []
    for (const m of t.reply.matchAll(/([\d]+(?:\.\d+)?)\s*(万|亿|million|m\b|k\b)?/gi)) {
      let n = parseFloat(m[1])
      const unit = (m[2] || '').toLowerCase()
      if (unit === '万') n *= 1e4
      else if (unit === '亿') n *= 1e8
      else if (unit === 'million' || unit === 'm') n *= 1e6
      else if (unit === 'k') n *= 1e3
      if (n >= 1e5) spoken.push(n)
    }
    if (!spoken.length) continue

    // 5% 容差：模型会做合理的四舍五入（270万 说成 2.7 million）
    const orphans = spoken.filter(s => !pool.some(p => p > 0 && Math.abs(p - s) / Math.max(p, s) < 0.05))
    out.push({
      ok: orphans.length === 0,
      name: `${sc.id} 数字有出处`,
      detail: orphans.length
        ? `❌ 工具返回里找不到：${orphans.map(o => o.toLocaleString()).join(', ')}`
        : `ok（${spoken.length} 个大额数字全部溯源成功）`,
    })
  }
  return out
}

/** 该调工具却先开口说空话 —— "好的我这就带您看看…" 然后地图毫无反应 */
function checkNoEmptyPromise(sc: Scenario, turns: Turn[]): Finding[] {
  const out: Finding[] = []
  for (const t of turns) {
    if (t.tools.length) continue
    const promised = /带你看看|带您看看|let me show|i'?ll show|taking you|这就为您|正在为您/i.test(t.reply)
    if (!promised) continue
    out.push({
      ok: false,
      name: `${sc.id} 不放空话`,
      detail: `❌ 答应了却没调任何工具：「${t.reply.slice(0, 70)}…」`,
    })
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// LLM 裁判 —— 补充信号，不能推翻确定性检查
// ════════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ **这个函数踩过一次大坑，改之前先看完。**
 *
 * 第一版做错了两件事，导致裁判**凭空捏造缺陷**：
 *
 * 1. 把 `sc.why`（描述的是**历史 bug**，例如「工具返回 Jebel Ali Village，
 *    Luna 全程在讲另一个区」）当成「本用例关注点」喂给了裁判。
 *    → 裁判顺着这段描述"确认"了它被告知的 bug。**这是诱导证人。**
 * 2. 只给了裁判**工具名**，没给工具返回值。
 *    → 它根本无从核实「回复有没有偏离工具数据」，只能猜。
 *
 * 实际后果：jvc-parens 被打 1/5，判词是「工具返回了 Jebel Ali Village 的数据，
 * Luna 张冠李戴」—— 而生产环境实测 `areas/match` 返回的是
 * `JVC Jumeirah Village Circle`，置信度 1.0，Luna 讲的数字也全对。
 * **整条判词是编的。**
 *
 * 现在：不给历史结论，只给真实工具返回，并明确要求「没在工具输出里看到就不许断言」。
 */
async function judge(sc: Scenario, turns: Turn[]): Promise<{ score: number; verdict: string; handledLimitationWell: boolean }> {
  const brief = (v: any) => {
    const s = JSON.stringify(v)
    return s && s.length > 900 ? s.slice(0, 900) + '…(截断)' : s
  }
  const convo = turns.map(t =>
    `USER: ${t.user}\n` +
    (t.tools.length
      ? t.tools.map(x => `TOOL ${x.name}(${JSON.stringify(x.args)}) RETURNED: ${brief(x.result)}`).join('\n')
      : 'TOOLS: (none called)') +
    `\nLUNA: ${t.reply || '(silence)'}`
  ).join('\n---\n')

  const r = await ai.models.generateContent({
    model: FLASH,
    config: {
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          score: { type: 'number', description: '1-5, 5 = 一个优秀的迪拜置业顾问会这么答' },
          verdict: { type: 'string', description: '一句话中文点评，指出最主要的问题' },
          handledLimitationWell: {
            type: 'boolean',
            description: '当工具没有数据/区域歧义/超出服务范围时：Luna 是否既没有硬编一个答案，又把话头交回给了客户（反问、列候选、提替代都算）。不适用时填 true。',
          },
        },
        required: ['score', 'verdict', 'handledLimitationWell'],
      },
    },
    contents: `你在评估一个迪拜房产语音助手 Luna 的对话质量。这是**语音**场景，回复简短是对的，不要因为"不够详细"扣分。

评分标准（1-5）：
5 = 直接答到点上，用了工具返回的具体数据，语气自然像真人顾问
3 = 答了但泛泛而谈，或者绕了弯
1 = 答非所问 / 空话 / 明显让客户没法继续聊下去

特别扣分项：答应了却没调工具、把客户问的东西换成别的东西答、前后自相矛盾、套话连篇。
特别加分项：工具没数据时老实说没有，并给出可执行的替代路径。

**证据纪律（必须遵守）：**
下面每一轮都附了工具的**真实返回值**。
- 只有当你在 TOOL RETURNED 里**亲眼看到**某个数据，而 Luna 说的与之不符时，才可以指控"数据不一致/张冠李戴"。
- 工具返回被截断（结尾有"…(截断)"）时，不要因为没看到某个数字就断定 Luna 编造。
- 不确定就不要指控。**宁可给中间分，也不要写一句你无法从下面材料里证实的判词。**

对话：
${convo}`,
  })

  try {
    const j = JSON.parse(r.text || '{}')
    return { score: Number(j.score) || 0, verdict: String(j.verdict || ''), handledLimitationWell: j.handledLimitationWell !== false }
  } catch {
    return { score: 0, verdict: '裁判解析失败', handledLimitationWell: false }
  }
}

// ════════════════════════════════════════════════════════════════════════════

async function main() {
  const pool = ONLY ? SCENARIOS.filter(s => s.tag === ONLY || s.id === ONLY) : SCENARIOS
  console.log(`\nLuna 模型层跑分 —— ${LIVE_AUDIO}`)
  console.log(`${pool.length} 条用例（真实 Live 会话 + 真实工具执行）\n${'─'.repeat(70)}`)

  const findings: Finding[] = []
  const judged: { id: string; score: number; verdict: string }[] = []

  for (const sc of pool) {
    process.stdout.write(`  ▸ ${sc.id} … `)
    let turns: Turn[] = []
    try {
      turns = await runScenario(sc)
    } catch (e: any) {
      findings.push({ ok: false, name: `${sc.id} 会话崩了`, detail: e?.message || String(e) })
      console.log('💥')
      continue
    }
    const f = [
      ...checkLanguage(sc, turns),
      ...checkForbidden(sc, turns),
      ...checkMentions(sc, turns),
      ...checkObeyedUncertainty(sc, turns),
      ...checkNumbersGrounded(sc, turns),
      ...checkNoEmptyPromise(sc, turns),
    ]
    const j = await judge(sc, turns)

    /**
     * 「有没有优雅地处理局限」交给裁判，不用正则。
     *
     * ⚠️ **这是踩了四轮坑之后的结论，别改回去。** 我先后往正则里补过：
     *   "Did you mean a different area?" · "Would you like…" · "If you can stretch…"
     *   "could mean A, B, or C" · "Are you interested in…" · "is not an area in Dubai"
     *   · `cannot` 匹配不到 `can't`
     * 每一次都是模型**做对了**却被判红。最后一次的回复是
     *   `Which "Village" area are you interested in: Jebel Ali Village, JVC…`
     * —— 教科书级的正确处理，正则依然判它失败（它不"承认"任何东西，它只是问）。
     *
     * 词表永远追不上自然语言。**这个维度本来就是判断题，不是模式匹配题。**
     * 假红灯比漏报更伤：跑分一旦不可信，就没人会再看它。
     *
     * 真正确定性的东西（语言、禁提区域、数字溯源、空头支票、有没有听工具的话）
     * 仍然全部走确定性检查 —— 那些是硬证据，裁判无权翻案。
     */
    if (sc.mustHedge) {
      f.push({
        ok: !!j.handledLimitationWell,
        name: `${sc.id} 优雅处理局限（裁判判定）`,
        detail: j.handledLimitationWell ? 'ok' : `❌ ${j.verdict}`,
      })
    }
    findings.push(...f)
    judged.push({ id: sc.id, ...j })
    const bad = f.filter(x => !x.ok).length
    console.log(`${bad ? `❌ ${bad} 项` : '✅'}  裁判 ${j.score}/5 — ${j.verdict}`)
  }

  console.log(`\n${'─'.repeat(70)}`)
  const fails = findings.filter(f => !f.ok)
  const pass = findings.length - fails.length
  const avg = judged.length ? judged.reduce((a, b) => a + b.score, 0) / judged.length : 0
  console.log(`  确定性检查 ${pass}/${findings.length} 通过`)
  console.log(`  裁判均分   ${avg.toFixed(2)}/5`)

  if (fails.length) {
    console.log(`\n  未通过：`)
    for (const f of fails) console.log(`    · ${f.name} — ${f.detail}`)
  }

  if (DIFF && existsSync(DIFF)) {
    const b = JSON.parse(readFileSync(DIFF, 'utf8'))
    console.log(`\n  ── 对比基线 ${DIFF} ──`)
    console.log(`  确定性 ${b.pass}/${b.total} → ${pass}/${findings.length}`)
    console.log(`  裁判   ${Number(b.avgScore).toFixed(2)} → ${avg.toFixed(2)}`)
  }

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      at: new Date().toISOString(), model: LIVE_AUDIO,
      pass, total: findings.length, avgScore: avg, findings, judged,
    }, null, 2))
    console.log(`\n  结果已存 ${OUT}`)
  }
  console.log()
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
