-- 补建生产库缺失的 get_pois_near_point 函数（dubai_pois 表/枚举/PostGIS 均已存在）
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
