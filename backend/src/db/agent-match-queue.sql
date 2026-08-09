-- 派单通知改成「攒一攒、隔 5 分钟发一次」+ 收到 lead 就退出排班(owner 2026-08-09)
--
-- 两条规则:
--
-- ① **不要一次性发**。原来是 reveal 的瞬间同步发一封 —— 同一个经纪短时间内被派到
--    几条,就收到几封,像在轰炸他。改成落一个待发标记,后台每分钟扫一次:
--    距上次通知 ≥ 5 分钟才发,而且把这段时间攒下的**全部 lead 合成一封**。
--
-- ② **收到 lead 就退出排班**,直到他在经纪台点「已跟进」。
--    least-exposed 排序只保证"下一条给接得最少的人",但一个人手上压着没处理的
--    lead 时还继续被派,对买家和对他都不好。
--    ⚠️ 必须有**自动释放**:没人点「已跟进」的话池子会一点点干掉,
--       最后所有人都被锁在外面、功能静默失效。24 小时后自动放回来。

ALTER TABLE agent_match_assignments
  -- 这条 lead 的通知邮件什么时候发出去的。NULL + 已 reveal = 待发。
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- 扫待发队列:按经纪分组找 notified_at IS NULL 的
CREATE INDEX IF NOT EXISTS idx_agent_match_notify_pending
  ON agent_match_assignments (agent_id)
  WHERE notified_at IS NULL AND revealed_at IS NOT NULL;

-- 排班排除:找"有未跟进的真 lead"的经纪
CREATE INDEX IF NOT EXISTS idx_agent_match_open_lead
  ON agent_match_assignments (agent_id, revealed_at DESC)
  WHERE revealed_at IS NOT NULL AND agent_ack_at IS NULL;

COMMENT ON COLUMN agent_match_assignments.notified_at IS
  '通知邮件发出时间。NULL 且已 reveal = 在待发队列里;同一经纪的多条会合并成一封发。';
