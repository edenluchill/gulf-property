-- ============================================================================
-- Add statistical fields to dubai_areas for market data
-- ============================================================================

-- Add market statistics columns
ALTER TABLE dubai_areas 
ADD COLUMN IF NOT EXISTS project_counts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS average_price NUMERIC(12, 2),  -- Average price in AED
ADD COLUMN IF NOT EXISTS sales_volume NUMERIC(12, 2),   -- Total sales volume in AED
ADD COLUMN IF NOT EXISTS capital_appreciation NUMERIC(5, 2),  -- Percentage (e.g., 7.5 for 7.5%)
ADD COLUMN IF NOT EXISTS rental_yield NUMERIC(5, 2);    -- Percentage (e.g., 6.8 for 6.8%)

-- Create index for statistics queries
CREATE INDEX IF NOT EXISTS idx_dubai_areas_stats 
    ON dubai_areas (project_counts, average_price) 
    WHERE visible = true;

COMMENT ON COLUMN dubai_areas.project_counts IS 'Number of active projects in this area';
COMMENT ON COLUMN dubai_areas.average_price IS 'Average property price in AED';
COMMENT ON COLUMN dubai_areas.sales_volume IS 'Total sales volume in AED';
COMMENT ON COLUMN dubai_areas.capital_appreciation IS 'Capital appreciation rate (percentage)';
COMMENT ON COLUMN dubai_areas.rental_yield IS 'Average rental yield (percentage)';
