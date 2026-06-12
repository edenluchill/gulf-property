/**
 * Canonical area resolution — map the extracted (marketing) area name to the
 * dubai_areas entry used by the map/filter system.
 *
 * Strategy (deterministic, no AI guessing):
 * 1. Spatial: the project's geocoded coordinates fall inside a dubai_areas
 *    boundary polygon → that's the canonical area. Fallback: nearest area
 *    within 2.5 km (covers points just outside coarse polygons).
 * 2. Name: normalized bidirectional containment against dubai_areas.name
 *    ("City Walk" ↔ "CityWalk").
 *
 * Returns the canonical name or null if nothing matches.
 */

import pool from '../../db/pool';

export async function resolveCanonicalArea(
  latitude?: number,
  longitude?: number,
  extractedArea?: string
): Promise<string | null> {
  // ---- 1. Spatial lookup by coordinates ----
  if (latitude != null && longitude != null) {
    try {
      const contains = await pool.query(
        `SELECT name FROM dubai_areas
          WHERE visible
            AND ST_Contains(boundary::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326))
          ORDER BY display_order NULLS LAST
          LIMIT 1`,
        [longitude, latitude]
      );
      if (contains.rowCount) return contains.rows[0].name.trim();

      const nearest = await pool.query(
        `SELECT name FROM dubai_areas
          WHERE visible
            AND ST_DWithin(boundary::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 2500)
          ORDER BY ST_Distance(boundary::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
          LIMIT 1`,
        [longitude, latitude]
      );
      if (nearest.rowCount) return nearest.rows[0].name.trim();
    } catch (error) {
      console.warn(`   ⚠️  [AREA] Spatial lookup failed: ${(error as Error).message}`);
    }
  }

  // ---- 2. Normalized name match ----
  if (extractedArea && extractedArea.trim().length >= 3) {
    try {
      const byName = await pool.query(
        `SELECT name FROM dubai_areas
          WHERE visible AND (
            regexp_replace(UPPER(name),'[^A-Z0-9]','','g') LIKE '%'||regexp_replace(UPPER($1),'[^A-Z0-9]','','g')||'%'
            OR regexp_replace(UPPER($1),'[^A-Z0-9]','','g') LIKE '%'||regexp_replace(UPPER(name),'[^A-Z0-9]','','g')||'%')
          ORDER BY length(name) LIMIT 1`,
        [extractedArea.trim()]
      );
      if (byName.rowCount) return byName.rows[0].name.trim();
    } catch (error) {
      console.warn(`   ⚠️  [AREA] Name lookup failed: ${(error as Error).message}`);
    }
  }

  return null;
}
