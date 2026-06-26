-- ============================================================
-- 订阅 gating 强化迁移 (2026-06-25)
-- 设计稿: docs/stripe-billing-spec.md §6 (gating)
--
-- 1) 免费 Explore 档对经纪工具硬归零 → 没订阅的经纪用不了任何高级功能(用户决策:"完全不给,必须订阅")
-- 2) lt_usage_counters 增加按功能计数列:报告、实时带看(Luna 导览沿用 sessions_created)
-- ============================================================

-- 1) 用量计数列(按月,与 sessions_created 同表)
ALTER TABLE lt_usage_counters ADD COLUMN IF NOT EXISTS reports_created    int NOT NULL DEFAULT 0;
ALTER TABLE lt_usage_counters ADD COLUMN IF NOT EXISTS live_tours_created int NOT NULL DEFAULT 0;

-- 2) 免费 Explore 档:经纪工具额度全部归零(买家的地图/DLD/Luna语音是另一套公开端点,不受影响)
UPDATE lt_subscription_plans
   SET limits = jsonb_set(jsonb_set(jsonb_set(
         limits,
         '{sessions_month}', '0'),
         '{live_tours_month}', '0'),
         '{reports_month}', '0')
 WHERE id = 'explore';

-- 3) 确认 agent / founder 额度(幂等,保持营销页口径)
UPDATE lt_subscription_plans
   SET limits = limits || '{"sessions_month":20,"live_tours_month":20,"reports_month":30}'::jsonb
 WHERE id = 'agent';
UPDATE lt_subscription_plans
   SET limits = limits || '{"sessions_month":200,"live_tours_month":200,"reports_month":300}'::jsonb
 WHERE id = 'founder';
