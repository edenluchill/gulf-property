/**
 * Collab 持久化单元测试 —— 纯内存,不连 DB。
 *
 * 验证两件事:
 *  1) pushReliable 把可靠事件累积进 room.eventLog(含 chat/select/goto + join/leave),
 *     盖 at 时间戳、标 dirty;cam/cur 不进日志。
 *  2) buildCollabRoomRow 把房间压成正确的落库行(计数、首末时间、无事件返回 null)。
 *
 * 运行:cd backend && npm run test:collab-persist
 */

import {
  createRoom,
  joinRoom,
  pushReliable,
  nextSeq,
  type Room,
} from '../src/services/collab-rooms'
import { buildCollabRoomRow } from '../src/services/collab-persistence'

let passed = 0
function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}`)
    process.exit(1)
  }
}

// 假 ws,joinRoom 需要一个 ws 引用
const fakeWs: any = { send() {}, readyState: 1 }

function reliable(room: Room, msg: Record<string, any>): void {
  const m = { ...msg, seq: nextSeq(room) }
  pushReliable(room, m as any)
}

function run(): void {
  console.log('\n[test-collab-persist] pure, no DB\n')

  // ── 1. 空房 → buildCollabRoomRow 返回 null ──────────
  console.log('1. empty room -> null row (never written)')
  const { room: empty } = createRoom('Ahmed')
  ok(buildCollabRoomRow(empty) === null, 'no events -> null')

  // ── 2. join 更新 peakParticipants ──────────────────
  console.log('2. join tracks peak participants')
  const { room, code } = createRoom('Ahmed')
  ok(code.length >= 4, `room created (${code})`)
  joinRoom(code, fakeWs, 'Ahmed', 'presenter')
  joinRoom(code, fakeWs, '李先生', 'viewer')
  ok(room.peakParticipants === 2, `peakParticipants == 2 (got ${room.peakParticipants})`)

  // ── 3. pushReliable 累积事件日志 + dirty + at 戳 ─────
  console.log('3. reliable events accumulate into eventLog')
  ok(room.dirty === false, 'fresh room not dirty')
  reliable(room, { k: 'chat', from: 'agent', name: 'Ahmed', text: '回报率不错' })
  reliable(room, { k: 'select', kind: 'project', id: 'uuid-1' })
  reliable(room, { k: 'goto', c: [55.27, 25.2], z: 14, label: 'Marina' })
  reliable(room, { k: 'chat', from: 'viewer', name: '李先生', text: '到地铁多远?' })
  ok(room.dirty === true, 'room marked dirty after events')
  ok(room.eventLog.length === 4, `eventLog has 4 events (got ${room.eventLog.length})`)
  ok(room.eventLog.every(e => typeof e.at === 'number'), 'every event stamped with at')
  ok(room.eventLog[0].k === 'chat' && room.eventLog[0].seq === 1, 'first event preserved with seq')

  // ── 4. buildCollabRoomRow 计数/时间正确 ─────────────
  console.log('4. buildCollabRoomRow shape')
  const row = buildCollabRoomRow(room)
  ok(row !== null, 'row built')
  ok(row!.code === code, 'row.code matches')
  ok(row!.name === 'Ahmed', 'row.name carries creator')
  ok(row!.eventCount === 4, `eventCount == 4 (got ${row!.eventCount})`)
  ok(row!.chatCount === 2, `chatCount == 2 (got ${row!.chatCount})`)
  ok(row!.peakParticipants === 2, 'peakParticipants carried')
  ok(row!.firstEventAt instanceof Date && row!.lastEventAt instanceof Date, 'first/last event timestamps set')
  ok(row!.lastEventAt!.getTime() >= row!.firstEventAt!.getTime(), 'last >= first')
  const parsed = JSON.parse(row!.eventsJson)
  ok(Array.isArray(parsed) && parsed.length === 4, 'eventsJson is the full array')

  console.log(`\nALL COLLAB-PERSIST TESTS PASSED (${passed} assertions)\n`)
  process.exit(0)
}

run()
