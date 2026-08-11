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
import { askLuna, startAsk, awaitAsk } from '../src/services/luna-brain'
import { liveToolManifest } from '../src/services/luna-live-manifest'
// 场景定义是**共享**的 —— admin 自测跑的是同一份(services/luna-test-scenarios.ts)。
// 两份场景 = admin 绿了命令行红了,然后谁都不信跑分。
import { SCENARIOS, type Scenario } from '../src/services/luna-test-scenarios'

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
/**
 * **Live 层的工具声明 = 后端 manifest。**
 *
 * 2026-08-10 之前这里内联了第二份声明,于是跑分测的是一个生产上不存在的配置
 * (memory `voice-tool-declaration-drift`)。现在直接 import 生产同一个函数 ——
 * **前端、跑分、后端三处同源**,漂移面归零。
 */
const LIVE_TOOLS = liveToolManifest()

const VERBOSE = process.argv.includes('--verbose')
const jsonIdx = process.argv.indexOf('--json')
const OUT = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const diffIdx = process.argv.indexOf('--diff')
const DIFF = diffIdx >= 0 ? process.argv[diffIdx + 1] : null
/**
 * `--model <id>` —— **换 Live 模型时用同一套场景做 A/B**。
 *
 * 2026-08-10 才发现 `gemini-3.1-flash-live-preview` 一直存在(实测 models.list()
 * 有,能 bidiGenerateContent),而我们跑的还是 2.5 世代。**别再靠读文档判断
 * 有哪些模型** —— 这个项目的模型表错过一次,写着的两个 ID 全是 404
 * (见 CLAUDE.md 的 Gemini 模型表)。要换先在这里跑一遍对比。
 */
const modelIdx = process.argv.indexOf('--model')
const MODEL = modelIdx >= 0 ? process.argv[modelIdx + 1] : LIVE_AUDIO
const onlyIdx = process.argv.indexOf('--only')
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

// ════════════════════════════════════════════════════════════════════════════
// 用例 —— 全部取自 2026-07-08~17 的真实对话
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// 跑一场真实 Live 会话（文字注入）
// ════════════════════════════════════════════════════════════════════════════

interface Turn {
  user: string; reply: string; tools: { name: string; args: any; result: any }[]
  /** 两段式:这一轮拿到了过渡句(pending) */
  staged?: boolean
  /** 两段式:这一轮真的回来取了正文 */
  resumed?: boolean
  /** 这一轮 Live 有没有调工具（= 有没有问 Brain） */
  askedBrain?: boolean
}

async function runScenario(sc: Scenario): Promise<Turn[]> {
  const turns: Turn[] = []
  let replyBuf = ''
  const toolLog: { name: string; args: any; result: any }[] = []
  let turnDone: (() => void) | null = null
  // 两段式作答的追踪 —— 只说了过渡句却没调 ask_luna_more,就是把客户挂在了线上。
  let stagedThisTurn = false
  let sawAskMore = false
  // 🔴 这一轮 Live 到底有没有调工具 —— 生产事故「AI 自己编」就发生在这条路径上,
  // 而以前的跑分完全看不到它。
  let askedBrainThisTurn = false
  let turnIdx = 0

  const session = await ai.live.connect({
    model: MODEL,
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
              if (fc.name === 'capture_contact') {
                // 前端直连 /api/leads/contact,这里不真写库。
                result = { ok: true }; summary = 'Contact saved.'
              } else {
                /**
                 * **所有工具都走 Brain** —— 与生产完全一致。
                 * Live 选的工具降级成 intendedTool(意图信号),Brain 决定真正调什么。
                 * 这正是跑分以前测不到的那条路径。
                 */
                askedBrainThisTurn = true
                const a = await askLuna({
                  question: sc.turns[turnIdx] || '',
                  intendedTool: fc.name!,
                  intendedParams: (fc.args as any) || {},
                  sessionId: sc.id,
                })
                // 把 Brain 内部调用过的工具摊进 toolLog —— 「数字溯源」「遵守不确定
                // 信号」两条断言读的就是它。
                for (const t of a.debug.toolLog) {
                  toolLog.push({ name: t.name, args: t.args, result: { result: t.result, summary: t.summary } })
                }
                result = { speech: a.speech }; summary = a.speech
              }
            } catch (e: any) {
              summary = `Failed: ${e?.message}`
            }
            if (fc.name === 'capture_contact') {
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
      stagedThisTurn = false
      sawAskMore = false
      askedBrainThisTurn = false
      turnIdx = sc.turns.indexOf(user)
      const before = toolLog.length
      const done = new Promise<void>((res) => { turnDone = res })
      session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: user }] }], turnComplete: true })
      await Promise.race([done, new Promise<void>((r) => setTimeout(r, 45_000))])
      turns.push({ user, reply: replyBuf.trim(), tools: toolLog.slice(before), staged: stagedThisTurn, resumed: sawAskMore, askedBrain: askedBrainThisTurn })
      if (VERBOSE) {
        console.log(`\n  👤 ${user}`)
        console.log(`  🤖 ${replyBuf.trim() || '(无回复)'}`)
        for (const t of toolLog.slice(before)) console.log(`  🔧 ${t.name}(${JSON.stringify(t.args)})`)
        console.log(`  ⏱  两段式: staged=${stagedThisTurn} resumed=${sawAskMore}`)
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
/**
 * 🔴 **两段式必须走完** —— 只说了过渡句就收场,等于当着客户的面把电话挂了。
 *
 * 这是两段式作答唯一的失败模式,也是它最该被守住的地方:
 * Live 层拿到 `pending: true` 之后**必须**接着调 `ask_luna_more`。
 * 同一个坑之前踩过一次 —— 让 Live 自己先说 filler 再调工具,它说完就不调了
 * (「买房能拿迪拜身份吗?」→「让我查一下。」→ 沉默)。
 */
/**
 * 🔴 **这一轮到底调没调工具** —— 抓「Luna 没查就自己说」的唯一手段。
 *
 * 这是 2026-08-10 两起生产事故的共同路径,而**以前的跑分完全看不到它**:
 *   · owner 报「AI 说自己能卖二手房」—— 同样的问题直接问 Brain,答案全对,
 *     所以那句话是 Live 自己编的,它压根没调工具
 *   · 所有护栏(数据边界/诚实规则/澄清出路)都在 Brain 里,
 *     **Live 绕过 Brain = 护栏全失效,而且不留痕迹**
 *
 * 根因是我把 17 个具体工具砍成一个抽象入口,模型从「语义匹配」被迫改做
 * 「元判断」。恢复完整工具清单之后,这条断言就是它的验收标准。
 */
function checkAskedBrain(sc: Scenario, turns: Turn[]): Finding[] {
  if (sc.noToolOk) return []
  return turns.map((t, i) => ({
    ok: !!t.askedBrain,
    name: `${sc.id} 第${i + 1}轮调了工具(没有自己编)`,
    detail: t.askedBrain
      ? 'ok'
      : `❌ 一次工具都没调就开口了：「${(t.reply || '(沉默)').slice(0, 60)}」—— 这一轮完全绕过了 Brain 的护栏`,
  }))
}

function checkTwoStageCompleted(sc: Scenario, turns: Turn[]): Finding[] {
  const out: Finding[] = []
  for (const t of turns) {
    if (!t.staged) continue
    out.push({
      ok: !!t.resumed,
      name: `${sc.id} 两段式走完了(念完过渡句要接着取正文)`,
      detail: t.resumed ? 'ok' : `❌ 只说了「${t.reply.slice(0, 40)}」就收场,没调 ask_luna_more —— 客户被挂在线上`,
    })
  }
  return out
}

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

  /**
   * ⚠️ **用户自己说的数字也算有出处 —— 而且要跨整场会话累积。**
   *
   * 两次栽在这条上，是同一个问题的两个版本：
   *   ① 第一版根本没有豁免 → 客户说「100万左右」，Luna 复述「in your 1 million
   *      budget」被判成编数字。
   *   ② 修完仍只看**当轮** `t.user` → `asr-offplan-confusion` 里客户第 1 轮说
   *      「100万的二手房」，Luna 第 2 轮复述 1,000,000，又被判成编数字。
   *
   * 客户的预算在整通电话里都有效，好顾问本来就该一直记着它。
   * **假红灯比漏报更伤 —— 跑分一旦不可信就没人看了。**
   */
  const userSaid: number[] = []
  const harvest = (text: string, into: number[]) => {
    for (const m of text.matchAll(/([\d]+(?:\.\d+)?)\s*(万|亿|million|m\b|k\b)?/gi)) {
      let n = parseFloat(m[1])
      const u = (m[2] || '').toLowerCase()
      if (u === '万') n *= 1e4
      else if (u === '亿') n *= 1e8
      else if (u === 'million' || u === 'm') n *= 1e6
      else if (u === 'k') n *= 1e3
      into.push(n)
    }
  }

  for (const t of turns) {
    harvest(t.user, userSaid)          // 先累积,再判 —— 当轮说的当轮也算数
    if (!t.tools.length || !t.reply) continue
    const pool: number[] = [...userSaid]
    const walk = (v: any) => {
      if (v == null) return
      if (typeof v === 'number') { pool.push(v); return }
      if (typeof v === 'string') { const n = Number(v); if (Number.isFinite(n)) pool.push(n); return }
      if (Array.isArray(v)) { v.forEach(walk); return }
      if (typeof v === 'object') Object.values(v).forEach(walk)
    }
    t.tools.forEach(x => walk(x.result))
    if (!pool.length) continue

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
  /**
   * 🔴 **截断可以，但绝不能截掉判定所需的东西。**
   *
   * 旧版就一行 `JSON.stringify(v).slice(0, 900)`。而**单个项目对象就将近 900 字符**
   * （id/图片URL/investment_5yr 全在里面），于是裁判**只看得到列表的第一条**。
   *
   * 后果是最坏的那种假红灯：Luna 讲了列表里第 2、3 个项目（Serenz、
   * SAMANA SOUTH HAVEN —— 查库确认真实存在，区域也对），裁判看不到它们，
   * 判成「凭空捏造数据的严重违规」，1/5。
   *
   * **我拿这个假红灯否决了一次 Live 模型升级。** 假红灯不只是没人看，
   * 它会让人做出错误的决定。
   *
   * 现在:①`summary` 完整给（那是 Brain 真正读到的事实来源，本来就不长）；
   * ②所有实体名单独抽出来放最前面，永不被截；③原始 JSON 才截断。
   */
  const collectNames = (v: any, out: string[] = [], depth = 0): string[] => {
    if (!v || depth > 6 || out.length >= 40) return out
    if (Array.isArray(v)) { v.forEach(x => collectNames(x, out, depth + 1)); return out }
    if (typeof v === 'object') {
      for (const k of ['project_name', 'name', 'area_name', 'developer', 'matched', 'title']) {
        const val = (v as any)[k]
        if (typeof val === 'string' && val.trim() && !out.includes(val)) out.push(val)
      }
      Object.values(v).forEach(x => collectNames(x, out, depth + 1))
    }
    return out
  }
  /**
   * 数字同理，而且比名字更容易误判 —— **同一个坑栽了三次**：
   *   ① Serenz / SAMANA SOUTH HAVEN（项目名在列表第 2、3 条，被截掉）
   *   ② 3.1 的 roi-sane「53万租金、302万房价没有数据支撑」
   *      —— 工具实际返回 `rental_income_5y_aed: 529867`、`future_price_aed: 3027211`，
   *      只是嵌在 `projection_5y` 里，在 700 字符之外
   *   ③ 2.5 的 ambiguous-village 同款判词
   *
   * 数字溯源是裁判最爱冤枉人的地方，所以**所有数值单独抽出来，永不截断**。
   * 大额同时给「万」单位 —— Luna 播报中文时说的是「53万」，裁判要能对上。
   */
  const collectNumbers = (v: any, out: Set<string> = new Set(), depth = 0): Set<string> => {
    if (v == null || depth > 8 || out.size >= 80) return out
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(Math.abs(v) >= 10000 ? `${v}(${(v / 10000).toFixed(1)}万)` : String(v))
      return out
    }
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n) && v.trim() !== '') out.add(Math.abs(n) >= 10000 ? `${n}(${(n / 10000).toFixed(1)}万)` : String(n))
      return out
    }
    if (Array.isArray(v)) { v.forEach(x => collectNumbers(x, out, depth + 1)); return out }
    if (typeof v === 'object') Object.values(v).forEach(x => collectNumbers(x, out, depth + 1))
    return out
  }
  const brief = (v: any) => {
    const summary = v?.summary
    const inner = v?.result !== undefined ? v.result : v
    const names = collectNames(inner)
    const nums = [...collectNumbers(inner)]
    const s = JSON.stringify(inner)
    const body = s && s.length > 700 ? s.slice(0, 700) + '…(RAW 在此截断——名字和数字见上,那两行是完整的)' : s
    return (
      (summary ? `\n  SUMMARY: ${summary}` : '') +
      (names.length ? `\n  ENTITIES RETURNED (complete, nothing omitted): ${names.join(' | ')}` : '') +
      (nums.length ? `\n  NUMBERS RETURNED (complete, nothing omitted): ${nums.join(' , ')}` : '') +
      `\n  RAW: ${body}`
    )
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
  console.log(`\nLuna 模型层跑分 —— ${MODEL}${MODEL !== LIVE_AUDIO ? `  ⚠️ 非生产模型(生产是 ${LIVE_AUDIO})` : ''}`)
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
      ...checkTwoStageCompleted(sc, turns),
      ...checkAskedBrain(sc, turns),
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
      at: new Date().toISOString(), model: MODEL,
      pass, total: findings.length, avgScore: avg, findings, judged,
    }, null, 2))
    console.log(`\n  结果已存 ${OUT}`)
  }
  console.log()
  process.exit(fails.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
