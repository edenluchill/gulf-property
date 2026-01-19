-- ============================================================================
-- Migration: Remove tower column, Add description column
-- Date: 2026-01-18
-- Description: 
--   1. Remove tower column from project_unit_types (not a standard unit attribute)
--   2. Add description column for AI-generated marketing text (3-5 sentences)
-- ============================================================================

-- Remove tower column
ALTER TABLE project_unit_types 
DROP COLUMN IF EXISTS tower;

-- Remove tower index if it exists
DROP INDEX IF EXISTS idx_unit_types_tower;

-- Add description column for AI-generated marketing content
ALTER TABLE project_unit_types 
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add comment for the new column
COMMENT ON COLUMN project_unit_types.description IS 
'AI-generated marketing description (3-5 sentences) highlighting layout advantages, dimensions, design features, and target audience based on floor plan analysis';

-- Verify changes
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'project_unit_types' 
  AND column_name IN ('description')
ORDER BY ordinal_position;
