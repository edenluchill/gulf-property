-- ============================================================================
-- DUBAI TRANSPORT INFRASTRUCTURE
-- Stores metro lines, tram lines, future planned routes (2040 plan)
-- Data source: Dubai Pulse, RTA, manual research
-- ============================================================================

-- Transport line type enum
CREATE TYPE transport_line_type AS ENUM (
    'metro',
    'tram',
    'monorail',
    'bus_rapid',
    'future_metro',
    'future_tram'
);

-- Line status enum
CREATE TYPE transport_line_status AS ENUM (
    'operational',      -- Currently running
    'under_construction', -- Being built
    'planned',          -- Announced but not started
    'proposed'          -- Under consideration
);

-- ============================================================================
-- TRANSPORT LINES TABLE
-- Stores the actual route geometry as LineString
-- ============================================================================
CREATE TABLE IF NOT EXISTS dubai_transport_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Basic info
    name VARCHAR(100) NOT NULL,           -- "Red Line", "Blue Line"
    name_ar VARCHAR(100),                 -- Arabic name
    code VARCHAR(20) NOT NULL UNIQUE,     -- "red", "green", "blue", "purple", "tram"

    -- Visual styling
    color VARCHAR(7) NOT NULL,            -- Hex color: "#FF0000"

    -- Classification
    line_type transport_line_type NOT NULL,
    status transport_line_status NOT NULL DEFAULT 'operational',

    -- Route geometry (LineString for the track)
    route GEOGRAPHY(LINESTRING, 4326),

    -- Stats
    length_km DECIMAL(6,2),               -- Total length in km
    station_count INTEGER,                -- Number of stations

    -- Timeline
    opened_date DATE,                     -- When it started operation
    planned_completion DATE,              -- For future lines

    -- Metadata
    description TEXT,
    data_source VARCHAR(100) DEFAULT 'dubai_pulse',
    source_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TRANSPORT STATIONS TABLE
-- Individual stations on each line
-- ============================================================================
CREATE TABLE IF NOT EXISTS dubai_transport_stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Basic info
    name VARCHAR(150) NOT NULL,
    name_ar VARCHAR(150),
    code VARCHAR(30),                     -- Station code if any

    -- Location
    location GEOGRAPHY(POINT, 4326) NOT NULL,

    -- Line relationship
    line_id UUID NOT NULL REFERENCES dubai_transport_lines(id) ON DELETE CASCADE,
    line_code VARCHAR(20) NOT NULL,       -- Denormalized for quick queries
    sequence_order INTEGER NOT NULL,      -- Order along the line (1, 2, 3...)

    -- Station characteristics
    is_interchange BOOLEAN DEFAULT FALSE, -- Connects to other lines
    is_terminal BOOLEAN DEFAULT FALSE,    -- End of line
    is_underground BOOLEAN DEFAULT FALSE,

    -- Status (for future stations)
    status transport_line_status NOT NULL DEFAULT 'operational',
    planned_completion DATE,

    -- Connected lines (for interchange stations)
    interchange_lines VARCHAR(20)[],      -- Array of line codes: ["red", "green"]

    -- Metadata
    zone VARCHAR(20),                     -- Fare zone
    facilities TEXT[],                    -- ["parking", "bus_connection", "taxi"]
    data_source VARCHAR(100) DEFAULT 'dubai_pulse',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint: one station per position on a line
    UNIQUE(line_id, sequence_order)
);

-- ============================================================================
-- TRANSPORT LINE SEGMENTS TABLE (Optional - for detailed routing)
-- Stores line segments between stations for precise rendering
-- ============================================================================
CREATE TABLE IF NOT EXISTS dubai_transport_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    line_id UUID NOT NULL REFERENCES dubai_transport_lines(id) ON DELETE CASCADE,
    from_station_id UUID REFERENCES dubai_transport_stations(id),
    to_station_id UUID REFERENCES dubai_transport_stations(id),

    -- Segment geometry (curved path between stations)
    segment_path GEOGRAPHY(LINESTRING, 4326),

    -- Segment info
    sequence_order INTEGER NOT NULL,
    distance_km DECIMAL(5,2),
    travel_time_mins INTEGER,

    -- Status
    status transport_line_status NOT NULL DEFAULT 'operational',

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Spatial indexes
CREATE INDEX IF NOT EXISTS idx_transport_lines_route_gist
    ON dubai_transport_lines USING GIST (route);

CREATE INDEX IF NOT EXISTS idx_transport_stations_location_gist
    ON dubai_transport_stations USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_transport_segments_path_gist
    ON dubai_transport_segments USING GIST (segment_path);

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_transport_lines_status
    ON dubai_transport_lines (status);

CREATE INDEX IF NOT EXISTS idx_transport_lines_type
    ON dubai_transport_lines (line_type);

CREATE INDEX IF NOT EXISTS idx_transport_stations_line
    ON dubai_transport_stations (line_id);

CREATE INDEX IF NOT EXISTS idx_transport_stations_code
    ON dubai_transport_stations (line_code);

CREATE INDEX IF NOT EXISTS idx_transport_stations_status
    ON dubai_transport_stations (status);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get all lines with station count
CREATE OR REPLACE FUNCTION get_transport_lines(
    p_include_future BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id UUID,
    name VARCHAR(100),
    code VARCHAR(20),
    color VARCHAR(7),
    line_type transport_line_type,
    status transport_line_status,
    length_km DECIMAL(6,2),
    station_count BIGINT,
    route_geojson JSON
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        tl.id,
        tl.name,
        tl.code,
        tl.color,
        tl.line_type,
        tl.status,
        tl.length_km,
        COUNT(ts.id) as station_count,
        ST_AsGeoJSON(tl.route)::json as route_geojson
    FROM dubai_transport_lines tl
    LEFT JOIN dubai_transport_stations ts ON ts.line_id = tl.id
    WHERE p_include_future = TRUE
       OR tl.status = 'operational'
    GROUP BY tl.id
    ORDER BY
        CASE tl.status
            WHEN 'operational' THEN 1
            WHEN 'under_construction' THEN 2
            WHEN 'planned' THEN 3
            ELSE 4
        END,
        tl.name;
END;
$$ LANGUAGE plpgsql;

-- Get stations for a specific line
CREATE OR REPLACE FUNCTION get_line_stations(
    p_line_code VARCHAR(20)
)
RETURNS TABLE (
    id UUID,
    name VARCHAR(150),
    name_ar VARCHAR(150),
    lng DOUBLE PRECISION,
    lat DOUBLE PRECISION,
    sequence_order INTEGER,
    is_interchange BOOLEAN,
    is_terminal BOOLEAN,
    status transport_line_status,
    interchange_lines VARCHAR(20)[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ts.id,
        ts.name,
        ts.name_ar,
        ST_X(ts.location::geometry) as lng,
        ST_Y(ts.location::geometry) as lat,
        ts.sequence_order,
        ts.is_interchange,
        ts.is_terminal,
        ts.status,
        ts.interchange_lines
    FROM dubai_transport_stations ts
    WHERE ts.line_code = p_line_code
    ORDER BY ts.sequence_order;
END;
$$ LANGUAGE plpgsql;

-- Get all transport data as GeoJSON FeatureCollection
CREATE OR REPLACE FUNCTION get_transport_geojson(
    p_include_future BOOLEAN DEFAULT FALSE
)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(json_agg(features.feature), '[]'::json)
    ) INTO result
    FROM (
        -- Lines as LineString features
        SELECT json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(tl.route)::json,
            'properties', json_build_object(
                'id', tl.id,
                'name', tl.name,
                'code', tl.code,
                'color', tl.color,
                'type', tl.line_type,
                'status', tl.status,
                'featureType', 'line'
            )
        ) as feature
        FROM dubai_transport_lines tl
        WHERE tl.route IS NOT NULL
          AND (p_include_future = TRUE OR tl.status = 'operational')

        UNION ALL

        -- Stations as Point features
        SELECT json_build_object(
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(ts.location)::json,
            'properties', json_build_object(
                'id', ts.id,
                'name', ts.name,
                'lineCode', ts.line_code,
                'sequenceOrder', ts.sequence_order,
                'isInterchange', ts.is_interchange,
                'isTerminal', ts.is_terminal,
                'status', ts.status,
                'interchangeLines', ts.interchange_lines,
                'featureType', 'station'
            )
        ) as feature
        FROM dubai_transport_stations ts
        JOIN dubai_transport_lines tl ON tl.id = ts.line_id
        WHERE p_include_future = TRUE OR ts.status = 'operational'
    ) features;

    RETURN result;
END;
$$ LANGUAGE plpgsql;
