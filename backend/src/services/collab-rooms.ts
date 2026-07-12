/**
 * Collab Rooms — 内存房间管理(实时协作带看)
 *
 * 纯逻辑层:房间 / 参与者 / seq / ring / 扇出。
 * 单进程内存即可(spec §6)。不碰 DB、不依赖 express。
 * 未来水平扩展才需 Redis pub/sub —— 不提前做。
 */

import type { WebSocket } from 'ws'

export type Role = 'presenter' | 'viewer'

export interface Participant {
  connId: string
  ws: WebSocket
  name: string
  role: Role
  lastSeq: number
}

// 已盖 seq 的可靠消息原文(原样存进 ring,供 resumeSeq 补发)
export interface ReliableMsg {
  seq: number
  [key: string]: any
}

export interface Room {
  id: string
  code: string                          // 短分享码
  name?: string                         // 建房时经纪名(可空),落库用
  presenterConnId: string | null
  participants: Map<string, Participant>
  selected: any | null                  // 最近一次 select 事件 payload
  lastCam: any | null                   // 最近一次 cam 快照
  recentChat: any[]                     // 最近 ~30 条 chat,供 sync
  /**
   * 画的标注(id → mark)—— **物化**的 draw 状态,供 sync 快照。
   *
   * 为什么要物化:draw 走 mapAction 的 add/erase/clear 三个 op 流式广播。
   * 中途进来的客户(客户迟到是常态)只能收到「之后」的 op,看不到经纪**已经**画好的圈,
   * 而经纪浑然不觉还在说「你看我圈的这块」。ring 补发也救不了 —— 那条路是死的
   * (客户端在 sync 时就把 lastSeq 设成 state.seq,后续补发全被 seq<=lastSeq 丢弃)。
   * 所以服务端做个 reducer,把 marks 直接放进 sync 快照。
   */
  marks: Map<string, any>
  seq: number                           // 单调递增,盖在可靠事件上
  ring: ReliableMsg[]                   // 最近 ~200 条可靠事件,供 resumeSeq 补发
  createdAt: number
  // ── 持久化用(全在内存累积,由 collab-persistence 落库)──────────────
  eventLog: ReliableMsg[]               // 全量可靠事件日志(含 chat),供带看后报告
  peakParticipants: number              // 同时在场峰值
  dirty: boolean                        // 自上次 flush 后有新事件?
}

const RECENT_CHAT_MAX = 30
const RING_MAX = 200
const EVENT_LOG_MAX = 5000                  // 事件日志上限,兜底防失控房膨胀
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000   // 空房 10 分钟回收

const rooms = new Map<string, Room>()      // id -> Room
const codeToId = new Map<string, string>() // code -> id

// 去掉易混的 0/O/1/I
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(len = 5): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

function genId(): string {
  return `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function genConnId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function buildRoom(code: string, creatorName?: string): Room {
  const room: Room = {
    id: genId(),
    code,
    name: creatorName,
    presenterConnId: null,
    participants: new Map(),
    selected: null,
    lastCam: null,
    recentChat: [],
    marks: new Map(),
    seq: 0,
    ring: [],
    createdAt: Date.now(),
    eventLog: [],
    peakParticipants: 0,
    dirty: false
  }
  rooms.set(room.id, room)
  codeToId.set(code, room.id)
  return room
}

export function createRoom(creatorName?: string): { room: Room; code: string } {
  // 保证 code 唯一(碰撞极罕见,但兜一下)
  let code = randomCode()
  while (codeToId.has(code)) code = randomCode()
  return { room: buildRoom(code, creatorName), code }
}

/** 归一化外部传入的 code(经纪稳定 code / 重连):限我们的字母表与长度,
 *  防止 presenter 凭空捏造任意房间 id。无效返回 null。 */
function normalizeCode(code: string): string | null {
  const norm = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (norm.length < 4 || norm.length > 8) return null
  return norm
}

/**
 * 用「指定 code」拿房间:已存在就返回原房间,不存在就以该 code 新建。
 * 用途:① 经纪稳定分享链接(同一 code 永远复用同一房间);② presenter 断线/
 * 服务器重启后房间被回收,用同一 code 复活,使分享出去的链接永不失效。
 * 仅 presenter 路径调用(viewer 找不到房间应提示「主持人不在线」,不在此重建)。
 */
export function ensureRoomWithCode(code: string, creatorName?: string): Room | null {
  const norm = normalizeCode(code)
  if (!norm) return null
  return getRoomByCode(norm) ?? buildRoom(norm, creatorName)
}

export function getRoomByCode(code: string): Room | null {
  if (!code) return null
  const id = codeToId.get(code.toUpperCase())
  if (!id) return null
  return rooms.get(id) ?? null
}

/**
 * 加入房间。校验 code,分配 connId,挂上 participant。
 * 若房间还没 presenter 且新人是 presenter 角色,设为 presenterConnId。
 */
export function joinRoom(
  code: string,
  ws: WebSocket,
  name: string,
  role: Role = 'viewer'
): { participant: Participant; room: Room } | null {
  const room = getRoomByCode(code)
  if (!room) return null

  const connId = genConnId()
  const participant: Participant = { connId, ws, name, role, lastSeq: 0 }
  room.participants.set(connId, participant)
  if (room.participants.size > room.peakParticipants) {
    room.peakParticipants = room.participants.size
  }

  // A presenter (re)joining ALWAYS (re)claims the camera source. This makes
  // presenter reconnects robust even when the old socket hasn't been cleaned up
  // yet (a network drop can leave the dead socket lingering until its 25s ping
  // fails). Without this, the reconnected presenter wouldn't own presenterConnId
  // and its cam would be rejected → viewers freeze. Single-presenter model;
  // explicit handoff is a separate `role` event.
  if (role === 'presenter') {
    room.presenterConnId = connId
  }
  return { participant, room }
}

export function leave(room: Room, connId: string): void {
  room.participants.delete(connId)
  if (room.presenterConnId === connId) {
    room.presenterConnId = null
  }
}

/**
 * 主持人结束带看:立即让 code 失效(从 codeToId/rooms 删 → 之后 getRoomByCode 拿不到,
 * viewer 再拿旧 link 进来只会 room_not_found)+ 通知在场所有人 {k:'ended'} 并关连接。
 * 返回被结束的 room(供调用方 flushRoom 落库供报告),无此房返回 null。
 * 这是「防偷听」的关键:一场带看结束后旧链接立刻作废,不再靠 10 分钟空房 GC。
 */
export function endRoom(code: string): Room | null {
  const room = getRoomByCode(code)
  if (!room) return null
  rooms.delete(room.id)
  codeToId.delete(room.code)
  const bye = JSON.stringify({ k: 'ended' })
  for (const p of room.participants.values()) {
    try { p.ws.send(bye) } catch { /* 坏连接忽略 */ }
    try { p.ws.close() } catch { /* noop */ }
  }
  return room
}

/**
 * 主持人踢人:通知被踢者 {k:'kicked'} + 关连接 + 从房间移除。
 * 返回是否踢成功(connId 不在房间返回 false)。
 */
export function kickParticipant(room: Room, connId: string): boolean {
  const p = room.participants.get(connId)
  if (!p) return false
  try { p.ws.send(JSON.stringify({ k: 'kicked' })) } catch { /* noop */ }
  try { p.ws.close() } catch { /* noop */ }
  leave(room, connId)
  return true
}

export function nextSeq(room: Room): number {
  room.seq += 1
  return room.seq
}

/**
 * 盖 seq 后入 ring + 视类型更新房间状态(selected/lastCam/recentChat)。
 * 传入的 msg 必须已经盖好 seq(由调用方先 nextSeq 再设上)。
 */
export function pushReliable(room: Room, msg: ReliableMsg): void {
  room.ring.push(msg)
  if (room.ring.length > RING_MAX) {
    room.ring.splice(0, room.ring.length - RING_MAX)
  }

  // 持久化用:全量事件日志(含 chat/select/goto/mapAction/role/join/leave),
  // server 盖一个 at 时间戳(协议本身无 chat 时间戳,见 spec §H.8)。存副本,
  // 不污染要扇出/进 ring 的原 msg。cam/cur 高频流不走这里,天然排除。
  room.eventLog.push({ ...msg, at: Date.now() })
  if (room.eventLog.length > EVENT_LOG_MAX) {
    room.eventLog.splice(0, room.eventLog.length - EVENT_LOG_MAX)
  }
  room.dirty = true

  switch (msg.k) {
    case 'chat':
      room.recentChat.push(msg)
      if (room.recentChat.length > RECENT_CHAT_MAX) {
        room.recentChat.splice(0, room.recentChat.length - RECENT_CHAT_MAX)
      }
      break
    case 'select':
      room.selected = msg
      break
    case 'goto':
      // goto 也代表镜头落点,记为 lastCam 的离散版本不必要 —— 留作纯事件
      break
    case 'mapAction':
      reduceDraw(room, (msg as any).action)
      break
    default:
      break
  }
}

/** 标注上限:兜底防失控房膨胀(和 EVENT_LOG_MAX 同理)。 */
const MARKS_MAX = 500

/**
 * 把 draw 的 add/erase/clear 归约进 room.marks,让 sync 快照能带上「已经画好的东西」。
 *
 * mapAction 是个 untyped 的万能通道(Luna 工具输出 / 测距 / POI 弹窗 / draw 都走它),
 * 这里只认 __collab_draw,其余原样放过。
 */
function reduceDraw(room: Room, action: any): void {
  if (!action || action.type !== '__collab_draw') return
  switch (action.op) {
    case 'add':
      if (action.mark?.id) {
        room.marks.set(action.mark.id, action.mark)
        // 超上限就丢最老的(Map 保持插入序)
        if (room.marks.size > MARKS_MAX) {
          const oldest = room.marks.keys().next().value
          if (oldest !== undefined) room.marks.delete(oldest)
        }
      }
      break
    case 'erase':
      if (action.id) room.marks.delete(action.id)
      break
    case 'clear':
      room.marks.clear()
      break
  }
}

/**
 * 扇出给房间内其它人(可排除发送者)。逐个 ws.send,坏连接静默跳过。
 */
export function fanout(room: Room, msg: any, exceptConnId?: string): void {
  const text = JSON.stringify(msg)
  for (const p of room.participants.values()) {
    if (p.connId === exceptConnId) continue
    try {
      p.ws.send(text)
    } catch {
      // 坏连接由 close/error handler 清理,这里不抛
    }
  }
}

/** 所有活跃房间(供持久化层遍历 flush dirty 房间)。 */
export function listRooms(): Room[] {
  return Array.from(rooms.values())
}

/**
 * 空房 GC:无人后 TTL 到期删除。可由 setInterval 周期调用。
 * onEvict 在删除前回调(持久化层借此做最后一次 flush,确保数据不丢)。
 */
export function gcEmptyRooms(now = Date.now(), onEvict?: (room: Room) => void): number {
  let removed = 0
  for (const room of rooms.values()) {
    if (room.participants.size === 0 && now - room.createdAt > EMPTY_ROOM_TTL_MS) {
      onEvict?.(room)
      rooms.delete(room.id)
      codeToId.delete(room.code)
      removed++
    }
  }
  return removed
}

let gcTimer: NodeJS.Timeout | null = null

export function startRoomGc(intervalMs = 60 * 1000, onEvict?: (room: Room) => void): void {
  if (gcTimer) return
  gcTimer = setInterval(() => gcEmptyRooms(Date.now(), onEvict), intervalMs)
  gcTimer.unref?.()  // 别拦住进程退出(测试友好)
}

export function stopRoomGc(): void {
  if (gcTimer) {
    clearInterval(gcTimer)
    gcTimer = null
  }
}

// 测试 / 调试用
export function _roomCount(): number {
  return rooms.size
}
