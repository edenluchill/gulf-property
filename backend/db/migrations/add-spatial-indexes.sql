-- ============================================================================
-- Add Spatial Indexes for Optimized Map Clustering
-- ============================================================================

-- 1. Spatial index on location (GIST index for fast bounding box queries)
CREATE INDEX IF NOT EXISTS idx_residential_projects_location_gist 
ON residential_projects USING GIST (location);

-- 2. Index on verified + location (for filtered queries)
CREATE INDEX IF NOT EXISTS idx_residential_projects_verified_location 
ON residential_projects (verified) 
WHERE location IS NOT NULL;

-- 3. Composite index for common filter fields
CREATE INDEX IF NOT EXISTS idx_residential_projects_filters 
ON residential_projects (developer, area, status) 
WHERE verified = true AND location IS NOT NULL;

-- 4. Index on price range queries
CREATE INDEX IF NOT EXISTS idx_residential_projects_price 
ON residential_projects (starting_price) 
WHERE verified = true AND location IS NOT NULL;

-- 5. Index on bedroom range queries
CREATE INDEX IF NOT EXISTS idx_residential_projects_bedrooms 
ON residential_projects (min_bedrooms, max_bedrooms) 
WHERE verified = true AND location IS NOT NULL;

-- ============================================================================
-- Performance Statistics
-- ============================================================================

-- Analyze table to update statistics for query planner
ANALYZE residential_projects;

-- Show existing indexes
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'residential_projects'
ORDER BY indexname;
