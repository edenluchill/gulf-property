-- ============================================================================
-- Metric overhaul (per ChatGPT/product feedback, 2026-06-19):
--   1) Rental yield  = median NEW-contract rent / median sale price (was AVG of
--      ALL contracts / AVG price). New-contract rent = what you can actually let
--      a unit for today; median tames outliers.
--   2) Rent stability = median renew rent / median new rent (renew/new ratio).
--      High ratio → sitting tenants near market = stable. Low ratio → rents
--      rising fast (sitting tenants far below market).
--   3) Capital growth = median price change (was AVG) for robustness.
-- All per-sqm so different unit sizes stay comparable. Also stores the inputs
-- (median new/renew rent + contract counts) so the UI can SHOW THE EVIDENCE.
-- ============================================================================

ALTER TABLE dubai_area_rolling_metrics
  ADD COLUMN IF NOT EXISTS median_new_rent_sqm   NUMERIC,
  ADD COLUMN IF NOT EXISTS median_renew_rent_sqm NUMERIC,
  ADD COLUMN IF NOT EXISTS new_contract_count    INTEGER,
  ADD COLUMN IF NOT EXISTS renew_contract_count  INTEGER,
  ADD COLUMN IF NOT EXISTS rent_stability_pct    NUMERIC;

COMMENT ON COLUMN dubai_area_rolling_metrics.median_new_rent_sqm   IS 'Median annual rent per sqm, NEW contracts only (drives rental yield)';
COMMENT ON COLUMN dubai_area_rolling_metrics.median_renew_rent_sqm IS 'Median annual rent per sqm, RENEWAL contracts only';
COMMENT ON COLUMN dubai_area_rolling_metrics.rent_stability_pct    IS 'median_renew_rent / median_new_rent * 100. ~100 = stable; low = rents rising fast';

-- ── Rebuild the rolling-metrics function with the new definitions ────────────
CREATE OR REPLACE FUNCTION calculate_area_rolling_metrics(p_end_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER AS $$
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
        da.id,
        v_period_end,
        curr.avg_price,
        curr.median_price,
        curr.median_unit_price,
        curr.total_volume,
        curr.txn_count,
        curr.avg_size,
        rent.avg_rent,
        rent.median_rent,
        rent.total_rent,
        rent.contract_count,
        rent.avg_size,
        rent.median_new_rent,
        rent.median_renew_rent,
        rent.new_count,
        rent.renew_count,
        -- Rent stability = renew / new (median, per sqm)
        CASE
            WHEN rent.median_new_rent > 0 AND rent.median_renew_rent > 0
            THEN ROUND((rent.median_renew_rent / rent.median_new_rent * 100)::numeric, 1)
            ELSE NULL
        END,
        -- Rental yield = median NEW-contract rent / median sale price (per sqm).
        -- Fall back to all-contract median rent if an area has no New contracts.
        CASE
            WHEN curr.median_price > 0 AND COALESCE(rent.median_new_rent, rent.median_rent) > 0
            THEN ROUND((COALESCE(rent.median_new_rent, rent.median_rent) / curr.median_price * 100)::numeric, 2)
            ELSE NULL
        END,
        -- Capital growth = MEDIAN price change vs prior 12-month window. Guard:
        -- require >= 20 sales in BOTH periods so a tiny base can't explode.
        CASE
            WHEN prev.median_price > 0 AND prev.txn_count >= 20 AND curr.txn_count >= 20
                 AND ABS((curr.median_price - prev.median_price) / prev.median_price * 100) <= 120
            THEN ROUND(((curr.median_price - prev.median_price) / prev.median_price * 100)::numeric, 1)
            ELSE NULL
        END,
        CASE
            WHEN prev_rent.avg_rent > 0
            THEN ROUND(((rent.avg_rent - prev_rent.avg_rent) / prev_rent.avg_rent * 100)::numeric, 1)
            ELSE NULL
        END,
        CASE
            WHEN prev.median_price IS NULL THEN NULL
            WHEN curr.median_price > prev.median_price * 1.02 THEN 'up'
            WHEN curr.median_price < prev.median_price * 0.98 THEN 'down'
            ELSE 'stable'
        END,
        CASE
            WHEN prev_rent.avg_rent IS NULL THEN NULL
            WHEN rent.avg_rent > prev_rent.avg_rent * 1.02 THEN 'up'
            WHEN rent.avg_rent < prev_rent.avg_rent * 0.98 THEN 'down'
            ELSE 'stable'
        END
    FROM dubai_areas da
    LEFT JOIN LATERAL (
        SELECT
            AVG(dt.meter_sale_price) as avg_price,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) as median_price,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) as median_unit_price,
            SUM(dt.actual_worth) as total_volume,
            COUNT(*)::INTEGER as txn_count,
            AVG(dt.procedure_area) as avg_size
        FROM dld_transactions dt
        JOIN dld_areas dla ON dla.area_id = dt.area_id
        WHERE dla.dubai_area_id = da.id
            AND dt.trans_group = 'Sales'
            AND dt.property_usage = 'Residential'
            AND dt.property_type IN ('Unit','Villa')
            AND dt.meter_sale_price BETWEEN 1000 AND 250000
            AND dt.instance_date >= v_period_start
            AND dt.instance_date < v_period_end
    ) curr ON true
    LEFT JOIN LATERAL (
        SELECT
            AVG(dt.meter_sale_price) as avg_price,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price) as median_price,
            COUNT(*)::INTEGER as txn_count
        FROM dld_transactions dt
        JOIN dld_areas dla ON dla.area_id = dt.area_id
        WHERE dla.dubai_area_id = da.id
            AND dt.trans_group = 'Sales'
            AND dt.property_usage = 'Residential'
            AND dt.property_type IN ('Unit','Villa')
            AND dt.meter_sale_price BETWEEN 1000 AND 250000
            AND dt.instance_date >= v_prev_start
            AND dt.instance_date < v_prev_end
    ) prev ON true
    LEFT JOIN LATERAL (
        SELECT
            AVG(rc.annual_amount / NULLIF(rc.property_area, 0)) as avg_rent,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area, 0)) as median_rent,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area, 0))
                FILTER (WHERE rc.registration_type = 'New') as median_new_rent,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area, 0))
                FILTER (WHERE rc.registration_type = 'Renew') as median_renew_rent,
            SUM(rc.annual_amount) as total_rent,
            COUNT(*)::INTEGER as contract_count,
            COUNT(*) FILTER (WHERE rc.registration_type = 'New')::INTEGER as new_count,
            COUNT(*) FILTER (WHERE rc.registration_type = 'Renew')::INTEGER as renew_count,
            AVG(rc.property_area) as avg_size
        FROM dld_rent_contracts rc
        WHERE rc.dubai_area_id = da.id
            AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
            AND rc.property_area >= 20
            AND rc.annual_amount <= 500000
            AND (rc.annual_amount / rc.property_area) <= 3000
            AND rc.start_date >= v_period_start
            AND rc.start_date < v_period_end
    ) rent ON true
    LEFT JOIN LATERAL (
        SELECT AVG(rc.annual_amount / NULLIF(rc.property_area, 0)) as avg_rent
        FROM dld_rent_contracts rc
        WHERE rc.dubai_area_id = da.id
            AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
            AND rc.property_area >= 20
            AND rc.annual_amount <= 500000
            AND (rc.annual_amount / rc.property_area) <= 3000
            AND rc.start_date >= v_prev_start
            AND rc.start_date < v_prev_end
    ) prev_rent ON true
    WHERE curr.txn_count > 0 OR rent.contract_count > 0
    ON CONFLICT (dubai_area_id, period_end_month) DO UPDATE SET
        avg_price_sqm = EXCLUDED.avg_price_sqm,
        median_price_sqm = EXCLUDED.median_price_sqm,
        median_unit_price = EXCLUDED.median_unit_price,
        total_sales_volume = EXCLUDED.total_sales_volume,
        sales_transaction_count = EXCLUDED.sales_transaction_count,
        avg_rent_sqm = EXCLUDED.avg_rent_sqm,
        median_rent_sqm = EXCLUDED.median_rent_sqm,
        median_new_rent_sqm = EXCLUDED.median_new_rent_sqm,
        median_renew_rent_sqm = EXCLUDED.median_renew_rent_sqm,
        new_contract_count = EXCLUDED.new_contract_count,
        renew_contract_count = EXCLUDED.renew_contract_count,
        rent_stability_pct = EXCLUDED.rent_stability_pct,
        rental_yield_pct = EXCLUDED.rental_yield_pct,
        price_growth_pct = EXCLUDED.price_growth_pct,
        rent_growth_pct = EXCLUDED.rent_growth_pct,
        price_trend = EXCLUDED.price_trend,
        rent_trend = EXCLUDED.rent_trend;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ── Expose the new fields through the API function ──────────────────────────
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

COMMENT ON FUNCTION get_dubai_area_metrics IS 'Current area metrics from rolling 12-month data (median-based yield + rent stability)';

-- Recompute the current period so the new columns are populated now.
SELECT calculate_area_rolling_metrics(CURRENT_DATE) AS rows_updated;
