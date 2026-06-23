-- Precompute the per-area investment summary for the DOMINANT segment used by the
-- find-home calculator: ptype='apartment', bedrooms = ALL. recommend_for_budget /
-- affordability re-ran percentile_cont over v_sales (763k) + v_rent (2.9M) per call
-- (ptype is a CASE expr → no index → full scan), costing ~12–20s. This materializes
-- the same s/r/g/j computation once (refresh daily after the sync). recommend uses
-- it for the apartment/all-beds case; bedroom-specific / villa queries stay on the
-- live path (mirror of recommend_for_budget's CTEs).
DROP MATERIALIZED VIEW IF EXISTS mv_area_invest_apt;
CREATE MATERIALIZED VIEW mv_area_invest_apt AS
WITH s AS (
  SELECT area_name, (array_agg(dubai_area_id) FILTER (WHERE dubai_area_id IS NOT NULL))[1] AS dubai_area_id,
    percentile_cont(0.5) within group (order by price_aed) AS price_aed,
    percentile_cont(0.5) within group (order by price_sqm) AS price_sqm,
    count(*) AS cnt
  FROM v_sales
  WHERE ptype = 'apartment' AND txn_date >= CURRENT_DATE - INTERVAL '24 months'
  GROUP BY area_name HAVING count(*) >= 10
),
r AS (
  SELECT area_name, percentile_cont(0.5) within group (order by rent_sqm) AS rent_sqm
  FROM v_rent WHERE ptype = 'apartment' AND start_date >= CURRENT_DATE - INTERVAL '24 months'
  GROUP BY area_name
),
g AS (
  SELECT area_name, percentile_cont(0.5) within group (order by price_sqm) AS p_then
  FROM v_sales WHERE ptype = 'apartment'
    AND txn_date >= CURRENT_DATE - INTERVAL '48 months' AND txn_date < CURRENT_DATE - INTERVAL '36 months'
  GROUP BY area_name
)
SELECT s.area_name,
  round(s.price_aed::numeric) AS median_price_aed,
  round(s.price_sqm::numeric) AS median_price_sqm,
  s.cnt AS sales_count,
  round((r.rent_sqm/NULLIF(s.price_sqm,0)*100)::numeric,2) AS gross_yield_pct,
  ny.service_charge_sqft AS service_charge_sqft,
  round((r.rent_sqm/NULLIF(s.price_sqm,0)*100 - COALESCE(ny.sc_drag_pct,0))::numeric,2) AS net_yield_pct,
  round(((power(s.price_sqm/NULLIF(g.p_then,0),1.0/3)-1)*100)::numeric,1) AS cagr_3y_pct
FROM s
  LEFT JOIN r USING(area_name)
  LEFT JOIN g USING(area_name)
  LEFT JOIN mv_area_net_yield ny ON ny.dubai_area_id = s.dubai_area_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_area_invest_apt_name ON mv_area_invest_apt(area_name);
CREATE INDEX IF NOT EXISTS idx_mv_area_invest_apt_price ON mv_area_invest_apt(median_price_aed);
