/**
 * Voice Tools API
 *
 * Executes tools called by the AI assistant
 * Frontend calls this when Gemini requests a tool execution
 */

import { Router } from 'express'
import { executeTool } from '../services/voice-assistant-tools'
import { askLuna, startAsk, awaitAsk } from '../services/luna-brain'
import { logTurn } from '../services/luna-turn-log'

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

  /**
   * 🔴 **两段式默认关闭 —— 它在真实语音链路上会把客户挂断。**
   *
   * 设计是:秒回过渡句让 Luna 立刻开口,正文由 Live 再调 `ask_luna_more` 取。
   * Tier2(文字注入)里试了几次都成功,我就信了。**生产埋点打脸**:
   *
   *     luna.brain.two_stage{stage:start} = 8
   *     luna.brain.two_stage{stage:resume} = 4      ← 一半没走完
   *
   * 没走完 = 客户听到「好，我看一下」然后**永远的沉默**。owner 的原话是
   * 「一开始跟他说话得等一分钟它才开口」—— 那不是慢,那是坏了。
   *
   * 根因跟「说了 filler 就不调工具」是同一个病:**2.5 native audio 说完一句话
   * 之后会不会接着调工具,是不可靠的**。前端 bundle 里 `ask_luna_more` 声明
   * 明明在(已核验线上 bundle),它就是不调。
   *
   * 教训:**几次成功不等于可靠。** 一个「失败就等于挂断客户」的机制,
   * 不能建立在模型自觉上。
   *
   * 想重开先解决「不依赖模型自觉」:由前端在拿到 pending 后主动去取正文,
   * 再 `sendClientContent` 塞回给 Live 念 —— 那条路不靠它记得调工具。
   * 在那之前 `LUNA_TWO_STAGE=1` 只用于开发环境验证。
   */
  if (process.env.LUNA_TWO_STAGE === '1') {
    const staged = startAsk({ question, language, sessionId, context })
    if (staged.pending) {
      console.log(`[LunaBrain] "${question.slice(0, 60)}" → staged, filler out`)
      return res.json({ success: true, speech: staged.speech, pending: true, attachments: [] })
    }
  }

  const answer = await askLuna({ question, language, sessionId, context })

  console.log(
    `[LunaBrain] "${question.slice(0, 60)}" → ${answer.debug.ms}ms, ` +
    `tools=[${answer.debug.toolsUsed.join(',')}]` +
    (answer.debug.outOfScope ? ` scope=${answer.debug.outOfScope}` : '') +
    (answer.debug.degraded ? ' DEGRADED' : '')
  )

  const { toolLog, ...lightDebug } = answer.debug   // toolLog 只给跑分,别塞进每次语音往返

  // 逐轮落库 —— 会话级的 luna_sessions 只在 endSession 时上报,用户直接关页面
  // 就永远看不到。出了问题要能查「他问了什么、Luna 答了什么」。
  logTurn({
    sessionId, visitorId: req.body?.visitorId, source: 'brain',
    question, speech: answer.speech, tools: answer.debug.toolsUsed,
    ms: answer.debug.ms, askedBrain: true,
    degraded: answer.debug.degraded, outOfScope: answer.debug.outOfScope,
    clarifying: answer.debug.clarifying,
  })

  res.json({
    success: true,
    speech: answer.speech,
    mapAction: answer.mapAction,
    attachments: answer.attachments,
    debug: lightDebug,
  })
})

/**
 * POST /api/voice/tools/turn —— 前端每轮结束上报 Luna **实际说了什么**。
 *
 * 🔴 **这是唯一能看见「Live 层没问 Brain 就自己编」的地方。**
 * 服务端只知道被问过的轮次；Luna 绕过 Brain 直接开口时后端毫无察觉,
 * 而所有护栏(数据边界/诚实规则/澄清出路)都在 Brain 里 —— 绕过 = 裸奔。
 * owner 报的「AI 说自己能卖二手房」就是这么来的(Brain 的回答实测是对的)。
 *
 * 不等 `endSession` 上报,因为那个太容易丢(关标签页/会话还开着)。
 */
router.post('/turn', (req, res) => {
  const { sessionId, visitorId, speech, askedBrain, tools, ms } = req.body || {}
  logTurn({
    sessionId, visitorId, source: 'live',
    speech, tools, ms, askedBrain: !!askedBrain,
  })
  res.status(204).end()
})

/**
 * POST /api/voice/tools/ask-more —— 两段式的第二段。
 *
 * 客户此刻已经听完了过渡句，**这里不能静默、不能报错、不能 4xx** ——
 * 那等于当着他的面把电话挂了。`awaitAsk` 保证永远有一句能说的话，
 * 连「没有在途请求」（Live 层跳过第一段直接调这里）也有兜底。
 */
router.post('/ask-more', async (req, res) => {
  const { sessionId, language } = req.body || {}
  const answer = await awaitAsk(sessionId, language)

  console.log(
    `[LunaBrain] resume → ${answer.debug.ms}ms, tools=[${answer.debug.toolsUsed.join(',')}]` +
    (answer.debug.outOfScope ? ` scope=${answer.debug.outOfScope}` : '') +
    (answer.debug.degraded ? ' DEGRADED' : '')
  )

  const { toolLog, ...lightDebug } = answer.debug

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
