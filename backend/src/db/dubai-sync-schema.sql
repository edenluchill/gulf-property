-- ============================================================================
-- Dubai data.dubai sync — audit & cursor tables
-- Run once:  cd backend && npx ts-node scripts/db-runner.ts src/db/dubai-sync-schema.sql
-- Additive only (CREATE IF NOT EXISTS). Safe to re-run.
-- ============================================================================

-- One row per sync run. Query for debugging:
--   SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 20;
CREATE TABLE IF NOT EXISTS sync_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key   VARCHAR(80) NOT NULL,
  mode          VARCHAR(20) NOT NULL,          -- 'full' | 'incremental' | 'full+dry' | 'incremental+dry'
  status        VARCHAR(20) NOT NULL,          -- 'running' | 'success' | 'failed' | 'partial'
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  pages_fetched INTEGER DEFAULT 0,
  rows_read     INTEGER DEFAULT 0,
  rows_upserted INTEGER DEFAULT 0,
  error_count   INTEGER DEFAULT 0,
  cursor_before TEXT,
  cursor_after  TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_dataset ON sync_runs(dataset_key, started_at DESC);

-- Per-page / per-run errors, with a payload sample for post-mortem.
CREATE TABLE IF NOT EXISTS sync_run_errors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID REFERENCES sync_runs(id),
  page           INTEGER,
  http_status    INTEGER,
  message        TEXT,
  payload_sample TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sync_run_errors_run ON sync_run_errors(run_id);

-- Incremental cursor: where each dataset's last successful sync got to
-- (usually max(load_timestamp)).
CREATE TABLE IF NOT EXISTS sync_cursors (
  dataset_key  VARCHAR(80) PRIMARY KEY,
  last_value   TEXT,
  last_run_id  UUID,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
