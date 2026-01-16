-- ============================================================================
-- DUBAI AREAS & LANDMARKS
-- Tables for storing Dubai district information and famous landmarks
-- ============================================================================

-- Dubai areas table (districts with polygon boundaries)
CREATE TABLE IF NOT EXISTS dubai_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),  -- Arabic name
    
    -- Geographic boundary (polygon)
    boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
    
    -- Area attributes
    area_type VARCHAR(50),  -- e.g., 'residential', 'commercial', 'mixed', 'freehold'
    wealth_level VARCHAR(50),  -- e.g., 'luxury', 'premium', 'mid-range', 'affordable'
    cultural_attribute VARCHAR(100),  -- e.g., 'expatriate', 'family-oriented', 'business-hub', 'entertainment'
    
    -- Description
    description TEXT,
    description_ar TEXT,  -- Arabic description
    
    -- Visual styling
    color VARCHAR(7) DEFAULT '#3B82F6',  -- Hex color for map display
    opacity NUMERIC(3, 2) DEFAULT 0.3,  -- Opacity (0-1)
    
    -- Metadata
    visible BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Dubai landmarks table (famous points of interest)
CREATE TABLE IF NOT EXISTS dubai_landmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),  -- Arabic name
    
    -- Geographic location (point)
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    
    -- Landmark attributes
    landmark_type VARCHAR(50) NOT NULL,  -- e.g., 'tower', 'mall', 'hotel', 'attraction', 'beach', 'airport'
    icon_name VARCHAR(50) DEFAULT 'landmark',  -- Icon identifier for frontend
    
    -- Description
    description TEXT,
    description_ar TEXT,
    
    -- Additional info
    year_built INTEGER,
    website_url TEXT,
    image_url TEXT,
    
    -- Visual styling
    color VARCHAR(7) DEFAULT '#EF4444',  -- Hex color for marker
    size VARCHAR(20) DEFAULT 'medium',  -- 'small', 'medium', 'large'
    
    -- Metadata
    visible BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Spatial index for areas (polygon search)
CREATE INDEX IF NOT EXISTS idx_dubai_areas_boundary_gist 
    ON dubai_areas USING GIST (boundary);

-- Spatial index for landmarks (point search)
CREATE INDEX IF NOT EXISTS idx_dubai_landmarks_location_gist 
    ON dubai_landmarks USING GIST (location);

-- Filter indexes
CREATE INDEX IF NOT EXISTS idx_dubai_areas_visible 
    ON dubai_areas (visible) WHERE visible = true;

CREATE INDEX IF NOT EXISTS idx_dubai_landmarks_visible 
    ON dubai_landmarks (visible) WHERE visible = true;

CREATE INDEX IF NOT EXISTS idx_dubai_landmarks_type 
    ON dubai_landmarks (landmark_type);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger for dubai_areas updated_at
CREATE TRIGGER update_dubai_areas_updated_at 
    BEFORE UPDATE ON dubai_areas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for dubai_landmarks updated_at
CREATE TRIGGER update_dubai_landmarks_updated_at 
    BEFORE UPDATE ON dubai_landmarks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SAMPLE DATA - Dubai Areas
-- ============================================================================

INSERT INTO dubai_areas (name, name_ar, boundary, area_type, wealth_level, cultural_attribute, description, color, opacity) VALUES
-- Downtown Dubai (luxury business/residential hub)
('Downtown Dubai', 'وسط مدينة دبي', 
 ST_GeomFromText('POLYGON((55.269 25.191, 55.282 25.191, 55.282 25.205, 55.269 25.205, 55.269 25.191))', 4326)::geography,
 'mixed', 'luxury', 'business-hub', 
 'Heart of Dubai with Burj Khalifa, Dubai Mall, and luxury living', 
 '#FFD700', 0.25),

-- Dubai Marina (luxury waterfront residential)
('Dubai Marina', 'مرسى دبي',
 ST_GeomFromText('POLYGON((55.128 25.068, 55.148 25.068, 55.148 25.088, 55.128 25.088, 55.128 25.068))', 4326)::geography,
 'residential', 'luxury', 'expatriate',
 'Upscale waterfront living with high-rise towers and marina lifestyle',
 '#4169E1', 0.25),

-- Palm Jumeirah (ultra-luxury island residential)
('Palm Jumeirah', 'نخلة جميرا',
 ST_GeomFromText('POLYGON((55.115 25.105, 55.145 25.105, 55.145 25.125, 55.115 25.125, 55.115 25.105))', 4326)::geography,
 'residential', 'luxury', 'family-oriented',
 'Iconic palm-shaped island with luxury villas and apartments',
 '#32CD32', 0.25),

-- Business Bay (business district)
('Business Bay', 'الخليج التجاري',
 ST_GeomFromText('POLYGON((55.258 25.175, 55.273 25.175, 55.273 25.188, 55.258 25.188, 55.258 25.175))', 4326)::geography,
 'commercial', 'premium', 'business-hub',
 'Modern business district with commercial towers and offices',
 '#FF6347', 0.25),

-- JBR (Jumeirah Beach Residence - beachfront lifestyle)
('JBR', 'شاطئ جميرا',
 ST_GeomFromText('POLYGON((55.125 25.075, 55.135 25.075, 55.135 25.085, 55.125 25.085, 55.125 25.075))', 4326)::geography,
 'residential', 'premium', 'entertainment',
 'Beachfront residential towers with dining and entertainment',
 '#00CED1', 0.25),

-- Dubai Hills Estate (family-oriented green community)
('Dubai Hills Estate', 'دبي هيلز استيت',
 ST_GeomFromText('POLYGON((55.245 25.105, 55.265 25.105, 55.265 25.125, 55.245 25.125, 55.245 25.105))', 4326)::geography,
 'residential', 'premium', 'family-oriented',
 'Green community with golf course, parks, and family amenities',
 '#90EE90', 0.25),

-- Jumeirah Village Circle (mid-range family community)
('Jumeirah Village Circle', 'دائرة قرية جميرا',
 ST_GeomFromText('POLYGON((55.200 25.050, 55.220 25.050, 55.220 25.065, 55.200 25.065, 55.200 25.050))', 4326)::geography,
 'residential', 'mid-range', 'family-oriented',
 'Affordable family community with parks and schools',
 '#FFA07A', 0.25),

-- Arabian Ranches (suburban luxury villas)
('Arabian Ranches', 'المرابع العربية',
 ST_GeomFromText('POLYGON((55.240 25.040, 55.265 25.040, 55.265 25.060, 55.240 25.060, 55.240 25.040))', 4326)::geography,
 'residential', 'luxury', 'family-oriented',
 'Golf course community with luxury villas and polo club',
 '#F4A460', 0.25)

ON CONFLICT DO NOTHING;

-- ============================================================================
-- SAMPLE DATA - Dubai Landmarks
-- ============================================================================

INSERT INTO dubai_landmarks (name, name_ar, location, landmark_type, icon_name, description, year_built, color, size) VALUES
-- Iconic towers and buildings
('Burj Khalifa', 'برج خليفة',
 ST_SetSRID(ST_MakePoint(55.2744, 25.1972), 4326)::geography,
 'tower', 'building', 
 'World''s tallest building at 828m with observation decks',
 2010, '#FFD700', 'large'),

('Burj Al Arab', 'برج العرب',
 ST_SetSRID(ST_MakePoint(55.1853, 25.1413), 4326)::geography,
 'hotel', 'hotel', 
 'Iconic sail-shaped luxury hotel on artificial island',
 1999, '#00BFFF', 'large'),

('Museum of the Future', 'متحف المستقبل',
 ST_SetSRID(ST_MakePoint(55.2802, 25.2195), 4326)::geography,
 'attraction', 'museum', 
 'Futuristic museum showcasing innovations and technology',
 2022, '#C0C0C0', 'large'),

-- Shopping malls
('Dubai Mall', 'دبي مول',
 ST_SetSRID(ST_MakePoint(55.2788, 25.1981), 4326)::geography,
 'mall', 'shopping', 
 'World''s largest shopping mall by total area',
 2008, '#FF69B4', 'large'),

('Mall of the Emirates', 'مول الإمارات',
 ST_SetSRID(ST_MakePoint(55.2002, 25.1186), 4326)::geography,
 'mall', 'shopping', 
 'Major shopping destination with indoor ski resort',
 2005, '#FF1493', 'medium'),

-- Beaches and waterfront
('Jumeirah Beach', 'شاطئ جميرا',
 ST_SetSRID(ST_MakePoint(55.1900, 25.1350), 4326)::geography,
 'beach', 'beach', 
 'Popular public beach with Burj Al Arab views',
 NULL, '#87CEEB', 'medium'),

('Kite Beach', 'شاطئ الطائرة الورقية',
 ST_SetSRID(ST_MakePoint(55.1950, 25.1550), 4326)::geography,
 'beach', 'beach', 
 'Active beach for water sports and kite surfing',
 NULL, '#40E0D0', 'medium'),

-- Entertainment and culture
('Dubai Opera', 'دار الأوبرا',
 ST_SetSRID(ST_MakePoint(55.2741, 25.1941), 4326)::geography,
 'attraction', 'theater', 
 'Premier performing arts venue in Downtown Dubai',
 2016, '#8B008B', 'medium'),

('Dubai Fountain', 'نافورة دبي',
 ST_SetSRID(ST_MakePoint(55.2747, 25.1951), 4326)::geography,
 'attraction', 'fountain', 
 'World''s largest choreographed fountain system',
 2009, '#1E90FF', 'medium'),

('La Mer', 'لامير',
 ST_SetSRID(ST_MakePoint(55.2650, 25.2320), 4326)::geography,
 'attraction', 'entertainment', 
 'Beachfront destination with dining and entertainment',
 2017, '#FF6347', 'medium'),

-- Transport hubs
('Dubai International Airport', 'مطار دبي الدولي',
 ST_SetSRID(ST_MakePoint(55.3644, 25.2532), 4326)::geography,
 'airport', 'airport', 
 'One of the world''s busiest international airports',
 1960, '#808080', 'large'),

('Dubai Marina Mall', 'مول مرسى دبي',
 ST_SetSRID(ST_MakePoint(55.1372, 25.0771), 4326)::geography,
 'mall', 'shopping', 
 'Waterfront shopping mall in Dubai Marina',
 2008, '#FF1493', 'small'),

-- Parks and outdoor
('Zabeel Park', 'حديقة زعبيل',
 ST_SetSRID(ST_MakePoint(55.3059, 25.2295), 4326)::geography,
 'park', 'park', 
 'Large urban park with Dubai Frame landmark',
 2005, '#228B22', 'medium'),

('Global Village', 'القرية العالمية',
 ST_SetSRID(ST_MakePoint(55.3085, 25.0744), 4326)::geography,
 'attraction', 'entertainment', 
 'Seasonal cultural and shopping festival park',
 1997, '#FF4500', 'medium')

ON CONFLICT DO NOTHING;
