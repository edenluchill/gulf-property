-- New Developer Property Submissions Table with Enhanced Structure
-- This table stores developer-submitted properties with rich metadata

CREATE TABLE IF NOT EXISTS developer_property_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Basic Information
    project_name VARCHAR(255) NOT NULL,
    developer VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    
    -- Location
    latitude NUMERIC(10, 8),
    longitude NUMERIC(11, 8),
    location GEOGRAPHY(POINT, 4326),  -- PostGIS geography for map integration
    
    -- Pricing & Size Ranges
    min_price NUMERIC(15, 2),
    max_price NUMERIC(15, 2),
    min_area NUMERIC(10, 2),  -- in square feet
    max_area NUMERIC(10, 2),
    min_bedrooms INTEGER,
    max_bedrooms INTEGER,
    
    -- Project Timeline
    launch_date DATE,
    completion_date DATE,
    completion_percent INTEGER DEFAULT 0,
    
    -- Description & Amenities
    description TEXT,
    amenities TEXT[] DEFAULT '{}',
    
    -- Images (categorized)
    showcase_images TEXT[] DEFAULT '{}',
    floorplan_images TEXT[] DEFAULT '{}',
    amenity_images TEXT[] DEFAULT '{}',
    
    -- PDF Source
    original_pdf_url TEXT,
    original_pdf_filename TEXT,
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, approved, rejected
    verified BOOLEAN DEFAULT false,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by VARCHAR(255),
    rejection_reason TEXT
);

-- Unit Types Table (one-to-many relationship)
CREATE TABLE IF NOT EXISTS developer_submission_unit_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES developer_property_submissions(id) ON DELETE CASCADE,
    
    -- Unit Type Details
    name VARCHAR(100) NOT NULL,  -- e.g., "Studio", "1 Bedroom", "2 Bedroom"
    min_area NUMERIC(10, 2),
    max_area NUMERIC(10, 2),
    min_price NUMERIC(15, 2),
    max_price NUMERIC(15, 2),
    bedrooms INTEGER,
    bathrooms NUMERIC(3, 1),  -- Allow half bathrooms like 2.5
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payment Plan Table (one-to-many relationship)
CREATE TABLE IF NOT EXISTS developer_submission_payment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES developer_property_submissions(id) ON DELETE CASCADE,
    
    -- Payment Milestone Details
    milestone VARCHAR(255) NOT NULL,  -- e.g., "Down Payment", "December 2024"
    percentage NUMERIC(5, 2) NOT NULL,  -- e.g., 20.00 for 20%
    payment_date DATE,
    sequence_order INTEGER DEFAULT 0,  -- For ordering milestones
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dev_submissions_location ON developer_property_submissions USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_dev_submissions_status ON developer_property_submissions(status);
CREATE INDEX IF NOT EXISTS idx_dev_submissions_developer ON developer_property_submissions(developer);
CREATE INDEX IF NOT EXISTS idx_dev_submissions_created_at ON developer_property_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_submission_unit_types_submission_id ON developer_submission_unit_types(submission_id);
CREATE INDEX IF NOT EXISTS idx_dev_submission_payment_plans_submission_id ON developer_submission_payment_plans(submission_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_developer_submission_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_developer_submission_updated_at
    BEFORE UPDATE ON developer_property_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_developer_submission_updated_at();

CREATE TRIGGER trigger_update_unit_types_updated_at
    BEFORE UPDATE ON developer_submission_unit_types
    FOR EACH ROW
    EXECUTE FUNCTION update_developer_submission_updated_at();

-- Auto-update location geography from lat/lng
CREATE OR REPLACE FUNCTION update_developer_submission_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_developer_submission_location
    BEFORE INSERT OR UPDATE ON developer_property_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_developer_submission_location();

-- Comments for documentation
COMMENT ON TABLE developer_property_submissions IS 'Stores developer-submitted off-plan properties with AI-extracted data from PDFs';
COMMENT ON TABLE developer_submission_unit_types IS 'Unit type configurations for developer submissions';
COMMENT ON TABLE developer_submission_payment_plans IS 'Payment plan milestones for developer submissions';
COMMENT ON COLUMN developer_property_submissions.status IS 'pending: awaiting review, approved: added to main catalog, rejected: not approved';
COMMENT ON COLUMN developer_submission_unit_types.bathrooms IS 'Numeric to support half bathrooms (e.g., 2.5)';
