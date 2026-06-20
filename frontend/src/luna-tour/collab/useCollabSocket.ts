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
}

export function useCollabSocket(opts: UseCollabSocketOpts): CollabSocketApi {
  const { code, name, role, enabled = true } = opts
  const clientRef = useRef<CollabClient | null>(null)

  const [connId, setConnId] = useState<string | null>(null)
  const [presenterConnId, setPresenterConnId] = useState<string | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<ChatEntry[]>([])
  const [state, setState] = useState<ConnState>('idle')

  useEffect(() => {
    if (!enabled || !code) return
    const client = new CollabClient({ code, name, role, url: collabWsUrl() })
    clientRef.current = client

    const offState = client.onState(setState)
    const offSync = client.on('sync', (m) => {
      if (m.k !== 'sync') return
      setConnId(m.connId)
      setPresenterConnId(m.state.presenterConnId ?? null)
      setParticipants(m.state.participants ?? [])
      setMessages(m.state.recentChat ?? [])
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
      offSync()
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
    }),
    [connId, presenterConnId, participants, messages, state, send]
  )
}
