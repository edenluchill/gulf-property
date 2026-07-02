/**
 * Voice Text-Mode Agent API
 *
 * Text path for Luna (方案 B): typed input, NO audio. Completely separate from the
 * Gemini Live voice pipeline — the key stays server-side here. Reuses the EXACT same
 * system prompt (getSystemInstruction) + tool declarations (voiceAssistantTools) +
 * executor (executeTool) as voice, so typing "does" everything voice does (fly map,
 * open project, measure, project/area cards, investment chart).
 *
 * best-effort: any failure returns a friendly Chinese message, never a 500 — the UX
 * must never dead-end. Billing/quota deliberately NOT wired yet (voice is the primary
 * paid path); see docs/luna-text-mode-plan-2026-07-01.md.
 */

import { Router } from 'express'
import { GoogleGenAI } from '@google/genai'
import { executeTool } from '../services/voice-assistant-tools'
import { convertToolsForSDK } from '../services/voice-assistant'

const router = Router()

/** Lean, tool-first system prompt for TEXT mode (greet-free). Kept separate from
 *  the voice prompt on purpose (see the call site). */
function buildTextPrompt(language: string): string {
  const glossary =
    '伊曼/艾玛→Emaar、达马克/迪马克→DAMAC、纳克希尔→Nakheel、索巴/哈特兰→Sobha、迈拉斯→Meraas、宾加提→Binghatti、多瑙河→Danube；' +
    '马瑞纳/码头→Dubai Marina、市中心→Downtown Dubai、朱美拉村/JVC→JVC、商业湾→Business Bay、迪拜山庄→Dubai Hills Estate、' +
    '棕榈岛→Palm Jumeirah、达马克山→DAMAC Hills、阿拉伯牧场→Arabian Ranches、富尔詹→Al Furjan、金融中心→DIFC、美丹→Meydan、国际城→International City'
  if (language === 'zh') {
    return `你是 Luna,迪拜期房 App 的 AI 助手。这是文字聊天。
用户已经打字提出需求 —— 你的任务是【立刻调用一个工具去做】,然后(下一轮)用简洁中文说明结果。
严禁:寒暄、自我介绍、反问"您想了解什么"。直接做。

选工具(按用户意图):
- "X有什么房/找房/推荐/N居/预算200万" → search_projects(area 或 max_price 等)
- "带我去X/看看X区/X在哪" → fly_to_area(area_name)
- "X投资回报/值不值/ROI/收益/帮我分析这个区" → area_investment_report(area)
- "X生活方便吗/配套/离医院学校地铁多远" → analyze_area_amenities(area_name)
- "X万预算能买哪" → recommend_by_budget
- "对比A和B" → compare_areas
- "A到B多远" → measure_distance
- 提到具体项目名 → navigate_to_project / open_project_detail

名称模糊音映射(把口音写法映射到真实实体,没把握就选最接近的): ${glossary}。

若搜索返回 0 条,不要冷场 —— 说明并推荐 1-2 个符合条件的邻近区域。
回答简洁,只讲买家关心的:户型、面积、价格、回报。`
  }
  return `You are Luna, an AI assistant for a Dubai off-plan property app. This is a TEXT chat.
The user already typed a request — your job is to IMMEDIATELY call one tool to do it, then (next turn) summarize the result concisely in English.
NEVER greet, introduce yourself, or ask "what would you like". Just act.

Tool routing (by intent):
- "what's in X / find homes / N-bed / budget 2M" → search_projects
- "take me to X / show X area / where is X" → fly_to_area(area_name)
- "X investment return / is it worth it / ROI / analyze this area" → area_investment_report(area)
- "is X convenient / amenities / how far to hospital/school/metro" → analyze_area_amenities(area_name)
- "what can I buy with 2M" → recommend_by_budget
- "compare A and B" → compare_areas
- "how far from A to B" → measure_distance
- a specific project by name → navigate_to_project / open_project_detail

Name glossary (map fuzzy renderings to real entities): ${glossary}.

If a search returns 0 results, don't dead-end — mention it and suggest 1-2 nearby areas that fit.
Keep answers concise: bedrooms, size, price, yield.`
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
// gemini-3-flash 404s on our current API access — 2.5-flash is the working fast
// model with function-calling (verified). Keep 3-flash as a future bump.
const MODEL = 'gemini-2.5-flash'
const MAX_TOOL_ROUNDS = 6

interface IncomingMessage { role?: string; text?: string }
interface AgentStep { name: string; result: unknown; mapAction?: unknown }

/**
 * POST /api/voice/text
 * Body: { messages: [{role:'user'|'model', text}], text, language }
 * Returns: { reply: string, steps: [{ name, result, mapAction }] }
 */
router.post('/text', async (req, res) => {
  const language = req.body?.language === 'zh' ? 'zh' : (req.body?.language || 'en')
  const failReply = language === 'zh'
    ? '刚刚有点忙不过来，麻烦再说一次？'
    : 'Something went wrong on my side — please try again.'

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.json({ reply: failReply, steps: [] })
    }

    const text: string = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const history: IncomingMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : []

    // Build the conversation for Gemini: prior turns + the new user message.
    const contents: any[] = []
    for (const m of history) {
      if (!m || typeof m.text !== 'string' || !m.text.trim()) continue
      contents.push({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })
    }
    if (text) contents.push({ role: 'user', parts: [{ text }] })

    if (!contents.length) {
      return res.json({ reply: language === 'zh' ? '想了解点什么？' : 'What can I help you with?', steps: [] })
    }

    const tools = [{ functionDeclarations: convertToolsForSDK() }]
    // Dedicated LEAN text prompt — NOT the voice prompt. The voice prompt is written
    // for a live audio session (opens with a greeting, literally says "emit
    // present_place this turn"), which both makes the model greet instead of act AND
    // biases tool selection. This tool-first prompt + round-0 forced call makes text
    // mode reliably DO the right thing.
    const systemInstruction = buildTextPrompt(language)

    const steps: AgentStep[] = []
    let reply = ''

    // Agent loop: model → tool calls → executeTool → feed results back → repeat.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents,
        // thinkingBudget:0 is REQUIRED — with thinking on, 2.5-flash swallows the
        // turn (finishReason STOP, empty parts, no functionCall) when tools are
        // attached. Disabling it makes tool-calling reliable.
        // Round 0: force a tool call (mode ANY) so the model can't fall back to a
        // "你好，想了解什么?" greeting for a question like "X有什么房" — the voice
        // prompt's opening/greeting behavior otherwise leaks into text mode. Later
        // rounds use AUTO so it can produce the final text answer after tools run.
        config: {
          systemInstruction,
          tools,
          thinkingConfig: { thinkingBudget: 0 },
        },
      })

      const modelContent = resp.candidates?.[0]?.content
      const functionCalls = resp.functionCalls || []

      // Record the model turn (incl. any functionCall parts) before we answer them.
      if (modelContent) contents.push(modelContent)

      if (!functionCalls.length) {
        reply = (resp.text ?? '').trim()
        break
      }

      const responseParts: any[] = []
      for (const fc of functionCalls) {
        if (!fc.name) continue
        try {
          const { result, summary, mapAction } = await executeTool(fc.name, fc.args || {})
          steps.push({ name: fc.name, result, mapAction })
          responseParts.push({
            functionResponse: { name: fc.name, response: { output: summary, result } },
          })
        } catch (toolErr) {
          console.error(`[Voice Text] tool ${fc.name} failed:`, toolErr)
          responseParts.push({
            functionResponse: { name: fc.name, response: { output: 'Tool execution failed.' } },
          })
        }
      }
      contents.push({ role: 'user', parts: responseParts })
    }

    if (!reply) {
      reply = language === 'zh'
        ? '我已经在地图上帮你处理好了，还想了解什么？'
        : "I've updated the map for you — anything else you'd like to see?"
    }

    res.json({ reply, steps })
  } catch (error) {
    console.error('[Voice Text] Error:', error)
    res.json({ reply: failReply, steps: [] })
  }
})

export default router
