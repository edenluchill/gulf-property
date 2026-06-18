-- Area bridge reconciliation (2026-06-18).
-- The dubai_areas polygons + names are hand-drawn/typed, so DLD cadastral areas
-- often don't centroid-match them. This safely reconnects unbridged DLD areas to
-- a hand-drawn area via a CONTAINMENT name match (exact / ordinal variant /
-- coarse aggregate) within 3km. Wrong-number cases (DLD "Wadi Al Safa 3" vs
-- hand-drawn "Safa 2") are correctly rejected. Re-run after drawing new areas.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Normalize: strip non-alphanumerics (RTL marks/punct), lowercase, ordinal words
-- -> digits (First->1 ...), drop spaces.
CREATE OR REPLACE FUNCTION norm_area_name(p text) RETURNS text AS $$
  SELECT regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(
      lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9 ]', '', 'g')),
      ' first',' 1'),' second',' 2'),' third',' 3'),' fourth',' 4'),
      ' fifth',' 5'),' sixth',' 6'),' seventh',' 7'),' eighth',' 8'),' ninth',' 9'),
    '\s+', '', 'g')
$$ LANGUAGE sql IMMUTABLE;

WITH m AS (
  SELECT dla.area_id, b.id AS da_id, b.name AS da_name
  FROM dld_areas dla
  CROSS JOIN LATERAL (
    SELECT da.id, da.name, ST_Distance(dla.centroid::geography, da.boundary::geography) AS dist
    FROM dubai_areas da
    WHERE da.visible
      AND ST_Distance(dla.centroid::geography, da.boundary::geography) < 3000
      AND (norm_area_name(da.name)=norm_area_name(dla.area_name)
           OR (length(norm_area_name(dla.area_name))>=6 AND position(norm_area_name(dla.area_name) in norm_area_name(da.name))>0)
           OR (length(norm_area_name(da.name))>=6 AND position(norm_area_name(da.name) in norm_area_name(dla.area_name))>0))
    ORDER BY ST_Distance(dla.centroid::geography, da.boundary::geography) ASC
    LIMIT 1
  ) b
  WHERE dla.dubai_area_id IS NULL AND dla.centroid IS NOT NULL
)
UPDATE dld_areas dla SET dubai_area_id = m.da_id, dubai_area_name = m.da_name
FROM m WHERE m.area_id = dla.area_id;

-- Propagate to rent (it stores dubai_area_id directly; transactions join live).
UPDATE dld_rent_contracts rc SET dubai_area_id = dla.dubai_area_id
FROM dld_areas dla
WHERE dla.area_id = rc.area_id AND rc.dubai_area_id IS NULL AND dla.dubai_area_id IS NOT NULL;
