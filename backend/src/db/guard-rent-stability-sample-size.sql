-- ============================================================================
-- Guard the rent metrics against tiny samples (2026-06-19).
-- Al Mizhar 2 showed "188% stability" off just 22 new + 26 renewal leases — a
-- villa area where the few new vs renewal leases have very different unit mixes,
-- so the ratio is noise. Require a minimum sample:
--   • rent_stability_pct: only when >= 40 new AND >= 40 renewal leases, else NULL
--   • rental_yield: use the NEW-lease median only when >= 30 new leases,
--     otherwise fall back to the all-contract median (more stable base).
-- ============================================================================

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
        -- Rent stability = median renew / median new (per sqm). Only meaningful
        -- with enough of BOTH lease types, else the unit-mix noise dominates.
        CASE
            WHEN rent.new_count >= 40 AND rent.renew_count >= 40
                 AND rent.median_new_rent > 0 AND rent.median_renew_rent > 0
            THEN ROUND((rent.median_renew_rent / rent.median_new_rent * 100)::numeric, 1)
            ELSE NULL
        END,
        -- Rental yield = NEW-lease median rent (when enough new leases) / median
        -- sale price; otherwise fall back to the all-contract median rent.
        CASE
            WHEN curr.median_price > 0
                 AND COALESCE(CASE WHEN rent.new_count >= 30 THEN rent.median_new_rent END, rent.median_rent) > 0
            THEN ROUND((COALESCE(CASE WHEN rent.new_count >= 30 THEN rent.median_new_rent END, rent.median_rent) / curr.median_price * 100)::numeric, 2)
            ELSE NULL
        END,
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

SELECT calculate_area_rolling_metrics(CURRENT_DATE) AS rows_updated;
