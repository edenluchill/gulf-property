-- ============================================================================
-- PINZOS DATABASE SCHEMA - Core Setup
-- ============================================================================

-- Enable PostGIS extension for geospatial queries (run as superuser if needed)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- SHARED HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp (used by multiple tables)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Function to create point from lat/lng
CREATE OR REPLACE FUNCTION create_point(lng DOUBLE PRECISION, lat DOUBLE PRECISION)
RETURNS GEOGRAPHY AS $$
BEGIN
    RETURN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY;
END;
$$ language 'plpgsql';

-- ============================================================================
-- NOTE: Main tables are defined in their respective schema files:
-- - residential-projects-schema.sql (residential_projects, project_unit_types, etc.)
-- - developer-submissions-schema.sql (developer_property_submissions, etc.)
-- - dubai-analytics-schema.sql (dld_transactions, dld_areas, etc.)
-- - dubai-pois-schema.sql (dubai_pois)
-- - task-schema.sql (pdf_processing_tasks)
-- ============================================================================
