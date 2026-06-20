/**
 * Collab WebSocket Route —— 实时协作带看(co-presence)
 *
 * 照抄 voice-chat.ts 的范式:在同一 http server 上挂第二个 WebSocketServer,
 * path `/api/collab`。原生 ws 按 path 路由 upgrade,与 /api/voice-chat 零冲突。
 *
 * 两类消息(spec §5):
 *  - 高频不可靠(cam / cur):收到即扇出,不盖 seq、不入 ring。cam 只认 presenter。
 *  - 可靠有序(goto/select/chat/mapAction/role + join/leave):server 盖 seq、入 ring、扇出。
 *
 * 单进程内存房间,不碰 DB(持久化只留 TODO stub)。
 */

import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import {
  createRoom,
  getRoomByCode,
  joinRoom,
  leave,
  nextSeq,
  pushReliable,
  fanout,
  startRoomGc,
  type Room,
  type Participant
} from '../services/collab-rooms'

const router = Router()

let wss: WebSocketServer | null = null

// 分享链接域名(前端 /t/:code 路由会消费),做成常量
const SHARE_BASE_URL = 'https://pinzos.com/t'

// 25s server-side ping —— 让 Cloudflare 橙云的 100s 空闲超时不会断 WS。
// 用应用层 {k:'ping'} 帧(客户端回 {k:'pong'}),也驱动 server→client 的活性。
const PING_INTERVAL_MS = 25 * 1000

// 服务器盖 seq 的可靠消息类型
const RELIABLE_KINDS = new Set(['goto', 'select', 'chat', 'mapAction', 'role'])

/**
 * TODO(persistence): 落库 collab_rooms(chat + 事件日志),供带看后意向报告。
 * 本项目本地 db 直连生产库,这次先不写库 —— 只留 stub。见 spec §6 持久化。
 */
function persistRoomEvent(_room: Room, _msg: any): void {
  // intentionally empty — DB persistence is a separate, deliberate step
}

export function initCollabWebSocket(server: Server): void {
  // noServer + 自管 upgrade 路由(见 voice-chat.ts 同款注释):同一 http server
  // 多 WSS 共存的唯一正确写法。只认 /api/collab,其它 path 不碰。
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let pathname: string
    try {
      pathname = new URL(req.url || '', 'http://localhost').pathname
    } catch {
      return
    }
    if (pathname !== '/api/collab') return
    wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit('connection', ws, req))
  })

  startRoomGc()

  console.log('🗺️  Collab WebSocket server initialized at /api/collab')

  wss.on('connection', (ws: WebSocket) => {
    // 这两个在 hello 成功后绑定;在此之前的消息(除 hello/ping)忽略。
    let room: Room | null = null
    let me: Participant | null = null

    // 25s 心跳保活
    const pingTimer = setInterval(() => {
      try {
        ws.send(JSON.stringify({ k: 'ping' }))
      } catch {
        /* 坏连接由 close/error 清理 */
      }
    }, PING_INTERVAL_MS)
    pingTimer.unref?.()

    ws.on('message', (data: Buffer) => {
      let msg: any
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return // 非 JSON 帧直接忽略
      }

      // ── 控制:ping / pong ──────────────────────────
      if (msg.k === 'ping') {
        ws.send(JSON.stringify({ k: 'pong' }))
        return
      }
      if (msg.k === 'pong') return // 客户端回的心跳,吞掉

      // ── 控制:hello(进房/重连)──────────────────────
      if (msg.k === 'hello') {
        const joined = joinRoom(msg.code, ws, msg.name || '访客', msg.role === 'presenter' ? 'presenter' : 'viewer')
        if (!joined) {
          ws.send(JSON.stringify({ k: 'error', reason: 'room_not_found' }))
          ws.close()
          return
        }
        room = joined.room
        me = joined.participant

        // 回 sync 全量快照(connId 告诉客户端它自己的 id)
        ws.send(JSON.stringify({
          k: 'sync',
          connId: me.connId,
          state: {
            presenterConnId: room.presenterConnId,
            lastCam: room.lastCam,
            selected: room.selected,
            participants: Array.from(room.participants.values()).map(p => ({
              connId: p.connId, name: p.name, role: p.role
            })),
            recentChat: room.recentChat,
            seq: room.seq
          }
        }))

        // resumeSeq:补发 ring 里 seq > resumeSeq 的可靠消息(升序逐条)
        if (typeof msg.resumeSeq === 'number') {
          for (const r of room.ring) {
            if (r.seq > msg.resumeSeq) {
              ws.send(JSON.stringify(r))
            }
          }
        }

        // server 主动生成 join 事件并扇出给其它人(走 seq + ring)
        const joinMsg = {
          k: 'join',
          seq: nextSeq(room),
          who: { connId: me.connId, name: me.name, role: me.role }
        }
        pushReliable(room, joinMsg)
        fanout(room, joinMsg, me.connId)
        return
      }

      // hello 之前的其它消息一律忽略
      if (!room || !me) return

      // ── 高频不可靠:cam(只认 presenter)/ cur ──────
      if (msg.k === 'cam') {
        if (me.connId !== room.presenterConnId) return // 非 presenter 的 cam 忽略
        room.lastCam = msg
        fanout(room, msg, me.connId)
        return
      }
      if (msg.k === 'cur') {
        // P2:先实现扇出(except 自己)。归一化光标。
        fanout(room, msg, me.connId)
        return
      }

      // ── 可靠有序:server 盖 seq、入 ring、扇出 ──────
      if (RELIABLE_KINDS.has(msg.k)) {
        // role 事件额外切换 presenter
        if (msg.k === 'role' && typeof msg.presenter === 'string') {
          if (room.participants.has(msg.presenter)) {
            room.presenterConnId = msg.presenter
          }
        }
        msg.seq = nextSeq(room)
        pushReliable(room, msg)
        persistRoomEvent(room, msg)
        fanout(room, msg, me.connId)
        return
      }

      // 未知 kind:忽略
    })

    const cleanup = () => {
      clearInterval(pingTimer)
      if (room && me) {
        const connId = me.connId
        leave(room, connId)
        // server 主动生成 leave 并扇出
        const leaveMsg = { k: 'leave', seq: nextSeq(room), connId }
        pushReliable(room, leaveMsg)
        fanout(room, leaveMsg) // 发送者已走,扇给剩下所有人
        room = null
        me = null
      }
    }

    ws.on('close', cleanup)
    ws.on('error', () => cleanup())
  })
}

// ── REST:建房 / 校验 ──────────────────────────────

// POST /api/collab/rooms  body { name? } → { code, url }
router.post('/rooms', (req, res) => {
  const { name } = req.body || {}
  const { code } = createRoom(typeof name === 'string' ? name : undefined)
  res.json({ code, url: `${SHARE_BASE_URL}/${code}` })
})

// GET /api/collab/rooms/:code → { exists, participants }
router.get('/rooms/:code', (req, res) => {
  const room = getRoomByCode(req.params.code)
  res.json({
    exists: !!room,
    participants: room ? room.participants.size : 0
  })
})

// 健康检查(照抄 voice-chat)
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    websocket: wss ? 'initialized' : 'not initialized',
    activeConnections: wss ? wss.clients.size : 0
  })
})

export default router
