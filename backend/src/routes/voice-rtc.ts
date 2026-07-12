/**
 * Agora 应用内语音 REST —— token 签发 + 用量记录。挂在 /api/voice-rtc。
 *
 * 成本护栏全在 services/voiceRtc.ts(单场30min/经纪3h日/全局兜底)。这里只做
 * 薄校验 + 转发。token 仅在房间真实存在(经纪建过)时签发,限制刷 token 的面。
 */
import { Router, Request, Response } from 'express'
import { getRoomByCode } from '../services/collab-rooms'
import pool from '../db/pool'
import { checkVideoQuota } from '../luna-tour/credits'
import {
  isVoiceConfigured,
  startVoiceSession,
  getViewerToken,
  heartbeatVoiceSession,
  videoHeartbeat,
  endVoiceSession,
  getAgentUsage,
  MAX_VIDEO_VIEWERS,
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

/**
 * 心跳:回填语音时长 + **视频用量实时结算**。
 *
 * ⚠️ 带 videoViewers 时**不能** fire-and-forget —— 响应里的 stopVideo 是成本刹车:
 * 免费额度和积分都空了 → 前端必须立即 unpublish 视频轨(Agora 当场停止计费)。
 * 不带 videoViewers(没开摄像头)时维持原来的 204 快路径。
 */
router.post('/heartbeat', async (req: Request, res: Response) => {
  const { sessionId, videoViewers } = (req.body || {}) as {
    sessionId?: number | string
    videoViewers?: number
  }
  const sid = Number(sessionId)
  if (!Number.isFinite(sid)) return res.status(400).json({ ok: false })

  // 语音时长回填:best-effort,不阻塞
  void heartbeatVoiceSession(sid).catch(() => {})

  // 没开摄像头 → 老快路径
  if (typeof videoViewers !== 'number') return res.status(204).end()

  try {
    const r = await videoHeartbeat(sid, videoViewers)
    // 会话已结束/不存在 → 让前端关掉摄像头
    if (!r) return res.json({ ok: true, stopVideo: true, freeLeft: 0, creditBalance: 0 })
    res.json({ ok: true, ...r })
  } catch (err) {
    console.error('[voice-rtc] video heartbeat failed:', err)
    // 结算挂了 → **保守刹车**。宁可关掉摄像头,也不能在算不清账的情况下继续烧 Agora。
    res.json({ ok: false, stopVideo: true, freeLeft: 0, creditBalance: 0 })
  }
})

// 开摄像头前预检(点亮/置灰按钮)。email = 经纪邮箱。
router.get('/video-quota', async (req: Request, res: Response) => {
  const email = String(req.query.email || '').toLowerCase().trim()
  if (!email) return res.status(400).json({ ok: false })
  try {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM lt_agents WHERE lower(email) = $1 LIMIT 1`,
      [email]
    )
    const agentId = a.rows[0]?.id
    if (!agentId) return res.json({ ok: true, exhausted: true, needsUpgrade: true, freeLeft: 0, creditBalance: 0 })
    const q = await checkVideoQuota(agentId)
    res.json({ ok: true, ...q, maxViewers: MAX_VIDEO_VIEWERS })
  } catch (err) {
    console.error('[voice-rtc] video-quota failed:', err)
    res.status(500).json({ ok: false })
  }
})

// 结束。best-effort,恒 204。
router.post('/end', (req: Request, res: Response) => {
  const { sessionId, reason } = (req.body || {}) as { sessionId?: number | string; reason?: string }
  res.status(204).end()
  const sid = Number(sessionId)
  if (Number.isFinite(sid)) void endVoiceSession(sid, reason || 'ended').catch(() => {})
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
