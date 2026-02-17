-- ============================================================================
-- DUBAI POIs (Points of Interest)
-- Stores hospitals, schools, metro stations, parks, etc.
-- Data source: OpenStreetMap via Overpass API
-- ============================================================================

-- POI categories enum
CREATE TYPE poi_category AS ENUM (
    'hospital',
    'clinic',
    'pharmacy',
    'school',
    'university',
    'metro_station',
    'bus_station',
    'mall',
    'supermarket',
    'bank',
    'atm',
    'gas_station',
    'hotel',
    'mosque',
    'church',
    'park',
    'beach',
    'gym',
    'cinema',
    'restaurant',
    'cafe',
    'police',
    'fire_station',
    'post_office',
    'embassy'
);

-- Main POI table
CREATE TABLE IF NOT EXISTS dubai_pois (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Basic info
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),

    -- Location (PostGIS geography for accurate distance calculations)
    location GEOGRAPHY(POINT, 4326) NOT NULL,

    -- Classification
    category poi_category NOT NULL,
    subcategory VARCHAR(100),  -- e.g., 'Red Line', 'British Curriculum'

    -- Contact details
    address TEXT,
    phone VARCHAR(100),
    website TEXT,

    -- Source reference (for deduplication and updates)
    osm_id TEXT UNIQUE,        -- OpenStreetMap node/way ID
    osm_type VARCHAR(20),      -- OSM element type: 'node', 'way', 'relation'

    -- Metadata
    data_source VARCHAR(50) DEFAULT 'openstreetmap',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Spatial index for location queries (CRITICAL for performance)
CREATE INDEX IF NOT EXISTS idx_dubai_pois_location_gist
    ON dubai_pois USING GIST (location);

-- Category filter index
CREATE INDEX IF NOT EXISTS idx_dubai_pois_category
    ON dubai_pois (category);

-- Source ID for upsert operations
CREATE INDEX IF NOT EXISTS idx_dubai_pois_source
    ON dubai_pois (osm_type, osm_id);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get POIs within radius (in meters) of a point
CREATE OR REPLACE FUNCTION get_pois_near_point(
    p_lng DOUBLE PRECISION,
    p_lat DOUBLE PRECISION,
    p_radius_meters INTEGER DEFAULT 1000,
    p_categories poi_category[] DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name VARCHAR(255),
    name_ar VARCHAR(255),
    category poi_category,
    subcategory VARCHAR(100),
    lng DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    distance_meters DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dp.id,
        dp.name,
        dp.name_ar,
        dp.category,
        dp.subcategory,
        ST_X(dp.location::geometry) as lng,
        ST_Y(dp.location::geometry) as lat,
        ST_Distance(dp.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_meters
    FROM dubai_pois dp
    WHERE ST_DWithin(
          dp.location,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_meters
      )
      AND (p_categories IS NULL OR dp.category = ANY(p_categories))
    ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;
