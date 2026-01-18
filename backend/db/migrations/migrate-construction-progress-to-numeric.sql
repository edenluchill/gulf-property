-- ============================================================================
-- Migration: Convert construction_progress from VARCHAR to NUMERIC
-- ============================================================================
-- This script migrates the construction_progress column from VARCHAR(100) 
-- to NUMERIC(5,2) and converts existing string data to numeric values.
-- 
-- Usage:
--   psql -U your_user -d your_database -f migrate-construction-progress-to-numeric.sql
-- ============================================================================

BEGIN;

-- Step 1: Add a temporary numeric column
ALTER TABLE residential_projects 
ADD COLUMN construction_progress_numeric NUMERIC(5, 2);

-- Step 2: Convert existing data
-- Extract numeric values from strings like "75% Complete", "50", "Under Construction"
UPDATE residential_projects
SET construction_progress_numeric = 
  CASE
    -- If construction_progress is NULL, keep it NULL
    WHEN construction_progress IS NULL THEN NULL
    
    -- Try to extract a number from the string
    WHEN construction_progress ~ '\d+' THEN
      -- Extract the first number found
      CAST(SUBSTRING(construction_progress FROM '\d+') AS NUMERIC)
    
    -- Handle common text-only cases
    WHEN LOWER(construction_progress) LIKE '%under construction%' OR 
         LOWER(construction_progress) LIKE '%in progress%' THEN 50
    WHEN LOWER(construction_progress) LIKE '%completed%' OR 
         LOWER(construction_progress) LIKE '%ready%' OR
         LOWER(construction_progress) LIKE '%handed over%' THEN 100
    WHEN LOWER(construction_progress) LIKE '%upcoming%' OR
         LOWER(construction_progress) LIKE '%not started%' THEN 0
    
    -- Default to 0 if we can't parse it
    ELSE 0
  END;

-- Step 3: Ensure values are within valid range (0-100)
UPDATE residential_projects
SET construction_progress_numeric = 
  CASE
    WHEN construction_progress_numeric > 100 THEN 100
    WHEN construction_progress_numeric < 0 THEN 0
    ELSE construction_progress_numeric
  END
WHERE construction_progress_numeric IS NOT NULL;

-- Step 4: Drop the old VARCHAR column
ALTER TABLE residential_projects 
DROP COLUMN construction_progress;

-- Step 5: Rename the new column to the original name
ALTER TABLE residential_projects 
RENAME COLUMN construction_progress_numeric TO construction_progress;

-- Step 6: Add CHECK constraint
ALTER TABLE residential_projects
ADD CONSTRAINT construction_progress_range 
CHECK (construction_progress >= 0 AND construction_progress <= 100);

-- Step 7: Update the column comment
COMMENT ON COLUMN residential_projects.construction_progress IS 'Construction progress as percentage (0.00 to 100.00)';

-- Show conversion results
SELECT 
  construction_progress,
  COUNT(*) as count
FROM residential_projects
GROUP BY construction_progress
ORDER BY construction_progress;

COMMIT;

-- ============================================================================
-- Rollback script (if needed)
-- ============================================================================
-- To rollback, run this separately:
--
-- BEGIN;
-- ALTER TABLE residential_projects 
-- ADD COLUMN construction_progress_text VARCHAR(100);
-- 
-- UPDATE residential_projects
-- SET construction_progress_text = 
--   CASE
--     WHEN construction_progress IS NULL THEN NULL
--     ELSE construction_progress::TEXT || '% Complete'
--   END;
-- 
-- ALTER TABLE residential_projects DROP COLUMN construction_progress;
-- ALTER TABLE residential_projects RENAME COLUMN construction_progress_text TO construction_progress;
-- COMMIT;
-- ============================================================================
