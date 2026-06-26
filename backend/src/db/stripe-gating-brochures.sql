-- ============================================================
-- AI 楼书解析 gating 迁移 (2026-06-26)
-- 楼书解析(上传开发商 PDF → AI 结构化房源)纳入订阅 gating。
-- 免费档 0;Agent 10/月;Founder 100/月。owner 无限(代码内 bypass)。
-- ============================================================

-- 月度计数列
ALTER TABLE lt_usage_counters ADD COLUMN IF NOT EXISTS brochures_parsed int NOT NULL DEFAULT 0;

-- 各档额度(brochures_month)
UPDATE lt_subscription_plans SET limits = limits || '{"brochures_month":0}'::jsonb   WHERE id = 'explore';
UPDATE lt_subscription_plans SET limits = limits || '{"brochures_month":10}'::jsonb  WHERE id = 'agent';
UPDATE lt_subscription_plans SET limits = limits || '{"brochures_month":100}'::jsonb WHERE id = 'founder';
