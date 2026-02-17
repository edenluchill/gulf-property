-- Populate median_unit_price in rolling metrics
-- Uses actual_worth from dld_transactions as the total sale price

WITH median_prices AS (
  SELECT
    da.id as dubai_area_id,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) as median_price
  FROM dubai_areas da
  JOIN dld_areas dla ON dla.dubai_area_id = da.id
  JOIN dld_transactions dt ON dt.area_id = dla.area_id
  WHERE dt.trans_group = 'Sales'
    AND dt.actual_worth > 0
    AND dt.instance_date >= (SELECT MAX(period_end_month) - INTERVAL '12 months' FROM dubai_area_rolling_metrics)
    AND dt.instance_date < (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics)
  GROUP BY da.id
)
UPDATE dubai_area_rolling_metrics rm
SET median_unit_price = ROUND(mp.median_price::numeric, 0)
FROM median_prices mp
WHERE rm.dubai_area_id = mp.dubai_area_id
  AND rm.period_end_month = (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics);

-- Show results
SELECT da.name, rm.median_unit_price, rm.median_price_sqm
FROM dubai_area_rolling_metrics rm
JOIN dubai_areas da ON da.id = rm.dubai_area_id
WHERE rm.period_end_month = (SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics)
  AND rm.median_unit_price IS NOT NULL
ORDER BY rm.median_unit_price DESC
LIMIT 10;
