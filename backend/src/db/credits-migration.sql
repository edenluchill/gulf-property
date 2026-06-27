-- ============================================================
-- 积分制计费迁移 (2026-06-27)
-- 从"每功能固定次数"改为"每月发积分,用功能扣积分,每月清零刷新"。
-- 功能成本在代码配置 backend/src/luna-tour/credits.ts(单一真相源)。
-- 这里只放套餐级参数:credits_month(月额度)+ cost_multiplier(Founder 扣得便宜)。
-- ============================================================

-- 本月已花积分(按 agent+period_month 分行 → 新月自动归零刷新,无需定时任务)
ALTER TABLE lt_usage_counters ADD COLUMN IF NOT EXISTS credits_used int NOT NULL DEFAULT 0;

-- 套餐积分额度 + 消耗折扣(写进 limits jsonb,/plans 与价格页可读)
UPDATE lt_subscription_plans SET limits = limits || '{"credits_month":0,     "cost_multiplier":1}'::jsonb   WHERE id = 'explore';
UPDATE lt_subscription_plans SET limits = limits || '{"credits_month":2500,  "cost_multiplier":1}'::jsonb   WHERE id = 'agent';
UPDATE lt_subscription_plans SET limits = limits || '{"credits_month":15000, "cost_multiplier":0.6}'::jsonb WHERE id = 'founder';
