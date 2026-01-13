-- Create database
-- CREATE DATABASE gulf_property;

-- Enable PostGIS extension for geospatial queries (run as superuser if needed)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Off-plan properties table optimized for map search (Zillow-style)
CREATE TABLE IF NOT EXISTS off_plan_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Building information
    building_id INTEGER UNIQUE NOT NULL,  -- Unique constraint for deduplication
    building_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    building_description TEXT,
    
    -- Developer information
    developer VARCHAR(255) NOT NULL,
    developer_id INTEGER,
    developer_logo_url TEXT,
    
    -- Location (optimized for geospatial queries)
    location GEOGRAPHY(POINT, 4326) NOT NULL,  -- PostGIS geography type for accurate distance calculations
    area_name VARCHAR(255) NOT NULL,
    area_id INTEGER,
    dld_location_id INTEGER,
    
    -- Bedroom configuration
    min_bedrooms INTEGER NOT NULL DEFAULT 0,
    max_bedrooms INTEGER NOT NULL DEFAULT 0,
    beds_description VARCHAR(50),
    
    -- Size (square feet)
    min_size INTEGER,
    max_size INTEGER,
    
    -- Pricing
    starting_price NUMERIC(15, 2),
    median_price_sqft NUMERIC(10, 2),
    median_price_per_unit NUMERIC(15, 2),
    median_rent_per_unit NUMERIC(15, 2),
    
    -- Project status and timeline
    launch_date TIMESTAMP WITH TIME ZONE,
    completion_date TIMESTAMP WITH TIME ZONE,
    completion_percent INTEGER DEFAULT 0,
    status VARCHAR(50) GENERATED ALWAYS AS (
        CASE 
            WHEN completion_percent = 0 THEN 'upcoming'
            WHEN completion_percent > 0 AND completion_percent < 100 THEN 'under-construction'
            WHEN completion_percent >= 100 THEN 'completed'
            ELSE 'upcoming'
        END
    ) STORED,
    
    -- Units
    unit_count INTEGER,
    building_unit_count INTEGER,
    
    -- Sales data
    sales_volume INTEGER DEFAULT 0,
    prop_sales_volume INTEGER DEFAULT 0,
    
    -- Media and marketing
    images TEXT[] DEFAULT '{}',
    logo_url TEXT,
    brochure_url TEXT,
    amenities TEXT[] DEFAULT '{}',
    
    -- Metadata
    display_as VARCHAR(10),
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Developer submissions table (keep existing structure with minor updates)
CREATE TABLE IF NOT EXISTS developer_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_name VARCHAR(255) NOT NULL,
    developer_name VARCHAR(255) NOT NULL,
    location VARCHAR(500) NOT NULL,
    district VARCHAR(255) NOT NULL,
    min_price NUMERIC(12, 2) NOT NULL,
    max_price NUMERIC(12, 2) NOT NULL,
    completion_date DATE NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_phone VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES FOR HIGH-PERFORMANCE MAP SEARCH (Zillow-style)
-- ============================================================================

-- ** CRITICAL ** Spatial index for map viewport queries (bounding box searches)
-- This is the most important index for map performance
CREATE INDEX IF NOT EXISTS idx_off_plan_location_gist 
    ON off_plan_properties USING GIST (location);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_off_plan_price_bedrooms 
    ON off_plan_properties (starting_price, min_bedrooms, max_bedrooms) 
    WHERE starting_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_off_plan_area_price 
    ON off_plan_properties (area_name, starting_price) 
    WHERE starting_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_off_plan_developer 
    ON off_plan_properties (developer);

CREATE INDEX IF NOT EXISTS idx_off_plan_completion 
    ON off_plan_properties (completion_date) 
    WHERE completion_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_off_plan_status 
    ON off_plan_properties (completion_percent, completion_date);

CREATE INDEX IF NOT EXISTS idx_off_plan_verified 
    ON off_plan_properties (verified) 
    WHERE verified = true;

-- Index for price range queries
CREATE INDEX IF NOT EXISTS idx_off_plan_price_range 
    ON off_plan_properties (starting_price) 
    WHERE starting_price IS NOT NULL;

-- Index for bedroom filtering
CREATE INDEX IF NOT EXISTS idx_off_plan_bedrooms 
    ON off_plan_properties (min_bedrooms, max_bedrooms);

-- Full-text search index for building/project names
CREATE INDEX IF NOT EXISTS idx_off_plan_search 
    ON off_plan_properties USING GIN (
        to_tsvector('english', 
            COALESCE(building_name, '') || ' ' || 
            COALESCE(project_name, '') || ' ' || 
            COALESCE(area_name, '')
        )
    );

-- Index for amenities array search
CREATE INDEX IF NOT EXISTS idx_off_plan_amenities 
    ON off_plan_properties USING GIN (amenities);

-- Developer submissions indexes
CREATE INDEX IF NOT EXISTS idx_developer_submissions_verified 
    ON developer_submissions(verified);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
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

-- Function to search properties within bounding box (for map viewport)
-- Usage: SELECT * FROM search_in_bounds(minLng, minLat, maxLng, maxLat, filters...)
CREATE OR REPLACE FUNCTION search_properties_in_bounds(
    min_lng DOUBLE PRECISION,
    min_lat DOUBLE PRECISION,
    max_lng DOUBLE PRECISION,
    max_lat DOUBLE PRECISION,
    p_min_price NUMERIC DEFAULT NULL,
    p_max_price NUMERIC DEFAULT NULL,
    p_min_beds INTEGER DEFAULT NULL,
    p_max_beds INTEGER DEFAULT NULL,
    p_developer VARCHAR DEFAULT NULL,
    p_area VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    building_name VARCHAR,
    project_name VARCHAR,
    developer VARCHAR,
    area_name VARCHAR,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    starting_price NUMERIC,
    min_bedrooms INTEGER,
    max_bedrooms INTEGER,
    completion_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR,
    images TEXT[],
    amenities TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        op.id,
        op.building_name,
        op.project_name,
        op.developer,
        op.area_name,
        ST_Y(op.location::geometry) as latitude,
        ST_X(op.location::geometry) as longitude,
        op.starting_price,
        op.min_bedrooms,
        op.max_bedrooms,
        op.completion_date,
        op.status,
        op.images,
        op.amenities
    FROM off_plan_properties op
    WHERE 
        -- Bounding box filter (optimized with spatial index)
        ST_Intersects(
            op.location,
            ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
        )
        -- Price filter
        AND (p_min_price IS NULL OR op.starting_price >= p_min_price)
        AND (p_max_price IS NULL OR op.starting_price <= p_max_price)
        -- Bedroom filter
        AND (p_min_beds IS NULL OR op.max_bedrooms >= p_min_beds)
        AND (p_max_beds IS NULL OR op.min_bedrooms <= p_max_beds)
        -- Developer filter
        AND (p_developer IS NULL OR op.developer = p_developer)
        -- Area filter
        AND (p_area IS NULL OR op.area_name = p_area)
        -- Only show properties with valid location and price
        AND op.location IS NOT NULL
        AND op.starting_price IS NOT NULL;
END;
$$ language 'plpgsql';

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger for off_plan_properties updated_at
CREATE TRIGGER update_off_plan_properties_updated_at 
    BEFORE UPDATE ON off_plan_properties
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for developer_submissions updated_at
CREATE TRIGGER update_developer_submissions_updated_at 
    BEFORE UPDATE ON developer_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- View for active listings (verified and not completed)
CREATE OR REPLACE VIEW active_off_plan_properties AS
SELECT * FROM off_plan_properties
WHERE verified = true AND completion_percent < 100
ORDER BY created_at DESC;

-- View for property counts by area
CREATE OR REPLACE VIEW properties_by_area AS
SELECT 
    area_name,
    COUNT(*) as property_count,
    AVG(starting_price) as avg_price,
    MIN(starting_price) as min_price,
    MAX(starting_price) as max_price
FROM off_plan_properties
WHERE starting_price IS NOT NULL
GROUP BY area_name
ORDER BY property_count DESC;
