-- ===========================================================================
-- Agent's client profiles (lightweight CRM). The agent creates a client first
-- (cartoon avatar + background + funds + expectations + traits), then from the
-- client generates an investment proposal or a tour. Reports link back via
-- lt_client_reports.client_id.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lt_clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  name         text NOT NULL,
  avatar_url   text,                 -- cartoon avatar (DiceBear URL)
  background   text,                 -- 背景介绍
  budget       text,                 -- 资金介绍 (free text, e.g. "300万 AED 现金")
  expectations text,                 -- 期待 (e.g. "5年回报 / 自住 / 学区")
  traits       text,                 -- 人物特色 (e.g. "谨慎 / 看重品牌开发商")
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_clients_agent ON lt_clients(agent_id, created_at DESC);

-- Link generated proposals to a client (nullable — older reports have none).
ALTER TABLE lt_client_reports ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES lt_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lt_client_reports_client ON lt_client_reports(client_id);
