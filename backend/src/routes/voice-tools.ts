/**
 * Voice Tools API
 *
 * Executes tools called by the AI assistant
 * Frontend calls this when Gemini requests a tool execution
 */

import { Router } from 'express'
import { executeTool } from '../services/voice-assistant-tools'

const router = Router()

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
