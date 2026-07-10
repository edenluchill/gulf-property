/**
 * Luna Collaborative Tour — framework-agnostic connection manager.
 *
 * Owns the `/api/collab` WebSocket: connect, heartbeat, auto-reconnect with
 * exponential backoff, reliable-event de-dupe by `seq`, and `resumeSeq`
 * continuation on reconnect (§5/§6 of the spec). NO React, NO maplibre — a
 * React hook (useCollabSocket) wraps this; tests drive it with a mock socket.
 *
 * ISOLATION: deterministic by injection — pass `wsFactory` (a fake socket) and
 * `now` to test without real timers/sockets. The only ambient deps are
 * setTimeout/clearTimeout (used for backoff + heartbeat).
 */
import {
  isReliable,
  type ClientMsg,
  type HelloMsg,
  type MsgKind,
  type Role,
  type ServerMsg,
} from './protocol'

/** Minimal socket surface — the real `WebSocket` and the test mock both satisfy it. */
export interface CollabSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code?: number; reason?: string }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface CollabClientOpts {
  code: string
  name: string
  role: Role
  url: string
  /** defaults to (url) => new WebSocket(url); inject a fake for tests */
  wsFactory?: (url: string) => CollabSocket
  /** defaults to () => Date.now(); inject for deterministic backoff/heartbeat */
  now?: () => number
  /** self-ping interval ms (0 disables). Spec: 25s to survive Cloudflare 100s idle. */
  heartbeatMs?: number
  /** turn off backoff jitter for deterministic tests */
  jitter?: boolean
}

type MsgHandler = (msg: ServerMsg) => void

const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 10_000

export class CollabClient {
  readonly code: string
  readonly name: string
  readonly role: Role
  readonly url: string

  /** filled once the server `sync` arrives */
  connId: string | null = null
  state: ConnState = 'idle'

  /** highest reliable seq processed — drives de-dupe + resumeSeq */
  private lastSeq = 0
  private ws: CollabSocket | null = null
  private wsFactory: (url: string) => CollabSocket
  private now: () => number
  private heartbeatMs: number
  private jitter: boolean

  private shouldReconnect = true
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  private anyHandlers = new Set<MsgHandler>()
  private kindHandlers = new Map<MsgKind, Set<MsgHandler>>()
  private stateHandlers = new Set<(s: ConnState) => void>()

  /** 终止性关闭原因(不再重连):主持人结束 / 被踢 / 房间不存在(已结束或链接失效)。null = 正常。 */
  terminalReason: 'ended' | 'kicked' | 'not_found' | null = null
  private terminalHandlers = new Set<(r: 'ended' | 'kicked' | 'not_found') => void>()

  constructor(opts: CollabClientOpts) {
    this.code = opts.code
    this.name = opts.name
    this.role = opts.role
    this.url = opts.url
    this.wsFactory = opts.wsFactory ?? ((url) => new WebSocket(url) as unknown as CollabSocket)
    this.now = opts.now ?? (() => Date.now())
    this.heartbeatMs = opts.heartbeatMs ?? 25_000
    this.jitter = opts.jitter ?? true
  }

  /** Last reliable seq processed (also used as resumeSeq on reconnect). */
  get seq(): number {
    return this.lastSeq
  }

  // ── subscriptions ──────────────────────────────────────────────────────
  onMessage(cb: MsgHandler): () => void {
    this.anyHandlers.add(cb)
    return () => this.anyHandlers.delete(cb)
  }
  on(kind: MsgKind, cb: MsgHandler): () => void {
    let set = this.kindHandlers.get(kind)
    if (!set) {
      set = new Set()
      this.kindHandlers.set(kind, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }
  onState(cb: (s: ConnState) => void): () => void {
    this.stateHandlers.add(cb)
    return () => this.stateHandlers.delete(cb)
  }
  /** 订阅终止性关闭(主持人结束/被踢/房间不存在):UI 用它显示「本次带看已结束」。 */
  onTerminal(cb: (r: 'ended' | 'kicked' | 'not_found') => void): () => void {
    this.terminalHandlers.add(cb)
    return () => this.terminalHandlers.delete(cb)
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  connect(): void {
    if (this.ws && (this.state === 'open' || this.state === 'connecting')) return
    this.shouldReconnect = true
    this.openSocket()
  }

  /** Active close — does NOT trigger a reconnect. */
  disconnect(): void {
    this.shouldReconnect = false
    this.clearTimers()
    if (this.ws) {
      try {
        this.ws.close(1000, 'client disconnect')
      } catch {
        /* ignore */
      }
    }
    this.ws = null
    this.setState('closed')
  }

  private openSocket(): void {
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')
    const ws = this.wsFactory(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setState('open')
      // hello carries resumeSeq so the server replays reliable events we missed.
      const hello: HelloMsg = {
        k: 'hello',
        code: this.code,
        name: this.name,
        role: this.role,
        ...(this.lastSeq > 0 ? { resumeSeq: this.lastSeq } : {}),
      }
      this.rawSend(hello)
      this.startHeartbeat()
    }
    ws.onmessage = (ev) => this.handleRaw(ev.data)
    ws.onerror = () => {
      /* surfaced via onclose; nothing reliable to do here */
    }
    ws.onclose = (ev) => {
      this.stopHeartbeat()
      this.ws = null
      if (!this.shouldReconnect || ev?.code === 1000) {
        this.setState('closed')
        return
      }
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    this.setState('reconnecting')
    const attempt = this.reconnectAttempts++
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt))
    // jitter derived from now() (no extra randomness source — keeps tests
    // deterministic when jitter is off; spec forbids ad-hoc Math.random).
    const jit = this.jitter ? (this.now() % 250) : 0
    const delay = base + jit
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  // ── messaging ──────────────────────────────────────────────────────────
  /**
   * Send a message. When not open: high-frequency `cam`/`cur` are silently
   * dropped (next packet supersedes), other messages warn and drop (MVP — no
   * offline queue, see spec §7 hooks).
   */
  send(msg: ClientMsg): void {
    if (this.state !== 'open' || !this.ws) {
      if (msg.k !== 'cam' && msg.k !== 'cur') {
        console.warn('[collab] dropped %s — socket not open', msg.k)
      }
      return
    }
    this.rawSend(msg)
  }

  private rawSend(msg: ClientMsg): void {
    try {
      this.ws?.send(JSON.stringify(msg))
    } catch (e) {
      console.warn('[collab] send failed', e)
    }
  }

  private handleRaw(data: unknown): void {
    let msg: ServerMsg
    try {
      msg = typeof data === 'string' ? JSON.parse(data) : (data as ServerMsg)
    } catch {
      console.warn('[collab] bad frame', data)
      return
    }
    if (!msg || typeof (msg as { k?: unknown }).k !== 'string') return

    // heartbeat: answer pings immediately, swallow pongs.
    if (msg.k === 'ping') {
      this.rawSend({ k: 'pong' })
      return
    }
    if (msg.k === 'pong') return

    // 终止性关闭:主持人结束 / 被踢 / 房间不存在 → 停止自动重连(否则会傻傻重连一个
    // 已不存在的房间)+ 通知 UI 显示「本次带看已结束」。
    if (msg.k === 'ended' || msg.k === 'kicked') {
      this.terminalReason = msg.k === 'kicked' ? 'kicked' : 'ended'
      this.shouldReconnect = false
      this.dispatch(msg)
      this.terminalHandlers.forEach((cb) => cb(this.terminalReason!))
      return
    }
    if (msg.k === 'error' && msg.reason === 'room_not_found') {
      this.terminalReason = 'not_found'
      this.shouldReconnect = false
      this.terminalHandlers.forEach((cb) => cb('not_found'))
      return
    }

    if (msg.k === 'sync') {
      this.connId = msg.connId
      // The snapshot's seq is authoritative — adopt it so subsequent reliable
      // events de-dupe against the resumed baseline.
      if (typeof msg.state?.seq === 'number') this.lastSeq = msg.state.seq
      this.dispatch(msg)
      return
    }

    // reliable, ordered: de-dupe + drop stale/out-of-order older seqs.
    if (isReliable(msg)) {
      if (typeof msg.seq !== 'number' || msg.seq <= this.lastSeq) return
      this.lastSeq = msg.seq
      this.dispatch(msg)
      return
    }

    // cam / cur — unreliable, never affect seq.
    this.dispatch(msg)
  }

  private dispatch(msg: ServerMsg): void {
    this.anyHandlers.forEach((cb) => cb(msg))
    this.kindHandlers.get(msg.k)?.forEach((cb) => cb(msg))
  }

  // ── heartbeat ────────────────────────────────────────────────────────────
  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatMs <= 0) return
    this.heartbeatTimer = setInterval(() => {
      if (this.state === 'open') this.rawSend({ k: 'ping' })
    }, this.heartbeatMs)
  }
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
  private clearTimers(): void {
    this.clearReconnectTimer()
    this.stopHeartbeat()
  }
  private setState(s: ConnState): void {
    if (s === this.state) return
    this.state = s
    this.stateHandlers.forEach((cb) => cb(s))
  }
}
