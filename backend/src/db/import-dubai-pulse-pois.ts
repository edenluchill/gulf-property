/**
 * Import Dubai POI data from Dubai Pulse
 *
 * Data sources:
 * - DHA: Healthcare (hospitals, clinics, pharmacies)
 * - RTA: Metro stations, bus stops
 * - KHDA: Private schools
 * - DM: Parks & beaches
 *
 * Usage:
 *   npx ts-node src/db/import-dubai-pulse-pois.ts
 *
 * Run monthly to get fresh data.
 */

import pool from './pool'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { parse } from 'csv-parse/sync'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'stream'

const DATA_DIR = path.join(__dirname, '../../data/dubai-pulse')
const CACHE_HOURS = 24

// Dubai Pulse dataset URLs
const DATASETS = {
  healthcare: {
    name: 'DHA Healthcare',
    url: 'https://www.dubaipulse.gov.ae/dataset/089e6ec9-1894-4824-8a2a-5d46df569b57/resource/6bc7f19f-8803-4b46-93a4-4bce8fe508a0/download/sheryan_facility_detail.csv',
    file: 'healthcare.csv',
  },
  metro: {
    name: 'RTA Metro Stations',
    url: 'https://www.dubaipulse.gov.ae/dataset/add769c3-0c42-471a-ab1c-c3f04cdb3dbd/resource/ca7c0e12-ba1a-4ff4-8e55-dfd482139500/download/metro_stations.csv',
    file: 'metro_stations.csv',
  },
  bus: {
    name: 'RTA Bus Stops',
    url: 'https://www.dubaipulse.gov.ae/dataset/c99b0b9a-4af8-4496-8fc5-f214b3c2fc51/resource/1ede4ce9-6ef4-4464-bffb-80c46e3c0af8/download/bus_stops.csv',
    file: 'bus_stops.csv',
  },
  schools: {
    name: 'KHDA Schools',
    url: 'https://www.dubaipulse.gov.ae/dataset/2ae67e78-833f-4638-9b6f-9f5a3f40ba44/resource/062647ff-ac22-4fe4-a1ab-cbbef6037c90/download/school_search.csv',
    file: 'schools.csv',
  },
  parks: {
    name: 'DM Parks & Beaches',
    url: 'https://www.dubaipulse.gov.ae/dataset/f0ac9d47-4c0f-4308-930f-31b4fea5226f/resource/25960c81-0e4d-4c74-ba75-3f66704508b6/download/dubai_parks_and_beaches_x_and_y_coordinates.csv',
    file: 'parks_beaches.csv',
  },
}

type CsvRow = Record<string, string | undefined>

// ============================================================================
// UTILITIES
// ============================================================================

async function downloadFile(url: string, dest: string): Promise<boolean> {
  // Check cache
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const ageHours = (Date.now() - fs.statSync(dest).mtimeMs) / 3600000
    if (ageHours < CACHE_HOURS) {
      const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1)
      console.log(`  Using cached file (${sizeMB}MB, ${ageHours.toFixed(0)}h old)`)
      return true
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log(`  Downloading...`)

  return new Promise((resolve) => {
    const download = (targetUrl: string, redirects = 0): void => {
      if (redirects > 5) { resolve(false); return }

      const file = fs.createWriteStream(dest)
      https.get(targetUrl, { timeout: 60000 }, (res) => {
        // Handle redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close()
          try { fs.unlinkSync(dest) } catch {}
          download(res.headers.location, redirects + 1)
          return
        }

        if (res.statusCode !== 200) {
          console.log(`  ❌ HTTP ${res.statusCode}`)
          file.close()
          resolve(false)
          return
        }

        res.pipe(file)
        file.on('finish', () => {
          file.close()
          const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1)
          console.log(`  ✓ Downloaded ${sizeMB}MB`)
          resolve(true)
        })
      }).on('error', (err) => {
        console.log(`  ❌ ${err.message}`)
        file.close()
        resolve(false)
      }).on('timeout', () => {
        console.log(`  ❌ Timeout`)
        resolve(false)
      })
    }

    download(url)
  })
}

function escapeCSV(val: string | undefined | null): string {
  if (!val) return ''
  const s = String(val).replace(/"/g, '""')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
}

async function bulkInsert(rows: string[][], sourceType: string): Promise<number> {
  if (rows.length === 0) return 0

  // Deduplicate by source_id (column index 7)
  const unique = new Map<string, string[]>()
  for (const row of rows) {
    const sourceId = row[7]
    if (sourceId && !unique.has(sourceId)) {
      unique.set(sourceId, row)
    }
  }
  const deduped = Array.from(unique.values())

  if (rows.length !== deduped.length) {
    console.log(`  Deduped: ${rows.length} → ${deduped.length}`)
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Delete existing records from this source, then insert fresh
    await client.query(`DELETE FROM dubai_pois WHERE osm_type = $1`, [sourceType])

    const copyQuery = `COPY dubai_pois (name, location, category, subcategory, address, phone, website, osm_id, osm_type) FROM STDIN WITH (FORMAT csv)`
    const stream = client.query(copyFrom(copyQuery))

    const csvData = deduped.map(row => row.map(v => escapeCSV(v)).join(',')).join('\n')

    return new Promise((resolve, reject) => {
      Readable.from([csvData]).pipe(stream)
      stream.on('finish', async () => {
        await client.query('COMMIT')
        resolve(deduped.length)
      })
      stream.on('error', async (err) => {
        await client.query('ROLLBACK')
        reject(err)
      })
    })
  } finally {
    client.release()
  }
}

// ============================================================================
// IMPORT FUNCTIONS
// ============================================================================

async function importHealthcare(): Promise<number> {
  console.log(`\n📥 ${DATASETS.healthcare.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.healthcare.file)
  if (!await downloadFile(DATASETS.healthcare.url, filePath)) return 0

  const records = parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true }) as CsvRow[]
  console.log(`  Parsing ${records.length} records...`)

  const rows: string[][] = []
  for (const r of records) {
    const lat = parseFloat(r.x_coordinate || '')
    const lon = parseFloat(r.y_coordinate || '')
    const name = r.f_name_english || ''
    if (!name || isNaN(lon) || isNaN(lat)) continue

    // Categorize: hospital > pharmacy > clinic
    const catName = (r.facility_category_name_english || '').toLowerCase()
    const category = catName.includes('hospital') ? 'hospital'
                   : catName.includes('pharmacy') ? 'pharmacy'
                   : 'clinic'

    rows.push([
      name,
      `SRID=4326;POINT(${lon} ${lat})`,
      category,
      r.facilitysubcategorynameenglish || '',
      r.area_english || '',
      r.telephone_1 || '',
      r.website || '',
      `dha_${r.unique_id}`,
      'dha'
    ])
  }

  const count = await bulkInsert(rows, 'dha')
  console.log(`  ✅ ${count} POIs`)
  return count
}

async function importMetro(): Promise<number> {
  console.log(`\n📥 ${DATASETS.metro.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.metro.file)
  if (!await downloadFile(DATASETS.metro.url, filePath)) return 0

  const records = parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true }) as CsvRow[]
  console.log(`  Parsing ${records.length} records...`)

  const rows: string[][] = []
  for (const r of records) {
    const lon = parseFloat(r.station_location_longitude || '')
    const lat = parseFloat(r.station_location_latitude || '')
    const name = r.location_name_english || ''
    if (!name || isNaN(lon) || isNaN(lat)) continue

    rows.push([
      name,
      `SRID=4326;POINT(${lon} ${lat})`,
      'metro_station',
      r.line_name || '',  // Red Line, Green Line
      '', '', '',
      `rta_metro_${r.location_id}`,
      'rta_metro'
    ])
  }

  const count = await bulkInsert(rows, 'rta_metro')
  console.log(`  ✅ ${count} POIs`)
  return count
}

async function importBus(): Promise<number> {
  console.log(`\n📥 ${DATASETS.bus.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.bus.file)
  if (!await downloadFile(DATASETS.bus.url, filePath)) return 0

  const records = parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true }) as CsvRow[]
  console.log(`  Parsing ${records.length} records...`)

  const rows: string[][] = []
  for (const r of records) {
    const lon = parseFloat(r.stop_location_longitude || '')
    const lat = parseFloat(r.stop_location_latitude || '')
    const name = r.stop_name || ''
    if (!name || isNaN(lon) || isNaN(lat)) continue

    rows.push([
      name,
      `SRID=4326;POINT(${lon} ${lat})`,
      'bus_station',
      r.bus_stop_type || '',
      r.street_name || '',
      '', '',
      `rta_bus_${r.stop_id}`,
      'rta_bus'
    ])
  }

  const count = await bulkInsert(rows, 'rta_bus')
  console.log(`  ✅ ${count} POIs`)
  return count
}

async function importSchools(): Promise<number> {
  console.log(`\n📥 ${DATASETS.schools.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.schools.file)
  if (!await downloadFile(DATASETS.schools.url, filePath)) return 0

  const stat = fs.statSync(filePath)
  if (stat.size === 0) {
    console.log('  ⚠️ Empty file')
    return 0
  }

  const records = parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true }) as CsvRow[]
  console.log(`  Parsing ${records.length} records...`)

  const rows: string[][] = []
  for (const r of records) {
    const lat = parseFloat(r.lat || '')
    const lon = parseFloat(r.long || '')
    const name = r.name_eng || ''
    if (!name || isNaN(lon) || isNaN(lat)) continue

    rows.push([
      name,
      `SRID=4326;POINT(${lon} ${lat})`,
      'school',
      r.curriculum_en || '',  // British, American, IB, etc.
      r.address || '',
      r.telephone || '',
      r.web_address || '',
      `khda_${r.education_center_id}`,
      'khda'
    ])
  }

  const count = await bulkInsert(rows, 'khda')
  console.log(`  ✅ ${count} POIs`)
  return count
}

async function importParks(): Promise<number> {
  console.log(`\n📥 ${DATASETS.parks.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.parks.file)
  if (!await downloadFile(DATASETS.parks.url, filePath)) return 0

  const records = parse(fs.readFileSync(filePath, 'utf-8'), { columns: true, skip_empty_lines: true }) as CsvRow[]
  console.log(`  Parsing ${records.length} records...`)

  const rows: string[][] = []
  for (const r of records) {
    // Note: coordinate_x is latitude, coordinate_y is longitude (swapped in source!)
    const lat = parseFloat(r.coordinate_x || '')
    const lon = parseFloat(r.coordinate_y || '')
    const name = r.park_name || ''
    if (!name || isNaN(lon) || isNaN(lat)) continue

    const category = name.toLowerCase().includes('beach') ? 'beach' : 'park'

    rows.push([
      name,
      `SRID=4326;POINT(${lon} ${lat})`,
      category,
      '',
      r.location || '',
      '', '',
      `dm_park_${rows.length}`,
      'dm_park'
    ])
  }

  const count = await bulkInsert(rows, 'dm_park')
  console.log(`  ✅ ${count} POIs`)
  return count
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('='.repeat(50))
  console.log('Dubai Pulse POI Import')
  console.log('='.repeat(50))

  const start = Date.now()

  // Import all datasets
  await importHealthcare()
  await importMetro()
  await importBus()
  await importSchools()
  await importParks()

  // Summary
  const result = await pool.query(`
    SELECT category, COUNT(*)::int as count
    FROM dubai_pois GROUP BY category ORDER BY count DESC
  `)

  console.log('\n' + '='.repeat(50))
  const icons: Record<string, string> = {
    hospital: '🏥', clinic: '🩺', pharmacy: '💊', school: '🏫',
    metro_station: '🚇', bus_station: '🚌', park: '🌳', beach: '🏖️',
  }
  for (const r of result.rows) {
    console.log(`${icons[r.category] || '📍'} ${r.category}: ${r.count.toLocaleString()}`)
  }

  const total = await pool.query('SELECT COUNT(*)::int as c FROM dubai_pois')
  console.log(`\n📊 Total: ${total.rows[0].c.toLocaleString()} POIs`)
  console.log(`⏱️ Time: ${((Date.now() - start) / 1000).toFixed(1)}s`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
