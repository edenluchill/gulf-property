-- ===========================================================================
-- Lead engine (把匿名行为变成可联系、可评分的 lead)
--
-- 抓到联系方式后,leads.visitor_id 关联 app_events,该访客的全部历史行为立刻
-- 可归因。lead_score 由 services/leadScoring.ts 从 app_events 计算后写回。
-- intent 是推断出的可变结构(预算/区域/项目)→ JSONB。
--
-- 决策(2026-06-17):不发邮件提醒;热 lead 仅在 dashboard 按分置顶呈现。
-- alerted_at 预留给将来的主动提醒。详见 docs/analytics-dashboard-spec.md §6。
-- ===========================================================================

CREATE TABLE IF NOT EXISTS leads (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  visitor_id    TEXT UNIQUE,              -- 关联 app_events.visitor_id
  name          TEXT,
  email         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  source        TEXT,                     -- luna | search_form | tutorial_cta | manual
  intent        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { areas[], project_ids[], searches, property_views, opened_luna }
  lead_score    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new',  -- new | contacted | qualified | lost
  alerted_at    TIMESTAMPTZ,              -- 预留:已主动提醒所有者的时间(现在不用)
  last_seen_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads (lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_visitor  ON leads (visitor_id);
CREATE INDEX IF NOT EXISTS idx_leads_created  ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads (status);
