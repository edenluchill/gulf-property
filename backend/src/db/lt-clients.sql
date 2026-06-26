-- ===========================================================================
-- Extend the existing luna-tour CRM `lt_clients` (id, agent_id, name, email,
-- phone, goal, budget_min/max, pipeline_stage, lead_score, notes…) with the
-- fields the agent client-profile UI uses. Non-destructive (ADD IF NOT EXISTS) —
-- coexists with the existing CRM columns.
--   Agent creates a client → generates an investment proposal or tour from it.
-- ===========================================================================
ALTER TABLE lt_clients ADD COLUMN IF NOT EXISTS avatar_url   text;  -- cartoon avatar (DiceBear)
ALTER TABLE lt_clients ADD COLUMN IF NOT EXISTS background   text;  -- 背景介绍
ALTER TABLE lt_clients ADD COLUMN IF NOT EXISTS budget       text;  -- 资金介绍 (free text)
ALTER TABLE lt_clients ADD COLUMN IF NOT EXISTS expectations text;  -- 期待
ALTER TABLE lt_clients ADD COLUMN IF NOT EXISTS traits       text;  -- 人物特色

-- Link generated proposals back to a client (nullable — older reports have none).
ALTER TABLE lt_client_reports ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES lt_clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lt_client_reports_client ON lt_client_reports(client_id);
