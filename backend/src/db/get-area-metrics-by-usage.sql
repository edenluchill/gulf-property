-- ===========================================================================
-- get_dubai_area_metrics(usage) — usage-aware (default residential).
--
-- Now that dubai_area_rolling_metrics has one row per (area, period, usage),
-- the old no-arg function returned duplicate area rows. Replace it with a
-- usage-parameterised version (default 'residential' → every existing caller,
-- incl. /dubai/areas and area-classification, keeps working unchanged). The map
-- + panel pass a usage to switch lenses.
-- ===========================================================================
DROP FUNCTION IF EXISTS get_dubai_area_metrics();

CREATE OR REPLACE FUNCTION get_dubai_area_metrics(p_usage text DEFAULT 'residential')
RETURNS TABLE(
  id uuid, name character varying, name_ar character varying,
  avg_price_sqm numeric, median_price_sqm numeric, median_unit_price numeric,
  sales_volume numeric, transaction_count bigint, capital_growth_pct numeric,
  rental_yield_pct numeric, rent_stability_pct numeric, median_new_rent_sqm numeric,
  new_contract_count integer, renew_contract_count integer
)
LANGUAGE sql STABLE AS $function$
  -- Resilience: if the requested usage has no rows (e.g. the daily job only
  -- produced 'residential' and the 'all'/segment rollups are missing), fall back
  -- to 'residential' so the map never goes blank. Pick the latest period that
  -- actually has data for the effective usage.
  WITH eff AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM dubai_area_rolling_metrics WHERE usage = p_usage)
                THEN p_usage ELSE 'residential' END AS u
  )
  SELECT
    da.id, da.name, da.name_ar,
    ROUND(rm.avg_price_sqm::numeric, 0),
    ROUND(rm.median_price_sqm::numeric, 0),
    ROUND(rm.median_unit_price::numeric, 0),
    ROUND(rm.total_sales_volume::numeric, 0),
    rm.sales_transaction_count::bigint,
    rm.price_growth_pct,
    rm.rental_yield_pct,
    rm.rent_stability_pct,
    ROUND(rm.median_new_rent_sqm::numeric, 0),
    rm.new_contract_count,
    rm.renew_contract_count
  FROM eff
  JOIN dubai_area_rolling_metrics rm ON rm.usage = eff.u
   AND rm.period_end_month = (
     SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics WHERE usage = eff.u
   )
  JOIN dubai_areas da ON da.id = rm.dubai_area_id
  WHERE rm.sales_transaction_count > 0
  ORDER BY rm.sales_transaction_count DESC;
$function$;
