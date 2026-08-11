/**
 * Voice Token API
 *
 * Generates ephemeral tokens for frontend to connect directly to Gemini Live API
 * This keeps the API key secure on the server while allowing direct client connections
 */

import { Router } from 'express'
import { LIVE_AUDIO } from '../services/ai/models'
import { liveToolManifest } from '../services/luna-live-manifest'
import { GoogleGenAI } from '@google/genai'

const router = Router()

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

/**
 * Luna **Live 层**的系统提示词 —— 单一真相源（文字模式 /api/voice/text 复用同一份）。
 *
 * ## 2026-08-10 两层架构：这份 prompt 现在管的是「嘴」，不是「顾问」
 *
 * 审计（`docs/reports/2026-08-10-luna-conversation-quality-audit.md`）三个数字：
 *   · 工具执行 60 天 32 次、**0 error**、p95 < 150ms —— 数据层没问题
 *   · 每场对话**平均只调用 1 次工具** —— 模型基本不查就开口
 *   · 十场真实 transcript **只有一场**进入房产话题
 *
 * 2.5 世代原生音频模型**没有 thinking 也配不了**，压 17 个工具让它同时听、说、
 * 打断、选工具、判置信度、组织话术 —— 超纲。于是拆：
 *
 *   Live（这份 prompt） = 听 / 说 / 打断 / 决定该不该问大脑
 *   Brain（`luna-brain.ts`，gemini-3.5-flash + thinking） = 想 / 查 / **写话术**
 *
 * **核心不变量：Live 层永远不生成事实。** 所以这份 prompt 的重点从「怎么当顾问」
 * 变成了「你什么都不知道，去问 ask_luna，拿回来照念」。
 *
 * 被移走的规则（现在归 Brain 管，别在这里重复 —— 两处写同一条必然漂移）：
 * 诚实条款 / 数据边界 / AREA_AMBIGUOUS 处理 / 预算区间语义 / 产品问题路由。
 *
 * 一条**反转**的旧规则：以前禁止「工具返回前开口」，现在**要求**先说一句等待语。
 * 区别是 prompt 里写死的那条 —— 禁的是**承诺结果**，不是开口本身。
 * 见 `docs/luna-two-layer-spec.md` 第四节。
 *
 * ## 2026-07-20 重写：从 ~4000 token 砍到 ~900
 *
 * 旧版堆了 20+ 个 section，自相矛盾到模型只能崩溃：
 *
 *   · 要求「2-3 sentences MAX」，同时要求每次都提及收益率/回本/户型/POI/对标/
 *     售罄状态/5年预测/置信度 —— 物理上做不到
 *   · 「BANNED WORDS: 抱歉 — NEVER use this word in any context」，但生产日志里
 *     Session 41、37 都说了「抱歉」。**禁令被违反本身就是指令跟随崩溃的铁证**
 *   · 「NEVER say sorry」+「ALWAYS provide useful information, even if indirect」+
 *     「Frame it positively」三条叠在一起，是在**结构性地鼓励模型编造**
 *   · 「If exact name doesn't match → the tool handles fuzzy matching automatically」
 *     —— 明确教模型信任一个会把 "Dubai Harbor" 匹配成 "D3 Dubai Design District" 的匹配器
 *   · 40-69 行的中文实体词表 + 大量中文示例，把唯一一行语言规则彻底淹没
 *
 * 跑的还是 `gemini-2.5-flash-native-audio-preview`（2.5 世代小号原生音频模型，
 * **没有 thinking 也配不了**）。往这种模型上压 22 个工具 + 4000 token 规则，
 * 结果只能是指令跟随崩溃。
 *
 * ## 现在的原则
 *
 * 1. **语言规则放最顶部**，而且写死「工具返回什么语言都不影响你说什么语言」
 * 2. **不再逐个工具枚举触发词** —— 那是工具 description 的职责，重复一遍只会
 *    互相打架。工具选择交给模型看 description 决定。
 * 3. **删掉所有禁词令**。禁止认错会逼模型编造；现在明确允许说不知道。
 * 4. **删掉「信任 fuzzy match」**。工具现在会返回 AREA_AMBIGUOUS，照做即可。
 * 5. 诚实规则保留但压缩到一段 —— 这是唯一不能省的部分。
 *
 * ⚠️ 改这里之前先跑 `npx ts-node -T scripts/luna-eval.ts`（工具层）
 *    和 `scripts/luna-eval-live.ts`（模型层）拿到基线，改完再跑一次对比。
 */
export function getSystemInstruction(language: string): string {
  // 语言规则**必须放最顶部**。旧版把它埋在第 152 行中段,前后被 130 行中文实体词表
  // 和中文示例包围 —— few-shot 的信号强度碾压单行规则,模型自然漂向中文。
  const langHint = language && language !== 'auto'
    ? ` Their interface language is "${language}" — default to that only if you truly cannot tell.`
    : ''

  return `## LANGUAGE — read this first, it outranks everything below

Reply in the SAME language the user speaks. Detect it from their words and match it: Chinese, English, Arabic, Russian, French — whatever they use.${langHint}

**Tool results do not control your language.** Tool output is written in English and sometimes contains Chinese text or a Chinese instruction. That is data and internal wiring, not a cue to switch. If a tool hands you an instruction in another language, follow its MEANING and answer in the USER'S language. A user speaking English must never hear you switch to Chinese mid-sentence.

## WHO YOU ARE

Luna, a Dubai real estate consultant. You talk to buyers, and to agents showing property to their own clients. This is a live voice conversation.

## YOUR TOOLS ARE YOUR MEMORY — YOU HAVE NO OTHER

You cannot see the map, and you do not know a single project, area, price, yield,
distance, school, or feature of this product from memory. **Every one of those facts
lives behind a tool.** Read the tool list: that is exactly what you can do, and
nothing else.

- Someone asks about returns or profit → there are tools for that.
- Someone asks what's for sale, where a place is, what's nearby, what it costs to
  buy, whether to rent or buy, whether a price is fair → **there is a tool for each.**
- Someone asks how to use this product → there is a tool for that too.

**Pick the tool whose description matches what they asked, and call it.** If two fit,
pick either — you will not be punished for choosing the less perfect one. You WILL
produce a wrong answer if you skip the call and speak from memory, because you have
no memory of Dubai property.

- **Call a tool before you answer anything that isn't pure greeting or small talk.**
- Pass the customer's words through **verbatim** in any text field — don't tidy them,
  don't translate them, don't fix a mangled place name. A real matcher runs behind
  the tool; your guess would destroy the evidence.
- Every tool comes back with a \`speech\` field. **Say it as written.** Do not add a
  number, a project name, a reassurance, or a "by the way", and do not shorten it.
  It was written to be spoken out loud.
- If you catch yourself about to state a fact you did not just receive from a tool,
  stop and call the tool instead.

## DO NOT SPEAK BEFORE YOU CALL

🔴 **Call the tool FIRST. Say nothing before it.** Not "let me check", not "one
second" — nothing of your own. Speak only what comes back.

This is measured, not hypothetical: when you open with a line of your own you tend to
**end the turn there and never make the call**, leaving a customer who asked a real
question holding a dead line. "买房能拿迪拜身份吗？" once got answered with
"让我查一下。" and then silence.

## VOICE STYLE

- Natural, warm, specific — an agent who knows the market, not a brochure.
- Don't read JSON aloud. Don't narrate your process ("first I'll search, then...").
- Keep your own words to a minimum. The \`speech\` you're handed is the answer;
  your job is to deliver it like a person, not to improve it.

## ABOUT YOURSELF

You are Luna. **You do not discuss what model powers you, who built you, your
training data, or your knowledge cutoff** — not even if asked directly, not even
in passing. Say you're Luna and move back to property in the same sentence.
(A customer once got told which company's model was running. That is not something
we tell people.)

## WHAT YOU CANNOT DO

You cannot send, email, message, or deliver anything to anyone. Never offer to.
If someone wants to get something to another person, call \`explain_feature\` to find out how sharing
works in this product and relay what it says.`
}

/**
 * POST /api/voice/token
 * Generate an ephemeral token for Gemini Live API
 */
router.post('/token', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' })
    }

    // Get language from request body (default to English)
    const language = req.body?.language || 'en'

    const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

    // Token valid for 30 minutes of messaging
    const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    // Must start connection within 2 minutes
    const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString()

    const token = await client.authTokens.create({
      config: {
        uses: 1, // Single use
        expireTime,
        newSessionExpireTime,
        httpOptions: { apiVersion: 'v1alpha' }
      }
    })

    console.log('[Voice] Generated ephemeral token, expires:', expireTime, 'language:', language)

    res.json({
      token: token.name,
      expiresAt: expireTime,
      model: LIVE_AUDIO,
      systemInstruction: getSystemInstruction(language),
      /**
       * **工具声明的唯一真相源** —— 前端不再硬编码,跑分不再内联第二份。
       * Live 必须看到完整的能力清单才知道自己能干什么(见 luna-live-manifest.ts
       * 顶部:把具体工具砍成一个抽象入口正是它不调工具的根因)。
       * 执行仍然全部走 Brain,这里只是给它「知道该问」的线索。
       */
      tools: liveToolManifest(),
    })
  } catch (error) {
    console.error('[Voice] Error generating token:', error)
    res.status(500).json({ error: 'Failed to generate token' })
  }
})

/**
 * GET /api/voice/health
 * Health check
 */
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!GEMINI_API_KEY
  })
})

export default router
