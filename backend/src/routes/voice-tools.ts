/**
 * Voice Tools API
 *
 * Executes tools called by the AI assistant
 * Frontend calls this when Gemini requests a tool execution
 */

import { Router } from 'express'
import { executeTool } from '../services/voice-assistant-tools'
import { askLuna } from '../services/luna-brain'

const router = Router()

/**
 * POST /api/voice/tools/ask —— **两层架构的接缝**。
 *
 * Live 层（native audio，不会思考）把用户原话丢过来，这里的 Brain
 * （gemini-3.5-flash + thinking）选工具、查数据、**写好最终话术**，
 * Live 只负责念出来。
 *
 * 见 `docs/luna-two-layer-spec.md`。
 *
 * ⚠️ 这个端点**绝不返回 5xx**。Live 层收到错误只会变成一段死寂 ——
 * askLuna 内部已兜底，任何失败都返回一句能说的话。
 */
router.post('/ask', async (req, res) => {
  const { question, language, sessionId, context } = req.body || {}
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question is required' })
  }

  const answer = await askLuna({ question, language, sessionId, context })

  console.log(
    `[LunaBrain] "${question.slice(0, 60)}" → ${answer.debug.ms}ms, ` +
    `tools=[${answer.debug.toolsUsed.join(',')}]` +
    (answer.debug.outOfScope ? ` scope=${answer.debug.outOfScope}` : '') +
    (answer.debug.degraded ? ' DEGRADED' : '')
  )

  const { toolLog, ...lightDebug } = answer.debug   // toolLog 只给跑分,别塞进每次语音往返

  res.json({
    success: true,
    speech: answer.speech,
    mapAction: answer.mapAction,
    attachments: answer.attachments,
    debug: lightDebug,
  })
})

/**
 * POST /api/voice/tools/execute
 * Execute a tool and return the result
 */
router.post('/execute', async (req, res) => {
  try {
    const { toolName, params } = req.body

    if (!toolName) {
      return res.status(400).json({ error: 'toolName is required' })
    }

    console.log(`[Voice Tools] Executing: ${toolName}`, params)

    const { result, summary, mapAction } = await executeTool(toolName, params || {})

    res.json({
      success: true,
      result,
      summary,
      mapAction
    })
  } catch (error) {
    console.error('[Voice Tools] Error:', error)
    res.status(500).json({
      success: false,
      error: 'Tool execution failed'
    })
  }
})

export default router
