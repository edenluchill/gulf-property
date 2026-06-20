/**
 * Luna Collaborative Tour — single integration hook for the host page (MapPage).
 *
 * Composes the three core hooks (socket / presenter sampler / viewer follow) and
 * exposes exactly what the page needs: connection + room UI state, the follow
 * state machine, and senders for select / chat / goto / mapAction. The page
 * passes `getMap` (the live maplibre instance) and `flyTo` (from
 * createMapTourHandle); the camera is driven imperatively inside the core hooks —
 * NEVER through React state (performance hard rule).
 *
 * Disabled (mode 'browse') → no socket, no sampler, no follow loop, zero effect.
 * This is what keeps the normal browse path a strict no-op.
 *
 * ISOLATION: glue only. Delete the collab directory to remove the feature.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useCollabSocket } from './useCollabSocket'
import { useCollabPresenter } from './useCollabPresenter'
import { useCollabFollow, type FlyToArgs, type FollowMode } from './useCollabFollow'
import { chatMessage, selectMessage } from './collab-actions'
import type { Participant, ChatEntry, SelectKind, ServerMsg } from './protocol'
import type { ConnState } from './CollabClient'

export type CollabMode = 'browse' | 'presenter' | 'viewer'

export interface UseCollabOpts {
  mode: CollabMode
  code: string | undefined
  name: string
  getMap: () => MaplibreMap | null | undefined
  /** from createMapTourHandle — cinematic flyTo for `goto` events */
  flyTo: (args: FlyToArgs) => void
  /** remote select → page highlights / flies to the project/area.
   *  empty id = deselect/close; `tab` = project detail tab to follow. */
  onRemoteSelect?: (kind: SelectKind, id: string, tab?: string) => void
  /** remote Luna tool output → page runs its existing voice mapAction path */
  onRemoteMapAction?: (action: unknown) => void
}

export interface CollabApi {
  active: boolean
  state: ConnState
  connId: string | null
  presenterConnId: string | null
  participants: Participant[]
  messages: ChatEntry[]
  /** viewer follow state ('following' | 'free'); presenter is always undefined */
  followMode: FollowMode | undefined
  setFree: () => void
  returnToPresenter: () => void
  /** presenter helpers (no-op when not presenter / not connected) */
  sendSelect: (kind: SelectKind, id: string, tab?: string) => void
  sendChat: (text: string) => void
  sendMapAction: (action: unknown) => void
}

export function useCollab(opts: UseCollabOpts): CollabApi {
  const { mode, code, name, getMap, flyTo, onRemoteSelect, onRemoteMapAction } = opts
  const active = mode !== 'browse'
  const role = mode === 'presenter' ? 'presenter' : 'viewer'

  const socket = useCollabSocket({ code: code ?? '', name, role, enabled: active && !!code })

  // presenter samples + broadcasts its camera; viewers pass active=false.
  useCollabPresenter({ getMap, client: socket.client, active: active && mode === 'presenter' })

  const follow = useCollabFollow({
    getMap,
    client: mode === 'viewer' ? socket.client : null,
    flyTo,
  })

  // remote reliable events the page reacts to (select / mapAction). Subscribed on
  // BOTH roles so a multi-party room stays consistent; the page handlers are
  // expected to be idempotent (fly/highlight).
  useEffect(() => {
    const c = socket.client
    if (!c || !active) return
    const handle = (m: ServerMsg) => {
      if (m.k === 'select') onRemoteSelect?.(m.kind, m.id, m.tab)
      else if (m.k === 'mapAction') onRemoteMapAction?.(m.action)
    }
    const offSel = c.on('select', handle)
    const offAct = c.on('mapAction', handle)
    return () => {
      offSel()
      offAct()
    }
  }, [socket.client, active, onRemoteSelect, onRemoteMapAction])

  const sendSelect = useCallback(
    (kind: SelectKind, id: string, tab?: string) => {
      if (mode === 'presenter') socket.send(selectMessage(kind, id, tab))
    },
    [mode, socket]
  )

  // The server fans reliable events out to OTHERS only (never echoes to the
  // sender), so we optimistically echo our own chat locally. No dedupe needed —
  // these never come back over the wire.
  const [ownChat, setOwnChat] = useState<ChatEntry[]>([])
  const sendChat = useCallback(
    (text: string) => {
      const from = socket.connId ?? ''
      socket.send(chatMessage(from, name, text))
      setOwnChat((prev) => [...prev, { from, name, text }])
    },
    [socket, name]
  )

  // merge received + own, preserving send order well enough for a chat list.
  const messages = useMemo(
    () => [...socket.messages, ...ownChat],
    [socket.messages, ownChat]
  )

  const sendMapAction = useCallback(
    (action: unknown) => {
      if (mode === 'presenter') socket.send({ k: 'mapAction', seq: 0, action })
    },
    [mode, socket]
  )

  return useMemo(
    () => ({
      active,
      state: socket.state,
      connId: socket.connId,
      presenterConnId: socket.presenterConnId,
      participants: socket.participants,
      messages,
      followMode: mode === 'viewer' ? follow.mode : undefined,
      setFree: follow.setFree,
      returnToPresenter: follow.returnToPresenter,
      sendSelect,
      sendChat,
      sendMapAction,
    }),
    [
      active,
      mode,
      socket.state,
      socket.connId,
      socket.presenterConnId,
      socket.participants,
      messages,
      follow.mode,
      follow.setFree,
      follow.returnToPresenter,
      sendSelect,
      sendChat,
      sendMapAction,
    ]
  )
}
