-- ===========================================================================
-- Agora 应用内语音用量与额度(成本护栏)。每场带看语音通话一行。
--
-- 额度(全部服务端硬 enforce,见 services/voiceRtc.ts):
--   • 单场 ≤ 30 分钟 —— token TTL 卡死,过期自动断
--   • 每经纪每日 ≤ 3 小时(按 agent_email 当日累计)
--   • 全局每日兜底上限(防身份伪造刷 token)
-- duration_seconds 由 30s 心跳 + 结束时回填,崩溃也能记到最近一次心跳。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS voice_sessions (
  id               BIGSERIAL PRIMARY KEY,
  agent_email      TEXT,                                  -- 发起经纪(用量归属)
  room_code        TEXT,                                  -- collab 房间分享码 = Agora channel
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0,            -- 实际通话秒数(心跳/结束回填)
  allowed_seconds  INTEGER NOT NULL DEFAULT 0,            -- 本场授权时长(token TTL)
  ended_reason     TEXT,                                  -- ended | limit | left | error
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_agent_day ON voice_sessions (agent_email, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_room      ON voice_sessions (room_code, started_at DESC);
-- 快速找某房间「仍在进行」的语音场(供 viewer 申请 token 时校验)
CREATE INDEX IF NOT EXISTS idx_voice_sessions_active    ON voice_sessions (room_code) WHERE ended_at IS NULL;
