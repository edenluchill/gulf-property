import { runAudit } from '../quality'
import { LUNA_RULES, type LunaSession } from '../quality/luna-rules'
import { counter } from '../telemetry'
/**
 * Behaviour event collection — public ingest endpoint.
 *
 * Mounted at /api/events. Fully decoupled telemetry: responds 204 immediately
 * and persists fire-and-forget, so a slow/erroring DB can never surface to the
 * client. Frontend batches events (frontend/src/lib/track.ts) and posts an
 * events[] array; optionalAuth attaches user_email/user_id when logged in.
 *
 * Delete this file + its mount line + frontend track.ts to remove the feature.
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { optionalAuth } from '../middleware/auth'
import { ingestEvents, hashIp } from '../services/eventIngest'
import { summarizeLunaSession, hasSummarizableContent } from '../services/lunaSummary'

const router = Router()

router.post('/', optionalAuth, (req: Request, res: Response) => {
  // Respond immediately; persistence is best-effort. Client ignores the body.
  res.status(204).end()

  const body = (req.body || {}) as Record<string, unknown>
  // Accept either { events: [...] } (batch) or a single event object.
  const rawEvents = Array.isArray(body.events) ? body.events : [body]

  counter('events.received').inc(rawEvents.length)
  void ingestEvents(rawEvents, {
    userEmail: req.user?.email ?? null,
    userId: req.user?.id ?? null,
    ua: (req.headers['user-agent'] as string || '').slice(0, 300) || null,
    ipHash: hashIp(req),
  }).catch((err) => {
    // 行为采集是**所有客户分析的地基**(dashboard/漏斗/lead 引擎全靠它)。
    // 它悄悄挂掉 = 数据静静地少了一块,而所有报表照样正常显示 —— 最难发现的那种坏。
    counter('events.ingest.failed').inc()
    console.error('[events] ingest failed (ignored):', err instanceof Error ? err.message : err)
  })
})

/**
 * POST /voice-session — persist a finished Luna conversation.
 * Body: { session: SessionLog, visitor_id }. Stores the full transcript as
 * JSONB + a few scalar columns for the dashboard. Best-effort; never blocks the
 * client. optionalAuth attaches user_email/user_id when logged in.
 */
router.post('/voice-session', optionalAuth, (req: Request, res: Response) => {
  res.status(204).end()

  const b = (req.body || {}) as Record<string, unknown>
  const session = (b.session || {}) as Record<string, any>
  const sessionId = typeof session.sessionId === 'string' ? session.sessionId : null
  if (!sessionId) return

  const visitorId = typeof b.visitor_id === 'string' ? b.visitor_id.slice(0, 128) : null
  const messages = Array.isArray(session.messages) ? session.messages : []
  const toolCalls = Array.isArray(session.toolCalls) ? session.toolCalls : []
  const errors = Array.isArray(session.errors) ? session.errors : []
  const startedAt = typeof session.startTime === 'number' ? new Date(session.startTime) : null
  const endedAt = typeof session.endTime === 'number' ? new Date(session.endTime) : null
  const durationMs = typeof session.duration === 'number' ? Math.round(session.duration) : null

  // Cap transcript size to keep one runaway session from bloating a row.
  let transcript = '{}'
  try {
    const s = JSON.stringify(session)
    transcript = s.length <= 1_000_000 ? s : JSON.stringify({ sessionId, truncated: true })
  } catch { /* keep '{}' */ }

  /**
   * 对话质检 —— 一场对话的质量不是「有没有报错」,是**客户问的东西 Luna 答上了没有**。
   * 规则从真实 transcript 里找行为痕迹(客户重复提问 = 第一次没答上;工具返回空 =
   * 她拿不到数据只能瞎聊)。落 quality_samples 带 session_id,**可回溯到原对话**。
   */
  void runAudit('luna_session', sessionId, session as LunaSession, LUNA_RULES, {
    turns: messages.length,
    toolCalls: toolCalls.length,
    durationMs: durationMs ?? 0,
  }).catch((e) => console.error('[quality] luna audit failed:', e))

  void pool
    .query(
      /**
       * 冲突有两种来源:同一场重复上报,或 **`luna-session-rebuild` 已经从
       * `luna_turns` 把它补过了**。两种都让浏览器这份赢 —— 它带着真实
       * metrics / 错误列表 / 打断次数,比重建的富。`source` 一并改回
       * 'beacon',否则看板上会一直显示成「补录的」。
       */
      `INSERT INTO luna_sessions
         (session_id, visitor_id, user_email, user_id, started_at, ended_at,
          duration_ms, turn_count, tool_call_count, had_error, transcript, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'beacon')
       ON CONFLICT (session_id) DO UPDATE SET
         ended_at = EXCLUDED.ended_at,
         duration_ms = EXCLUDED.duration_ms,
         turn_count = EXCLUDED.turn_count,
         tool_call_count = EXCLUDED.tool_call_count,
         had_error = EXCLUDED.had_error,
         transcript = EXCLUDED.transcript,
         source = 'beacon'`,
      [
        sessionId,
        visitorId,
        req.user?.email ?? null,
        req.user?.id ?? null,
        startedAt,
        endedAt,
        durationMs,
        messages.length,
        toolCalls.length,
        errors.length > 0,
        transcript,
      ]
    )
    .then(() => {
      // Fire-and-forget AI summary so each new session lands with a readable
      // Chinese synopsis (the raw voice transcript is barely legible). Best-effort.
      if (!hasSummarizableContent(session as any)) return
      return summarizeLunaSession(session as any).then((summary) => {
        if (!summary) return
        return pool.query(
          `UPDATE luna_sessions SET summary = $1, summary_at = now() WHERE session_id = $2`,
          [summary, sessionId]
        )
      })
    })
    .catch((err) => {
      console.error('[events] voice-session persist failed (ignored):', err instanceof Error ? err.message : err)
    })
})

/**
 * POST /identify — link a visitor_id to the logged-in email and backfill.
 * Body: { visitor_id }. The email/user_id are taken from the verified token
 * (never the body), then ALL of this visitor's events (past + future) are
 * stamped with it — so the dashboard can show the real person behind an
 * anonymous browsing history once they log in. Best-effort; never blocks.
 */
router.post('/identify', optionalAuth, (req: Request, res: Response) => {
  res.status(204).end()

  const email = req.user?.email ?? null
  const userId = req.user?.id ?? null
  if (!email) return // not logged in → nothing to link

  const b = (req.body || {}) as Record<string, unknown>
  const visitorId = typeof b.visitor_id === 'string' ? b.visitor_id.slice(0, 128) : null
  if (!visitorId) return

  void pool
    .query(
      `UPDATE app_events
          SET user_email = $1, user_id = COALESCE($2, user_id)
        WHERE visitor_id = $3
          AND (user_email IS DISTINCT FROM $1)`,
      [email, userId, visitorId]
    )
    .catch((err) => {
      console.error('[events] identify backfill failed (ignored):', err instanceof Error ? err.message : err)
    })
})

export default router
