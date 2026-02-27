-- Custom Routes and Stops tables (replaces hardcoded transport data)

-- Routes table (metro lines, tram lines, custom routes, etc.)
CREATE TABLE IF NOT EXISTS custom_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),  -- Arabic name
  description TEXT,
  color VARCHAR(20) DEFAULT '#3b82f6',  -- Line color
  line_width DECIMAL(3,1) DEFAULT 3,
  route_type VARCHAR(50) DEFAULT 'metro',  -- metro, tram, bus, monorail, custom
  geometry JSONB NOT NULL,  -- GeoJSON LineString
  images TEXT[],  -- Array of image URLs
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stops table (stations along routes)
CREATE TABLE IF NOT EXISTS custom_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID REFERENCES custom_routes(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),  -- Arabic name
  description TEXT,
  color VARCHAR(20),  -- Optional override, defaults to route color
  location JSONB NOT NULL,  -- {lat, lng}
  position_on_route DECIMAL(5,4),  -- 0.0 to 1.0, position along route line
  images TEXT[],  -- Array of image URLs
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_custom_routes_active ON custom_routes(is_active);
CREATE INDEX IF NOT EXISTS idx_custom_routes_type ON custom_routes(route_type);
CREATE INDEX IF NOT EXISTS idx_custom_stops_route ON custom_stops(route_id);
CREATE INDEX IF NOT EXISTS idx_custom_stops_active ON custom_stops(is_active);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_custom_routes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS custom_routes_updated_at ON custom_routes;
CREATE TRIGGER custom_routes_updated_at
  BEFORE UPDATE ON custom_routes
  FOR EACH ROW EXECUTE FUNCTION update_custom_routes_timestamp();

DROP TRIGGER IF EXISTS custom_stops_updated_at ON custom_stops;
CREATE TRIGGER custom_stops_updated_at
  BEFORE UPDATE ON custom_stops
  FOR EACH ROW EXECUTE FUNCTION update_custom_routes_timestamp();
