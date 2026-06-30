-- get_pois_near_point: surface enrichment (KHDA rating + Chinese description) so
-- Luna's amenity tools / present_place can actually SPEAK them.
-- Return-type change → must DROP before CREATE.

DROP FUNCTION IF EXISTS get_pois_near_point(double precision, double precision, integer, poi_category[]);

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
    distance_meters DOUBLE PRECISION,
    description_zh TEXT,
    khda_rating VARCHAR(20)
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
        ST_Distance(dp.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) as distance_meters,
        e.description_zh,
        e.khda_rating
    FROM dubai_pois dp
    LEFT JOIN dubai_poi_enrichment e ON e.poi_id = dp.id
    WHERE ST_DWithin(
          dp.location,
          ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
          p_radius_meters
      )
      AND (p_categories IS NULL OR dp.category = ANY(p_categories))
    ORDER BY distance_meters;
END;
$$ LANGUAGE plpgsql;
