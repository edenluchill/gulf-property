-- Market page performance objects (applied 2026-06-19 after the data.dubai rebuild).
-- The /api/market/{transactions,rent}/{summary,filters,projects} endpoints run
-- full-scan percentile_cont/mode/group-by aggregates over ~5M rows (6-14s cold).
-- Two fixes:
--   1. functional index on UPPER(area_name) so per-area drill-downs use an index
--      instead of scanning the whole table (the area filter uses UPPER(area_name)=X).
--   2. market_cache: tiny table holding the precomputed UNFILTERED defaults
--      (overall summary + filter dropdowns + all-projects) for both markets,
--      refreshed daily by the box timer via scripts/market-precompute.ts. The
--      endpoints serve these verbatim for the default page load (~0.2s vs 14s).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_upper_area_name
  ON dld_transactions (UPPER(area_name));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rent_upper_area_name
  ON dld_rent_contracts (UPPER(area_name));

CREATE TABLE IF NOT EXISTS market_cache (
  market     TEXT,                       -- 'tx' | 'rent'
  key        TEXT,                       -- 'summary' | 'filters' | 'projects:ALL'
  payload    JSONB NOT NULL,             -- the exact endpoint response for the default
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (market, key)
);
