-- Performance Optimization for Gulf Property Database
-- Run this to add additional indexes for faster queries

-- ============================================================================
-- ADDITIONAL COMPOSITE INDEXES FOR COMMON FILTER COMBINATIONS
-- ============================================================================

-- Index for size range queries (commonly used with bedrooms)
CREATE INDEX IF NOT EXISTS idx_off_plan_size_range 
    ON off_plan_properties (min_size, max_size) 
    WHERE min_size IS NOT NULL AND max_size IS NOT NULL;

-- Index for price per sqft queries
CREATE INDEX IF NOT EXISTS idx_off_plan_price_sqft_range 
    ON off_plan_properties (median_price_sqft) 
    WHERE median_price_sqft IS NOT NULL;

-- Index for launch date queries
CREATE INDEX IF NOT EXISTS idx_off_plan_launch_date 
    ON off_plan_properties (launch_date) 
    WHERE launch_date IS NOT NULL;

-- Composite index for common filter combination: location + price + bedrooms + status
CREATE INDEX IF NOT EXISTS idx_off_plan_common_filters 
    ON off_plan_properties USING GIST (location) 
    INCLUDE (starting_price, min_bedrooms, max_bedrooms, completion_percent);

-- Index for project name lookups
CREATE INDEX IF NOT EXISTS idx_off_plan_project_name 
    ON off_plan_properties (project_name);

-- Composite index for location + developer (common filter combination)
CREATE INDEX IF NOT EXISTS idx_off_plan_location_developer 
    ON off_plan_properties (developer) 
    INCLUDE (location);

-- Index for size + bedrooms combination (common search)
CREATE INDEX IF NOT EXISTS idx_off_plan_size_bedrooms 
    ON off_plan_properties (min_size, max_size, min_bedrooms, max_bedrooms) 
    WHERE min_size IS NOT NULL;

-- ============================================================================
-- MATERIALIZED VIEWS FOR METADATA (for faster loading)
-- ============================================================================

-- Materialized view for developers list (pre-computed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_developers AS
SELECT DISTINCT 
    developer, 
    developer_logo_url,
    COUNT(*) as property_count
FROM off_plan_properties 
WHERE verified = true AND developer IS NOT NULL
GROUP BY developer, developer_logo_url
ORDER BY developer;

CREATE INDEX IF NOT EXISTS idx_mv_developers 
    ON mv_developers (developer);

-- Materialized view for areas list (pre-computed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_areas AS
SELECT 
    area_name,
    COUNT(*) as property_count,
    AVG(starting_price) as avg_price,
    MIN(starting_price) as min_price,
    MAX(starting_price) as max_price
FROM off_plan_properties 
WHERE verified = true AND area_name IS NOT NULL AND starting_price IS NOT NULL
GROUP BY area_name
ORDER BY property_count DESC;

CREATE INDEX IF NOT EXISTS idx_mv_areas 
    ON mv_areas (area_name);

-- Materialized view for projects list (pre-computed)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_projects AS
SELECT 
    project_name,
    developer,
    COUNT(*) as property_count,
    AVG(starting_price) as avg_price,
    MIN(starting_price) as min_price,
    MAX(starting_price) as max_price
FROM off_plan_properties 
WHERE verified = true AND project_name IS NOT NULL AND starting_price IS NOT NULL
GROUP BY project_name, developer
ORDER BY property_count DESC;

CREATE INDEX IF NOT EXISTS idx_mv_projects 
    ON mv_projects (project_name);

-- ============================================================================
-- REFRESH FUNCTION FOR MATERIALIZED VIEWS
-- ============================================================================

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_metadata_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_developers;
    REFRESH MATERIALIZED VIEW mv_areas;
    REFRESH MATERIALIZED VIEW mv_projects;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ANALYZE TABLES FOR QUERY PLANNER
-- ============================================================================

-- Update statistics for query optimizer
ANALYZE off_plan_properties;

-- Note: VACUUM cannot run inside a transaction block
-- Run separately if needed: VACUUM ANALYZE off_plan_properties;

-- ============================================================================
-- CHECK INDEX USAGE
-- ============================================================================

-- Query to check which indexes are being used
-- SELECT 
--     schemaname,
--     tablename,
--     indexname,
--     idx_scan as index_scans,
--     idx_tup_read as tuples_read,
--     idx_tup_fetch as tuples_fetched
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- AND tablename = 'off_plan_properties'
-- ORDER BY idx_scan DESC;

-- ============================================================================
-- TABLE STATISTICS
-- ============================================================================

-- Check table size and statistics
-- SELECT 
--     pg_size_pretty(pg_total_relation_size('off_plan_properties')) as total_size,
--     pg_size_pretty(pg_relation_size('off_plan_properties')) as table_size,
--     pg_size_pretty(pg_indexes_size('off_plan_properties')) as indexes_size,
--     (SELECT COUNT(*) FROM off_plan_properties) as row_count;
