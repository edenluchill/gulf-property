-- ============================================================
-- Stripe billing 接入迁移 (2026-06-25)
-- 设计稿: docs/stripe-billing-spec.md
--
-- 复用现有 lt_subscriptions / lt_subscription_plans / lt_usage_counters。
-- 计费身份挂在 lt_agents.id 上(经纪进台时 ensureAgent 已建该行)。
-- sessions_month = Luna AI tours/月 → 现有配额代码 sessionUsage 不动即生效。
-- 价格统一为 USD(营销页:Explore 免费 / Agent $99 / Founder $699)。
-- ============================================================

-- 1) lt_agents 记一个永久 Stripe customer(一经纪一 customer)
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS stripe_customer_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_agents_stripe_customer
  ON lt_agents (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- 2) 套餐目录加 USD 价格列
ALTER TABLE lt_subscription_plans ADD COLUMN IF NOT EXISTS price_usd_month numeric;

-- 3) lt_subscriptions: 一个 Stripe 订阅唯一,幂等 upsert 用
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_subs_stripe_sub
  ON lt_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lt_subs_stripe_customer
  ON lt_subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- 4) 重建套餐种子为 explore / agent / founder (USD)
--    limits: sessions_month = Luna AI tours/月(沿用现有计量口径)
--            live_tours_month / reports_month = 实时带看 / 买家意向报告 配额
INSERT INTO lt_subscription_plans (id, name, price_aed_month, price_usd_month, limits) VALUES
  ('explore', 'Explore', 0,   0,
     '{"sessions_month":2,"live_tours_month":0,"reports_month":2,"seats":1,"white_label":false}'::jsonb),
  ('agent',   'Agent',   99,  99,
     '{"sessions_month":20,"live_tours_month":20,"reports_month":30,"seats":1,"white_label":false}'::jsonb),
  ('founder', 'Founder', 699, 699,
     '{"sessions_month":200,"live_tours_month":200,"reports_month":300,"seats":1,"white_label":true,"price_locked":true,"priority_support":true}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      price_aed_month = EXCLUDED.price_aed_month,
      price_usd_month = EXCLUDED.price_usd_month,
      limits = EXCLUDED.limits;

-- 5) 清掉旧的 free/pro/team(仅在没有订阅引用它们时)
DELETE FROM lt_subscription_plans
 WHERE id IN ('free', 'pro', 'team')
   AND id NOT IN (SELECT DISTINCT plan_id FROM lt_subscriptions WHERE plan_id IS NOT NULL);

-- 6) stripe_price_id 在 Stripe dashboard 建好 Price 后回填(或用 env STRIPE_PRICE_AGENT/FOUNDER 覆盖):
--    UPDATE lt_subscription_plans SET stripe_price_id = 'price_xxx' WHERE id = 'agent';
--    UPDATE lt_subscription_plans SET stripe_price_id = 'price_yyy' WHERE id = 'founder';
