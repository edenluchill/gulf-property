-- ============================================================================
-- ADD PRIMARY IMAGE FIELD
-- Allows users to select a featured image for map pin display
-- ============================================================================

-- Add primary_image column to residential_projects
ALTER TABLE residential_projects
ADD COLUMN IF NOT EXISTS primary_image TEXT;

-- Add comment
COMMENT ON COLUMN residential_projects.primary_image IS 'User-selected primary image URL for map pin display. Falls back to first project image if not set.';
