-- ============================================================================
-- ADD SOLD-OUT STATUS
-- Allows marking projects as sold out
-- ============================================================================

-- Drop and recreate the constraint to include 'sold-out'
ALTER TABLE residential_projects
DROP CONSTRAINT IF EXISTS residential_projects_status_check;

ALTER TABLE residential_projects
ADD CONSTRAINT residential_projects_status_check
CHECK (status IN ('upcoming', 'under-construction', 'completed', 'handed-over', 'sold-out'));

-- Add comment
COMMENT ON COLUMN residential_projects.status IS 'Project status: upcoming, under-construction, completed, handed-over, sold-out';
