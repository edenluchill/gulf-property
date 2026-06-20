/**
 * Luna Collaborative Tour — wire protocol (types + constants).
 *
 * The single source of truth for the `/api/collab` WebSocket message shapes.
 * Field names mirror the BACKEND exactly (it ships first, see
 * docs/luna-collaborative-tour-spec.md §5) — short keys to save bandwidth, top
 * level discriminated on `k`.
 *
 * ISOLATION: pure types + one URL helper. No React, no maplibre. Delete the
 * luna-tour/collab directory to remove the whole co-presence layer.
 */
import { API_BASE_URL } from '../../lib/config'

export type LngLat = [number, number]
export type Role = 'presenter' | 'viewer'

/** A camera snapshot — the high-frequency, lossy stream the presenter samples
 *  ~20Hz and viewers interpolate locally. `t` = sender clock (ms). */
export interface Cam {
  t: number
  c: LngLat
  z: number
  b: number
  p: number
  /** set on the final frame when the camera goes still, so viewers stop the rAF */
  idle?: boolean
}

export interface Participant {
  connId: string
  name: string
  role: Role
}

export interface ChatEntry {
  from: string
  name: string
  text: string
}

export type SelectKind = 'project' | 'area'

// ── ① high-frequency · unreliable (no seq) ────────────────────────────────
export interface CamMsg extends Cam {
  k: 'cam'
}
export interface CurMsg {
  k: 'cur'
  /** normalized cursor 0..1 */
  x: number
  y: number
}

// ── ② reliable · ordered (server stamps `seq`, client de-dupes) ────────────
export interface GotoMsg {
  k: 'goto'
  seq: number
  c: LngLat
  z: number
  b: number
  p: number
  label?: string
}
export interface SelectMsg {
  k: 'select'
  seq: number
  kind: SelectKind
  id: string
}
export interface ChatMsg {
  k: 'chat'
  seq: number
  from: string
  name: string
  text: string
}
export interface MapActionMsg {
  k: 'mapAction'
  seq: number
  /** Luna tool output, broadcast verbatim — shape owned by the voice tools */
  action: unknown
}
export interface RoleMsg {
  k: 'role'
  seq: number
  presenter: string
}
export interface JoinMsg {
  k: 'join'
  seq: number
  who: Participant
}
export interface LeaveMsg {
  k: 'leave'
  seq: number
  connId: string
}

// ── control ────────────────────────────────────────────────────────────────
export interface HelloMsg {
  k: 'hello'
  code: string
  name: string
  role: Role
  /** last reliable seq the client has processed — server replays seq > this */
  resumeSeq?: number
}

/** Full snapshot the server replies with after `hello`. */
export interface CollabState {
  presenterConnId: string
  lastCam?: Cam
  selected?: { kind: SelectKind; id: string }
  participants: Participant[]
  recentChat: ChatEntry[]
  seq: number
}
export interface SyncMsg {
  k: 'sync'
  connId: string
  state: CollabState
}
export interface PingMsg {
  k: 'ping'
}
export interface PongMsg {
  k: 'pong'
}

/** Anything the server may push to the client. */
export type ServerMsg =
  | CamMsg
  | CurMsg
  | GotoMsg
  | SelectMsg
  | ChatMsg
  | MapActionMsg
  | RoleMsg
  | JoinMsg
  | LeaveMsg
  | SyncMsg
  | PingMsg
  | PongMsg

/** Anything the client may send. */
export type ClientMsg =
  | HelloMsg
  | CamMsg
  | CurMsg
  | GotoMsg
  | SelectMsg
  | ChatMsg
  | MapActionMsg
  | RoleMsg
  | PingMsg
  | PongMsg

export type AnyMsg = ServerMsg | ClientMsg
export type MsgKind = AnyMsg['k']

/** The reliable, ordered message kinds — all carry a monotone `seq`. */
export const RELIABLE_KINDS = new Set<MsgKind>([
  'goto',
  'select',
  'chat',
  'mapAction',
  'role',
  'join',
  'leave',
])

export function isReliable(msg: { k: MsgKind }): msg is ServerMsg & { seq: number } {
  return RELIABLE_KINDS.has(msg.k)
}

/**
 * Derive the collab WebSocket URL from the configured API base: http→ws,
 * https→wss, then append `/api/collab`. Falls back to the page protocol when
 * API_BASE_URL is protocol-relative.
 */
export function collabWsUrl(apiBase: string = API_BASE_URL): string {
  let base = apiBase
  if (base.startsWith('https://')) base = 'wss://' + base.slice('https://'.length)
  else if (base.startsWith('http://')) base = 'ws://' + base.slice('http://'.length)
  else if (base.startsWith('//')) base = 'ws:' + base
  return base.replace(/\/+$/, '') + '/api/collab'
}
