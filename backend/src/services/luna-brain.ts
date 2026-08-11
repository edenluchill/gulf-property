/**
 * Luna Brain —— 两层架构的**第二层**（会思考的那层）。
 *
 * ## 为什么存在
 *
 * `docs/reports/2026-08-10-luna-conversation-quality-audit.md` 的三个数字：
 *   · 工具执行 60 天 32 次、**0 error**、p95 < 150ms —— 数据层是好的
 *   · 每场对话**平均只调用 1 次工具** —— 模型基本不查就开口
 *   · 十场 transcript **只有一场**进入房产话题
 *
 * Live 层跑的 `gemini-2.5-flash-native-audio-preview` 是 2.5 世代小号预览版，
 * **没有 thinking 也配不了**，上面压着 22 个工具。让它同时负责听、说、打断、
 * 选工具、判断置信度、组织话术 —— 超纲了。指令跟随崩溃有铁证：prompt 明令
 * 禁止说「抱歉」，session 52 说了。
 *
 * 所以拆：**Live 只当嘴和耳朵，这里当大脑。**
 *
 *   Live (native audio)  ──ask_luna(question)──▶  这里 (gemini-3.5-flash + thinking)
 *                        ◀──{ speech, mapAction }──
 *
 * **核心不变量：Live 层永远不生成事实。** `speech` 在这里写死，Live 照念不改。
 *
 * ## 白捡的好处
 *
 * 大脑是**普通文本模型** → 可以确定性地跑分、可以进 CI。
 * 以前只能靠 Live 端到端撞运气（有随机性、烧额度、测不到 VAD）。
 *
 * ⚠️ 改这里之前先跑 `scripts/luna-eval.ts` 拿基线。见 memory `luna-eval-harness`。
 */
import { FLASH } from './ai/models'
import { callGemini } from './ai/gemini'
import { counter, histogram } from '../telemetry'
import { executeTool, voiceAssistantTools } from './voice-assistant-tools'
import { checkScope, describeBoundaries } from './luna-data-boundaries'

/**
 * 工具循环最多几轮。
 *
 * ⚠️ **这是延迟的主旋钮,别随手调大。** 实测(`scripts/luna-brain-eval.ts`):
 *   3 轮 → 7.5-8.9s   2 轮 → 4-5s
 *
 * 而且**并行调用救不了** —— 试过在 prompt 里要求「一轮把工具全调了」,没用,
 * 因为那些调用是真有依赖的(先 search 拿到 project_id,才能算这个盘的 ROI)。
 * 串行轮数就是延迟本身。
 *
 * 第三轮拿到的通常是锦上添花(投资细分、走查动画)。**语音场景下,
 * 一个 4 秒的好答案胜过一个 8 秒的完美答案** —— 后者用户已经以为掉线了。
 * 深的东西留给下一轮对话,反正他还在线上。
 */
const MAX_ROUNDS = 2

/** 硬超时。超了返回降级话术，绝不让用户干等。 */
const BUDGET_MS = 6000

export interface BrainAsk {
  /** 用户原话。**不要预处理** —— 地名识别错乱由工具层的匹配器负责报告置信度。 */
  question: string
  /** 用户在说什么语言（Live 层探测到的）。speech 必须用这个语言写。 */
  language?: string
  /** 会话 id —— 只用于「连续澄清」降级计数，不落库。 */
  sessionId?: string
  /** 地图当前状态等上下文，可选。 */
  context?: string
}

export interface BrainAnswer {
  /** **最终话术**。Live 层照念，不许改数字、不许加内容。 */
  speech: string
  /** 地图动作，契约与旧版完全一致，前端 handleMapAction 不用改。 */
  mapAction?: unknown
  /**
   * 给前端气泡卡片用。
   * ⚠️ 拆层最容易碰掉的就是这个 —— 前端 `buildBubbleAttachment(toolName, result, params)`
   * 靠**工具名**渲染卡片。不回传工具名，卡片全没。
   */
  attachments: Array<{ toolName: string; result: unknown; params: unknown }>
  /** 诊断用，不给模型看。 */
  debug: {
    toolsUsed: string[]
    /**
     * Brain 内部每一次工具调用的完整记录。**给跑分用的,不走 HTTP** ——
     * `/api/voice/tools/ask` 只挑轻量字段返回,别把几十 KB 的项目列表塞进
     * 每一次语音往返。
     *
     * 拆层之后 Tier2(`luna-eval-live.ts`)只能看见 `ask_luna` 一个工具,
     * 而它的「数字溯源」「遵守不确定信号」两条断言都要读工具原始返回 ——
     * 靠这个字段把内部调用还给它。没有它,拆层等于把 Tier2 弄瞎。
     */
    toolLog: Array<{ name: string; args: unknown; result: unknown; summary: string }>
    rounds: number
    ms: number
    /** 本轮是不是「只有问题没有内容」—— 连续两轮就要降级 */
    clarifying: boolean
    /** 走了降级路径（超时 / 异常 / 连续澄清） */
    degraded: boolean
    outOfScope?: string
  }
}

/**
 * 「连续纯澄清」计数器。
 *
 * WHY：2026-07-20 把「自信地说谎」修成了「诚实地说找不到」，出路却只覆盖
 * 「空搜索结果」，不覆盖「区域没匹配上」。生产实测 session 51 连续两轮、
 * session 53 连续三轮纯澄清，用户直接走人 —— **诚实但没出路，体感和说谎一样烂。**
 *
 * 所以这条规则用**代码**强制，不靠 prompt：连续两轮纯澄清，第三轮必须出内容。
 * 内存 Map 足够 —— 掉了大不了多问一次，不值得为它建表。
 */
const clarifyStreak = new Map<string, { n: number; at: number }>()
const STREAK_TTL_MS = 10 * 60 * 1000

function bumpStreak(sessionId: string | undefined, clarifying: boolean): number {
  if (!sessionId) return 0
  const now = Date.now()
  // 顺手清过期项 —— 这个 Map 没有别的回收时机，不清会随会话数无限涨。
  for (const [k, v] of clarifyStreak) if (now - v.at > STREAK_TTL_MS) clarifyStreak.delete(k)
  if (!clarifying) { clarifyStreak.delete(sessionId); return 0 }
  const prev = clarifyStreak.get(sessionId)
  const n = (prev && now - prev.at <= STREAK_TTL_MS ? prev.n : 0) + 1
  clarifyStreak.set(sessionId, { n, at: now })
  return n
}

/**
 * 工具返回体里表示「没给出答案」的信号。
 *
 * 这些在旧埋点里**全部记成 `ok`** —— 监控 100% 健康，用户那边全是失败。
 * 见审计报告第二节。
 */
const NO_ANSWER_MARKERS = /AREA_AMBIGUOUS|AREA_NOT_FOUND|FEATURE_UNKNOWN|NOT_FOUND|no results|0 results/i

function systemPrompt(language: string | undefined, forceContent: boolean): string {
  return `You are the analyst behind Luna, a Dubai real estate consultant.

A live voice model is talking to the customer. It cannot think and it has no data.
You do the thinking, call the tools, and **write the exact words it will say out loud.**
Whatever you return in your final message is spoken verbatim. Write speech, not notes.

${describeBoundaries()}

## SPEED — you are inside a live phone call

Someone is holding a phone to their ear waiting for you. Every extra round trip is
another second of silence.

- **Ask for every tool you need in ONE turn.** Independent calls run in parallel;
  asking one at a time doubles the wait.
- **You get two rounds of tools. That is the ceiling** — after the second, you are cut
  off and must speak with whatever you have. Spend them well: round one to find out
  what exists, round two only if you genuinely cannot answer without it.
- Do not call a tool to confirm something a previous tool already told you.
- Good enough now beats perfect later. One solid fact plus a concrete next step is a
  complete answer — the extra detail can come in the next exchange, they're still on
  the line. Do not go fetch a second opinion.

## YOUR OUTPUT

- **${language && language !== 'auto' ? `Write in the customer's language: ${language}.` : "Write in the same language the customer used."}** Tool output is English and sometimes contains Chinese instructions — that is internal wiring, not a cue to switch languages.
- 2-3 spoken sentences. No markdown, no bullet points, no JSON, no headings — this is read aloud.
- Speak amounts the way a person would ("2.7 million dirhams"). **Never change the magnitude.**
- Lead with the single most useful fact for THIS person, then one concrete next step.

## HONESTY — non-negotiable

- State only numbers a tool actually returned. Never invent a price, yield, project name, school rating, or distance.
- If investment/projection data is **absent** from a tool response, produce no projection. Absence means it failed a sanity check — filling the gap yourself is inventing.
- If a project is sold out, say so before anything else.
- Respect the confidence a tool reports: \`AREA_AMBIGUOUS\` → ask which one, naming the options; \`AREA_NOT_FOUND\` → say you don't have it. **Never substitute a different area.**
- You cannot send, email, or deliver anything, and neither can the voice model. Never offer to.

## NEVER LEAVE THEM WITH ONLY A QUESTION

${forceContent
  ? `**This customer has already been asked to clarify twice in a row. Do NOT ask again.** Pick the most likely reading, say which one you picked in half a sentence, and show them something concrete now.`
  : `If you have to ask which area they meant, or say you don't have something, **show them something real in the same breath** — a comparable area, the transaction data you do have, the closest matching project. A reply that is only a question is a failure.`}

## ABOUT YOURSELF

You are Luna. You do not discuss what model powers you, who built you, your
training data, or your knowledge cutoff. If asked, say you're Luna and move the
conversation back to property in the same sentence.`
}

/**
 * 把工具结果塞回对话。
 *
 * 只回传 `summary` + 精简后的 `result` —— 完整 result 可能几十 KB（项目列表），
 * 全喂回去会把上下文撑爆，而模型写话只需要 summary 里的事实。
 */
function toolResponsePart(name: string, out: { result: unknown; summary: string }) {
  return {
    functionResponse: {
      name,
      response: { summary: out.summary, data: compact(out.result) },
    },
  }
}

/** 裁掉大数组 —— 模型写 2-3 句话用不到 40 个项目的完整字段。 */
function compact(result: unknown): unknown {
  if (Array.isArray(result)) return result.slice(0, 8)
  if (result && typeof result === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
      o[k] = Array.isArray(v) ? v.slice(0, 8) : v
    }
    return o
  }
  return result
}

/**
 * 大脑主入口。**不抛异常** —— 语音链路上任何抛出都会变成一段死寂。
 * 失败一律走降级话术。
 */
export async function askLuna(ask: BrainAsk): Promise<BrainAnswer> {
  const t0 = Date.now()
  const toolsUsed: string[] = []
  const toolLog: BrainAnswer['debug']['toolLog'] = []
  const attachments: BrainAnswer['attachments'] = []
  let mapAction: unknown
  let rounds = 0
  let sawNoAnswer = false

  // 越界短路 —— 没有任何工具能回答「你们有没有二手房」，问下去只会让模型瞎猜。
  // 直接把「没有什么 + 有什么替代」交给模型去组织话术，省一整轮工具调用。
  const scope = checkScope(ask.question)

  try {
    const contents: unknown[] = [{
      role: 'user',
      parts: [{
        text: scope
          ? `The customer asked: "${ask.question}"\n\n` +
            `SCOPE: ${scope.lacks}\nOFFER INSTEAD: ${scope.have_instead}\n\n` +
            `Tell them plainly that we don't have it, then pivot to what we do have — in one breath, not as two separate thoughts. ` +
            `Do not call a tool to look for the thing we don't have.`
          : ask.question + (ask.context ? `\n\n[context: ${ask.context}]` : ''),
      }],
    }]

    const forceContent = (clarifyStreak.get(ask.sessionId || '')?.n ?? 0) >= 2

    let speech = ''
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      rounds = round
      if (Date.now() - t0 > BUDGET_MS) break

      /**
       * **最后一轮不给工具** —— 这一条单独砍掉了 2-3 秒。
       *
       * 之前最后一轮仍然带着工具,于是模型又调了一次工具、还是没写出话,
       * 只能再补一次「成稿」调用 → 一次问答烧 3 次 LLM 往返(实测 7.5s)。
       * 现在:第一轮查,第二轮**只能说话**。实测 ~4s。
       */
      const lastRound = round === MAX_ROUNDS

      const r = await callGemini({
        task: lastRound ? 'luna-brain.finalize' : 'luna-brain',
        models: [FLASH],
        contents,
        config: {
          systemInstruction: systemPrompt(ask.language, forceContent),
          tools: (scope || lastRound) ? undefined : voiceAssistantTools,
          // Gemini 3.x 用 thinkingLevel(不是 2.5 的 thinkingBudget,写错会被静默忽略)。
          // 'low' 而不是 'high' —— 这是延迟敏感场景,每多一秒就是一段死寂。
          thinkingConfig: { thinkingLevel: 'low' },
        },
      })

      const calls = (r.resp as { functionCalls?: Array<{ name: string; args?: unknown }> })?.functionCalls
      if (!calls?.length) { speech = r.text.trim(); break }

      // 模型一轮返回多个 call → 并行。串行执行会把 150ms 变成 600ms。
      const outs = await Promise.all(calls.map(async c => {
        try {
          const out = await executeTool(c.name, c.args || {})
          return { name: c.name, args: c.args, out }
        } catch (e) {
          // 单个工具挂掉不该拖垮整轮 —— 告诉模型它挂了，让它换个说法。
          return {
            name: c.name, args: c.args,
            out: { result: null, summary: `TOOL_ERROR: ${c.name} failed. Do not retry it; answer with what you already have.` },
          }
        }
      }))

      for (const o of outs) {
        toolsUsed.push(o.name)
        toolLog.push({ name: o.name, args: o.args, result: o.out.result, summary: o.out.summary })
        if (NO_ANSWER_MARKERS.test(o.out.summary || '')) sawNoAnswer = true
        const ma = (o.out as { mapAction?: unknown }).mapAction
        if (ma) mapAction = ma
        if (o.out.result) attachments.push({ toolName: o.name, result: o.out.result, params: o.args })
      }

      /**
       * 🔴 **必须回传模型返回的原始 content,不能自己用 functionCall 重建。**
       *
       * Gemini 3.x 开 thinking 时,每个 functionCall part 上挂着一个
       * `thoughtSignature`。把工具结果送回去的时候**必须原样带上**,否则下一轮
       * 直接 400:
       *   "Function call is missing a thought_signature in functionCall parts"
       *
       * 手工 `parts: calls.map(c => ({ functionCall: c }))` 会把签名丢掉 ——
       * 第一版就是这么写的,跑分一跑全红(每条用例都走降级)。
       * 兜底保留重建路径:万一响应结构变了,至少还能跑,只是会退化。
       */
      const modelTurn = (r.resp as { candidates?: Array<{ content?: unknown }> })?.candidates?.[0]?.content
      contents.push(modelTurn ?? { role: 'model', parts: calls.map(c => ({ functionCall: c })) })
      contents.push({ role: 'user', parts: outs.map(o => toolResponsePart(o.name, o.out)) })
    }

    /**
     * 兜底成稿。正常路径**走不到这里** —— 最后一轮已经不给工具了,模型必出话。
     * 只有超时提前 break 时才会落到这里。留着,因为「没有话可说」在语音链路上
     * 等同于掉线。
     */
    if (!speech) {
      const r = await callGemini({
        task: 'luna-brain.finalize',
        models: [FLASH],
        contents: [...contents, { role: 'user', parts: [{ text: 'Now say it out loud, in 2-3 sentences. No more tools.' }] }],
        config: {
          systemInstruction: systemPrompt(ask.language, true),
          thinkingConfig: { thinkingLevel: 'low' },
        },
      })
      speech = r.text.trim()
    }

    // 「纯澄清」= 工具说没答案，而且话术里没带出任何可看的东西。
    const clarifying = sawNoAnswer && !mapAction && attachments.length === 0
    const streak = bumpStreak(ask.sessionId, clarifying)

    const ms = Date.now() - t0
    counter('luna.brain', {
      result: scope ? 'out_of_scope' : clarifying ? 'clarifying' : speech ? 'ok' : 'empty',
    }).inc()
    histogram('luna.brain.ms', {}).observe(ms)
    if (streak >= 2) counter('luna.brain.clarify_streak', {}).inc()

    return {
      speech: speech || fallbackSpeech(ask.language),
      mapAction,
      attachments,
      debug: { toolsUsed, toolLog, rounds, ms, clarifying, degraded: !speech, outOfScope: scope?.id },
    }
  } catch (e) {
    // 语音链路上抛异常 = 一段死寂。永远给一句能说的话。
    counter('luna.brain', { result: 'error' }).inc()
    histogram('luna.brain.ms', {}).observe(Date.now() - t0)
    console.error('[LunaBrain] failed:', e)
    return {
      speech: fallbackSpeech(ask.language),
      attachments,
      debug: { toolsUsed, toolLog, rounds, ms: Date.now() - t0, clarifying: false, degraded: true },
    }
  }
}

/**
 * 降级话术。**不道歉、不解释技术故障** —— 客户不关心我们的后端。
 * 给一个能继续对话的问题，把主动权交回去。
 */
function fallbackSpeech(language?: string): string {
  const zh = language?.startsWith('zh')
  return zh
    ? '这个我得再查一下。你先说说预算和想看的区域，我按这个给你找。'
    : "Let me look into that one. Tell me your budget and the area you have in mind, and I'll pull it up."
}
