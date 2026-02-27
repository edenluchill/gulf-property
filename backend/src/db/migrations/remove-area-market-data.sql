-- Remove market data columns from dubai_areas
-- These are no longer used for map display

ALTER TABLE dubai_areas
DROP COLUMN IF EXISTS project_counts,
DROP COLUMN IF EXISTS average_price,
DROP COLUMN IF EXISTS sales_volume,
DROP COLUMN IF EXISTS capital_appreciation,
DROP COLUMN IF EXISTS rental_yield;
