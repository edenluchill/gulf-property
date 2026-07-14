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
  ensureRoomWithCode,
  getRoomByCode,
  joinRoom,
  leave,
  endRoom,
  kickParticipant,
  nextSeq,
  pushReliable,
  fanout,
  startRoomGc,
  roomStats,
  type Room,
  type Participant
} from '../services/collab-rooms'
import { counter, gauge, collabJoin } from '../telemetry'
import { startCollabPersistence, flushRoom } from '../services/collab-persistence'
import { purgeOldCollabRooms } from '../services/collabReport'
import { checkCredits, spend, creditError } from '../luna-tour/credits'
import { resolveAgentId } from '../lib/agent-identity'

// 带看记录(含客户 PII)保留期,env 可调,默认 180 天。
const COLLAB_RETENTION_DAYS = Math.max(1, Number(process.env.COLLAB_RETENTION_DAYS) || 180)
const RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000   // 每 6h 扫一次

const router = Router()

let wss: WebSocketServer | null = null

// 分享链接域名(前端 /t/:code 路由会消费)。env 可覆盖(staging/换域名免改码)。
const SHARE_BASE_URL = process.env.COLLAB_SHARE_BASE_URL || 'https://pinzos.com/t'

// 25s server-side ping —— 让 Cloudflare 橙云的 100s 空闲超时不会断 WS。
// 用应用层 {k:'ping'} 帧(客户端回 {k:'pong'}),也驱动 server→client 的活性。
const PING_INTERVAL_MS = 25 * 1000

// 服务器盖 seq 的可靠消息类型
const RELIABLE_KINDS = new Set(['goto', 'select', 'chat', 'mapAction', 'role'])

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

  // 房间被驱逐前最后 flush 一次,确保事件日志不随房间删除而丢。
  startRoomGc(60 * 1000, (room) => { void flushRoom(room) })
  // 定时把 dirty 房间落库(15s ≪ 空房 10min TTL,删前必已刷过)。
  startCollabPersistence()

  // 保留期清理:开机扫一次 + 每 6h 一次,删超期带看记录(PII 合规)。
  const sweep = () => {
    void purgeOldCollabRooms(COLLAB_RETENTION_DAYS).then((n) => {
      if (n > 0) console.log(`🧹 collab retention: purged ${n} room(s) older than ${COLLAB_RETENTION_DAYS}d`)
    })
  }
  sweep()
  setInterval(sweep, RETENTION_SWEEP_MS).unref?.()

  console.log('🗺️  Collab WebSocket server initialized at /api/collab')

  // WS 之前 **100% 全盲** —— perfMetrics 是 Express 中间件,而 upgrade 根本不经过它。
  // 2026-07-13 合伙人报「带看有半分钟延迟」时,我们没有任何现成数据可查,
  // 只能临时写探针脚本去生产实测。这几个 gauge 是 pull 式的,不用自己维护计数器。
  gauge('collab.rooms.active', () => roomStats().rooms)
  gauge('collab.ws.connections', () => roomStats().participants)

  wss.on('connection', (ws: WebSocket) => {
    counter('collab.ws.connect').inc()
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
        const role = msg.role === 'presenter' ? 'presenter' : 'viewer'
        let joined = joinRoom(msg.code, ws, msg.name || '访客', role)
        // presenter 重连而房间已被回收(空房 TTL / 服务器重启)→ 用同一 code 复活,
        // 使经纪/客户分享出去的链接永不失效。viewer 找不到房间则照旧提示离线。
        if (!joined && role === 'presenter') {
          ensureRoomWithCode(msg.code, msg.name)
          joined = joinRoom(msg.code, ws, msg.name || '访客', role)
        }
        if (!joined) {
          // 客户点了链接却进不去(房间已结束 / 链接失效)—— 之前是**静默失败**,
          // 经纪那头只看到「客户怎么没进来」,分不清是没点还是进不来。
          counter('collab.ws.error', { reason: 'room_not_found' }).inc()
          ws.send(JSON.stringify({ k: 'error', reason: 'room_not_found' }))
          ws.close()
          return
        }
        room = joined.room
        me = joined.participant

        // 进房漏斗:ws_connect(连上并被房间接纳)→ sync(拿到快照 = 真正进房成功)。
        // link_open / identity_submit 在前端上报(RUM),first_cam 也是。
        // 今天那批 peak_participants=1 的房间(客户压根没进来)是手查 DB 才发现的。
        if (role === 'viewer') {
          collabJoin.step('ws_connect')
          collabJoin.step('sync')
        }

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
            // 已经画好的标注 —— 中途进来的客户也要看得见经纪圈的那块地
            // (客户迟到是常态;之前他们只能收到「之后」的 draw op,进来时地图是干净的)
            marks: Array.from(room.marks.values()),
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

      // ── 主持人结束带看:落库 + 删房 + 通知在场(旧 link 立即失效,防偷听)──
      if (msg.k === 'end') {
        if (me.connId === room.presenterConnId) {
          const ended = endRoom(room.code)
          if (ended) void flushRoom(ended)
        }
        return
      }
      // ── 主持人踢人 ──────────────────────────────────
      if (msg.k === 'kick' && typeof msg.connId === 'string') {
        if (me.connId === room.presenterConnId && msg.connId !== me.connId) {
          if (kickParticipant(room, msg.connId)) {
            const leaveMsg = { k: 'leave', seq: nextSeq(room), connId: msg.connId }
            pushReliable(room, leaveMsg)
            fanout(room, leaveMsg)
          }
        }
        return
      }

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
        fanout(room, msg, me.connId)
        return
      }

      // 未知 kind:忽略
    })

    const cleanup = () => {
      clearInterval(pingTimer)
      counter('collab.ws.disconnect').inc()
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
// 实时带看配额门:登录经纪按订阅额度拦截,匿名/demo 放行(公开演示)。
router.post('/rooms', async (req, res) => {
  const agentId = await resolveAgentId(req)
  if (agentId) {
    const q = await checkCredits(agentId, 'live_tours')
    if (!q.allowed) { const e = creditError('live_tours', q); return res.status(e.status).json(e.body) }
  }
  const { name } = req.body || {}
  const creatorName = typeof name === 'string' ? name : undefined
  // 每次开始带看都新建随机 code(一场一码):**不再复用「按经纪派生的稳定 code」**——
  // 那会让所有客户共用同一条永久链接,上一位客户能拿旧链接进来偷听下一场。
  // 断线/刷新重连仍能复活「当次这场」的房间(前端把 code 存进 ?host,走 WS hello presenter
  // 分支的 ensureRoomWithCode 复活);经纪主动结束(k:'end')后该 code 立即失效。
  const room = createRoom(creatorName).room
  if (agentId) await spend(agentId, 'live_tours', { type: 'live', id: room.code, label: creatorName }).catch(() => {})
  res.json({ code: room.code, url: `${SHARE_BASE_URL}/${room.code}` })
})

// GET /api/collab/rooms/:code → { exists, participants }
router.get('/rooms/:code', (req, res) => {
  const room = getRoomByCode(req.params.code)
  res.json({
    exists: !!room,
    participants: room ? room.participants.size : 0
  })
})

// POST /api/collab/rooms/:code/identify —— 客户进带看自报称呼(+选填联系方式),
// 进事件日志(k:'identify')供带看后意向报告归属到人 + 经纪跟进。
router.post('/rooms/:code/identify', (req, res) => {
  const room = getRoomByCode(req.params.code)
  if (!room) { res.status(404).json({ ok: false, error: 'room_not_found' }); return }
  const { name, phone, whatsapp } = req.body || {}
  const ev: Record<string, unknown> = {
    k: 'identify',
    seq: nextSeq(room),
    name: String(name || '').slice(0, 60),
  }
  if (phone) ev.phone = String(phone).slice(0, 40)
  if (whatsapp) ev.whatsapp = String(whatsapp).slice(0, 80)
  pushReliable(room, ev as unknown as Parameters<typeof pushReliable>[1])
  fanout(room, ev)
  res.json({ ok: true })
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
