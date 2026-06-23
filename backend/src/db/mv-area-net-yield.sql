-- Materialize v_area_net_yield. The view does percentile_cont over v_sales (763k)
-- + v_rent (2.9M) + the service-charge rollups on EVERY call, so anything joining it
-- (the map's /api/dubai/areas, and recommend/investment/report) paid ~4–12s per
-- request. The result is only ~104 rows and changes once a day (after the sync), so
-- precompute it into a table and refresh daily.
--
-- Refreshed by scripts/refresh-derived.ts (called after the daily sync) and re-run
-- here whenever the view definition changes.
DROP MATERIALIZED VIEW IF EXISTS mv_area_net_yield;
CREATE MATERIALIZED VIEW mv_area_net_yield AS SELECT * FROM v_area_net_yield;
-- Unique index → enables REFRESH ... CONCURRENTLY (no read lock during refresh).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_area_net_yield_id ON mv_area_net_yield(dubai_area_id);
