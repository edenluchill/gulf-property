-- ===========================================================================
-- Per-area centroid fallback ('__AREA__' rows) — full coverage.
--
-- ~2% of sales tx (only area_name) and ~78% of rent contracts (DLD tags most
-- leases only to the area, and the rent table has no building_name) carry no
-- project/building to geocode. We give each area ONE representative point — the
-- robust (median) centre of that area's geocoded projects — stored under the
-- sentinel project_name '__AREA__'. The spatial joins fall back to it via
-- COALESCE(project_name, building_name, '__AREA__'), so every record with an
-- area_name lands somewhere → ~100% coverage.
--
-- Trade-off: area-only records are placed at the area centre (coarse, not
-- building-precise). Re-runnable: refreshes the centroid from current geocodes.
-- ===========================================================================
INSERT INTO dld_project_locations (area_name, project_name, lat, lng, geom, source, tx_count)
SELECT s.area_name, '__AREA__',
       ST_Y(s.c::geometry), ST_X(s.c::geometry), s.c, 'area_centroid', 0
FROM (
  SELECT area_name,
    ST_SetSRID(ST_MakePoint(
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(geom::geometry)),
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(geom::geometry))),4326)::geography AS c
  FROM dld_project_locations
  WHERE geom IS NOT NULL AND project_name <> '__AREA__'
  GROUP BY area_name
) s
ON CONFLICT (area_name, project_name) DO UPDATE SET
  geom = EXCLUDED.geom, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
  source = 'area_centroid', geocoded_at = now();
