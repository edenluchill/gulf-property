-- ============================================================
-- Luna Tour — 经纪 demo SaaS schema
-- 目标库:现有 Postgres(backend/.env 的 DB_*),非 Supabase 存储
-- 隔离设计:所有表 lt_ 前缀;一键拆除见 luna-tour-teardown.sql
-- 鉴权:lt_agents 同时支持「复用现有 Supabase 登录」(auth_user_id)
--      或「本地邮箱密码」(password_hash);二者皆可空,按需取一。
-- 对既有表(residential_projects 等)只用普通 uuid 列,不加跨表 FK,
--      避免在已有生产库上建表失败 / 迁移耦合。
-- 幂等:全部 IF NOT EXISTS,可重复执行。
-- 运行:cd backend && npx ts-node scripts/db-runner.ts src/db/luna-tour-schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ---------- 通用 updated_at 触发器(仅 Luna Tour 用)----------
CREATE OR REPLACE FUNCTION lt_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. 经纪行 / 经纪
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_brokerages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  logo_url      text,
  primary_color text,
  custom_domain text UNIQUE,
  rera_orn      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lt_agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    text UNIQUE,                          -- 复用现有 Supabase 登录时存其 user id
  brokerage_id    uuid REFERENCES lt_brokerages(id) ON DELETE SET NULL,
  role            text NOT NULL DEFAULT 'agent',        -- agent | brokerage_admin
  email           text UNIQUE,
  password_hash   text,                                 -- 本地邮箱密码登录时用(bcrypt),可空
  display_name    text NOT NULL,
  phone           text,
  whatsapp        text,
  rera_brn        text,
  photo_url       text,
  brand           jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_config_id uuid,                               -- 软引用 lt_demo_configs(id)
  onboarding_done boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_agents_brokerage ON lt_agents(brokerage_id);
CREATE INDEX IF NOT EXISTS idx_lt_agents_email ON lt_agents(email);
CREATE INDEX IF NOT EXISTS idx_lt_agents_authuser ON lt_agents(auth_user_id);
DROP TRIGGER IF EXISTS trg_lt_agents_updated ON lt_agents;
CREATE TRIGGER trg_lt_agents_updated BEFORE UPDATE ON lt_agents
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ============================================================
-- 2. 客户档案(CRM)
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  name            text NOT NULL,
  email           text,
  phone           text,
  whatsapp        text,
  nationality     text,
  preferred_language text DEFAULT 'en',
  goal            text,                                 -- invest_growth|invest_rent|invest_both|self_use|self_invest
  budget_min      numeric,
  budget_max      numeric,
  bedrooms        text,                                 -- studio|1|2|3+
  family_size     int,
  has_children    boolean,
  preferred_areas text[],
  preferences     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_stage  text NOT NULL DEFAULT 'new',          -- new|engaged|viewing|offer|closed|lost
  lead_score      int NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_clients_agent ON lt_clients(agent_id);
CREATE INDEX IF NOT EXISTS idx_lt_clients_stage ON lt_clients(agent_id, pipeline_stage);
DROP TRIGGER IF EXISTS trg_lt_clients_updated ON lt_clients;
CREATE TRIGGER trg_lt_clients_updated BEFORE UPDATE ON lt_clients
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ============================================================
-- 3. Demo 配置 / 模板(Playbook)
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_demo_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_agent_id  uuid REFERENCES lt_agents(id) ON DELETE CASCADE,
  brokerage_id    uuid REFERENCES lt_brokerages(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  scope           text NOT NULL DEFAULT 'agent',        -- agent|brokerage|platform
  is_locked       boolean NOT NULL DEFAULT false,
  config          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (owner_agent_id IS NOT NULL OR brokerage_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_lt_configs_agent ON lt_demo_configs(owner_agent_id);
CREATE INDEX IF NOT EXISTS idx_lt_configs_brokerage ON lt_demo_configs(brokerage_id);
DROP TRIGGER IF EXISTS trg_lt_configs_updated ON lt_demo_configs;
CREATE TRIGGER trg_lt_configs_updated BEFORE UPDATE ON lt_demo_configs
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ============================================================
-- 4. Demo Session(核心可分享对象,发布即快照)
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_demo_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  client_id           uuid REFERENCES lt_clients(id) ON DELETE SET NULL,
  config_id           uuid REFERENCES lt_demo_configs(id) ON DELETE SET NULL,
  title               text NOT NULL,
  share_code          text NOT NULL UNIQUE,             -- 不可猜短码 → /v/{share_code}
  status              text NOT NULL DEFAULT 'draft',    -- draft|generating|review|published|archived
  effective_config    jsonb,
  data_as_of          date,
  theme               jsonb NOT NULL DEFAULT '{}'::jsonb,
  og_image_url        text,
  reveal_snapshot_url text,
  is_published        boolean NOT NULL DEFAULT false,
  passcode            text,
  expires_at          timestamptz,
  view_limit          int,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_sessions_share ON lt_demo_sessions(share_code);
CREATE INDEX IF NOT EXISTS idx_lt_sessions_agent ON lt_demo_sessions(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_lt_sessions_client ON lt_demo_sessions(client_id);
DROP TRIGGER IF EXISTS trg_lt_sessions_updated ON lt_demo_sessions;
CREATE TRIGGER trg_lt_sessions_updated BEFORE UPDATE ON lt_demo_sessions
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- 选中的房源(含排序 + 强调 + 冻结快照)。project_id 软引用 residential_projects(id)
CREATE TABLE IF NOT EXISTS lt_session_properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  project_id      uuid,                                 -- 软引用 residential_projects(id)
  unit_type_id    uuid,
  sort_order      int NOT NULL DEFAULT 0,
  agent_pitch     text,
  emphasis        jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 价格/yield/growth/ROI/坐标/距离/amenity 全冻结
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_sessprop_session ON lt_session_properties(session_id, sort_order);

-- 预生成导览脚本(TourScript v2)。每语言一份
CREATE TABLE IF NOT EXISTS lt_tour_scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  language        text NOT NULL DEFAULT 'en',
  voice           text NOT NULL DEFAULT 'Aoede',
  script          jsonb NOT NULL,                       -- TourScript v2
  total_ms        int,
  edited_by_agent boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, language)
);
CREATE INDEX IF NOT EXISTS idx_lt_tour_session ON lt_tour_scripts(session_id);
DROP TRIGGER IF EXISTS trg_lt_tour_updated ON lt_tour_scripts;
CREATE TRIGGER trg_lt_tour_updated BEFORE UPDATE ON lt_tour_scripts
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- 经纪挑选/手填的新闻、政策、背景
CREATE TABLE IF NOT EXISTS lt_session_news_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text,
  source_url      text,
  published_date  date,
  category        text,                                 -- policy|infrastructure|market|news
  sort_order      int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lt_news_session ON lt_session_news_items(session_id, sort_order);

-- 预生成音频资产(R2)
CREATE TABLE IF NOT EXISTS lt_audio_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  beat_id         text NOT NULL,
  language        text NOT NULL DEFAULT 'en',
  voice           text NOT NULL DEFAULT 'Aoede',
  r2_url          text,
  status          text NOT NULL DEFAULT 'pending',      -- pending|ready|failed
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, beat_id, language)
);
CREATE INDEX IF NOT EXISTS idx_lt_audio_session ON lt_audio_assets(session_id);
DROP TRIGGER IF EXISTS trg_lt_audio_updated ON lt_audio_assets;
CREATE TRIGGER trg_lt_audio_updated BEFORE UPDATE ON lt_audio_assets
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ============================================================
-- 5. 客户互动:遥测 + 反馈
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_engagement_events (
  id              bigserial PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  visitor_id      text NOT NULL,
  event_type      text NOT NULL,                        -- open|property_view|property_dwell|tour_play|
                                                        -- tour_complete|tour_replay|chart_view|cta_call|
                                                        -- cta_whatsapp|feedback|schedule|ask
  project_id      uuid,
  dwell_ms        int,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ua              text,
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_events_session ON lt_engagement_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lt_events_type ON lt_engagement_events(session_id, event_type);

CREATE TABLE IF NOT EXISTS lt_client_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES lt_demo_sessions(id) ON DELETE CASCADE,
  project_id      uuid,
  visitor_id      text NOT NULL,
  reaction        text,                                 -- love|like|dislike|maybe
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_feedback_session ON lt_client_feedback(session_id);

-- 派生:线索热度(物化视图,定时刷新)
DROP MATERIALIZED VIEW IF EXISTS lt_session_lead_scores;
CREATE MATERIALIZED VIEW lt_session_lead_scores AS
SELECT
  s.id AS session_id,
  s.agent_id,
  s.client_id,
  count(*) FILTER (WHERE e.event_type='open')          AS opens,
  count(*) FILTER (WHERE e.event_type='tour_complete') AS tour_completes,
  count(*) FILTER (WHERE e.event_type='tour_replay')   AS tour_replays,
  count(*) FILTER (WHERE e.event_type IN ('cta_call','cta_whatsapp')) AS cta_clicks,
  coalesce(sum(e.dwell_ms),0)                          AS total_dwell_ms,
  max(e.created_at)                                    AS last_seen_at,
  (count(*) FILTER (WHERE e.event_type='open')*1
   + count(*) FILTER (WHERE e.event_type='tour_complete')*5
   + count(*) FILTER (WHERE e.event_type='tour_replay')*3
   + count(*) FILTER (WHERE e.event_type IN ('cta_call','cta_whatsapp'))*10
   + LEAST(coalesce(sum(e.dwell_ms),0)/60000, 20))     AS lead_score
FROM lt_demo_sessions s
LEFT JOIN lt_engagement_events e ON e.session_id = s.id
GROUP BY s.id, s.agent_id, s.client_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_lead_scores ON lt_session_lead_scores(session_id);

-- ============================================================
-- 6. 订阅与计费(Stripe)
-- ============================================================
CREATE TABLE IF NOT EXISTS lt_subscription_plans (
  id              text PRIMARY KEY,                     -- free|pro|team
  name            text NOT NULL,
  price_aed_month numeric NOT NULL,
  stripe_price_id text,
  limits          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lt_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  brokerage_id    uuid REFERENCES lt_brokerages(id) ON DELETE CASCADE,
  plan_id         text NOT NULL REFERENCES lt_subscription_plans(id),
  status          text NOT NULL,                        -- trialing|active|past_due|canceled
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  seats           int NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_subs_agent ON lt_subscriptions(agent_id);
DROP TRIGGER IF EXISTS trg_lt_subs_updated ON lt_subscriptions;
CREATE TRIGGER trg_lt_subs_updated BEFORE UPDATE ON lt_subscriptions
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE TABLE IF NOT EXISTS lt_usage_counters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  period_month    date NOT NULL,
  sessions_created int NOT NULL DEFAULT 0,
  live_minutes    numeric NOT NULL DEFAULT 0,
  tts_chars       bigint NOT NULL DEFAULT 0,
  pdf_pages       int NOT NULL DEFAULT 0,
  UNIQUE(agent_id, period_month)
);

-- ---------- 默认订阅档位种子 ----------
INSERT INTO lt_subscription_plans (id, name, price_aed_month, limits) VALUES
  ('free', 'Free', 0,   '{"clients":3,"sessions_month":3,"live_minutes_month":0,"seats":1,"white_label":false}'::jsonb),
  ('pro',  'Pro', 199,  '{"clients":50,"sessions_month":50,"live_minutes_month":60,"seats":1,"white_label":false}'::jsonb),
  ('team', 'Team', 299, '{"clients":-1,"sessions_month":-1,"live_minutes_month":200,"seats":1,"white_label":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;
