-- ===========================================================================
-- 经纪准入审批。登录(Supabase)后想用经纪台 → 自动建 pending 行,所有者一键批准。
-- 服务端硬 enforce(/api/agents/me + requireOwner 的 admin 批准),不再靠前端 localStorage。
-- 所有者(OWNER_EMAILS)永远视为已批准,不会把自己锁在外面。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS agents (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT UNIQUE NOT NULL,                 -- supabase user email(小写)
  user_id      TEXT,                                 -- supabase user id
  name         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  decided_by   TEXT                                  -- 批准/拒绝的所有者 email
);

CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status, requested_at DESC);
