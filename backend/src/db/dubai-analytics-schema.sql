-- ============================================================================
-- DUBAI ANALYTICS TABLES
-- For AI-powered property valuation and investment analysis
-- Data source: Dubai Pulse (DLD, DSC)
-- ============================================================================

-- ============================================================================
-- 1. PROPERTY TRANSACTIONS (DLD)
-- Historical sales, gifts, mortgages - core data for price prediction
-- ============================================================================

CREATE TABLE IF NOT EXISTS dld_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50) UNIQUE NOT NULL,

    -- Transaction info
    trans_group VARCHAR(50),        -- 'Sales', 'Gifts', 'Mortgages'
    procedure_name VARCHAR(100),    -- 'Sale', 'Grant', 'Mortgage'
    instance_date DATE NOT NULL,    -- Transaction date

    -- Property classification
    property_type VARCHAR(50),      -- 'Villa', 'Flat', 'Land', 'Building'
    property_sub_type VARCHAR(100),
    property_usage VARCHAR(50),     -- 'Residential', 'Commercial', 'Industrial'

    -- Location
    area_id INTEGER,
    area_name VARCHAR(100),
    building_name VARCHAR(255),
    project_name VARCHAR(255),
    master_project VARCHAR(255),

    -- Nearby POIs (useful for AI features)
    nearest_landmark VARCHAR(255),
    nearest_metro VARCHAR(255),
    nearest_mall VARCHAR(255),

    -- Property details
    rooms VARCHAR(20),
    has_parking BOOLEAN,
    procedure_area DECIMAL(15,2),   -- Area in sqm

    -- Pricing (THE KEY DATA)
    actual_worth DECIMAL(15,2),     -- Transaction price in AED
    meter_sale_price DECIMAL(10,2), -- Price per sqm
    rent_value DECIMAL(15,2),       -- For lease transactions
    meter_rent_price DECIMAL(10,2),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_trans_date ON dld_transactions(instance_date);
CREATE INDEX IF NOT EXISTS idx_trans_area ON dld_transactions(area_id);
CREATE INDEX IF NOT EXISTS idx_trans_type ON dld_transactions(property_type);
CREATE INDEX IF NOT EXISTS idx_trans_group ON dld_transactions(trans_group);
CREATE INDEX IF NOT EXISTS idx_trans_price ON dld_transactions(actual_worth) WHERE actual_worth > 0;

-- ============================================================================
-- 2. RENTAL CONTRACTS (Ejari)
-- For rental yield analysis and rent prediction
-- ============================================================================

CREATE TABLE IF NOT EXISTS dld_rent_contracts (
    id SERIAL PRIMARY KEY,
    contract_id VARCHAR(50) UNIQUE NOT NULL,

    -- Contract details
    contract_start_date DATE,
    contract_end_date DATE,
    contract_amount DECIMAL(15,2),  -- Total contract value
    annual_amount DECIMAL(15,2),    -- Annual rent

    -- Property classification
    property_type VARCHAR(50),
    property_sub_type VARCHAR(100),
    property_usage VARCHAR(50),
    actual_area DECIMAL(15,2),

    -- Location
    area_id INTEGER,
    area_name VARCHAR(100),
    project_name VARCHAR(255),
    master_project VARCHAR(255),

    -- Nearby POIs
    nearest_landmark VARCHAR(255),
    nearest_metro VARCHAR(255),
    nearest_mall VARCHAR(255),

    -- Tenant type
    tenant_type VARCHAR(50),        -- 'Individual', 'Company'

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_start ON dld_rent_contracts(contract_start_date);
CREATE INDEX IF NOT EXISTS idx_rent_area ON dld_rent_contracts(area_id);
CREATE INDEX IF NOT EXISTS idx_rent_amount ON dld_rent_contracts(annual_amount) WHERE annual_amount > 0;

-- ============================================================================
-- 3. COMMUNITY STATISTICS
-- Population data for demand analysis
-- ============================================================================

CREATE TABLE IF NOT EXISTS dubai_communities (
    id SERIAL PRIMARY KEY,
    community_number INTEGER,
    community_name VARCHAR(255) NOT NULL,
    community_name_ar VARCHAR(255),

    -- Statistics by year
    year INTEGER NOT NULL,
    population INTEGER,

    -- Can add more stats later
    -- avg_rent, avg_price, num_transactions, etc.

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(community_number, year)
);

CREATE INDEX IF NOT EXISTS idx_community_name ON dubai_communities(community_name);
CREATE INDEX IF NOT EXISTS idx_community_year ON dubai_communities(year);

-- ============================================================================
-- 4. AREA LOOKUP (for joining)
-- Maps area_id to area names consistently
-- ============================================================================

CREATE TABLE IF NOT EXISTS dld_areas (
    area_id INTEGER PRIMARY KEY,
    area_name VARCHAR(255) NOT NULL,
    area_name_ar VARCHAR(255),

    -- Stats can be aggregated here
    avg_sale_price_sqm DECIMAL(10,2),
    avg_rent_sqm DECIMAL(10,2),
    total_transactions INTEGER,
    last_updated TIMESTAMPTZ
);

-- ============================================================================
-- USEFUL VIEWS FOR AI
-- ============================================================================

-- Recent sales by area (last 2 years)
CREATE OR REPLACE VIEW v_recent_sales AS
SELECT
    area_name,
    property_type,
    rooms,
    COUNT(*) as num_sales,
    AVG(actual_worth) as avg_price,
    AVG(meter_sale_price) as avg_price_sqm,
    AVG(procedure_area) as avg_area,
    MIN(actual_worth) as min_price,
    MAX(actual_worth) as max_price
FROM dld_transactions
WHERE trans_group = 'Sales'
  AND instance_date > CURRENT_DATE - INTERVAL '2 years'
  AND actual_worth > 0
GROUP BY area_name, property_type, rooms;

-- Price trends by area and month
CREATE OR REPLACE VIEW v_price_trends AS
SELECT
    area_name,
    property_type,
    DATE_TRUNC('month', instance_date) as month,
    COUNT(*) as num_sales,
    AVG(meter_sale_price) as avg_price_sqm,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY meter_sale_price) as median_price_sqm
FROM dld_transactions
WHERE trans_group = 'Sales'
  AND actual_worth > 0
  AND meter_sale_price > 0
GROUP BY area_name, property_type, DATE_TRUNC('month', instance_date);

-- Rental yields by area
CREATE OR REPLACE VIEW v_rental_yields AS
SELECT
    t.area_name,
    t.property_type,
    AVG(t.meter_sale_price) as avg_sale_price_sqm,
    AVG(r.annual_amount / NULLIF(r.actual_area, 0)) as avg_annual_rent_sqm,
    AVG(r.annual_amount / NULLIF(r.actual_area, 0)) / NULLIF(AVG(t.meter_sale_price), 0) * 100 as gross_yield_pct
FROM dld_transactions t
JOIN dld_rent_contracts r ON t.area_id = r.area_id AND t.property_type = r.property_type
WHERE t.trans_group = 'Sales'
  AND t.instance_date > CURRENT_DATE - INTERVAL '1 year'
  AND t.meter_sale_price > 0
  AND r.contract_start_date > CURRENT_DATE - INTERVAL '1 year'
  AND r.annual_amount > 0
GROUP BY t.area_name, t.property_type;
