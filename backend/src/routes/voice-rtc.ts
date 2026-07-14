import { counter } from '../telemetry'
/**
 * Agora 应用内语音 REST —— token 签发 + 用量记录。挂在 /api/voice-rtc。
 *
 * 成本护栏全在 services/voiceRtc.ts(单场30min/经纪3h日/全局兜底)。这里只做
 * 薄校验 + 转发。token 仅在房间真实存在(经纪建过)时签发,限制刷 token 的面。
 */
import { Router, Request, Response } from 'express'
import { getRoomByCode } from '../services/collab-rooms'
import pool from '../db/pool'
import { checkCallQuota, VIDEO_UNIT_WEIGHT, CALL_UNITS_PER_CREDIT } from '../luna-tour/credits'
import {
  isVoiceConfigured,
  startVoiceSession,
  getViewerToken,
  heartbeatVoiceSession,
  callHeartbeat,
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
 * 心跳:回填语音时长 + **通话用量实时结算(语音 + 视频)**。
 *
 * ⚠️ **不能** fire-and-forget —— 响应里的 stopVideo/stopCall 是成本刹车:
 * 额度和积分都空了 → 前端必须立即撤视频轨(先砍 4× 单价的视频),
 * 连语音都撑不住就挂断整场。Agora 当场停止计费。
 *
 * participants = 频道内总人数(含经纪)—— 音频按 **user**-分钟计费,不是会话时长。
 */
router.post('/heartbeat', async (req: Request, res: Response) => {
  const { sessionId, participants, videoViewers } = (req.body || {}) as {
    sessionId?: number | string
    participants?: number
    videoViewers?: number
  }
  const sid = Number(sessionId)
  if (!Number.isFinite(sid)) return res.status(400).json({ ok: false })

  // 语音会话时长回填(统计/日额度还在用):best-effort,不阻塞。
  // ⚠️ 但 heartbeat 是**计费刹车的心跳** —— 它悄悄挂掉,通话就会一直烧 Agora 的钱
  // 而额度门永远不触发。必须可见。
  void heartbeatVoiceSession(sid).catch((e) => {
    counter('call.heartbeat.failed').inc()
    console.error('[voice-rtc] heartbeat failed (计费刹车可能失效):', e)
  })

  // 老客户端不发 participants → 退回 204 快路径(不结算,别把老版本算爆)
  if (typeof participants !== 'number') return res.status(204).end()

  try {
    const r = await callHeartbeat(sid, participants, videoViewers ?? 0)
    // 会话已结束/不存在 → 让前端收摊
    if (!r) return res.json({ ok: true, stopVideo: true, stopCall: true, freeLeft: 0, creditBalance: 0 })
    res.json({ ok: true, ...r })
  } catch (err) {
    console.error('[voice-rtc] call heartbeat failed:', err)
    // 结算挂了 → **保守刹车**(先砍视频)。宁可关摄像头,也不能在算不清账时继续烧 Agora。
    res.json({ ok: false, stopVideo: true, stopCall: false, freeLeft: 0, creditBalance: 0 })
  }
})

// 开通话/摄像头前预检(点亮/置灰按钮)。email = 经纪邮箱。
router.get('/call-quota', async (req: Request, res: Response) => {
  const email = String(req.query.email || '').toLowerCase().trim()
  if (!email) return res.status(400).json({ ok: false })
  try {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM lt_agents WHERE lower(email) = $1 LIMIT 1`,
      [email]
    )
    const agentId = a.rows[0]?.id
    if (!agentId) return res.json({ ok: true, exhausted: true, needsUpgrade: true, freeLeft: 0, creditBalance: 0 })
    const q = await checkCallQuota(agentId)
    res.json({
      ok: true, ...q,
      maxViewers: MAX_VIDEO_VIEWERS,
      // 前端把 units 翻译成人话:「剩 N 分钟语音 / M 分钟视频」
      videoUnitWeight: VIDEO_UNIT_WEIGHT,
      unitsPerCredit: CALL_UNITS_PER_CREDIT,
    })
  } catch (err) {
    console.error('[voice-rtc] call-quota failed:', err)
    res.status(500).json({ ok: false })
  }
})

// 结束。best-effort,恒 204。
router.post('/end', (req: Request, res: Response) => {
  const { sessionId, reason } = (req.body || {}) as { sessionId?: number | string; reason?: string }
  res.status(204).end()
  const sid = Number(sessionId)
  // 结束失败 = 这一场不结算(少收费,或者状态一直挂着)。
  if (Number.isFinite(sid)) void endVoiceSession(sid, reason || 'ended').catch((e) => {
    counter('call.settle.failed').inc()
    console.error('[voice-rtc] endVoiceSession failed (这场没结算):', e)
  })
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
