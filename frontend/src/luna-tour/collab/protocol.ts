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
  /**
   * Presenter's map viewport size (css px). Viewers use it to COMPENSATE zoom so
   * they see at least everything the presenter sees.
   *
   * Why: visible geographic width ∝ viewportWidth / 2^zoom. At the same zoom an
   * iPad (1180px) shows ~3× the area a phone (390px) does — the presenter says
   * "look at this whole community" and the client only has the middle third on
   * screen. Agents present on iPads, clients watch on phones, so this is the
   * common case, not an edge case.
   *
   * Optional: older clients omit it → viewers fall back to no compensation.
   */
  vw?: number
  vh?: number
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
  /** normalized cursor 0..1 (relative to the presenter's map container) — fallback
   *  when geo-anchoring isn't available (pointer off the map). */
  x: number
  y: number
  /** geographic anchor — the lng/lat under the presenter's pointer. Viewers
   *  re-project this every frame so the cursor sits on the SAME building on any
   *  screen size/aspect (Figma-style), not a mismatched normalized position. */
  lng?: number
  lat?: number
  /** true on a tap / pointerdown — viewers spawn a ripple at the anchor. Lets a
   *  phone presenter (no hover) still show clients "what I'm tapping". */
  tap?: boolean
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
  /** presenter viewport size — same zoom-compensation story as Cam.vw/vh */
  vw?: number
  vh?: number
}
export interface SelectMsg {
  k: 'select'
  seq: number
  kind: SelectKind
  id: string
  /** project detail active tab — lets viewers follow the presenter's tab.
   *  empty id = close/deselect. */
  tab?: string
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
  selected?: { kind: SelectKind; id: string; tab?: string }
  participants: Participant[]
  recentChat: ChatEntry[]
  /**
   * Drawings already on the map (server-materialized from the __collab_draw
   * add/erase/clear op stream). Without this a client who joins mid-tour sees a
   * clean map while the agent is saying "look at the block I circled" — and
   * clients joining late is the norm, not an edge case.
   *
   * Shape is `Mark` from useCollabDraw; typed loose here to keep the protocol
   * free of a dependency on the draw layer (ISOLATION: delete collab/ and this
   * field just goes unused).
   */
  marks?: unknown[]
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
/** presenter 结束整场带看(server 删房,旧链接立即失效) / 踢人。 */
export interface EndMsg { k: 'end'; seq: number }
export interface KickMsg { k: 'kick'; seq: number; connId: string }
/** server → 客户:带看已被主持人结束 / 你被踢出 / 房间不存在(已结束或链接失效)。 */
export interface EndedMsg { k: 'ended' }
export interface KickedMsg { k: 'kicked' }
export interface ErrorMsg { k: 'error'; reason: string }

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
  | EndedMsg
  | KickedMsg
  | ErrorMsg

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
  | EndMsg
  | KickMsg

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
