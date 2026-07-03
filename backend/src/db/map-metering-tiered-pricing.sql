-- ============================================================
-- 地图计量 + 三档定价 + 角色 + 变更审计 + Founder 席位 (2026-07-03)
-- 设计稿: docs/map-metering-and-tiered-pricing-plan-2026-07-03.md
-- ============================================================

-- 1) 匿名地图用量:活跃分钟桶(visitor_id 与 IP hash 各一份,主键天然去重)。
--    day 由应用按 Asia/Dubai 计算传入,额度每日迪拜午夜刷新。
CREATE TABLE IF NOT EXISTS anon_map_usage (
  identity_key text NOT NULL,        -- 'v:{visitor_id}' | 'ip:{sha256(ip) 前16位}'
  day date NOT NULL,
  minute_bucket smallint NOT NULL,   -- 当天第 N 分钟 (0-1439)
  PRIMARY KEY (identity_key, day, minute_bucket)
);
CREATE INDEX IF NOT EXISTS idx_anon_map_usage_day ON anon_map_usage (day);

-- 2) 用户角色(type):登录用户是买家还是经纪。买家免费;经纪走订阅。
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id uuid PRIMARY KEY,          -- Supabase auth user id
  email text,
  role text CHECK (role IN ('buyer', 'agent')),
  role_chosen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles (role);

-- 3) 套餐变更审计:谁在什么时候 从哪档→哪档、为什么(Stripe 取消原因回填)。
CREATE TABLE IF NOT EXISTS plan_change_log (
  id bigserial PRIMARY KEY,
  agent_id uuid NOT NULL,
  agent_email text,
  action text NOT NULL,              -- subscribed/upgraded/downgraded/cancel_scheduled/cancel_reverted/canceled/past_due/recovered/trial_started/seats_changed/interval_changed
  from_plan text,
  to_plan text,
  from_status text,
  to_status text,
  reason text,                       -- Stripe cancellation_details.feedback + comment
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_agent ON plan_change_log (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_change_log_time ON plan_change_log (created_at DESC);

-- 4) Founder 席位:计费归属指针。NULL = 自己付费;指向某 founder = 该团队席位成员,
--    积分统一扣在 founder 的 lt_usage_counters 上(credits.ts 解析)。
ALTER TABLE lt_agents ADD COLUMN IF NOT EXISTS billing_agent_id uuid REFERENCES lt_agents(id);
CREATE INDEX IF NOT EXISTS idx_lt_agents_billing_agent
  ON lt_agents (billing_agent_id) WHERE billing_agent_id IS NOT NULL;

-- 加席数量(Stripe 订阅第二 line item 的 quantity,webhook 镜像)。
ALTER TABLE lt_subscriptions ADD COLUMN IF NOT EXISTS extra_seats int NOT NULL DEFAULT 0;
-- 是否已预约到期取消(webhook 镜像;审计靠新旧对比识别 cancel_scheduled/cancel_reverted)。
ALTER TABLE lt_subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

-- 5) 价格映射落 DB(env 仍可覆盖):月付沿用 stripe_price_id,补年付/席位列。
ALTER TABLE lt_subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_id_year text;
ALTER TABLE lt_subscription_plans ADD COLUMN IF NOT EXISTS stripe_price_id_seat text;  -- 仅 founder 行使用

-- 6) 新档:Starter(启程版)$25/月,200 积分,无 live/luna tour(minPlan 门在 credits.ts)。
INSERT INTO lt_subscription_plans (id, name, price_aed_month, price_usd_month, limits) VALUES
  ('rookie', 'Starter', 25, 25,
   '{"seats":1,"white_label":false,"credits_month":200,"cost_multiplier":1,
     "sessions_month":0,"live_tours_month":0,"reports_month":10,"brochures_month":5}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      price_aed_month = EXCLUDED.price_aed_month,
      price_usd_month = EXCLUDED.price_usd_month,
      limits = lt_subscription_plans.limits || EXCLUDED.limits;

-- 7) Founder 含 3 席(加席另购)。
UPDATE lt_subscription_plans SET limits = limits || '{"seats":3}'::jsonb WHERE id = 'founder';
