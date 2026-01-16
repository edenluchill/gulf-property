-- ============================================================================
-- RESIDENTIAL PROJECTS SCHEMA
-- For Developer-submitted off-plan properties with detailed unit information
-- ============================================================================

-- Enable PostGIS extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- MAIN TABLE: Residential Projects
-- ============================================================================
CREATE TABLE IF NOT EXISTS residential_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Information
    project_name VARCHAR(255) NOT NULL,
    developer VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    area VARCHAR(255) NOT NULL,  -- e.g., "Dubai Marina"
    description TEXT,
    
    -- Location (PostGIS for geospatial queries)
    location GEOGRAPHY(POINT, 4326),  -- Stores lat/lng
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    
    -- Project Timeline
    launch_date DATE,
    completion_date DATE,
    handover_date DATE,
    construction_progress VARCHAR(100),  -- e.g., "75% Complete"
    
    -- Project Status
    status VARCHAR(50) DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'under-construction', 'completed', 'handed-over')),
    
    -- Pricing Summary (derived from unit types)
    min_price NUMERIC(15, 2),
    max_price NUMERIC(15, 2),
    starting_price NUMERIC(15, 2),
    
    -- Unit Summary
    total_unit_types INTEGER DEFAULT 0,
    total_units INTEGER DEFAULT 0,
    min_bedrooms INTEGER,
    max_bedrooms INTEGER,
    
    -- Media Assets
    project_images TEXT[] DEFAULT '{}',  -- Array of image URLs
    floor_plan_images TEXT[] DEFAULT '{}',  -- Array of floor plan URLs
    brochure_url TEXT,
    
    -- Visual Content Metadata (from AI extraction)
    has_renderings BOOLEAN DEFAULT false,
    has_floor_plans BOOLEAN DEFAULT false,
    has_location_maps BOOLEAN DEFAULT false,
    rendering_descriptions TEXT[] DEFAULT '{}',
    floor_plan_descriptions TEXT[] DEFAULT '{}',
    
    -- Amenities
    amenities TEXT[] DEFAULT '{}',
    
    -- Metadata
    verified BOOLEAN DEFAULT false,
    featured BOOLEAN DEFAULT false,
    views_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_dates CHECK (
        (launch_date IS NULL OR completion_date IS NULL OR launch_date <= completion_date)
    ),
    CONSTRAINT valid_location CHECK (
        (latitude IS NULL AND longitude IS NULL) OR 
        (latitude IS NOT NULL AND longitude IS NOT NULL)
    )
);

-- ============================================================================
-- UNIT TYPES TABLE
-- Stores detailed information about each unit type in a project
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_unit_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES residential_projects(id) ON DELETE CASCADE,
    
    -- Unit Identification
    unit_type_name VARCHAR(255) NOT NULL,  -- e.g., "Type A", "Studio Premium"
    category VARCHAR(100),  -- e.g., "Studio", "Apartment", "Penthouse"
    type_code VARCHAR(100),  -- e.g., "A-101", "DSTH-M1"
    tower VARCHAR(100),  -- Building/Tower identifier (e.g., "DSTH", "A", "Tower 1")
    
    -- Unit Numbers
    unit_numbers TEXT[] DEFAULT '{}',  -- Specific unit numbers (e.g., ["101", "201", "301"])
    unit_count INTEGER DEFAULT 1,  -- Number of units of this type
    
    -- Room Configuration
    bedrooms INTEGER NOT NULL,
    bathrooms NUMERIC(3, 1) NOT NULL,  -- Allow 1.5, 2.5 bathrooms
    
    -- Size Information (in square feet)
    area NUMERIC(10, 2) NOT NULL,  -- Total area
    balcony_area NUMERIC(10, 2),  -- Balcony area
    built_up_area NUMERIC(10, 2),  -- Built-up area
    
    -- Pricing
    price NUMERIC(15, 2),
    price_per_sqft NUMERIC(10, 2),
    
    -- Unit Details
    orientation VARCHAR(50),  -- e.g., "North", "South-West"
    floor_level VARCHAR(50),  -- e.g., "Ground", "1-10", "High Floor"
    view_type VARCHAR(100),  -- e.g., "Sea View", "Marina View", "City View"
    
    -- Features
    features TEXT[] DEFAULT '{}',  -- e.g., ["Balcony", "Maid's Room", "Study Room"]
    
    -- Media
    floor_plan_image TEXT,  -- URL to floor plan image
    unit_images TEXT[] DEFAULT '{}',  -- Additional unit-specific images
    
    -- Display Order
    display_order INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_bedrooms CHECK (bedrooms >= 0 AND bedrooms <= 20),
    CONSTRAINT valid_bathrooms CHECK (bathrooms > 0 AND bathrooms <= 20),
    CONSTRAINT valid_area CHECK (area > 0)
);

-- ============================================================================
-- PAYMENT PLANS TABLE
-- Stores payment plan milestones for each project
-- ============================================================================
CREATE TABLE IF NOT EXISTS project_payment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES residential_projects(id) ON DELETE CASCADE,
    
    -- Milestone Information
    milestone_name VARCHAR(255) NOT NULL,  -- e.g., "Booking", "On Handover", "Construction Phase 1"
    percentage NUMERIC(5, 2) NOT NULL,  -- e.g., 10.00 for 10%
    milestone_date DATE,  -- Optional date for this milestone
    
    -- Display Order
    display_order INTEGER DEFAULT 0,
    
    -- Description
    description TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_percentage CHECK (percentage >= 0 AND percentage <= 100)
);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Residential Projects Indexes
CREATE INDEX IF NOT EXISTS idx_residential_projects_location_gist 
    ON residential_projects USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_residential_projects_area 
    ON residential_projects (area);

CREATE INDEX IF NOT EXISTS idx_residential_projects_developer 
    ON residential_projects (developer);

CREATE INDEX IF NOT EXISTS idx_residential_projects_price 
    ON residential_projects (starting_price) 
    WHERE starting_price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_residential_projects_status 
    ON residential_projects (status);

CREATE INDEX IF NOT EXISTS idx_residential_projects_verified 
    ON residential_projects (verified) 
    WHERE verified = true;

CREATE INDEX IF NOT EXISTS idx_residential_projects_completion 
    ON residential_projects (completion_date) 
    WHERE completion_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_residential_projects_bedrooms 
    ON residential_projects (min_bedrooms, max_bedrooms);

-- Full-text search for project names
CREATE INDEX IF NOT EXISTS idx_residential_projects_search 
    ON residential_projects USING GIN (
        to_tsvector('english', 
            COALESCE(project_name, '') || ' ' || 
            COALESCE(developer, '') || ' ' || 
            COALESCE(area, '') || ' ' ||
            COALESCE(address, '')
        )
    );

-- Amenities search
CREATE INDEX IF NOT EXISTS idx_residential_projects_amenities 
    ON residential_projects USING GIN (amenities);

-- Unit Types Indexes
CREATE INDEX IF NOT EXISTS idx_unit_types_project 
    ON project_unit_types (project_id);

CREATE INDEX IF NOT EXISTS idx_unit_types_bedrooms 
    ON project_unit_types (bedrooms);

CREATE INDEX IF NOT EXISTS idx_unit_types_price 
    ON project_unit_types (price) 
    WHERE price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unit_types_tower 
    ON project_unit_types (tower) 
    WHERE tower IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unit_types_category 
    ON project_unit_types (category);

-- Payment Plans Index
CREATE INDEX IF NOT EXISTS idx_payment_plans_project 
    ON project_payment_plans (project_id, display_order);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_residential_projects_updated_at 
    BEFORE UPDATE ON residential_projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_project_unit_types_updated_at 
    BEFORE UPDATE ON project_unit_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-sync location geography from lat/lng
CREATE OR REPLACE FUNCTION sync_location_geography()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::GEOGRAPHY;
    ELSE
        NEW.location = NULL;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER sync_residential_projects_location 
    BEFORE INSERT OR UPDATE ON residential_projects
    FOR EACH ROW EXECUTE FUNCTION sync_location_geography();

-- Auto-update project summary fields from unit types
CREATE OR REPLACE FUNCTION update_project_summary()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE residential_projects
    SET 
        total_unit_types = (SELECT COUNT(*) FROM project_unit_types WHERE project_id = NEW.project_id),
        total_units = (SELECT COALESCE(SUM(unit_count), 0) FROM project_unit_types WHERE project_id = NEW.project_id),
        min_bedrooms = (SELECT MIN(bedrooms) FROM project_unit_types WHERE project_id = NEW.project_id),
        max_bedrooms = (SELECT MAX(bedrooms) FROM project_unit_types WHERE project_id = NEW.project_id),
        min_price = (SELECT MIN(price) FROM project_unit_types WHERE project_id = NEW.project_id AND price IS NOT NULL),
        max_price = (SELECT MAX(price) FROM project_unit_types WHERE project_id = NEW.project_id AND price IS NOT NULL),
        starting_price = (SELECT MIN(price) FROM project_unit_types WHERE project_id = NEW.project_id AND price IS NOT NULL)
    WHERE id = NEW.project_id;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_project_summary_on_unit_insert 
    AFTER INSERT ON project_unit_types
    FOR EACH ROW EXECUTE FUNCTION update_project_summary();

CREATE TRIGGER update_project_summary_on_unit_update 
    AFTER UPDATE ON project_unit_types
    FOR EACH ROW EXECUTE FUNCTION update_project_summary();

CREATE TRIGGER update_project_summary_on_unit_delete 
    AFTER DELETE ON project_unit_types
    FOR EACH ROW EXECUTE FUNCTION update_project_summary();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Complete project details with unit summary
CREATE OR REPLACE VIEW residential_projects_with_details AS
SELECT 
    rp.*,
    COUNT(DISTINCT put.id) as unit_type_count,
    COALESCE(SUM(put.unit_count), 0) as total_unit_count,
    jsonb_agg(
        DISTINCT jsonb_build_object(
            'id', put.id,
            'name', put.unit_type_name,
            'bedrooms', put.bedrooms,
            'bathrooms', put.bathrooms,
            'area', put.area,
            'price', put.price,
            'floor_plan_image', put.floor_plan_image
        ) ORDER BY put.bedrooms, put.area
    ) FILTER (WHERE put.id IS NOT NULL) as unit_types,
    jsonb_agg(
        DISTINCT jsonb_build_object(
            'milestone', ppp.milestone_name,
            'percentage', ppp.percentage,
            'date', ppp.milestone_date
        ) ORDER BY ppp.display_order
    ) FILTER (WHERE ppp.id IS NOT NULL) as payment_plan
FROM residential_projects rp
LEFT JOIN project_unit_types put ON rp.id = put.project_id
LEFT JOIN project_payment_plans ppp ON rp.id = ppp.project_id
GROUP BY rp.id;

-- View: Active projects (verified and not completed)
CREATE OR REPLACE VIEW active_residential_projects AS
SELECT * FROM residential_projects
WHERE verified = true 
  AND (status IN ('upcoming', 'under-construction') OR completion_date > CURRENT_DATE)
ORDER BY created_at DESC;

-- View: Projects by area with statistics
CREATE OR REPLACE VIEW projects_by_area_stats AS
SELECT 
    area,
    COUNT(*) as project_count,
    AVG(starting_price) as avg_starting_price,
    MIN(starting_price) as min_price,
    MAX(starting_price) as max_price,
    AVG(total_units) as avg_units
FROM residential_projects
WHERE starting_price IS NOT NULL
GROUP BY area
ORDER BY project_count DESC;

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function: Search projects in map bounds
CREATE OR REPLACE FUNCTION search_residential_projects_in_bounds(
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
    project_name VARCHAR,
    developer VARCHAR,
    area VARCHAR,
    address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    starting_price NUMERIC,
    min_bedrooms INTEGER,
    max_bedrooms INTEGER,
    completion_date DATE,
    status VARCHAR,
    project_images TEXT[],
    amenities TEXT[],
    total_units INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rp.id,
        rp.project_name,
        rp.developer,
        rp.area,
        rp.address,
        rp.latitude,
        rp.longitude,
        rp.starting_price,
        rp.min_bedrooms,
        rp.max_bedrooms,
        rp.completion_date,
        rp.status,
        rp.project_images,
        rp.amenities,
        rp.total_units
    FROM residential_projects rp
    WHERE 
        -- Bounding box filter
        rp.location IS NOT NULL
        AND ST_Intersects(
            rp.location,
            ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
        )
        -- Filters
        AND (p_min_price IS NULL OR rp.starting_price >= p_min_price)
        AND (p_max_price IS NULL OR rp.starting_price <= p_max_price)
        AND (p_min_beds IS NULL OR rp.max_bedrooms >= p_min_beds)
        AND (p_max_beds IS NULL OR rp.min_bedrooms <= p_max_beds)
        AND (p_developer IS NULL OR rp.developer = p_developer)
        AND (p_area IS NULL OR rp.area = p_area)
        AND rp.verified = true;
END;
$$ language 'plpgsql';

-- Function: Get project with all details (units + payment plan)
CREATE OR REPLACE FUNCTION get_project_details(project_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'project', row_to_json(rp.*),
        'unitTypes', COALESCE(
            (SELECT json_agg(row_to_json(put.*) ORDER BY put.bedrooms, put.area)
             FROM project_unit_types put WHERE put.project_id = project_uuid),
            '[]'::json
        ),
        'paymentPlan', COALESCE(
            (SELECT json_agg(row_to_json(ppp.*) ORDER BY ppp.display_order)
             FROM project_payment_plans ppp WHERE ppp.project_id = project_uuid),
            '[]'::json
        )
    ) INTO result
    FROM residential_projects rp
    WHERE rp.id = project_uuid;
    
    RETURN result;
END;
$$ language 'plpgsql';

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE residential_projects IS 'Developer-submitted residential off-plan projects with AI-extracted data';
COMMENT ON TABLE project_unit_types IS 'Detailed unit type information for each residential project';
COMMENT ON TABLE project_payment_plans IS 'Payment plan milestones for each project';

COMMENT ON COLUMN residential_projects.location IS 'PostGIS geography point for geospatial queries';
COMMENT ON COLUMN residential_projects.construction_progress IS 'Human-readable construction progress (e.g., "75% Complete")';
COMMENT ON COLUMN residential_projects.project_images IS 'Array of URLs to project images extracted from PDF';
COMMENT ON COLUMN residential_projects.floor_plan_images IS 'Array of URLs to floor plan images';

COMMENT ON COLUMN project_unit_types.tower IS 'Building/Tower identifier extracted from unit type name (e.g., "DSTH", "A")';
COMMENT ON COLUMN project_unit_types.unit_numbers IS 'Specific unit numbers for this type (e.g., ["101", "201", "301"])';
COMMENT ON COLUMN project_unit_types.floor_plan_image IS 'URL to the floor plan image for this unit type';
