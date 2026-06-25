-- ===========================================================================
-- Snap geocode outliers to their area's robust centre.
--
-- ~18% of Google geocodes land in the wrong district (a same-named building
-- elsewhere — e.g. a "Palm Deira" project resolving 30km away). We can't make
-- free-text geocoding 100% building-precise, but every transaction carries an
-- official DLD area_id, so projects sharing an area must cluster. Any project
-- whose point is >2km from the MEDIAN (outlier-robust) centre of its area's
-- other points is snapped onto that centre: right area, approximate spot —
-- which is all area-level metrics need. Marked source='area_snap' for honesty.
--
-- Re-runnable: only updates points that are still >2km off.
-- ===========================================================================
WITH pa AS (
  SELECT DISTINCT ON (area_name, project_name) area_name, project_name, area_id
  FROM (SELECT area_name, project_name, area_id, COUNT(*) c FROM dld_transactions
         WHERE area_id IS NOT NULL AND project_name IS NOT NULL AND project_name <> ''
         GROUP BY 1,2,3) s
  ORDER BY area_name, project_name, c DESC
),
loc AS (
  SELECT l.area_name, l.project_name, l.geom, pa.area_id
  FROM dld_project_locations l JOIN pa USING (area_name, project_name)
  WHERE l.geom IS NOT NULL
),
centre AS (
  SELECT area_id,
    ST_SetSRID(ST_MakePoint(
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(geom::geometry)),
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(geom::geometry))),4326)::geography AS c,
    COUNT(*) n
  FROM loc GROUP BY area_id
)
UPDATE dld_project_locations t
   SET geom   = centre.c,
       lat    = ST_Y(centre.c::geometry),
       lng    = ST_X(centre.c::geometry),
       source = 'area_snap'
  FROM loc, centre
 WHERE t.area_name = loc.area_name AND t.project_name = loc.project_name
   AND centre.area_id = loc.area_id
   AND centre.n >= 4                              -- need a reliable cluster
   AND ST_Distance(loc.geom, centre.c) > 2000;    -- only the outliers
