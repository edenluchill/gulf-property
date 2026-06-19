-- Update get_dubai_area_metrics to use pre-calculated rolling metrics
-- This uses residential-only rent data from Ejari with outlier filtering

DROP FUNCTION IF EXISTS get_dubai_area_metrics();

CREATE FUNCTION get_dubai_area_metrics()
RETURNS TABLE(
  id uuid,
  name varchar,
  name_ar varchar,
  avg_price_sqm numeric,
  median_price_sqm numeric,
  median_unit_price numeric,
  sales_volume numeric,
  transaction_count bigint,
  capital_growth_pct numeric,
  rental_yield_pct numeric,
  rent_stability_pct numeric,
  median_new_rent_sqm numeric,
  new_contract_count integer,
  renew_contract_count integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    da.id,
    da.name,
    da.name_ar,
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
  FROM dubai_areas da
  JOIN dubai_area_rolling_metrics rm ON rm.dubai_area_id = da.id
  WHERE rm.period_end_month = (
    SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics
  )
  AND rm.sales_transaction_count > 0
  ORDER BY rm.sales_transaction_count DESC;
$$;

COMMENT ON FUNCTION get_dubai_area_metrics IS 'Returns current area metrics from pre-calculated rolling 12-month data';
