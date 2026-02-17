/**
 * Import DLD Areas with Geocoding
 *
 * Extracts unique areas from dld_transactions, geocodes them using Google Maps,
 * and matches them to dubai_areas polygons.
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY=xxx npx ts-node src/db/import-dld-areas.ts
 *
 * Or add GOOGLE_MAPS_API_KEY to your .env file
 */

import pool from './pool'
import 'dotenv/config'

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY

if (!GOOGLE_MAPS_API_KEY) {
  console.error('❌ GOOGLE_MAPS_API_KEY is required')
  console.error('   Set it in .env or run with: GOOGLE_MAPS_API_KEY=xxx npx ts-node ...')
  process.exit(1)
}

interface AreaInfo {
  area_id: number
  area_name: string
  transaction_count: number
}

interface GeocodingResult {
  lat: number
  lng: number
}

// ============================================================================
// GEOCODING
// ============================================================================

interface GoogleGeocodingResponse {
  status: string
  results: Array<{
    geometry: {
      location: { lat: number; lng: number }
    }
  }>
}

async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  const query = `${address}, Dubai, UAE`
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`

  try {
    const response = await fetch(url)
    const data = await response.json() as GoogleGeocodingResponse

    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location
      return { lat: location.lat, lng: location.lng }
    }

    if (data.status === 'ZERO_RESULTS') {
      console.log(`    ⚠️ No results for "${address}"`)
      return null
    }

    console.log(`    ❌ Geocoding error: ${data.status}`)
    return null
  } catch (err: any) {
    console.log(`    ❌ Geocoding failed: ${err.message}`)
    return null
  }
}

// ============================================================================
// DATABASE
// ============================================================================

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dld_areas (
      area_id INTEGER PRIMARY KEY,
      area_name VARCHAR(100) NOT NULL,
      area_name_ar VARCHAR(100),
      centroid GEOGRAPHY(POINT, 4326),
      dubai_area_id UUID REFERENCES dubai_areas(id),
      dubai_area_name VARCHAR(255),
      transaction_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await pool.query('CREATE INDEX IF NOT EXISTS idx_dld_areas_centroid ON dld_areas USING GIST (centroid)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_dld_areas_dubai_area ON dld_areas (dubai_area_id)')

  console.log('✅ Table dld_areas ready')
}

async function getUniqueAreas(): Promise<AreaInfo[]> {
  const result = await pool.query(`
    SELECT
      area_id,
      MAX(area_name) as area_name,
      COUNT(*)::int as transaction_count
    FROM dld_transactions
    WHERE area_id IS NOT NULL AND area_name IS NOT NULL
    GROUP BY area_id
    ORDER BY transaction_count DESC
  `)

  return result.rows
}

async function getExistingAreaIds(): Promise<Set<number>> {
  const result = await pool.query('SELECT area_id FROM dld_areas')
  return new Set(result.rows.map(r => r.area_id))
}

async function insertArea(
  areaId: number,
  areaName: string,
  areaNameAr: string | null,
  lat: number | null,
  lng: number | null,
  transactionCount: number
): Promise<void> {
  const centroid = lat && lng ? `SRID=4326;POINT(${lng} ${lat})` : null

  await pool.query(`
    INSERT INTO dld_areas (area_id, area_name, area_name_ar, centroid, transaction_count)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (area_id) DO UPDATE SET
      area_name = EXCLUDED.area_name,
      centroid = COALESCE(EXCLUDED.centroid, dld_areas.centroid),
      transaction_count = EXCLUDED.transaction_count
  `, [areaId, areaName, areaNameAr, centroid, transactionCount])
}

async function matchToDubaiAreas(): Promise<void> {
  console.log('\n📍 Matching to dubai_areas polygons...')

  // Match each dld_area centroid to the containing dubai_area
  const result = await pool.query(`
    UPDATE dld_areas dla
    SET
      dubai_area_id = da.id,
      dubai_area_name = da.name
    FROM dubai_areas da
    WHERE dla.centroid IS NOT NULL
      AND ST_Contains(da.boundary::geometry, dla.centroid::geometry)
  `)

  console.log(`   Matched ${result.rowCount} areas to dubai_areas`)

  // Show unmatched areas
  const unmatched = await pool.query(`
    SELECT area_id, area_name, transaction_count
    FROM dld_areas
    WHERE dubai_area_id IS NULL AND centroid IS NOT NULL
    ORDER BY transaction_count DESC
    LIMIT 20
  `)

  if (unmatched.rows.length > 0) {
    console.log(`\n   ⚠️ Top unmatched areas (not inside any dubai_area polygon):`)
    for (const r of unmatched.rows) {
      console.log(`      ${r.area_name} (${r.transaction_count.toLocaleString()} txns)`)
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(50))
  console.log('DLD Areas Import with Google Geocoding')
  console.log('='.repeat(50))

  const start = Date.now()

  // Setup
  await ensureTable()

  // Get areas from transactions
  const areas = await getUniqueAreas()
  console.log(`\n📊 Found ${areas.length} unique areas in transactions`)

  // Check which already exist
  const existing = await getExistingAreaIds()
  const toProcess = areas.filter(a => !existing.has(a.area_id))

  if (toProcess.length === 0) {
    console.log('   All areas already imported')
  } else {
    console.log(`   ${toProcess.length} new areas to geocode`)
    console.log(`   Estimated cost: ~$${(toProcess.length * 0.005).toFixed(2)} USD`)

    // Geocode and insert
    let success = 0
    let failed = 0

    for (let i = 0; i < toProcess.length; i++) {
      const area = toProcess[i]
      process.stdout.write(`\r   [${i + 1}/${toProcess.length}] Geocoding "${area.area_name}"...`)

      const coords = await geocodeAddress(area.area_name)

      if (coords) {
        await insertArea(
          area.area_id,
          area.area_name,
          null,
          coords.lat,
          coords.lng,
          area.transaction_count
        )
        success++
      } else {
        // Still insert without coordinates
        await insertArea(
          area.area_id,
          area.area_name,
          null,
          null,
          null,
          area.transaction_count
        )
        failed++
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100))
    }

    console.log(`\n   ✅ Geocoded: ${success}, ⚠️ Failed: ${failed}`)
  }

  // Match to dubai_areas
  await matchToDubaiAreas()

  // Summary
  const summary = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(centroid) as geocoded,
      COUNT(dubai_area_id) as matched
    FROM dld_areas
  `)
  const s = summary.rows[0]

  console.log('\n' + '='.repeat(50))
  console.log('📊 Summary:')
  console.log(`   Total DLD areas: ${s.total}`)
  console.log(`   Geocoded: ${s.geocoded}`)
  console.log(`   Matched to dubai_areas: ${s.matched}`)
  console.log(`⏱️ Time: ${((Date.now() - start) / 1000).toFixed(1)}s`)

  await pool.end()
}

main().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
