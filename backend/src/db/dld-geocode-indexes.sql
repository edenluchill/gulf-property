-- ===========================================================================
-- Composite indexes for the spatial geocode join.
--
-- The area-insights spatial path joins dld_transactions / dld_rent_contracts to
-- dld_project_locations on (area_name, project_name). With only an area_name
-- index, each nested-loop probe bitmap-scanned ~31k rows/area then filtered by
-- project — ~830ms for a busy area. A composite (area_name, project_name) index
-- turns each probe into a tight lookup. Plain CREATE INDEX (batch-import tables,
-- brief write lock is fine).
-- ===========================================================================
CREATE INDEX IF NOT EXISTS idx_rent_area_project ON dld_rent_contracts (area_name, project_name);
CREATE INDEX IF NOT EXISTS idx_tx_area_project   ON dld_transactions   (area_name, project_name);
CREATE INDEX IF NOT EXISTS idx_tx_area_building  ON dld_transactions   (area_name, building_name);
