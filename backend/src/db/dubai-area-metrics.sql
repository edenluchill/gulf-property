-- ============================================================================
-- DUBAI AREA METRICS
-- Calculate average price, growth, volume for each dubai_area from transactions
-- ============================================================================

-- View: Current metrics per dubai_area (last 12 months)
CREATE OR REPLACE VIEW dubai_area_metrics AS
WITH recent_sales AS (
  -- Last 12 months sales
  SELECT
    dla.dubai_area_id,
    dt.meter_sale_price,
    dt.actual_worth,
    dt.procedure_area,
    dt.instance_date
  FROM dld_transactions dt
  JOIN dld_areas dla ON dla.area_id = dt.area_id
  WHERE dt.trans_group = 'Sales'
    AND dt.meter_sale_price > 0
    AND dt.instance_date > NOW() - INTERVAL '12 months'
    AND dla.dubai_area_id IS NOT NULL
),
previous_sales AS (
  -- 12-24 months ago (for growth calculation)
  SELECT
    dla.dubai_area_id,
    AVG(dt.meter_sale_price) as avg_price
  FROM dld_transactions dt
  JOIN dld_areas dla ON dla.area_id = dt.area_id
  WHERE dt.trans_group = 'Sales'
    AND dt.meter_sale_price > 0
    AND dt.instance_date BETWEEN NOW() - INTERVAL '24 months' AND NOW() - INTERVAL '12 months'
    AND dla.dubai_area_id IS NOT NULL
  GROUP BY dla.dubai_area_id
),
current_metrics AS (
  SELECT
    dubai_area_id,
    AVG(meter_sale_price) as avg_price_sqm,
    SUM(actual_worth) as total_volume,
    COUNT(*) as transaction_count,
    AVG(procedure_area) as avg_size
  FROM recent_sales
  GROUP BY dubai_area_id
)
SELECT
  da.id as dubai_area_id,
  da.name,
  da.name_ar,
  ROUND(cm.avg_price_sqm::numeric, 0) as avg_price_sqm,
  ROUND(cm.total_volume::numeric, 0) as sales_volume,
  cm.transaction_count,
  ROUND(cm.avg_size::numeric, 0) as avg_size_sqm,
  -- Capital growth: (current - previous) / previous * 100
  CASE
    WHEN ps.avg_price > 0 THEN
      ROUND(((cm.avg_price_sqm - ps.avg_price) / ps.avg_price * 100)::numeric, 1)
    ELSE NULL
  END as capital_growth_pct
FROM dubai_areas da
LEFT JOIN current_metrics cm ON cm.dubai_area_id = da.id
LEFT JOIN previous_sales ps ON ps.dubai_area_id = da.id
WHERE cm.transaction_count > 0;

-- ============================================================================
-- FUNCTION: Get metrics for all areas (used by API)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_dubai_area_metrics()
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  name_ar VARCHAR,
  avg_price_sqm NUMERIC,
  sales_volume NUMERIC,
  transaction_count BIGINT,
  capital_growth_pct NUMERIC,
  rental_yield_pct NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH recent_sales AS (
    SELECT
      dla.dubai_area_id,
      dt.meter_sale_price,
      dt.actual_worth,
      dt.instance_date
    FROM dld_transactions dt
    JOIN dld_areas dla ON dla.area_id = dt.area_id
    WHERE dt.trans_group = 'Sales'
      AND dt.meter_sale_price > 0
      AND dt.instance_date > NOW() - INTERVAL '12 months'
      AND dla.dubai_area_id IS NOT NULL
  ),
  recent_rentals AS (
    SELECT
      dla.dubai_area_id,
      AVG(dt.meter_rent_price) as avg_rent
    FROM dld_transactions dt
    JOIN dld_areas dla ON dla.area_id = dt.area_id
    WHERE dt.trans_group = 'Rent'
      AND dt.meter_rent_price > 0
      AND dt.instance_date > NOW() - INTERVAL '12 months'
      AND dla.dubai_area_id IS NOT NULL
    GROUP BY dla.dubai_area_id
  ),
  previous_sales AS (
    SELECT
      dla.dubai_area_id,
      AVG(dt.meter_sale_price) as avg_price
    FROM dld_transactions dt
    JOIN dld_areas dla ON dla.area_id = dt.area_id
    WHERE dt.trans_group = 'Sales'
      AND dt.meter_sale_price > 0
      AND dt.instance_date BETWEEN NOW() - INTERVAL '24 months' AND NOW() - INTERVAL '12 months'
      AND dla.dubai_area_id IS NOT NULL
    GROUP BY dla.dubai_area_id
  ),
  current_metrics AS (
    SELECT
      dubai_area_id,
      AVG(meter_sale_price) as avg_price_sqm,
      SUM(actual_worth) as total_volume,
      COUNT(*) as txn_count
    FROM recent_sales
    GROUP BY dubai_area_id
  )
  SELECT
    da.id,
    da.name,
    da.name_ar,
    ROUND(cm.avg_price_sqm::numeric, 0),
    ROUND(cm.total_volume::numeric, 0),
    cm.txn_count,
    -- Capital growth
    CASE
      WHEN ps.avg_price > 0 THEN
        ROUND(((cm.avg_price_sqm - ps.avg_price) / ps.avg_price * 100)::numeric, 1)
      ELSE NULL
    END,
    -- Rental yield: (annual rent per sqm / price per sqm) * 100
    CASE
      WHEN cm.avg_price_sqm > 0 AND rr.avg_rent > 0 THEN
        ROUND((rr.avg_rent * 12 / cm.avg_price_sqm * 100)::numeric, 1)
      ELSE NULL
    END
  FROM dubai_areas da
  LEFT JOIN current_metrics cm ON cm.dubai_area_id = da.id
  LEFT JOIN previous_sales ps ON ps.dubai_area_id = da.id
  LEFT JOIN recent_rentals rr ON rr.dubai_area_id = da.id
  WHERE cm.txn_count > 0
  ORDER BY cm.txn_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION: Update dubai_areas with calculated metrics
-- ============================================================================

-- First, add metric columns to dubai_areas if not exist
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS avg_price_sqm NUMERIC;
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS sales_volume NUMERIC;
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS transaction_count INTEGER;
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS capital_growth_pct NUMERIC;
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS rental_yield_pct NUMERIC;
ALTER TABLE dubai_areas ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ;

-- Function to refresh metrics
CREATE OR REPLACE FUNCTION refresh_dubai_area_metrics()
RETURNS void AS $$
BEGIN
  UPDATE dubai_areas da
  SET
    avg_price_sqm = m.avg_price_sqm,
    sales_volume = m.sales_volume,
    transaction_count = m.transaction_count,
    capital_growth_pct = m.capital_growth_pct,
    rental_yield_pct = m.rental_yield_pct,
    metrics_updated_at = NOW()
  FROM get_dubai_area_metrics() m
  WHERE da.id = m.id;
END;
$$ LANGUAGE plpgsql;
