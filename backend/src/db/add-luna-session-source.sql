-- ===========================================================================
-- luna_sessions.source —— 这一行是怎么来的
--
-- 'beacon'  浏览器在会话结束时 sendBeacon 上报的（快路径，数据最全）
-- 'rebuilt' 服务端从 luna_turns 补的（浏览器那一次上报没发生）
--
-- 为什么要这一列：2026-08-14 owner 报「看不到记录，但合伙人说昨天聊过」。
-- 查了半天才确认「对话真发生了，只是上报丢了」。分不清来源的话，
-- 下次同样的问题还要从头查一遍 —— 而且会误判成「没人用」。
--
-- 存量行全是 beacon 报的（rebuild 服务此前不存在），所以 DEFAULT 直接写死。
-- ===========================================================================

ALTER TABLE luna_sessions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'beacon';

-- 「今天有几场没上报成功」是个要经常看的指标，给它一个便宜的走法。
CREATE INDEX IF NOT EXISTS idx_luna_sessions_source
  ON luna_sessions (source, created_at DESC);
