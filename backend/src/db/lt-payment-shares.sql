-- ===========================================================================
-- Shareable payment-plan quotes (经纪选户型 + 填实际报价 → 客户免登录查看).
-- Developers only publish starting prices at launch; the real quote varies by
-- floor/orientation, so the agent types the actual price and shares /pp/:code.
-- Created via POST /api/luna/public/payplan, read via GET /api/luna/public/payplan/:code.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS lt_payment_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code       text NOT NULL UNIQUE,          -- → /pp/:share_code (public)
  project_id       uuid NOT NULL,                 -- soft ref to residential_projects
  agent_id         uuid REFERENCES lt_agents(id) ON DELETE SET NULL,  -- optional branding
  unit_name        text,                          -- e.g. "TOWER A 2BEDROOM B1"
  bedrooms         integer,
  price            numeric NOT NULL,              -- agent-entered actual quote (AED)
  lang             text NOT NULL DEFAULT 'zh',
  created_by_email text,
  view_count       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lt_payment_shares_code    ON lt_payment_shares(share_code);
CREATE INDEX IF NOT EXISTS idx_lt_payment_shares_project ON lt_payment_shares(project_id);
