-- ===========================================================================
-- Collab 实时带看房间存档(co-presence 协作带看)
--
-- 沿用 luna_sessions 的范式:整段事件日志存一个 events JSONB(几乎只整段回看,
-- 完美 JSON 场景)+ 几个标量列供聚合/列表。一房一行,code 唯一。
--
-- 写入是 best-effort fire-and-forget:房间事件先在内存累积(collab-rooms 的
-- room.eventLog),由 collab-persistence 定时 + 房间驱逐时 upsert 落库。空房 /
-- 无事件房永不写库(避免链接预览 bot 造垃圾行)。
--
-- 用途:带看后给经纪生成意向报告(看了哪些区/项目、聊了什么、问了 Luna 什么)。
-- 隐私:events 含客户聊天逐句。访问应锁死所有者(同 luna_sessions 思路)。
-- 见 spec docs/luna-collaborative-tour-spec.md §6 持久化 / §H.7 待办#2。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS collab_rooms (
  id                BIGSERIAL PRIMARY KEY,
  code              TEXT UNIQUE NOT NULL,      -- 5 位分享码
  room_id           TEXT,                      -- 内存房间 id(room_*)
  name              TEXT,                      -- 建房时经纪名(可空)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_event_at    TIMESTAMPTZ,               -- 首条可靠事件时间
  last_event_at     TIMESTAMPTZ,               -- 末条可靠事件时间
  peak_participants INTEGER NOT NULL DEFAULT 0,-- 同时在场峰值
  chat_count        INTEGER NOT NULL DEFAULT 0,
  event_count       INTEGER NOT NULL DEFAULT 0,
  events            JSONB NOT NULL DEFAULT '[]'::jsonb  -- 全量可靠事件日志(含 chat)
);

CREATE INDEX IF NOT EXISTS idx_collab_rooms_created ON collab_rooms (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_rooms_last    ON collab_rooms (last_event_at DESC);
