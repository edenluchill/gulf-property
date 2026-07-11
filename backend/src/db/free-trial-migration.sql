-- ===========================================================================
-- 免绑卡试用 (2026-07-11) — 计划见 docs/no-card-trial-plan-2026-07-11.md
--
-- 经纪/经纪公司/开发商角色可零摩擦开 7 天试用(rookie 档 200 积分),不绑卡。
-- 积分用完或 7 天到期 → 回落 explore。随时可提前付费,付费即刷新积分池。
-- ===========================================================================

-- 1) 订阅来源。
--    ⚠️ 关键:不能用 `stripe_subscription_id IS NULL` 判定"本地试用" ——
--    后台 comp 授予(agents.ts:114,100 年期终身账户)也是 NULL。用它做过期清理
--    会把终身客户一起干掉。故显式建列,过期清理只作用于 source='free_trial'。
ALTER TABLE lt_subscriptions ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'stripe';

-- 回填:现存无 stripe 订阅 id 的行 = 历史后台 comp 授予。
UPDATE lt_subscriptions SET source = 'comp'
 WHERE stripe_subscription_id IS NULL AND source = 'stripe';

ALTER TABLE lt_subscriptions DROP CONSTRAINT IF EXISTS lt_subscriptions_source_check;
ALTER TABLE lt_subscriptions ADD CONSTRAINT lt_subscriptions_source_check
  CHECK (source IN ('stripe', 'comp', 'free_trial'));

-- 过期清理 sweep 的支撑索引(表很小,主要是表达意图)。
CREATE INDEX IF NOT EXISTS idx_lt_subs_free_trial
  ON lt_subscriptions (status, current_period_end) WHERE source = 'free_trial';

-- 2) 一人一次免绑卡试用。
--    不能靠"有没有试用订阅行"判断 —— 那样删掉行就能反复重开。打一个不可逆的戳。
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS free_trial_started_at timestamptz;

-- 3) 顺手修一个真 bug:代码(profile.ts:43)早已支持四角色,DB CHECK 还停在两个,
--    → 选 agency/developer 会被 DB 拒掉。billing.ts 的 role 同步带 .catch 会把这个
--    错误静默吞掉,所以一直没人发现:telemetry 里 agency/developer「史上零人选过」
--    不是没人想选,是这条路本来就是坏的。
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('buyer', 'agent', 'agency', 'developer'));
