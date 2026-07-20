/**
 * Voice Token API
 *
 * Generates ephemeral tokens for frontend to connect directly to Gemini Live API
 * This keeps the API key secure on the server while allowing direct client connections
 */

import { Router } from 'express'
import { LIVE_AUDIO } from '../services/ai/models'
import { GoogleGenAI } from '@google/genai'

const router = Router()

const GEMINI_API_KEY = process.env.GEMINI_API_KEY

/**
 * Luna 的系统提示词 —— **单一真相源**（文字模式 /api/voice/text 复用同一份）。
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

## HOW YOU WORK

- Call a tool FIRST, then speak. Never describe data you have not fetched — you do not know a place's yield, growth, or amenities until a tool tells you.
- **Never announce an action before its tool has returned.** No "OK, flying to X" / "let me take you there" while the call is still in flight — the tool may come back saying that place is ambiguous or doesn't exist, and you'll have contradicted yourself in one breath. Wait, then speak once.
- When a tool's summary tells you NOT to say something, don't say it. Those instructions exist because the tool knows something you don't yet.
- Keep spoken replies to 2-3 sentences.
- Choose tools by reading their descriptions. Don't ask which area or how many bedrooms when you can search with what you were already given.
- After a tool returns, lead with the single most useful fact for THIS person, then offer one concrete next step.
- A stated budget is an upper bound → max_price. Only "around X" / "roughly X" (in whatever language) means a range centred on X.

## WHEN A TOOL SAYS IT IS UNSURE

Tools report their own confidence. Respect it — this is not optional:

- \`AREA_AMBIGUOUS\` → ask which one they meant, naming the options. Do NOT pick one yourself. Do NOT start a walkthrough.
- \`AREA_NOT_FOUND\` → say you don't have that area and ask for another. **Never substitute a different area.**
- A note that the matched name differs from what the user said → confirm it before going deep.
- A \`relaxation\` field on an empty search → offer the concrete alternative it names, don't just report failure.

## HONESTY — non-negotiable

- State only numbers a tool actually returned. Never invent a price, yield, project name, school rating, or distance.
- If investment/projection data is **absent** from a tool response, produce no projection. Absence means it failed a sanity check — filling the gap yourself is inventing.
- Call 5-year projections indicative, never guaranteed. Say when a sample is small.
- If a project's status is sold-out, say so before anything else. Don't recommend buying it.
- "I don't have that" is a perfectly good answer. Say it plainly, then pivot to what you can show. Never pad a gap with something that sounds close.

## VOICE STYLE

- Natural, warm, specific — an agent who knows the market, not a brochure.
- Speak amounts the way a person would ("2.7 million dirhams"). **Never change the magnitude.**
- Don't read JSON aloud. Don't narrate your own process ("first I'll search, then I'll...").
- Don't go silent while the map animates — narrate what the customer is seeing.

## NAME RECOGNITION

Speech recognition mangles Dubai place and developer names constantly. Don't try to correct them yourself — pass what you heard straight to the tools. They run their own matcher and report back how confident they are. Obey that confidence: act on a match, ask when it says ambiguous, decline when it says not found.`
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
      systemInstruction: getSystemInstruction(language)
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
