/**
 * Geocode unique DLD (area_name, project_name) → lat/lng into dld_project_locations.
 *
 * Generate-once + resumable: skips keys already in the cache (ON CONFLICT DO
 * NOTHING), so re-running only fills new/missing ones. A development's location
 * never moves, so this never needs a full rebuild — just incremental top-ups as
 * new projects appear in DLD.
 *
 * Usage:
 *   npx ts-node scripts/geocode-dld-projects.ts                 # all, by tx volume desc
 *   npx ts-node scripts/geocode-dld-projects.ts --master "SOBHA HARTLAND"
 *   npx ts-node scripts/geocode-dld-projects.ts --limit 200 --min-tx 5
 *   npx ts-node scripts/geocode-dld-projects.ts --retry-failed  # re-attempt source='failed'
 *
 * Needs GOOGLE_MAPS_API_KEY (already used by routes/geocode.ts).
 */
import 'dotenv/config'
import pool from '../src/db/pool'

const KEY = process.env.GOOGLE_MAPS_API_KEY
if (!KEY) { console.error('GOOGLE_MAPS_API_KEY not set'); process.exit(1) }

const args = process.argv.slice(2)
const argVal = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }
const master = argVal('--master')
const limit = Number(argVal('--limit') || 0)
const minTx = Number(argVal('--min-tx') || 3)
const retryFailed = args.includes('--retry-failed')
// --buildings: geocode tx that have only a building_name (no project_name).
// Stored under project_name = building_name so the COALESCE join in
// market.ts's area-insights picks them up too. Lifts tx coverage past 91%.
const buildings = args.includes('--buildings')
// --areas: geocode the AREA itself ("{area_name}, Dubai") → an '__AREA__' centroid
// for areas that have no geocoded projects (mostly rent-only older areas). Fills
// the area-fallback so rent coverage reaches ~100%.
const areasMode = args.includes('--areas')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Key { area_name: string; project_name: string; tx: number }

async function pending(): Promise<Key[]> {
  if (areasMode) {
    // Distinct area_names (rent + sales) that still have no '__AREA__' centroid.
    const lim = limit > 0 ? `LIMIT ${limit}` : ''
    const { rows } = await pool.query(
      `SELECT u.a AS area_name, '__AREA__' AS project_name, 1 AS tx
         FROM (SELECT DISTINCT area_name a FROM dld_rent_contracts
                WHERE usage_type='Residential' AND area_name IS NOT NULL AND area_name<>''
                UNION
               SELECT DISTINCT area_name FROM dld_transactions
                WHERE trans_group='Sales' AND area_name IS NOT NULL AND area_name<>'') u
        WHERE u.a NOT IN (SELECT area_name FROM dld_project_locations WHERE project_name='__AREA__')
        ${lim}`
    )
    return rows
  }
  if (buildings) {
    // Key = (area_name, building_name); building_name stored in project_name col.
    const lim = limit > 0 ? `LIMIT ${limit}` : ''
    const { rows } = await pool.query(
      `SELECT dt.area_name, dt.building_name AS project_name, COUNT(*)::int AS tx
         FROM dld_transactions dt
        WHERE (dt.project_name IS NULL OR dt.project_name = '')
          AND dt.building_name IS NOT NULL AND dt.building_name <> ''
          AND dt.area_name IS NOT NULL AND dt.area_name <> ''
          AND NOT EXISTS (SELECT 1 FROM dld_project_locations l
                           WHERE l.area_name = dt.area_name AND l.project_name = dt.building_name)
        GROUP BY dt.area_name, dt.building_name
       HAVING COUNT(*) >= ${minTx}
        ORDER BY tx DESC ${lim}`
    )
    return rows
  }
  const where: string[] = [
    "dt.project_name IS NOT NULL AND dt.project_name <> ''",
    "dt.area_name IS NOT NULL AND dt.area_name <> ''",
  ]
  const params: unknown[] = []
  if (master) { params.push(master); where.push(`upper(dt.master_project) = upper($${params.length})`) }
  // Skip keys already cached — unless --retry-failed, which re-does the failures.
  const notExists = retryFailed
    ? `NOT EXISTS (SELECT 1 FROM dld_project_locations l WHERE l.area_name = dt.area_name AND l.project_name = dt.project_name AND l.source <> 'failed')`
    : `NOT EXISTS (SELECT 1 FROM dld_project_locations l WHERE l.area_name = dt.area_name AND l.project_name = dt.project_name)`
  where.push(notExists)
  const lim = limit > 0 ? `LIMIT ${limit}` : ''
  const { rows } = await pool.query(
    `SELECT dt.area_name, dt.project_name, COUNT(*)::int AS tx
       FROM dld_transactions dt
      WHERE ${where.join(' AND ')}
      GROUP BY dt.area_name, dt.project_name
     HAVING COUNT(*) >= ${minTx}
      ORDER BY tx DESC ${lim}`,
    params
  )
  return rows
}

async function geocode(k: Key): Promise<{ lat: number; lng: number } | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  // Area centroids geocode the area alone; projects/buildings include the name.
  const address = k.project_name === '__AREA__'
    ? `${k.area_name}, Dubai, United Arab Emirates`
    : `${k.project_name}, ${k.area_name}, Dubai, United Arab Emirates`
  url.searchParams.set('address', address)
  url.searchParams.set('key', KEY!)
  url.searchParams.set('bounds', '24.7,54.8|25.6,56.0') // Dubai bias
  url.searchParams.set('region', 'ae')
  const res = await fetch(url.toString())
  const data: any = await res.json()
  if (data.status === 'OK' && data.results?.[0]) {
    const loc = data.results[0].geometry.location
    // Reject results that fall outside the Dubai bounding box (bad matches).
    if (loc.lat >= 24.6 && loc.lat <= 25.7 && loc.lng >= 54.7 && loc.lng <= 56.1) {
      return { lat: loc.lat, lng: loc.lng }
    }
  }
  return null
}

async function upsert(k: Key, loc: { lat: number; lng: number } | null) {
  if (loc) {
    await pool.query(
      `INSERT INTO dld_project_locations (area_name, project_name, lat, lng, geom, source, tx_count)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, 'google', $5)
       ON CONFLICT (area_name, project_name) DO UPDATE SET
         lat = EXCLUDED.lat, lng = EXCLUDED.lng, geom = EXCLUDED.geom,
         source = 'google', tx_count = EXCLUDED.tx_count, geocoded_at = now()`,
      [k.area_name, k.project_name, loc.lat, loc.lng, k.tx]
    )
  } else {
    await pool.query(
      `INSERT INTO dld_project_locations (area_name, project_name, source, tx_count)
       VALUES ($1,$2,'failed',$3)
       ON CONFLICT (area_name, project_name) DO UPDATE SET source='failed', geocoded_at=now()`,
      [k.area_name, k.project_name, k.tx]
    )
  }
}

async function main() {
  const keys = await pending()
  console.log(`To geocode: ${keys.length}${master ? ` (master=${master})` : ''}, min-tx=${minTx}`)
  let ok = 0, fail = 0
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    try {
      const loc = await geocode(k)
      await upsert(k, loc)
      loc ? ok++ : fail++
    } catch (e) {
      fail++
      console.error(`  err ${k.project_name}:`, e instanceof Error ? e.message : e)
    }
    if ((i + 1) % 25 === 0 || i === keys.length - 1) {
      console.log(`  ${i + 1}/${keys.length}  ok=${ok} fail=${fail}`)
    }
    await sleep(80) // ~12/s, well under Google's QPS cap
  }
  console.log(`Done. ok=${ok} fail=${fail}`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
