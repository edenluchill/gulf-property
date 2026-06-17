-- ===========================================================================
-- Luna 语音对话存档(主应用的 Luna 助手,非 Luna Tour 分享链接)
--
-- 复用前端 debugLogger 已构建的 SessionLog 对象(messages 逐句 / toolCalls /
-- metrics)。整段嵌套结构存一个 transcript JSONB——几乎只整段回看,完美 JSON
-- 场景;另抽几个标量列供 dashboard 聚合。详见 docs/analytics-dashboard-spec.md §3。
--
-- 隐私:transcript 含客户逐句对话。访问锁死所有者 email(routes/admin-analytics)。
-- 保留期(可选):按 created_at 定时清理(见 spec §7)。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS luna_sessions (
  id               BIGSERIAL PRIMARY KEY,
  session_id       TEXT UNIQUE NOT NULL,   -- debugLogger 的 voice_* id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id       TEXT,
  user_email       TEXT,
  user_id          TEXT,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_ms      INTEGER,
  turn_count       INTEGER,                -- messages 数
  tool_call_count  INTEGER,
  had_error        BOOLEAN NOT NULL DEFAULT false,
  transcript       JSONB NOT NULL DEFAULT '{}'::jsonb  -- 完整 SessionLog
);

CREATE INDEX IF NOT EXISTS idx_luna_sessions_created ON luna_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_luna_sessions_email   ON luna_sessions (user_email);
CREATE INDEX IF NOT EXISTS idx_luna_sessions_visitor ON luna_sessions (visitor_id);
