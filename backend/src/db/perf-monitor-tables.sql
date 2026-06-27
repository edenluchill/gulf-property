-- Performance monitor tables (see docs/reports/2026-06-27-scale-assessment-and-perf-monitor.md)
-- Run with: cd backend && npx ts-node scripts/db-runner.ts src/db/perf-monitor-tables.sql
-- Idempotent — safe to re-run.

-- One row per minute: rolling aggregate flushed by services/perfMonitor.ts.
-- ~1440 rows/day; prune beyond 30 days via the housekeeping DELETE below.
CREATE TABLE IF NOT EXISTS perf_minute (
  minute            timestamptz PRIMARY KEY,
  req               integer NOT NULL DEFAULT 0,
  err4              integer NOT NULL DEFAULT 0,
  err5              integer NOT NULL DEFAULT 0,
  slow_req          integer NOT NULL DEFAULT 0,
  query_count       integer NOT NULL DEFAULT 0,
  slow_query        integer NOT NULL DEFAULT 0,
  p50               integer NOT NULL DEFAULT 0,
  p95               integer NOT NULL DEFAULT 0,
  p99               integer NOT NULL DEFAULT 0,
  max_ms            integer NOT NULL DEFAULT 0,
  peak_concurrency  integer NOT NULL DEFAULT 0,
  pool_total        integer NOT NULL DEFAULT 0,
  pool_waiting      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_perf_minute_minute ON perf_minute (minute DESC);

-- One row per threshold breach. resolved_at IS NULL ⇒ still firing (drives the
-- Admin red banner). kind is the rule id; a kind can have at most one active row.
CREATE TABLE IF NOT EXISTS perf_alerts (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  kind        text NOT NULL,
  severity    text NOT NULL DEFAULT 'warning',
  metric      numeric,
  threshold   numeric,
  window_s    integer,
  message     text,
  emailed     boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_perf_alerts_active
  ON perf_alerts (kind) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_perf_alerts_created ON perf_alerts (created_at DESC);
