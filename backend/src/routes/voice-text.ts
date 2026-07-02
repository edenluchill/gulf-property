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
import { getSystemInstruction } from './voice-token'
import { executeTool } from '../services/voice-assistant-tools'
import { convertToolsForSDK } from '../services/voice-assistant'

const router = Router()

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
    // The voice prompt is written for a live AUDIO session that opens with a
    // greeting — in text mode the model otherwise tends to reply "你好，想了解
    // 什么?" instead of acting. This addendum forces it to DO (call a tool) when
    // the typed request is actionable, and never greet/self-introduce.
    const textAddendum = language === 'zh'
      ? '\n\n【文字模式·重要】现在是文字聊天(不是语音)。用户已直接打字提出需求 —— 请立刻调用对应工具去做(搜房源/飞到区域/分析区域/开项目/测距等),然后用简洁中文说结果。禁止寒暄、禁止自我介绍、禁止反问"您想了解什么"。只有当信息确实不足以调用任何工具时,才追问一句关键信息。'
      : '\n\n[TEXT MODE — IMPORTANT] This is a TEXT chat (not voice). The user already typed a concrete request — immediately call the right tool (search/fly/analyze/open project/measure) and then answer concisely. Do NOT greet, do NOT introduce yourself, do NOT ask "what would you like". Only ask a follow-up if information is genuinely insufficient to call any tool.'
    const systemInstruction = getSystemInstruction(language) + textAddendum

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
        config: { systemInstruction, tools, thinkingConfig: { thinkingBudget: 0 } },
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
