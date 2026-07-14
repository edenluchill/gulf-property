-- Luna Tour — 经纪通知（客户看完 / 想联系 / 收藏了某套）
--
-- 🔴 为什么这张表值得存在:
--    核心卖点是「把 tour 发给客户,然后你知道他做了什么」。而在此之前,行为数据
--    确实采到了(lt_engagement_events,125 条),但**没有任何人被告知** ——
--    经纪只有主动去经纪台翻,才可能看见。**卖点是假的。**
--
--    最值钱的一刻是客户看完的那一分钟(他此刻正在想这件事)。晚一天打电话,
--    热度就没了。所以:高意向事件发生 → 立刻在站内立案 + 发邮件。
--
-- ISOLATION: lt_ 前缀。删 luna-tour 目录 + 这张表即可移除。

CREATE TABLE IF NOT EXISTS lt_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  -- tour_complete | cta | favorite
  kind         text NOT NULL,
  title        text NOT NULL,
  body         text,
  session_id   uuid REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  client_id    uuid REFERENCES lt_clients(id) ON DELETE SET NULL,
  share_code   text,
  -- 用来去重:同一个访客 + 同一场 tour + 同一类事件 = 一条通知,不刷屏
  dedupe_key   text NOT NULL,
  read_at      timestamptz,
  emailed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 一个访客把 tour 看完三遍,不该变成三条通知
CREATE UNIQUE INDEX IF NOT EXISTS lt_notifications_dedupe_uq
  ON lt_notifications (dedupe_key);

CREATE INDEX IF NOT EXISTS lt_notifications_agent_unread_idx
  ON lt_notifications (agent_id, read_at NULLS FIRST, created_at DESC);
