/**
 * Collab 应用内语音(Agora)—— 经纪↔客户双向通话,带成本护栏。
 *
 * 成本护栏(服务端硬 enforce,这里只是客户端配合):
 *   • token TTL = 服务端给的 allowed/remaining 秒 → 过期 Agora 自动断
 *   • 客户端额外跑倒计时,到点主动 leave('limit')
 *   • presenter 每 30s 心跳回填用量(崩溃也记到最近一次)
 *
 * Agora SDK 动态 import —— 只在真正开语音时才加载那个大 chunk(守 bundle)。
 * ISOLATION: 纯客户端;删 collab 目录即移除。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IAgoraRTCClient, IMicrophoneAudioTrack, IAgoraRTCRemoteUser } from 'agora-rtc-sdk-ng'
import { API_BASE_URL } from '../../lib/config'

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'limit' | 'unavailable' | 'no_session' | 'error'

export interface UseCollabVoiceOpts {
  mode: 'browse' | 'presenter' | 'viewer'
  roomCode?: string
  agentEmail?: string
}

export interface CollabVoiceApi {
  status: VoiceStatus
  muted: boolean
  /** countdown to the session cap (seconds); 0 when idle */
  remainingSeconds: number
  /** presenter: start a call (mints session + token); viewer: join the active call */
  connect: () => void
  leave: () => void
  toggleMute: () => void
}

const BASE = `${API_BASE_URL}/api/voice-rtc`

export function useCollabVoice({ mode, roomCode, agentEmail }: UseCollabVoiceOpts): CollabVoiceApi {
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)

  const clientRef = useRef<IAgoraRTCClient | null>(null)
  const micRef = useRef<IMicrophoneAudioTrack | null>(null)
  const sessionIdRef = useRef<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const leavingRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null }
  }, [])

  const teardown = useCallback(async (reason: string, nextStatus: VoiceStatus) => {
    if (leavingRef.current) return
    leavingRef.current = true
    clearTimers()
    const sid = sessionIdRef.current
    try { micRef.current?.stop(); micRef.current?.close() } catch { /* ignore */ }
    try { await clientRef.current?.leave() } catch { /* ignore */ }
    micRef.current = null
    clientRef.current = null
    // presenter owns the DB session row → finalize it
    if (mode === 'presenter' && sid != null) {
      navigator.sendBeacon?.(`${BASE}/end`, new Blob([JSON.stringify({ sessionId: sid, reason })], { type: 'application/json' }))
    }
    sessionIdRef.current = null
    setMuted(false)
    setRemainingSeconds(0)
    setStatus(nextStatus)
    leavingRef.current = false
  }, [mode, clearTimers])

  const leave = useCallback(() => { void teardown('left', 'idle') }, [teardown])

  const connect = useCallback(async () => {
    if (mode === 'browse' || !roomCode) return
    if (clientRef.current || status === 'connecting') return
    setStatus('connecting')

    // 1) get a token from the server (enforces all the limits)
    let data: any
    try {
      const path = mode === 'presenter' ? '/start' : '/viewer-token'
      const body = mode === 'presenter' ? { roomCode, agentEmail } : { roomCode }
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        if (res.status === 429) return setStatus('limit')
        if (res.status === 503) return setStatus('unavailable')
        if (res.status === 409) return setStatus('no_session')
        return setStatus('error')
      }
    } catch {
      return setStatus('error')
    }

    const ttl: number = data.allowedSeconds ?? data.remainingSeconds ?? 0
    sessionIdRef.current = data.sessionId ?? null

    // 2) join the Agora channel + publish mic (SDK loaded on demand)
    try {
      const AgoraRTC = (await import('agora-rtc-sdk-ng')).default
      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      clientRef.current = client

      client.on('user-published', async (user: IAgoraRTCRemoteUser, mediaType) => {
        if (mediaType !== 'audio') return
        try {
          await client.subscribe(user, mediaType)
          user.audioTrack?.play()
        } catch { /* ignore */ }
      })

      await client.join(data.appId, data.channel, data.token, null)
      const mic = await AgoraRTC.createMicrophoneAudioTrack()
      micRef.current = mic
      await client.publish([mic])
    } catch (err) {
      console.error('[collab-voice] join failed', err)
      return void teardown('error', 'error')
    }

    setMuted(false)
    setStatus('live')

    // 3) countdown to the cap; hard-leave at 0
    setRemainingSeconds(ttl)
    countdownRef.current = setInterval(() => {
      setRemainingSeconds((s) => {
        if (s <= 1) { void teardown('limit', 'limit'); return 0 }
        return s - 1
      })
    }, 1000)

    // 4) presenter heartbeat (crash-safe usage accounting)
    if (mode === 'presenter') {
      heartbeatRef.current = setInterval(() => {
        const sid = sessionIdRef.current
        if (sid != null) {
          fetch(`${BASE}/heartbeat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sid }),
          }).catch(() => {})
        }
      }, 30_000)
    }
  }, [mode, roomCode, agentEmail, status, teardown])

  const toggleMute = useCallback(() => {
    const mic = micRef.current
    if (!mic) return
    const next = !muted
    void mic.setMuted(next)
    setMuted(next)
  }, [muted])

  // leave on unmount / when the collab session ends (mode → browse)
  useEffect(() => {
    if (mode === 'browse' && clientRef.current) void teardown('left', 'idle')
  }, [mode, teardown])
  useEffect(() => () => { void teardown('left', 'idle') }, [teardown])

  return { status, muted, remainingSeconds, connect, leave, toggleMute }
}
