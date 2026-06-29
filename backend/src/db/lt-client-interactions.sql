-- lt_client_interactions — an agent's follow-up log per client (call / WhatsApp /
-- meeting / viewing / note), turning the client profile from a static card into a
-- "who do I chase next" workbench. agent_id stored alongside client_id for strict
-- per-agent isolation AND owner cross-agent queries. See agent-router /clients.

CREATE TABLE IF NOT EXISTS lt_client_interactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES lt_clients(id) ON DELETE CASCADE,
  agent_id         uuid NOT NULL,                 -- denormalised for isolation + owner views
  kind             text NOT NULL DEFAULT 'note',  -- note|call|whatsapp|email|meeting|viewing
  note             text,
  outcome          text,                          -- interested|follow_up|not_interested|closed_won|closed_lost
  next_followup_at timestamptz,                   -- when to chase again
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lt_client_interactions      ON lt_client_interactions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_client_interactions_due  ON lt_client_interactions (agent_id, next_followup_at) WHERE next_followup_at IS NOT NULL;
