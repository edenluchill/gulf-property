-- ===========================================================================
-- 防重复领取试用 —— DB 层硬保证 (2026-07-11)
--
-- 原来只有应用层的「先查 free_trial_started_at、再写入」读后写检查:两个并发
-- 请求(双击按钮 / 重放)可以同时通过检查 → 插出两条试用行。加一道数据库约束,
-- 让"一个 agent 最多一条试用行"成为**不可能违反**的事实,而不是靠代码自觉。
--
-- 领取本身也改成原子的:
--   UPDATE lt_agents SET free_trial_started_at = now()
--    WHERE id = $1 AND free_trial_started_at IS NULL RETURNING id
-- 只有拿到返回行的那个请求才是赢家(单条语句,天然互斥)。
-- ===========================================================================

-- 上索引前先清理:若已存在同一 agent 的多条试用行,只留最新一条(现网应为 0 条)。
DELETE FROM lt_subscriptions a
 USING lt_subscriptions b
 WHERE a.source = 'free_trial' AND b.source = 'free_trial'
   AND a.agent_id = b.agent_id
   AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_subs_one_trial_per_agent
  ON lt_subscriptions (agent_id) WHERE source = 'free_trial';
