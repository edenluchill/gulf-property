-- ===========================================================================
-- Comprehensive client investment proposals (the agent /agent/report output).
-- Generated async (progress shown), enriched with real DLD data per project +
-- an overall market/policy/trend section, shareable at /cr/:share_code, PDF via
-- browser print. See luna agent-router (generate/status) + public-router (read).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lt_client_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  share_code  text NOT NULL UNIQUE,         -- → /cr/:share_code (public)
  client_name text,
  brief       text,
  status      text NOT NULL DEFAULT 'generating',  -- generating | ready | error
  progress    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ key, label, done }]
  report      jsonb,                         -- the full enriched report
  view_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_client_reports_code  ON lt_client_reports(share_code);
CREATE INDEX IF NOT EXISTS idx_lt_client_reports_agent ON lt_client_reports(agent_id, created_at DESC);
