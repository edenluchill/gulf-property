-- 后台「授予」改造(2026-07-13):永久 comp → 一次性 30 天试用
--
-- 旧行为:admin 下拉可以随时授予任意套餐,期限 **100 年**(routes/agents.ts),
-- 同一个人能反复授予,审计只把操作人塞在 reason 里(「manual by xxx」)。
-- 而 100 年的 comp 行**没有任何过期清理** —— freeTrialSweep 和各处即时过期谓词
-- 都只认 source='free_trial' → 一旦发出就是永久免费,没人收得回。
--
-- 新行为:只能授予一次、30 天、到期自动收回(走 free_trial 行)。谁发的、什么时候
-- 发的落到列上,不再靠 reason 字符串。
--
-- ⚠️ 存量永久 comp 行(自己人/合伙人)**保持不动** —— 只移除「再发永久」的能力。

-- 一人一次 + 谁发的 + 什么时候发的。与 free_trial_started_at(自助领取戳)刻意分开:
-- 自助领过 7 天的人,admin 仍应能再给他发一次 30 天(今天这批经纪就是)。
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS trial_granted_at  timestamptz;
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS trial_granted_by  text;

-- 审计:操作人上升为一等列(原来只在 reason 里,查不了、也不可信)。
ALTER TABLE plan_change_log ADD COLUMN IF NOT EXISTS actor_email text;

-- 回填:把历史 comp 记录 reason 里的「manual by xxx」提到 actor_email。
UPDATE plan_change_log
   SET actor_email = substring(reason from 'manual by (.+)$')
 WHERE actor_email IS NULL
   AND reason LIKE 'manual by %';

-- 已经被手动赠送过的人,视为「已用掉那一次授予额度」—— 否则改造上线后他们还能
-- 再白拿一次 30 天。操作人取审计里最后一条 comp_granted 的 actor。
UPDATE lt_agents la
   SET trial_granted_at = c.created_at,
       trial_granted_by = COALESCE(c.actor_email, 'unknown(历史)')
  FROM (
    SELECT DISTINCT ON (agent_id) agent_id, created_at, actor_email
      FROM plan_change_log
     WHERE action = 'comp_granted'
     ORDER BY agent_id, created_at DESC
  ) c
 WHERE la.id = c.agent_id AND la.trial_granted_at IS NULL;
