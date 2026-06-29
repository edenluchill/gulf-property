-- agent_runs — what the cx-guardian (and any future autonomous agent) did each
-- patrol, so the owner can SEE it in the dashboard instead of trusting a black box.
-- One row per patrol round: what it found, what it changed/deployed, who to follow
-- up, what it left for a human. Written by the agent at the end of each run.

CREATE TABLE IF NOT EXISTS agent_runs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent         TEXT NOT NULL DEFAULT 'cx-guardian',
  status        TEXT NOT NULL DEFAULT 'clean',   -- clean | fixed | needs_attention
  summary       TEXT,                            -- one-line human recap
  blocked_count INT NOT NULL DEFAULT 0,          -- real customers hitting errors
  lost_count    INT NOT NULL DEFAULT 0,          -- high-intent customers churning
  actions       JSONB NOT NULL DEFAULT '[]',     -- [{type:'fix'|'optimize', detail, commit?, deploy_tag?, verify?}]
  flagged       JSONB NOT NULL DEFAULT '[]',     -- [{identity, score, reason}] — who to reach out to
  needs_human   JSONB NOT NULL DEFAULT '[]'      -- [{detail, suggestion}] — risky/unclear, left for owner
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs (created_at DESC);
