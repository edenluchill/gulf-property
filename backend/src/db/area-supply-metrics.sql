-- ===========================================================================
-- Area supply pipeline — from dld_projects, bridged to dubai_areas via dld_areas.
-- The #1 missing investment signal: how many off-plan units are coming per area.
-- A VIEW (always fresh after the weekly dld_projects sync) — no recompute needed.
-- Per-project 1:1 matching to our catalog is unreliable (dld project_name is
-- Arabic, master_project_en too coarse), but AREA-level aggregation via area_id
-- is clean and high-value.
-- ===========================================================================
CREATE OR REPLACE VIEW v_area_supply AS
  SELECT
    da.id AS dubai_area_id,
    da.name AS area_name,
    COUNT(*) FILTER (WHERE dp.project_status IN ('ACTIVE','NOT_STARTED','PENDING','CONDITIONAL_ACTIVATING')) AS pipeline_projects,
    COUNT(*) FILTER (WHERE dp.project_status = 'ACTIVE')      AS active_projects,
    COUNT(*) FILTER (WHERE dp.project_status = 'FINISHED')    AS finished_projects,
    COALESCE(SUM(dp.no_of_units) FILTER (WHERE dp.project_status IN ('ACTIVE','NOT_STARTED','PENDING','CONDITIONAL_ACTIVATING')), 0)::bigint AS units_pipeline,
    COALESCE(SUM(dp.no_of_units) FILTER (WHERE dp.project_status = 'ACTIVE'), 0)::bigint AS units_active,
    ROUND(AVG(dp.percent_completed) FILTER (WHERE dp.project_status = 'ACTIVE'), 0) AS avg_completion_pct,
    -- handover timeline (uses project_end_date / completion_date where present)
    COALESCE(SUM(dp.no_of_units) FILTER (
      WHERE dp.project_status IN ('ACTIVE','NOT_STARTED','PENDING')
        AND COALESCE(dp.completion_date, dp.project_end_date) >= CURRENT_DATE
        AND COALESCE(dp.completion_date, dp.project_end_date) <  CURRENT_DATE + INTERVAL '1 year'), 0)::bigint AS units_handover_1y,
    COALESCE(SUM(dp.no_of_units) FILTER (
      WHERE dp.project_status IN ('ACTIVE','NOT_STARTED','PENDING')
        AND COALESCE(dp.completion_date, dp.project_end_date) >= CURRENT_DATE + INTERVAL '1 year'
        AND COALESCE(dp.completion_date, dp.project_end_date) <  CURRENT_DATE + INTERVAL '3 years'), 0)::bigint AS units_handover_1_3y
  FROM dubai_areas da
  JOIN dld_areas dla    ON dla.dubai_area_id = da.id
  JOIN dld_projects dp  ON dp.area_id = dla.area_id
  GROUP BY da.id, da.name;
