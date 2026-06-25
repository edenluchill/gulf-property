-- ===========================================================================
-- DLD project geocode cache (immutable, generate-once)
--
-- WHY: DLD transactions have no coordinates, only text (area_name, project_name,
-- building_name). Colleague-drawn custom area polygons don't align to official
-- DLD communities or to a single master_project, so neither the area_id bridge
-- nor master_project filtering works for them. The general fix: geocode each
-- UNIQUE (area_name, project_name) once → a stable point → then ANY polygon can
-- capture its transactions via ST_Covers. A development's location never moves,
-- so this is a generate-once cache (ON CONFLICT DO NOTHING); only newly-appearing
-- projects get geocoded incrementally. Far more stable than a daily aggregate.
--
-- Populated by scripts/geocode-dld-projects.ts (Google Geocoding, Dubai-biased).
-- See docs/reports/2026-06-24-transaction-rent-matching-accuracy.md (P5).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS dld_project_locations (
  area_name    text NOT NULL,
  project_name text NOT NULL,
  lat          double precision,
  lng          double precision,
  geom         geography(Point, 4326),     -- NULL when geocoding failed
  source       text,                        -- 'google' | 'project_table' | 'failed'
  tx_count     integer,                     -- transactions for this key (priority/diagnostics)
  geocoded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (area_name, project_name)
);

-- Spatial index → fast ST_Covers(polygon, geom) for area lookups.
CREATE INDEX IF NOT EXISTS idx_dld_proj_loc_geom ON dld_project_locations USING gist (geom);
