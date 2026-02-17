-- Add median_unit_price column to rolling metrics table
-- This stores the median total sale price per unit (not per sqm)

ALTER TABLE dubai_area_rolling_metrics
ADD COLUMN IF NOT EXISTS median_unit_price NUMERIC;

COMMENT ON COLUMN dubai_area_rolling_metrics.median_unit_price IS 'Median total sale price per unit (AED)';

-- Also add to yearly metrics
ALTER TABLE dubai_area_yearly_metrics
ADD COLUMN IF NOT EXISTS median_unit_price NUMERIC;

COMMENT ON COLUMN dubai_area_yearly_metrics.median_unit_price IS 'Median total sale price per unit (AED)';
