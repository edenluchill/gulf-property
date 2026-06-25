-- ===========================================================================
-- Per-(area,usage) rolling metrics for CUSTOM (hand-drawn) areas — spatial.
-- Same as calculate_area_metrics_by_usage but matches tx/rent by ST_Covers over
-- the geocode cache instead of the area_id bridge. See area-metrics-by-usage.sql.
-- ===========================================================================
CREATE OR REPLACE FUNCTION calculate_custom_area_metrics_by_usage(p_end_date date DEFAULT CURRENT_DATE)
RETURNS integer LANGUAGE plpgsql AS $function$
DECLARE
  v_count int := 0;
  v_pe date := date_trunc('month', p_end_date);
  v_ps date := (date_trunc('month', p_end_date) - interval '12 months');
  v_pps date := (date_trunc('month', p_end_date) - interval '24 months');
BEGIN
  INSERT INTO dubai_area_rolling_metrics (
    dubai_area_id, period_end_month, usage,
    avg_price_sqm, median_price_sqm, median_unit_price, total_sales_volume,
    sales_transaction_count, avg_sale_size_sqm,
    median_rent_sqm, median_new_rent_sqm, new_contract_count, renew_contract_count,
    rent_stability_pct, rental_yield_pct, price_growth_pct, price_trend
  )
  SELECT
    curr.aid, v_pe, COALESCE(curr.usage,'all'),
    curr.avg_psm, curr.med_psm, curr.med_unit, curr.vol, curr.n, curr.sz,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_rent END,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.med_new END,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.new_n END,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') THEN rent.renew_n END,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') AND rent.new_n>=40 AND rent.renew_n>=40
              AND rent.med_new>0 AND rent.med_renew>0
         THEN ROUND((rent.med_renew/rent.med_new*100)::numeric,1) END,
    CASE WHEN COALESCE(curr.usage,'all') IN ('residential','all') AND curr.med_psm>0
              AND COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)>0
         THEN ROUND((COALESCE(CASE WHEN rent.new_n>=30 THEN rent.med_new END, rent.med_rent)/curr.med_psm*100)::numeric,2) END,
    CASE WHEN prev.med_psm>0 AND prev.n>=20 AND curr.n>=20
              AND ABS((curr.med_psm-prev.med_psm)/prev.med_psm*100)<=120
         THEN ROUND(((curr.med_psm-prev.med_psm)/prev.med_psm*100)::numeric,1) END,
    CASE WHEN prev.med_psm IS NULL THEN NULL
         WHEN curr.med_psm > prev.med_psm*1.02 THEN 'up'
         WHEN curr.med_psm < prev.med_psm*0.98 THEN 'down' ELSE 'stable' END
  FROM (
    SELECT da.id aid, dld_usage_bucket(dt.property_usage) usage,
           AVG(dt.meter_sale_price) avg_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) med_unit,
           SUM(dt.actual_worth) vol, COUNT(*)::int n, AVG(dt.procedure_area) sz
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_transactions dt ON dt.area_name=loc.area_name
         AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND dt.trans_group='Sales' AND dt.meter_sale_price>0
      AND dt.instance_date>=v_ps AND dt.instance_date<v_pe
    GROUP BY GROUPING SETS ((1,2),(1))
  ) curr
  LEFT JOIN (
    SELECT da.id aid, dld_usage_bucket(dt.property_usage) usage,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) med_psm, COUNT(*)::int n
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_transactions dt ON dt.area_name=loc.area_name
         AND COALESCE(NULLIF(dt.project_name,''), NULLIF(dt.building_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND dt.trans_group='Sales' AND dt.meter_sale_price>0
      AND dt.instance_date>=v_pps AND dt.instance_date<v_ps
    GROUP BY GROUPING SETS ((1,2),(1))
  ) prev ON prev.aid=curr.aid AND prev.usage IS NOT DISTINCT FROM curr.usage
  LEFT JOIN (
    SELECT da.id aid,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0)) med_rent,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='New') med_new,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rc.annual_amount/NULLIF(rc.property_area,0))
             FILTER (WHERE rc.registration_type='Renew') med_renew,
           COUNT(*) FILTER (WHERE rc.registration_type='New')::int new_n,
           COUNT(*) FILTER (WHERE rc.registration_type='Renew')::int renew_n
    FROM dubai_areas da
    JOIN dld_project_locations loc ON loc.geom IS NOT NULL AND ST_Covers(da.boundary, loc.geom)
    JOIN dld_rent_contracts rc ON rc.area_name=loc.area_name
         AND COALESCE(NULLIF(rc.project_name,''), '__AREA__')=loc.project_name
    WHERE da.boundary IS NOT NULL AND da.visible
      AND NOT EXISTS (SELECT 1 FROM dld_areas dla WHERE dla.dubai_area_id=da.id AND dla.area_id<900000)
      AND rc.usage_type='Residential' AND rc.property_area>=20
      AND rc.annual_amount<=500000 AND (rc.annual_amount/rc.property_area)<=3000
      AND rc.start_date>=v_ps AND rc.start_date<v_pe
    GROUP BY 1
  ) rent ON rent.aid=curr.aid
  WHERE curr.n>0
  ON CONFLICT (dubai_area_id, period_end_month, usage) DO UPDATE SET
    avg_price_sqm=EXCLUDED.avg_price_sqm, median_price_sqm=EXCLUDED.median_price_sqm,
    median_unit_price=EXCLUDED.median_unit_price, total_sales_volume=EXCLUDED.total_sales_volume,
    sales_transaction_count=EXCLUDED.sales_transaction_count, avg_sale_size_sqm=EXCLUDED.avg_sale_size_sqm,
    median_rent_sqm=EXCLUDED.median_rent_sqm, median_new_rent_sqm=EXCLUDED.median_new_rent_sqm,
    new_contract_count=EXCLUDED.new_contract_count, renew_contract_count=EXCLUDED.renew_contract_count,
    rent_stability_pct=EXCLUDED.rent_stability_pct, rental_yield_pct=EXCLUDED.rental_yield_pct,
    price_growth_pct=EXCLUDED.price_growth_pct, price_trend=EXCLUDED.price_trend;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;
