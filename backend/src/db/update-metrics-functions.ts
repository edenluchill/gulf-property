/**
 * Update metrics calculation functions to use residential-only property types
 */
import pool from './pool'

async function main() {
  console.log('Updating calculate_area_yearly_metrics function...')

  await pool.query(`
    CREATE OR REPLACE FUNCTION calculate_area_yearly_metrics(p_year INTEGER)
    RETURNS INTEGER AS $$
    DECLARE
        v_count INTEGER := 0;
    BEGIN
        INSERT INTO dubai_area_yearly_metrics (
            dubai_area_id, year,
            avg_price_sqm, median_price_sqm, total_sales_volume,
            sales_transaction_count, avg_sale_size_sqm, median_unit_price,
            avg_rent_sqm, median_rent_sqm, total_rent_volume,
            rental_contract_count, avg_rental_size_sqm,
            rental_yield_pct, yoy_price_growth_pct
        )
        SELECT
            da.id,
            p_year,
            AVG(dt.meter_sale_price),
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price),
            SUM(dt.actual_worth),
            COUNT(dt.id)::INTEGER,
            AVG(dt.procedure_area),
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.actual_worth),
            rent.avg_rent,
            rent.median_rent,
            rent.total_rent,
            rent.contract_count,
            rent.avg_size,
            CASE
                WHEN AVG(dt.meter_sale_price) > 0 AND rent.avg_rent > 0
                THEN ROUND((rent.avg_rent / AVG(dt.meter_sale_price) * 100)::numeric, 2)
                ELSE NULL
            END,
            NULL
        FROM dubai_areas da
        LEFT JOIN dld_areas dla ON dla.dubai_area_id = da.id
        LEFT JOIN dld_transactions dt ON dt.area_id = dla.area_id
            AND dt.trans_group = 'Sales'
            AND dt.meter_sale_price > 0
            AND EXTRACT(YEAR FROM dt.instance_date) = p_year
        -- Residential only with outlier filtering
        -- Exclude: tiny units (<20sqm), extreme rents (>500k/year), unrealistic rent/sqm (>3000)
        LEFT JOIN LATERAL (
            SELECT
                AVG(rc.annual_amount / NULLIF(rc.property_area, 0)) as avg_rent,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area, 0)) as median_rent,
                SUM(rc.annual_amount) as total_rent,
                COUNT(*)::INTEGER as contract_count,
                AVG(rc.property_area) as avg_size
            FROM dld_rent_contracts rc
            WHERE rc.dubai_area_id = da.id
                AND rc.property_type IN ('Flat', 'Villa', 'Studio ', 'Complex Villas', 'Penthouse', 'Arabian House')
                AND rc.property_area >= 20
                AND rc.annual_amount <= 500000
                AND (rc.annual_amount / rc.property_area) <= 3000
                AND EXTRACT(YEAR FROM rc.start_date) = p_year
        ) rent ON true
        GROUP BY da.id, rent.avg_rent, rent.median_rent, rent.total_rent, rent.contract_count, rent.avg_size
        HAVING COUNT(dt.id) > 0 OR rent.contract_count > 0
        ON CONFLICT (dubai_area_id, year) DO UPDATE SET
            avg_price_sqm = EXCLUDED.avg_price_sqm,
            median_price_sqm = EXCLUDED.median_price_sqm,
            total_sales_volume = EXCLUDED.total_sales_volume,
            sales_transaction_count = EXCLUDED.sales_transaction_count,
            avg_sale_size_sqm = EXCLUDED.avg_sale_size_sqm,
            median_unit_price = EXCLUDED.median_unit_price,
            avg_rent_sqm = EXCLUDED.avg_rent_sqm,
            median_rent_sqm = EXCLUDED.median_rent_sqm,
            total_rent_volume = EXCLUDED.total_rent_volume,
            rental_contract_count = EXCLUDED.rental_contract_count,
            avg_rental_size_sqm = EXCLUDED.avg_rental_size_sqm,
            rental_yield_pct = EXCLUDED.rental_yield_pct,
            updated_at = NOW();

        GET DIAGNOSTICS v_count = ROW_COUNT;

        UPDATE dubai_area_yearly_metrics m
        SET yoy_price_growth_pct = ROUND(
            ((m.avg_price_sqm - prev.avg_price_sqm) / NULLIF(prev.avg_price_sqm, 0) * 100)::numeric, 1
        )
        FROM dubai_area_yearly_metrics prev
        WHERE m.year = p_year
            AND prev.dubai_area_id = m.dubai_area_id
            AND prev.year = p_year - 1
            AND prev.avg_price_sqm > 0;

        RETURN v_count;
    END;
    $$ LANGUAGE plpgsql
  `)
  console.log('Yearly function updated.')

  console.log('Updating calculate_area_rolling_metrics function...')

  await pool.query(`
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
            avg_price_sqm, median_price_sqm, total_sales_volume,
            sales_transaction_count, avg_sale_size_sqm, median_unit_price,
            avg_rent_sqm, median_rent_sqm, total_rent_volume,
            rental_contract_count, avg_rental_size_sqm,
            rental_yield_pct, price_growth_pct, rent_growth_pct,
            price_trend, rent_trend
        )
        SELECT
            da.id,
            v_period_end,
            curr.avg_price,
            curr.median_price,
            curr.total_volume,
            curr.txn_count,
            curr.avg_size,
            curr.median_unit_price,
            rent.avg_rent,
            rent.median_rent,
            rent.total_rent,
            rent.contract_count,
            rent.avg_size,
            CASE
                WHEN curr.avg_price > 0 AND rent.avg_rent > 0
                THEN ROUND((rent.avg_rent / curr.avg_price * 100)::numeric, 2)
                ELSE NULL
            END,
            CASE
                WHEN prev.avg_price > 0
                THEN ROUND(((curr.avg_price - prev.avg_price) / prev.avg_price * 100)::numeric, 1)
                ELSE NULL
            END,
            CASE
                WHEN prev_rent.avg_rent > 0
                THEN ROUND(((rent.avg_rent - prev_rent.avg_rent) / prev_rent.avg_rent * 100)::numeric, 1)
                ELSE NULL
            END,
            CASE
                WHEN prev.avg_price IS NULL THEN NULL
                WHEN curr.avg_price > prev.avg_price * 1.02 THEN 'up'
                WHEN curr.avg_price < prev.avg_price * 0.98 THEN 'down'
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
                SUM(dt.actual_worth) as total_volume,
                COUNT(*)::INTEGER as txn_count,
                AVG(dt.procedure_area) as avg_size,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.actual_worth) as median_unit_price
            FROM dld_transactions dt
            JOIN dld_areas dla ON dla.area_id = dt.area_id
            WHERE dla.dubai_area_id = da.id
                AND dt.trans_group = 'Sales'
                AND dt.meter_sale_price > 0
                AND dt.instance_date >= v_period_start
                AND dt.instance_date < v_period_end
        ) curr ON true
        LEFT JOIN LATERAL (
            SELECT AVG(dt.meter_sale_price) as avg_price
            FROM dld_transactions dt
            JOIN dld_areas dla ON dla.area_id = dt.area_id
            WHERE dla.dubai_area_id = da.id
                AND dt.trans_group = 'Sales'
                AND dt.meter_sale_price > 0
                AND dt.instance_date >= v_prev_start
                AND dt.instance_date < v_prev_end
        ) prev ON true
        -- Residential only with outlier filtering
        LEFT JOIN LATERAL (
            SELECT
                AVG(rc.annual_amount / NULLIF(rc.property_area, 0)) as avg_rent,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rc.annual_amount / NULLIF(rc.property_area, 0)) as median_rent,
                SUM(rc.annual_amount) as total_rent,
                COUNT(*)::INTEGER as contract_count,
                AVG(rc.property_area) as avg_size
            FROM dld_rent_contracts rc
            WHERE rc.dubai_area_id = da.id
                AND rc.property_type IN ('Flat', 'Villa', 'Studio ', 'Complex Villas', 'Penthouse', 'Arabian House')
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
                AND rc.property_type IN ('Flat', 'Villa', 'Studio ', 'Complex Villas', 'Penthouse', 'Arabian House')
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
            total_sales_volume = EXCLUDED.total_sales_volume,
            sales_transaction_count = EXCLUDED.sales_transaction_count,
            median_unit_price = EXCLUDED.median_unit_price,
            avg_rent_sqm = EXCLUDED.avg_rent_sqm,
            rental_yield_pct = EXCLUDED.rental_yield_pct,
            price_growth_pct = EXCLUDED.price_growth_pct,
            rent_growth_pct = EXCLUDED.rent_growth_pct,
            price_trend = EXCLUDED.price_trend,
            rent_trend = EXCLUDED.rent_trend;

        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
    END;
    $$ LANGUAGE plpgsql
  `)
  console.log('Rolling function updated.')

  await pool.end()
  console.log('Done!')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
