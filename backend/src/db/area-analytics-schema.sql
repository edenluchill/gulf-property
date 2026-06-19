-- ============================================================================
-- DUBAI AREA ANALYTICS
-- Historical and rolling metrics for each dubai_area
-- Data sources: DLD Sales Transactions + DLD Rent Contracts (Ejari)
-- ============================================================================

-- ============================================================================
-- 1. YEARLY METRICS TABLE
-- Stores aggregated statistics per year per area
-- ============================================================================

CREATE TABLE IF NOT EXISTS dubai_area_yearly_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dubai_area_id UUID NOT NULL REFERENCES dubai_areas(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,

    -- Sales metrics
    avg_price_sqm NUMERIC,              -- Average sale price per sqm
    median_price_sqm NUMERIC,           -- Median sale price per sqm
    total_sales_volume NUMERIC,         -- Total AED value of all sales
    sales_transaction_count INTEGER,    -- Number of sale transactions
    avg_sale_size_sqm NUMERIC,          -- Average property size sold

    -- Price distribution
    price_sqm_p25 NUMERIC,              -- 25th percentile price/sqm
    price_sqm_p75 NUMERIC,              -- 75th percentile price/sqm

    -- Rental metrics (from Ejari)
    avg_rent_sqm NUMERIC,               -- Average annual rent per sqm
    median_rent_sqm NUMERIC,            -- Median annual rent per sqm
    total_rent_volume NUMERIC,          -- Total annual rent value
    rental_contract_count INTEGER,      -- Number of rental contracts
    avg_rental_size_sqm NUMERIC,        -- Average rental property size

    -- Calculated metrics
    rental_yield_pct NUMERIC,           -- (avg_rent_sqm / avg_price_sqm) * 100
    yoy_price_growth_pct NUMERIC,       -- Year-over-year price growth %
    yoy_rent_growth_pct NUMERIC,        -- Year-over-year rent growth %

    -- Property type breakdown (JSON for flexibility)
    sales_by_type JSONB,                -- {"apartment": {count, avg_price}, "villa": {...}}
    rentals_by_type JSONB,              -- {"apartment": {count, avg_rent}, "villa": {...}}

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(dubai_area_id, year)
);

CREATE INDEX IF NOT EXISTS idx_area_yearly_metrics_area ON dubai_area_yearly_metrics(dubai_area_id);
CREATE INDEX IF NOT EXISTS idx_area_yearly_metrics_year ON dubai_area_yearly_metrics(year);

-- ============================================================================
-- 2. ROLLING METRICS TABLE
-- Stores rolling 12-month metrics, updated monthly
-- ============================================================================

CREATE TABLE IF NOT EXISTS dubai_area_rolling_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dubai_area_id UUID NOT NULL REFERENCES dubai_areas(id) ON DELETE CASCADE,

    -- Period definition (e.g., "2026-02" means Feb 2025 - Feb 2026)
    period_end_month DATE NOT NULL,     -- First day of the end month
    period_months INTEGER DEFAULT 12,   -- Rolling window size (default 12 months)

    -- Sales metrics (last 12 months)
    avg_price_sqm NUMERIC,
    median_price_sqm NUMERIC,
    total_sales_volume NUMERIC,
    sales_transaction_count INTEGER,
    avg_sale_size_sqm NUMERIC,

    -- Rental metrics (last 12 months)
    avg_rent_sqm NUMERIC,
    median_rent_sqm NUMERIC,
    total_rent_volume NUMERIC,
    rental_contract_count INTEGER,
    avg_rental_size_sqm NUMERIC,
    median_new_rent_sqm NUMERIC,        -- median rent/sqm, NEW contracts (drives yield)
    median_renew_rent_sqm NUMERIC,      -- median rent/sqm, RENEWAL contracts
    new_contract_count INTEGER,         -- # NEW contracts (evidence)
    renew_contract_count INTEGER,       -- # RENEWAL contracts (evidence)
    rent_stability_pct NUMERIC,         -- renew/new median rent * 100 (~100 = stable)

    -- Calculated metrics
    median_unit_price NUMERIC,          -- median total sale price per unit (AED)
    rental_yield_pct NUMERIC,           -- median NEW rent / median sale price (per sqm)

    -- Compared to previous 12-month period
    price_growth_pct NUMERIC,           -- vs previous rolling period
    rent_growth_pct NUMERIC,            -- vs previous rolling period
    volume_growth_pct NUMERIC,          -- sales volume growth

    -- Trend indicators
    price_trend VARCHAR(10),            -- 'up', 'down', 'stable'
    rent_trend VARCHAR(10),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(dubai_area_id, period_end_month)
);

CREATE INDEX IF NOT EXISTS idx_area_rolling_metrics_area ON dubai_area_rolling_metrics(dubai_area_id);
CREATE INDEX IF NOT EXISTS idx_area_rolling_metrics_period ON dubai_area_rolling_metrics(period_end_month);

-- ============================================================================
-- 3. DLD RENT CONTRACTS TABLE
-- Stores imported rental contract data from Dubai Pulse
-- ============================================================================

CREATE TABLE IF NOT EXISTS dld_rent_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contract info
    contract_id VARCHAR(50),
    registration_type VARCHAR(50),       -- 'New' or 'Renewal'
    start_date DATE,
    end_date DATE,
    annual_amount NUMERIC,               -- Annual rent in AED

    -- Property info
    property_type VARCHAR(50),           -- 'Unit', 'Building', 'Land'
    property_subtype VARCHAR(100),       -- More specific type
    usage_type VARCHAR(50),              -- 'Residential', 'Commercial', etc.
    property_area NUMERIC,               -- Size in sqm

    -- Location
    area_name VARCHAR(255),
    area_name_ar VARCHAR(255),
    project_name VARCHAR(255),
    nearest_landmark VARCHAR(255),
    nearest_metro VARCHAR(255),
    nearest_mall VARCHAR(255),

    -- Tenant info
    tenant_type VARCHAR(50),             -- 'Person' or 'Company'

    -- Linking
    area_id INTEGER,                     -- FK to dld_areas if matched
    dubai_area_id UUID REFERENCES dubai_areas(id),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_contracts_area ON dld_rent_contracts(area_name);
CREATE INDEX IF NOT EXISTS idx_rent_contracts_dubai_area ON dld_rent_contracts(dubai_area_id);
CREATE INDEX IF NOT EXISTS idx_rent_contracts_dates ON dld_rent_contracts(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_rent_contracts_usage ON dld_rent_contracts(usage_type);
CREATE INDEX IF NOT EXISTS idx_rent_contracts_property_type ON dld_rent_contracts(property_type);

-- ============================================================================
-- 4. FUNCTIONS TO CALCULATE METRICS
-- ============================================================================

-- Function: Calculate yearly metrics for a specific year
CREATE OR REPLACE FUNCTION calculate_area_yearly_metrics(p_year INTEGER)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    INSERT INTO dubai_area_yearly_metrics (
        dubai_area_id, year,
        avg_price_sqm, median_price_sqm, total_sales_volume,
        sales_transaction_count, avg_sale_size_sqm,
        avg_rent_sqm, median_rent_sqm, total_rent_volume,
        rental_contract_count, avg_rental_size_sqm,
        rental_yield_pct, yoy_price_growth_pct
    )
    SELECT
        da.id,
        p_year,
        -- Sales metrics
        AVG(dt.meter_sale_price),
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.meter_sale_price),
        SUM(dt.actual_worth),
        COUNT(dt.id)::INTEGER,
        AVG(dt.procedure_area),
        -- Rental metrics
        rent.avg_rent,
        rent.median_rent,
        rent.total_rent,
        rent.contract_count,
        rent.avg_size,
        -- Rental yield
        CASE
            WHEN AVG(dt.meter_sale_price) > 0 AND rent.avg_rent > 0
            THEN ROUND((rent.avg_rent / AVG(dt.meter_sale_price) * 100)::numeric, 2)
            ELSE NULL
        END,
        -- YoY growth (calculated separately)
        NULL
    FROM dubai_areas da
    -- Join sales data
    LEFT JOIN dld_areas dla ON dla.dubai_area_id = da.id
    LEFT JOIN dld_transactions dt ON dt.area_id = dla.area_id
        AND dt.trans_group = 'Sales'
        AND dt.meter_sale_price > 0
        AND EXTRACT(YEAR FROM dt.instance_date) = p_year
    -- Join rental data (residential only, with outlier filtering)
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
            AND TRIM(rc.property_type) IN ('Flat','Villa','Studio','Complex Villas','Penthouse','Arabian House')
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
        avg_rent_sqm = EXCLUDED.avg_rent_sqm,
        median_rent_sqm = EXCLUDED.median_rent_sqm,
        total_rent_volume = EXCLUDED.total_rent_volume,
        rental_contract_count = EXCLUDED.rental_contract_count,
        avg_rental_size_sqm = EXCLUDED.avg_rental_size_sqm,
        rental_yield_pct = EXCLUDED.rental_yield_pct,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Calculate YoY growth
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
$$ LANGUAGE plpgsql;

-- Function: Calculate rolling 12-month metrics
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
        -- Rent stability = median renew rent / median new rent (per sqm).
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

-- ============================================================================
-- 5. VIEW: Current area metrics (for API)
-- ============================================================================

CREATE OR REPLACE VIEW dubai_area_current_metrics AS
SELECT
    da.id as dubai_area_id,
    da.name,
    da.name_ar,
    rm.avg_price_sqm,
    rm.median_price_sqm,
    rm.total_sales_volume as sales_volume,
    rm.sales_transaction_count as transaction_count,
    rm.avg_rent_sqm,
    rm.rental_yield_pct,
    rm.price_growth_pct as capital_growth_pct,
    rm.rent_growth_pct,
    rm.price_trend,
    rm.rent_trend,
    rm.period_end_month as metrics_period
FROM dubai_areas da
LEFT JOIN dubai_area_rolling_metrics rm ON rm.dubai_area_id = da.id
    AND rm.period_end_month = (
        SELECT MAX(period_end_month) FROM dubai_area_rolling_metrics
    )
WHERE da.visible = true;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE dubai_area_yearly_metrics IS 'Historical yearly statistics for each Dubai area';
COMMENT ON TABLE dubai_area_rolling_metrics IS 'Rolling 12-month metrics updated monthly';
COMMENT ON TABLE dld_rent_contracts IS 'Rental contracts from Dubai Pulse Ejari data';
COMMENT ON FUNCTION calculate_area_yearly_metrics IS 'Calculate and store yearly metrics for a given year';
COMMENT ON FUNCTION calculate_area_rolling_metrics IS 'Calculate rolling 12-month metrics up to a given date';
