-- api_calls — server-side attribution of business API hits to the customer who
-- made them. Complements the semantic, frontend-emitted app_events (which says
-- "user favorited X"); this says "this visitor/user actually fetched project X's
-- data / area Y's market intelligence", filling the blind spot where a successful
-- GET left no trace of who triggered it.
--
-- Written fire-and-forget from a res.on('finish') hook (middleware/attribution.ts),
-- SAMPLED so it never becomes a firehose: all writes (POST/PUT/PATCH/DELETE) +
-- a curated allowlist of meaningful reads. High-frequency map/viewport/poll GETs
-- are intentionally NOT recorded.

CREATE TABLE IF NOT EXISTS api_calls (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,            -- request path (with ids, without query string)
  status      INT,
  duration_ms INT,
  visitor_id  TEXT,                     -- anonymous browser id (X-Visitor-Id)
  user_id     TEXT,                     -- supabase user.id once logged in
  user_email  TEXT,
  is_admin    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_api_calls_created  ON api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_visitor  ON api_calls (visitor_id);
CREATE INDEX IF NOT EXISTS idx_api_calls_email    ON api_calls (user_email);
