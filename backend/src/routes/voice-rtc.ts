/**
 * Agora 应用内语音 REST —— token 签发 + 用量记录。挂在 /api/voice-rtc。
 *
 * 成本护栏全在 services/voiceRtc.ts(单场30min/经纪3h日/全局兜底)。这里只做
 * 薄校验 + 转发。token 仅在房间真实存在(经纪建过)时签发,限制刷 token 的面。
 */
import { Router, Request, Response } from 'express'
import { getRoomByCode } from '../services/collab-rooms'
import {
  isVoiceConfigured,
  startVoiceSession,
  getViewerToken,
  heartbeatVoiceSession,
  endVoiceSession,
  getAgentUsage,
} from '../services/voiceRtc'

const router = Router()

// 经纪发起语音:校验房间存在 + 当日额度 → 签 token(TTL=允许时长)
router.post('/start', async (req: Request, res: Response) => {
  const { roomCode, agentEmail } = (req.body || {}) as { roomCode?: string; agentEmail?: string }
  if (!roomCode || !getRoomByCode(roomCode)) {
    return res.status(404).json({ ok: false, reason: 'room_not_found' })
  }
  try {
    const r = await startVoiceSession(agentEmail || 'unknown', roomCode)
    if (!r.ok) {
      const code = r.reason === 'not_configured' ? 503 : 429
      return res.status(code).json(r)
    }
    res.json(r)
  } catch (err) {
    console.error('[voice-rtc] start failed:', err)
    res.status(500).json({ ok: false, reason: 'error' })
  }
})

// 客户申请语音 token:仅当该房间有进行中的语音场
router.post('/viewer-token', async (req: Request, res: Response) => {
  const { roomCode } = (req.body || {}) as { roomCode?: string }
  if (!roomCode) return res.status(400).json({ ok: false, reason: 'bad_request' })
  try {
    const r = await getViewerToken(roomCode)
    if (!r.ok) return res.status(r.reason === 'not_configured' ? 503 : 409).json(r)
    res.json(r)
  } catch (err) {
    console.error('[voice-rtc] viewer-token failed:', err)
    res.status(500).json({ ok: false, reason: 'error' })
  }
})

// 心跳(回填时长,崩溃也记到最近一次)。best-effort,恒 204。
router.post('/heartbeat', (req: Request, res: Response) => {
  const { sessionId } = (req.body || {}) as { sessionId?: number }
  res.status(204).end()
  if (typeof sessionId === 'number') void heartbeatVoiceSession(sessionId).catch(() => {})
})

// 结束。best-effort,恒 204。
router.post('/end', (req: Request, res: Response) => {
  const { sessionId, reason } = (req.body || {}) as { sessionId?: number; reason?: string }
  res.status(204).end()
  if (typeof sessionId === 'number') void endVoiceSession(sessionId, reason || 'ended').catch(() => {})
})

// 经纪当日用量(给经纪端显示剩余)
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const usage = await getAgentUsage(String(req.query.email || 'unknown'))
    res.json({ ok: true, ...usage })
  } catch {
    res.status(500).json({ ok: false })
  }
})

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', configured: isVoiceConfigured() })
})

export default router
