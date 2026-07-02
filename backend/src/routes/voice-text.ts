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
    const systemInstruction = getSystemInstruction(language)

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
