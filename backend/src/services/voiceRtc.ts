/**
 * Agora 应用内语音 —— RTC token 签发 + 用量额度(成本护栏)。
 *
 * 额度全部在这里硬 enforce:单场 ≤30min(token TTL)、每经纪 ≤3h/日、全局每日兜底。
 * token TTL 是最硬的成本天花板:过期客户端必断,Agora 不再计费。
 *
 * 配置(env):
 *   AGORA_APP_ID / AGORA_APP_CERTIFICATE   —— 必填,缺则语音整体停用(503)
 *   AGORA_AGENT_DAILY_SECONDS  默认 10800(3h)   每经纪每日上限
 *   AGORA_GLOBAL_DAILY_SECONDS 默认 21600(6h)   全局每日兜底(防伪造身份刷)
 *   AGORA_SESSION_MAX_SECONDS  默认 1800(30min)  单场上限
 */
import { RtcTokenBuilder, RtcRole } from 'agora-token'
import pool from '../db/pool'

const APP_ID = process.env.AGORA_APP_ID || ''
const APP_CERT = process.env.AGORA_APP_CERTIFICATE || ''

const SESSION_MAX = Math.max(60, Number(process.env.AGORA_SESSION_MAX_SECONDS) || 30 * 60)
const AGENT_DAILY = Math.max(60, Number(process.env.AGORA_AGENT_DAILY_SECONDS) || 3 * 60 * 60)
const GLOBAL_DAILY = Math.max(60, Number(process.env.AGORA_GLOBAL_DAILY_SECONDS) || 6 * 60 * 60)
const MIN_GRANT = 30 // 剩余不足 30s 就别开了

export function isVoiceConfigured(): boolean {
  return !!APP_ID && !!APP_CERT
}

export const appId = APP_ID

/** 构造一个 channel 的 RTC token(uid=0 通配,publisher),TTL 秒。 */
function buildToken(channel: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const expire = now + ttlSeconds
  // uid 0 = 通配,任意客户端 uid 可用此 token 加入该 channel
  return RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channel, 0, RtcRole.PUBLISHER, expire, expire)
}

async function sumSeconds(where: string, params: any[]): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(duration_seconds), 0)::int AS s
       FROM voice_sessions
      WHERE started_at >= date_trunc('day', now()) AND ${where}`,
    params
  )
  return rows[0]?.s ?? 0
}

export interface StartResult {
  ok: boolean
  reason?: 'not_configured' | 'agent_daily_limit' | 'global_daily_limit'
  appId?: string
  channel?: string
  token?: string
  sessionId?: number
  allowedSeconds?: number
  agentRemainingSeconds?: number
}

/**
 * 经纪发起语音:校验当日额度 → 建 session 行 → 签 token(TTL=允许时长)。
 */
export async function startVoiceSession(agentEmail: string, roomCode: string): Promise<StartResult> {
  if (!isVoiceConfigured()) return { ok: false, reason: 'not_configured' }

  const email = (agentEmail || '').toLowerCase().trim() || 'unknown'
  const [agentUsed, globalUsed] = await Promise.all([
    sumSeconds('lower(agent_email) = $1', [email]),
    sumSeconds('TRUE', []),
  ])

  const agentRemaining = AGENT_DAILY - agentUsed
  const globalRemaining = GLOBAL_DAILY - globalUsed
  if (agentRemaining < MIN_GRANT) return { ok: false, reason: 'agent_daily_limit', agentRemainingSeconds: Math.max(0, agentRemaining) }
  if (globalRemaining < MIN_GRANT) return { ok: false, reason: 'global_daily_limit' }

  const allowed = Math.min(SESSION_MAX, agentRemaining, globalRemaining)

  const { rows } = await pool.query(
    `INSERT INTO voice_sessions (agent_email, room_code, allowed_seconds)
     VALUES ($1, $2, $3) RETURNING id`,
    [email, roomCode, allowed]
  )
  const sessionId = rows[0].id as number

  return {
    ok: true,
    appId: APP_ID,
    channel: roomCode,
    token: buildToken(roomCode, allowed),
    sessionId,
    allowedSeconds: allowed,
    agentRemainingSeconds: agentRemaining,
  }
}

export interface ViewerTokenResult {
  ok: boolean
  reason?: 'not_configured' | 'no_active_session'
  appId?: string
  channel?: string
  token?: string
  remainingSeconds?: number
}

/**
 * 客户(viewer)申请语音 token:仅当该房间有「仍在进行」的语音场时签发,
 * TTL = 该场剩余时长。不消耗经纪额度(同一场已计)。
 */
export async function getViewerToken(roomCode: string): Promise<ViewerTokenResult> {
  if (!isVoiceConfigured()) return { ok: false, reason: 'not_configured' }

  const { rows } = await pool.query(
    `SELECT allowed_seconds,
            GREATEST(0, allowed_seconds - EXTRACT(EPOCH FROM (now() - started_at)))::int AS remaining
       FROM voice_sessions
      WHERE room_code = $1 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [roomCode]
  )
  const remaining = rows[0]?.remaining ?? 0
  if (!rows[0] || remaining < MIN_GRANT) return { ok: false, reason: 'no_active_session' }

  return {
    ok: true,
    appId: APP_ID,
    channel: roomCode,
    token: buildToken(roomCode, remaining),
    remainingSeconds: remaining,
  }
}

/** 心跳:回填实际时长(封顶 allowed),崩溃也能记到最近一次。 */
export async function heartbeatVoiceSession(sessionId: number): Promise<void> {
  await pool.query(
    `UPDATE voice_sessions
        SET duration_seconds = LEAST(allowed_seconds, EXTRACT(EPOCH FROM (now() - started_at))::int)
      WHERE id = $1 AND ended_at IS NULL`,
    [sessionId]
  )
}

/** 结束:回填最终时长 + ended_at + 原因。 */
export async function endVoiceSession(sessionId: number, reason: string): Promise<void> {
  await pool.query(
    `UPDATE voice_sessions
        SET ended_at = now(),
            duration_seconds = LEAST(allowed_seconds, EXTRACT(EPOCH FROM (now() - started_at))::int),
            ended_reason = $2
      WHERE id = $1 AND ended_at IS NULL`,
    [sessionId, (reason || 'ended').slice(0, 32)]
  )
}

/** 经纪当日已用 / 剩余(给前端显示)。 */
export async function getAgentUsage(agentEmail: string): Promise<{ usedSeconds: number; remainingSeconds: number; dailyLimit: number }> {
  const email = (agentEmail || '').toLowerCase().trim() || 'unknown'
  const used = await sumSeconds('lower(agent_email) = $1', [email])
  return { usedSeconds: used, remainingSeconds: Math.max(0, AGENT_DAILY - used), dailyLimit: AGENT_DAILY }
}
