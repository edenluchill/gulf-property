-- ===========================================================================
-- Development-level (master_project) precise matching + metrics
--
-- WHY: official DLD "areas" are heterogeneous — e.g. Al Merkadh blends SOBHA
-- HARTLAND (15k) + Meydan One (14k) + MBR District 1 (4k), so area medians are a
-- meaningless average of 3 unrelated developments ("不准"). The precise unit is
-- the master_project. DLD gives master_project on sales; rent has no
-- master_project but its project_name cleanly carries the sub-projects, so we
-- derive the rent set from the master's sales project_names.
--
-- Methodology is copied verbatim from calculate_area_rolling_metrics so the
-- numbers stay consistent with the area cards (same filters / yield / growth).
--   yield  = NEW-lease median rent-per-sqm (≥30 new leases, else all) / median
--            sale price-per-sqm × 100
--   growth = median sale price-per-sqm, last-12m vs prior-12m, guarded
-- See docs/reports/2026-06-24-transaction-rent-matching-accuracy.md (P1+P3).
-- ===========================================================================

-- 1) Resolve a residential project → its DLD development (master_project).
--    Spatial first: which official DLD area polygon contains the project point
--    (ST_Contains — no name matching). Then pick the master_project in that area
--    whose name best matches the project name (pg_trgm). Returns the best pick.
CREATE OR REPLACE FUNCTION resolve_project_development(
  p_name text, p_lng double precision, p_lat double precision
)
RETURNS TABLE(master_project text, area_id integer, similarity numeric, sales_count bigint)
LANGUAGE sql STABLE AS $$
  WITH area AS (   -- spatial: official DLD area_id containing the point
    SELECT dla.area_id
    FROM dubai_areas da
    JOIN dld_areas dla ON dla.dubai_area_id = da.id
    WHERE p_lng IS NOT NULL AND p_lat IS NOT NULL AND da.boundary IS NOT NULL
      AND ST_Covers(da.boundary, ST_SetSRID(ST_Point(p_lng, p_lat), 4326)::geography)
      AND dla.area_id IS NOT NULL
    ORDER BY ST_Area(da.boundary) ASC   -- smallest containing polygon = most specific
    LIMIT 1
  )
  SELECT
    dt.master_project,
    (SELECT area_id FROM area) AS area_id,
    ROUND(MAX(GREATEST(
      similarity(upper(dt.project_name),   upper(p_name)),
      similarity(upper(dt.master_project), upper(p_name))
    ))::numeric, 3) AS similarity,
    COUNT(*) AS sales_count
  FROM dld_transactions dt
  WHERE dt.master_project IS NOT NULL AND dt.master_project <> ''
    -- Require the spatial area (uses the area_id index → fast, and precision
    -- needs a real location anyway). No containing polygon → no rows → the
    -- caller falls back to the area-name tier instead of a full table scan.
    AND dt.area_id = (SELECT area_id FROM area)
    AND (similarity(upper(dt.project_name),   upper(p_name)) > 0.3
      OR similarity(upper(dt.master_project), upper(p_name)) > 0.3)
  GROUP BY dt.master_project
  ORDER BY similarity DESC, sales_count DESC
  LIMIT 1;
$$;

-- 2) Development-level metrics for one master_project (constrained to its area
--    for speed). Mirrors the area rolling-metric math exactly.
CREATE OR REPLACE FUNCTION get_development_metrics(p_master text, p_area_id integer)
RETURNS TABLE(
  median_price_sqm  numeric,
  median_unit_price numeric,
  sales_count       integer,
  rental_yield_pct  numeric,
  price_growth_pct  numeric,
  rent_count        integer,
  new_count         integer,
  data_through      date
)
LANGUAGE sql STABLE AS $$
  WITH b AS (
    SELECT date_trunc('month', CURRENT_DATE)::date AS pe,
           (date_trunc('month', CURRENT_DATE) - interval '12 months')::date AS ps,
           (date_trunc('month', CURRENT_DATE) - interval '24 months')::date AS pps
  ),
  pnames AS (  -- normalized project_name set for this development (from sales)
    SELECT DISTINCT regexp_replace(upper(project_name), '[^A-Z0-9]', '', 'g') AS pn
    FROM dld_transactions
    WHERE upper(master_project) = upper(p_master)
      AND area_id = p_area_id
      AND project_name IS NOT NULL AND project_name <> ''
  ),
  curr AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS med_psm,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth)     AS med_unit,
      COUNT(*)::int AS n
    FROM dld_transactions dt, b
    WHERE upper(dt.master_project) = upper(p_master) AND dt.area_id = p_area_id
      AND dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
      AND dt.property_type IN ('Unit','Villa')
      AND dt.meter_sale_price BETWEEN 1000 AND 250000
      AND dt.instance_date >= b.ps AND dt.instance_date < b.pe
  ),
  prev AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS med_psm,
           COUNT(*)::int AS n
    FROM dld_transactions dt, b
    WHERE upper(dt.master_project) = upper(p_master) AND dt.area_id = p_area_id
      AND dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
      AND dt.property_type IN ('Unit','Villa')
      AND dt.meter_sale_price BETWEEN 1000 AND 250000
      AND dt.instance_date >= b.pps AND dt.instance_date < b.ps
  ),
  rent AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area,0)) AS med_rent,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area,0))
        FILTER (WHERE rc.registration_type = 'New') AS med_new,
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE rc.registration_type = 'New')::int AS new_n
    FROM dld_rent_contracts rc, b
    WHERE rc.area_id = p_area_id
      AND regexp_replace(upper(rc.project_name), '[^A-Z0-9]', '', 'g') IN (SELECT pn FROM pnames)
      AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
      AND rc.property_area >= 20 AND rc.annual_amount <= 500000
      AND (rc.annual_amount / rc.property_area) <= 3000
      AND rc.start_date >= b.ps AND rc.start_date < b.pe
  )
  SELECT
    ROUND(curr.med_psm::numeric, 2),
    ROUND(curr.med_unit::numeric),
    curr.n,
    CASE
      WHEN curr.med_psm > 0
       AND COALESCE(CASE WHEN rent.new_n >= 30 THEN rent.med_new END, rent.med_rent) > 0
      THEN ROUND((COALESCE(CASE WHEN rent.new_n >= 30 THEN rent.med_new END, rent.med_rent)
                  / curr.med_psm * 100)::numeric, 2)
    END,
    CASE
      WHEN prev.med_psm > 0 AND prev.n >= 20 AND curr.n >= 20
       AND ABS((curr.med_psm - prev.med_psm) / prev.med_psm * 100) <= 120
      THEN ROUND(((curr.med_psm - prev.med_psm) / prev.med_psm * 100)::numeric, 1)
    END,
    rent.n,
    rent.new_n,
    (SELECT MAX(instance_date) FROM dld_transactions
      WHERE upper(master_project) = upper(p_master) AND area_id = p_area_id)
  FROM curr, prev, rent;
$$;
