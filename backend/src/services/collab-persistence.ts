/**
 * Collab 房间持久化 —— 把内存房间的事件日志落 collab_rooms 表(spec §6 / §H.7#2)。
 *
 * 设计(沿用 luna_sessions 范式):
 *  - 事件先在内存累积(collab-rooms 的 room.eventLog,在 pushReliable 里追加)。
 *  - 这里只负责「把 dirty 房间 upsert 进 DB」:定时(默认 15s)flush + 房间被 GC
 *    驱逐前最后 flush 一次。15s ≪ 空房 10min TTL,所以每个房在被删前必被刷到库。
 *  - best-effort fire-and-forget:DB 慢/错绝不影响实时 WS。空房 / 无事件房不写库。
 *
 * collab-rooms.ts 保持 DB-free(纯内存逻辑);所有 pool 依赖只在本文件。
 */

import pool from '../db/pool'
import { listRooms, type Room } from './collab-rooms'

const EVENTS_JSON_MAX = 1_000_000   // 单行 events JSONB 上限(同 luna_sessions)

export interface CollabRoomRow {
  code: string
  roomId: string
  name: string | null
  firstEventAt: Date | null
  lastEventAt: Date | null
  peakParticipants: number
  chatCount: number
  eventCount: number
  eventsJson: string
}

/**
 * 把房间内存态压成一行落库数据(纯函数,无副作用,可单测)。
 * 无事件返回 null —— 调用方据此跳过写库。
 */
export function buildCollabRoomRow(room: Room): CollabRoomRow | null {
  const events = room.eventLog
  if (!events || events.length === 0) return null

  const first = events[0]
  const last = events[events.length - 1]
  const chatCount = events.reduce((n, e) => (e.k === 'chat' ? n + 1 : n), 0)

  let eventsJson = '[]'
  try {
    const s = JSON.stringify(events)
    eventsJson = s.length <= EVENTS_JSON_MAX
      ? s
      : JSON.stringify({ truncated: true, eventCount: events.length })
  } catch {
    /* keep '[]' */
  }

  return {
    code: room.code,
    roomId: room.id,
    name: room.name ?? null,
    firstEventAt: typeof first?.at === 'number' ? new Date(first.at) : null,
    lastEventAt: typeof last?.at === 'number' ? new Date(last.at) : null,
    peakParticipants: room.peakParticipants,
    chatCount,
    eventCount: events.length,
    eventsJson,
  }
}

/**
 * 把单个房间 upsert 进库。dirty=false 直接跳过。best-effort,自己吞错。
 * 注意:先清 dirty 再 await —— 避免 flush 进行中的新事件被这次写覆盖标志后丢失。
 */
export async function flushRoom(room: Room): Promise<void> {
  if (!room.dirty) return
  const row = buildCollabRoomRow(room)
  if (!row) { room.dirty = false; return }
  room.dirty = false

  try {
    await pool.query(
      `INSERT INTO collab_rooms
         (code, room_id, name, first_event_at, last_event_at,
          peak_participants, chat_count, event_count, events)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (code) DO UPDATE SET
         room_id = EXCLUDED.room_id,
         name = EXCLUDED.name,
         first_event_at = EXCLUDED.first_event_at,
         last_event_at = EXCLUDED.last_event_at,
         peak_participants = EXCLUDED.peak_participants,
         chat_count = EXCLUDED.chat_count,
         event_count = EXCLUDED.event_count,
         events = EXCLUDED.events`,
      [
        row.code,
        row.roomId,
        row.name,
        row.firstEventAt,
        row.lastEventAt,
        row.peakParticipants,
        row.chatCount,
        row.eventCount,
        row.eventsJson,
      ]
    )
  } catch (err) {
    // best-effort:写失败标回 dirty,下个 tick 重试
    room.dirty = true
    console.error('[collab-persist] flush failed (ignored):', err instanceof Error ? err.message : err)
  }
}

async function flushDirtyRooms(): Promise<void> {
  for (const room of listRooms()) {
    if (room.dirty) await flushRoom(room)
  }
}

let timer: NodeJS.Timeout | null = null

export function startCollabPersistence(intervalMs = 15 * 1000): void {
  if (timer) return
  timer = setInterval(() => { void flushDirtyRooms() }, intervalMs)
  timer.unref?.()  // 别拦住进程退出(测试友好)
}

export function stopCollabPersistence(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
