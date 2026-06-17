-- ===========================================================================
-- App-wide behaviour analytics (主应用客户行为采集)
--
-- 统一事件流。设计:几个固定真列(总要查/排序/索引)+ 一个 payload JSONB
-- (每种事件形状不同的可变部分)。这是 PostHog/Segment/Snowplow 的标准事件
-- 建模法。详见 docs/analytics-dashboard-spec.md §2 / §11。
--
-- 隔离:本表与现有业务表无外键耦合。删表 + routes/events.ts + 前端 track.ts
-- 即可完全移除该功能,主应用行为不变。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS app_events (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type   TEXT NOT NULL,             -- search | search_result_click | property_view
                                          -- | luna_open | luna_close | tutorial_step | page_view
  visitor_id   TEXT NOT NULL,             -- localStorage 匿名 UUID,永远有
  user_email   TEXT,                      -- 登录用户(可空)
  user_id      TEXT,                      -- Supabase user.id(可空)
  session_id   TEXT,                      -- 每次页面加载 / voice session
  project_id   UUID,                      -- 涉及具体项目时
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 事件可变字段
  path         TEXT,                      -- 页面 URL path
  ua           TEXT,
  ip_hash      TEXT                       -- SHA256(ip + salt),不存明文 IP
);

CREATE INDEX IF NOT EXISTS idx_app_events_created  ON app_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_type     ON app_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_email    ON app_events (user_email);
CREATE INDEX IF NOT EXISTS idx_app_events_visitor  ON app_events (visitor_id);
CREATE INDEX IF NOT EXISTS idx_app_events_payload  ON app_events USING gin (payload);
