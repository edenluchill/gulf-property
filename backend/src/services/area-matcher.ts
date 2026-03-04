/**
 * Area Matcher — cascading area name lookup logic.
 * Extracted from voice-assistant-tools.ts where it was duplicated 4×.
 *
 * Priority: exact LIKE → strip-spaces → word-overlap
 */

import { Pool } from 'pg'

/** Sanitize user input for LIKE patterns */
function sanitize(name: string): string {
  return name.replace(/[%_]/g, '')
}

/**
 * Cascading area name lookup: exact LIKE → strip-spaces → word-overlap.
 * Returns the best-matching area row or null.
 */
export async function findAreaByName(
  pool: Pool,
  areaName: string,
  extraColumns = ''
): Promise<any | null> {
  const cols = extraColumns ? `, ${extraColumns}` : ''
  const query = `
    WITH matches AS (
      SELECT id, name, name_ar, description, 1 as priority ${cols}
      FROM dubai_areas
      WHERE LOWER(name) LIKE LOWER($1) AND visible = true

      UNION ALL

      SELECT id, name, name_ar, description, 2 as priority ${cols}
      FROM dubai_areas
      WHERE REPLACE(LOWER(name), ' ', '') LIKE REPLACE(LOWER($1), ' ', '') AND visible = true

      UNION ALL

      SELECT id, name, name_ar, description, 3 as priority ${cols}
      FROM dubai_areas
      WHERE visible = true
        AND EXISTS (
          SELECT 1 FROM unnest(string_to_array(LOWER($2), ' ')) AS word
          WHERE LENGTH(word) > 2 AND LOWER(name) LIKE '%' || word || '%'
        )
    )
    SELECT * FROM matches
    ORDER BY priority, name
    LIMIT 1
  `
  const stripped = sanitize(areaName)
  const result = await pool.query(query, [`%${stripped}%`, stripped])
  return result.rows[0] || null
}

/**
 * Same cascading lookup but returns centroid coordinates for fly_to.
 */
export async function findAreaWithCentroid(
  pool: Pool,
  areaName: string
): Promise<{ id: number; name: string; lat: number; lng: number } | null> {
  const query = `
    WITH matches AS (
      SELECT id, name, ST_X(ST_Centroid(boundary::geometry)) as lng,
             ST_Y(ST_Centroid(boundary::geometry)) as lat, 1 as priority
      FROM dubai_areas
      WHERE LOWER(name) LIKE LOWER($1) AND visible = true

      UNION ALL

      SELECT id, name, ST_X(ST_Centroid(boundary::geometry)) as lng,
             ST_Y(ST_Centroid(boundary::geometry)) as lat, 2 as priority
      FROM dubai_areas
      WHERE REPLACE(LOWER(name), ' ', '') LIKE REPLACE(LOWER($1), ' ', '') AND visible = true

      UNION ALL

      SELECT id, name, ST_X(ST_Centroid(boundary::geometry)) as lng,
             ST_Y(ST_Centroid(boundary::geometry)) as lat, 3 as priority
      FROM dubai_areas
      WHERE visible = true
        AND EXISTS (
          SELECT 1 FROM unnest(string_to_array(LOWER($2), ' ')) AS word
          WHERE LENGTH(word) > 2 AND LOWER(name) LIKE '%' || word || '%'
        )
    )
    SELECT * FROM matches
    ORDER BY priority, name
    LIMIT 1
  `
  const stripped = sanitize(areaName)
  const result = await pool.query(query, [`%${stripped}%`, stripped])
  return result.rows[0] || null
}

/**
 * Cascading area match that returns metrics for compare_areas.
 * Returns deduplicated rows (latest metrics per area).
 */
export async function findAreasWithMetrics(
  pool: Pool,
  area1: string,
  area2: string
): Promise<any[]> {
  const query = `
    WITH area_match AS (
      (SELECT da.id, da.name, 1 as input_group FROM dubai_areas da
       WHERE LOWER(da.name) LIKE LOWER($1) AND da.visible = true
       LIMIT 1)
      UNION ALL
      (SELECT da.id, da.name, 1 FROM dubai_areas da
       WHERE REPLACE(LOWER(da.name), ' ', '') LIKE REPLACE(LOWER($1), ' ', '') AND da.visible = true
       AND NOT EXISTS (SELECT 1 FROM dubai_areas WHERE LOWER(name) LIKE LOWER($1) AND visible = true)
       LIMIT 1)
      UNION ALL
      (SELECT da.id, da.name, 2 as input_group FROM dubai_areas da
       WHERE LOWER(da.name) LIKE LOWER($2) AND da.visible = true
       LIMIT 1)
      UNION ALL
      (SELECT da.id, da.name, 2 FROM dubai_areas da
       WHERE REPLACE(LOWER(da.name), ' ', '') LIKE REPLACE(LOWER($2), ' ', '') AND da.visible = true
       AND NOT EXISTS (SELECT 1 FROM dubai_areas WHERE LOWER(name) LIKE LOWER($2) AND visible = true)
       LIMIT 1)
    ),
    ranked AS (
      SELECT DISTINCT ON (input_group) * FROM area_match ORDER BY input_group, id
    )
    SELECT
      r.name as area_name,
      dam.median_price_sqm,
      dam.rental_yield_pct,
      dam.price_growth_pct,
      dam.sales_transaction_count
    FROM ranked r
    JOIN dubai_area_rolling_metrics dam ON dam.dubai_area_id = r.id
    ORDER BY r.input_group, dam.period_end_month DESC
  `
  const s1 = sanitize(area1)
  const s2 = sanitize(area2)
  const result = await pool.query(query, [`%${s1}%`, `%${s2}%`])

  // Deduplicate: keep first row per area_name (latest metrics)
  const seen = new Set<string>()
  return result.rows.filter(r => {
    if (seen.has(r.area_name)) return false
    seen.add(r.area_name)
    return true
  })
}
