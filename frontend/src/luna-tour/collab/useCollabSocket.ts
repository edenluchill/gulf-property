/**
 * Luna Collaborative Tour — thin React wrapper over CollabClient.
 *
 * Owns the client's connect/disconnect lifecycle and mirrors the room's
 * reliable state (participants / connId / presenter / chat) into React state for
 * the UI. The high-frequency cam/cur stream is NOT surfaced here — those drive
 * the map imperatively (useCollabFollow) to keep camera frames out of React
 * (performance hard rule: zero per-frame re-render).
 *
 * ISOLATION: all logic lives in CollabClient; this is glue only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CollabClient, type ConnState } from './CollabClient'
import { collabWsUrl, type ChatEntry, type ClientMsg, type Participant, type Role } from './protocol'
import { mark, measureFrom, reportFunnelStep, netLabel } from '../../lib/telemetry'

export interface UseCollabSocketOpts {
  code: string
  name: string
  role: Role
  /** when false, the hook does not connect (e.g. user not in a session yet) */
  enabled?: boolean
}

export interface CollabSocketApi {
  connId: string | null
  presenterConnId: string | null
  participants: Participant[]
  messages: ChatEntry[]
  state: ConnState
  /** the live client — pass to useCollabPresenter / useCollabFollow */
  client: CollabClient | null
  send: (msg: ClientMsg) => void
  /** 终止性关闭原因(主持人结束/被踢/房间不存在)→ 页面显示「本次带看已结束」。null=正常。 */
  endedReason: 'ended' | 'kicked' | 'not_found' | null
}

export function useCollabSocket(opts: UseCollabSocketOpts): CollabSocketApi {
  const { code, name, role, enabled = true } = opts
  const clientRef = useRef<CollabClient | null>(null)

  const [connId, setConnId] = useState<string | null>(null)
  const [presenterConnId, setPresenterConnId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [state, setState] = useState<ConnState>('idle')
  const [endedReason, setEndedReason] = useState<'ended' | 'kicked' | 'not_found' | null>(null)

  useEffect(() => {
    if (!enabled || !code) return
    setEndedReason(null) // 新会话:清掉上一场的结束态
    const client = new CollabClient({ code, name, role, url: collabWsUrl() })
    clientRef.current = client

    // ── RUM:客户真实的进房体验 ────────────────────────────────────────
    // 2026-07-13「半分钟延迟」的真凶在客户端(首屏 + 4.8MB 卫星瓦片),而我们当时
    // 对真实客户的设备一无所知,只能拿 playwright 模拟。埋在这一处 → 所有调用方覆盖。
    // 只测 viewer:presenter 是经纪自己,他不是我们要研究的那个"等得不耐烦的人"。
    const isViewer = role === 'viewer'
    const net = netLabel()
    if (isViewer) mark('collab.enter')      // 计时起点 = 客户点了「进入带看」

    const offState = client.onState((s) => {
      setState(s)
      if (isViewer && s === 'open') {
        measureFrom('collab.enter', 'rum.collab.ws_open.ms', { net })
        reportFunnelStep('collab.join', 'ws_connect')
      }
    })
    const offTerminal = client.onTerminal(setEndedReason)
    const offSync = client.on('sync', (m) => {
      if (m.k !== 'sync') return
      if (isViewer) reportFunnelStep('collab.join', 'sync')
      setConnId(m.connId)
      setPresenterConnId(m.state.presenterConnId ?? null)
      setParticipants(m.state.participants ?? [])
      setMessages(m.state.recentChat ?? [])
    })

    // 第一帧相机 = 客户的画面**真正开始跟随经纪**的那一刻(实测 4G 1.2s)。
    // 这是「点了进入之后到底等了多久」最诚实的数字。
    let gotFirstCam = false
    const offFirstCam = client.on('cam', () => {
      if (!isViewer || gotFirstCam) return
      gotFirstCam = true
      measureFrom('collab.enter', 'rum.collab.ttfc.ms', { net })
      reportFunnelStep('collab.join', 'first_cam')
    })
    const offJoin = client.on('join', (m) => {
      if (m.k !== 'join') return
      setParticipants((prev) =>
        prev.some((p) => p.connId === m.who.connId) ? prev : [...prev, m.who]
      )
    })
    const offLeave = client.on('leave', (m) => {
      if (m.k !== 'leave') return
      setParticipants((prev) => prev.filter((p) => p.connId !== m.connId))
    })
    const offChat = client.on('chat', (m) => {
      if (m.k !== 'chat') return
      setMessages((prev) => [...prev, { from: m.from, name: m.name, text: m.text }])
    })
    const offRole = client.on('role', (m) => {
      if (m.k !== 'role') return
      setPresenterConnId(m.presenter)
    })

    client.connect()
    return () => {
      offState()
      offTerminal()
      offSync()
      offFirstCam()
      offJoin()
      offLeave()
      offChat()
      offRole()
      client.disconnect()
      clientRef.current = null
    }
  }, [code, name, role, enabled])

  const send = useCallback((msg: ClientMsg) => clientRef.current?.send(msg), [])

  return useMemo(
    () => ({
      connId,
      presenterConnId,
      participants,
      messages,
      state,
      client: clientRef.current,
      send,
      endedReason,
    }),
    [connId, presenterConnId, participants, messages, state, send, endedReason]
  )
}
