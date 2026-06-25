-- ===========================================================================
-- Rolling metrics for CUSTOM (hand-drawn) areas — spatial, geocode-based.
--
-- Official areas get their dubai_area_rolling_metrics row from
-- calculate_area_rolling_metrics (area_id bridge). Colleague-drawn areas have no
-- real bridge (synthetic 900000+ id), so they never get a row → the map (which
-- reads get_dubai_area_metrics → rolling_metrics) shows them grey/blank.
--
-- This computes the SAME metrics with the SAME math, but matches transactions
-- spatially: ST_Covers(area.boundary, geocoded project/area point). Writes into
-- the same dubai_area_rolling_metrics table, so get_dubai_area_metrics, the map
-- colours, and refresh_dubai_area_metrics all pick them up unchanged.
--
-- Run after calculate_area_rolling_metrics in the daily job. See dubai-daily.ts.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.calculate_custom_area_rolling_metrics(p_end_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_period_end DATE := DATE_TRUNC('month', p_end_date);
  v_period_start DATE := v_period_end - INTERVAL '12 months';
  v_prev_end DATE := v_period_start;
  v_prev_start DATE := v_prev_end - INTERVAL '12 months';
BEGIN
  INSERT INTO dubai_area_rolling_metrics (
    dubai_area_id, period_end_month,
    avg_price_sqm, median_price_sqm, median_unit_price, total_sales_volume,
    sales_transaction_count, avg_sale_size_sqm,
    avg_rent_sqm, median_rent_sqm, total_rent_volume,
    rental_contract_count, avg_rental_size_sqm,
    median_new_rent_sqm, median_renew_rent_sqm,
    new_contract_count, renew_contract_count, rent_stability_pct,
    rental_yield_pct, price_growth_pct, rent_growth_pct,
    price_trend, rent_trend
  )
  SELECT
    da.id, v_period_end,
    curr.avg_price, curr.median_price, curr.median_unit_price, curr.total_volume,
    curr.txn_count, curr.avg_size,
    rent.avg_rent, rent.median_rent, rent.total_rent, rent.contract_count, rent.avg_size,
    rent.median_new_rent, rent.median_renew_rent, rent.new_count, rent.renew_count,
    CASE WHEN rent.new_count >= 40 AND rent.renew_count >= 40
              AND rent.median_new_rent > 0 AND rent.median_renew_rent > 0
         THEN ROUND((rent.median_renew_rent / rent.median_new_rent * 100)::numeric, 1) END,
    CASE WHEN curr.median_price > 0
              AND COALESCE(CASE WHEN rent.new_count >= 30 THEN rent.median_new_rent END, rent.median_rent) > 0
         THEN ROUND((COALESCE(CASE WHEN rent.new_count >= 30 THEN rent.median_new_rent END, rent.median_rent)
                     / curr.median_price * 100)::numeric, 2) END,
    CASE WHEN prev.median_price > 0 AND prev.txn_count >= 20 AND curr.txn_count >= 20
              AND ABS((curr.median_price - prev.median_price) / prev.median_price * 100) <= 120
         THEN ROUND(((curr.median_price - prev.median_price) / prev.median_price * 100)::numeric, 1) END,
    CASE WHEN prev_rent.avg_rent > 0
         THEN ROUND(((rent.avg_rent - prev_rent.avg_rent) / prev_rent.avg_rent * 100)::numeric, 1) END,
    CASE WHEN prev.median_price IS NULL THEN NULL
         WHEN curr.median_price > prev.median_price * 1.02 THEN 'up'
         WHEN curr.median_price < prev.median_price * 0.98 THEN 'down' ELSE 'stable' END,
    CASE WHEN prev_rent.avg_rent IS NULL THEN NULL
         WHEN rent.avg_rent > prev_rent.avg_rent * 1.02 THEN 'up'
         WHEN rent.avg_rent < prev_rent.avg_rent * 0.98 THEN 'down' ELSE 'stable' END
  FROM dubai_areas da
  -- CUSTOM only: has a boundary, visible, and NO real DLD bridge area_id.
  LEFT JOIN LATERAL (
    SELECT AVG(dt.meter_sale_price) AS avg_price,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS median_price,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) AS median_unit_price,
           SUM(dt.actual_worth) AS total_volume, COUNT(*)::INTEGER AS txn_count,
           AVG(dt.procedure_area) AS avg_size
    FROM dld_transactions dt
    JOIN dld_project_locations loc ON loc.area_name = dt.area_name
         AND loc.project_name = COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')
    WHERE loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
      AND dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
      AND dt.property_type IN ('Unit','Villa') AND dt.meter_sale_price BETWEEN 1000 AND 250000
      AND dt.instance_date >= v_period_start AND dt.instance_date < v_period_end
  ) curr ON true
  LEFT JOIN LATERAL (
    SELECT AVG(dt.meter_sale_price) AS avg_price,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) AS median_price,
           COUNT(*)::INTEGER AS txn_count
    FROM dld_transactions dt
    JOIN dld_project_locations loc ON loc.area_name = dt.area_name
         AND loc.project_name = COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')
    WHERE loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
      AND dt.trans_group = 'Sales' AND dt.property_usage = 'Residential'
      AND dt.property_type IN ('Unit','Villa') AND dt.meter_sale_price BETWEEN 1000 AND 250000
      AND dt.instance_date >= v_prev_start AND dt.instance_date < v_prev_end
  ) prev ON true
  LEFT JOIN LATERAL (
    SELECT AVG(rc.annual_amount / NULLIF(rc.property_area,0)) AS avg_rent,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area,0)) AS median_rent,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type = 'New') AS median_new_rent,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type = 'Renew') AS median_renew_rent,
           SUM(rc.annual_amount) AS total_rent, COUNT(*)::INTEGER AS contract_count,
           COUNT(*) FILTER (WHERE rc.registration_type = 'New')::INTEGER AS new_count,
           COUNT(*) FILTER (WHERE rc.registration_type = 'Renew')::INTEGER AS renew_count,
           AVG(rc.property_area) AS avg_size
    FROM dld_rent_contracts rc
    JOIN dld_project_locations loc ON loc.area_name = rc.area_name
         AND loc.project_name = COALESCE(NULLIF(rc.project_name,''), '__AREA__')
    WHERE loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
      AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
      AND rc.property_area >= 20 AND rc.annual_amount <= 500000 AND (rc.annual_amount / rc.property_area) <= 3000
      AND rc.start_date >= v_period_start AND rc.start_date < v_period_end
  ) rent ON true
  LEFT JOIN LATERAL (
    SELECT AVG(rc.annual_amount / NULLIF(rc.property_area,0)) AS avg_rent
    FROM dld_rent_contracts rc
    JOIN dld_project_locations loc ON loc.area_name = rc.area_name
         AND loc.project_name = COALESCE(NULLIF(rc.project_name,''), '__AREA__')
    WHERE loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
      AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
      AND rc.property_area >= 20 AND rc.annual_amount <= 500000 AND (rc.annual_amount / rc.property_area) <= 3000
      AND rc.start_date >= v_prev_start AND rc.start_date < v_prev_end
  ) prev_rent ON true
  WHERE da.boundary IS NOT NULL AND da.visible
    AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id = da.id AND dla.area_id < 900000)
    AND (curr.txn_count > 0 OR rent.contract_count > 0)
  ON CONFLICT (dubai_area_id, period_end_month) DO UPDATE SET
    avg_price_sqm = EXCLUDED.avg_price_sqm, median_price_sqm = EXCLUDED.median_price_sqm,
    median_unit_price = EXCLUDED.median_unit_price, total_sales_volume = EXCLUDED.total_sales_volume,
    sales_transaction_count = EXCLUDED.sales_transaction_count, avg_rent_sqm = EXCLUDED.avg_rent_sqm,
    median_rent_sqm = EXCLUDED.median_rent_sqm, median_new_rent_sqm = EXCLUDED.median_new_rent_sqm,
    median_renew_rent_sqm = EXCLUDED.median_renew_rent_sqm, new_contract_count = EXCLUDED.new_contract_count,
    renew_contract_count = EXCLUDED.renew_contract_count, rent_stability_pct = EXCLUDED.rent_stability_pct,
    rental_yield_pct = EXCLUDED.rental_yield_pct, price_growth_pct = EXCLUDED.price_growth_pct,
    rent_growth_pct = EXCLUDED.rent_growth_pct, price_trend = EXCLUDED.price_trend, rent_trend = EXCLUDED.rent_trend;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
