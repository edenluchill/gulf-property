-- Roll-ups over dld_service_charges → clean annual residential service charge (AED/sqft).
-- service_cost is AED/sqft PER category. The recurring annual charge = SUM of the
-- per-sqft categories, EXCLUDING one-off / non-per-sqft outliers:
--   'Parking' (whole-amount parking fee, avg ~1565) and 'Meter Installation' (one-off).
-- Only 'Residential' usage (what a home buyer pays; Retail/Parking usages excluded).

-- Drop first (dependency order: v_area_net_yield depends on by_area depends on latest).
-- Earlier drafts also had different column sets, so DROP + recreate, not REPLACE.
DROP VIEW IF EXISTS v_area_net_yield;
DROP VIEW IF EXISTS v_service_charge_by_community;
DROP VIEW IF EXISTS v_service_charge_by_area;
DROP VIEW IF EXISTS v_service_charge_latest;

-- 1) Clean annual service charge per property group, at its latest budget year.
CREATE VIEW v_service_charge_latest AS
WITH latest AS (
  SELECT property_group_id, max(budget_year) AS yr
  FROM dld_service_charges
  WHERE usage_name_en = 'Residential' AND property_group_id IS NOT NULL
  GROUP BY property_group_id
)
SELECT sc.property_group_id,
       max(sc.property_group_name_en) AS property_group_name_en,
       max(sc.project_name)           AS project_name,
       max(sc.master_community_name_en) AS master_community_name_en,
       l.yr AS budget_year,
       round(sum(sc.service_cost)::numeric, 2) AS annual_service_charge_sqft
FROM dld_service_charges sc
JOIN latest l ON l.property_group_id = sc.property_group_id AND l.yr = sc.budget_year
WHERE sc.usage_name_en = 'Residential'
  AND sc.service_category_name_en NOT IN ('Parking', 'Meter Installation')
GROUP BY sc.property_group_id, l.yr;

-- 2) Area-level median residential service charge, mapped via DLD project_name
--    (service-charge rows carry no area_id; v_sales bridges project_name -> dubai_area_id).
CREATE VIEW v_service_charge_by_area AS
WITH proj_area AS (
  SELECT DISTINCT lower(project_name) AS pname, dubai_area_id
  FROM v_sales
  WHERE project_name IS NOT NULL AND dubai_area_id IS NOT NULL
)
SELECT pa.dubai_area_id,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY scl.annual_service_charge_sqft)::numeric, 2) AS median_service_charge_sqft,
       count(DISTINCT scl.property_group_id) AS property_groups
FROM v_service_charge_latest scl
JOIN proj_area pa ON pa.pname = lower(scl.project_name)
WHERE scl.annual_service_charge_sqft > 0
GROUP BY pa.dubai_area_id;

-- 3) Area Net Yield = gross yield − service-charge drag.
--    gross = median annual rent/sqm ÷ median sale price/sqm (last 12 months).
--    sc_drag = service_charge/sqft (×10.764 → /sqm) ÷ price/sqm. net = gross − drag.
DROP VIEW IF EXISTS v_area_net_yield;
CREATE VIEW v_area_net_yield AS
WITH price AS (
  SELECT dubai_area_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY price_sqm) AS med_price_sqm
  FROM v_sales
  WHERE dubai_area_id IS NOT NULL AND price_sqm > 0 AND txn_date > now() - interval '1 year'
  GROUP BY dubai_area_id
), rent AS (
  SELECT dubai_area_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY rent_sqm) AS med_rent_sqm
  FROM v_rent
  WHERE dubai_area_id IS NOT NULL AND rent_sqm > 0 AND start_date > now() - interval '1 year'
  GROUP BY dubai_area_id
)
SELECT da.id AS dubai_area_id,
       da.name,
       round(p.med_price_sqm) AS median_price_sqm,
       round((r.med_rent_sqm / NULLIF(p.med_price_sqm, 0) * 100)::numeric, 2) AS gross_yield_pct,
       sca.median_service_charge_sqft AS service_charge_sqft,
       round((sca.median_service_charge_sqft * 10.764 / NULLIF(p.med_price_sqm, 0) * 100)::numeric, 2) AS sc_drag_pct,
       -- Net yield ONLY when we actually have a service charge for the area — otherwise
       -- "net" would just equal gross (and could surface outlier gross values). NULL =
       -- "no net-yield data", which the map metric renders as grey / no label.
       CASE WHEN sca.median_service_charge_sqft IS NOT NULL THEN
         round((r.med_rent_sqm / NULLIF(p.med_price_sqm, 0) * 100
                - sca.median_service_charge_sqft * 10.764 / NULLIF(p.med_price_sqm, 0) * 100)::numeric, 2)
       END AS net_yield_pct
FROM dubai_areas da
JOIN price p ON p.dubai_area_id = da.id
JOIN rent  r ON r.dubai_area_id = da.id
LEFT JOIN v_service_charge_by_area sca ON sca.dubai_area_id = da.id;
