-- ===========================================================================
-- Agent-branded, shareable per-project reports.
-- One report per (agent, project); /r/:share_code is a public trust-building page
-- (agent avatar + contact + project data + DLD evidence + supply). See
-- luna-tour agent-router (create) + public-router (read).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lt_project_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     uuid NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL,            -- soft ref to residential_projects
  share_code   text NOT NULL UNIQUE,     -- → /r/:share_code (public)
  title        text,
  is_published boolean NOT NULL DEFAULT true,
  view_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_lt_project_reports_code  ON lt_project_reports(share_code);
CREATE INDEX IF NOT EXISTS idx_lt_project_reports_agent ON lt_project_reports(agent_id);
