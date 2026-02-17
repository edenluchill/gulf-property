/**
 * Import DLD Rent Contracts from Dubai Pulse
 *
 * Data source: https://www.dubaipulse.gov.ae/data/dld-registration/dld_rent_contracts-open
 * File size: ~4.4GB (large dataset)
 *
 * Usage:
 *   npx ts-node src/db/import-dld-rent-contracts.ts
 *
 * Options:
 *   --fresh    Clear existing data before import
 *   --limit=N  Import only first N records (for testing)
 */

import pool from './pool'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { parse } from 'csv-parse'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'stream'

const DATA_DIR = path.join(__dirname, '../../data/dubai-pulse')
const RENT_FILE = path.join(DATA_DIR, 'rent_contracts.csv')
const RENT_URL = 'https://www.dubaipulse.gov.ae/dataset/00768c45-f014-4cc6-937d-2b17dcab53fb/resource/765b5a69-ca16-4bfd-9852-74612f3c4ea6/download/rent_contracts.csv'

const BATCH_SIZE = 10000
const CACHE_DAYS = 7  // Re-download if older than 7 days

// RentRecord interface for reference (CSV column mapping)
// contract_id, registration_type, start_date, end_date, annual_amount,
// property_type, property_subtype, usage_type, property_area,
// area_name, area_name_ar, project_name, nearest_landmark, nearest_metro, nearest_mall, tenant_type

// ============================================================================
// DOWNLOAD
// ============================================================================

async function downloadRentFile(): Promise<boolean> {
  // Check if file exists and is recent enough
  if (fs.existsSync(RENT_FILE)) {
    const stat = fs.statSync(RENT_FILE)
    const ageDays = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24)

    if (ageDays < CACHE_DAYS && stat.size > 1000000) {
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1)
      console.log(`  Using cached file (${sizeMB}MB, ${ageDays.toFixed(1)} days old)`)
      return true
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log(`  Downloading rent contracts (this may take a while, ~4.4GB)...`)

  return new Promise((resolve) => {
    const download = (url: string, redirects = 0): void => {
      if (redirects > 5) {
        console.log('  ❌ Too many redirects')
        resolve(false)
        return
      }

      const file = fs.createWriteStream(RENT_FILE)
      let downloadedBytes = 0
      let lastLogTime = Date.now()

      https.get(url, { timeout: 300000 }, (res) => {
        // Handle redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          file.close()
          try { fs.unlinkSync(RENT_FILE) } catch { }
          download(res.headers.location, redirects + 1)
          return
        }

        if (res.statusCode !== 200) {
          console.log(`  ❌ HTTP ${res.statusCode}`)
          file.close()
          resolve(false)
          return
        }

        const totalSize = parseInt(res.headers['content-length'] || '0')

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length
          const now = Date.now()
          if (now - lastLogTime > 5000) {  // Log every 5 seconds
            const pct = totalSize > 0 ? ((downloadedBytes / totalSize) * 100).toFixed(1) : '?'
            const mb = (downloadedBytes / 1024 / 1024).toFixed(1)
            process.stdout.write(`\r  Downloading: ${mb}MB (${pct}%)    `)
            lastLogTime = now
          }
        })

        res.pipe(file)
        file.on('finish', () => {
          file.close()
          const sizeMB = (fs.statSync(RENT_FILE).size / 1024 / 1024).toFixed(1)
          console.log(`\n  ✓ Downloaded ${sizeMB}MB`)
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

    download(RENT_URL)
  })
}

// ============================================================================
// IMPORT
// ============================================================================

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  // Expected format: DD-MM-YYYY or DD/MM/YYYY
  const match = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/)
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  }
  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.split('T')[0]
  }
  return null
}

function parseNumber(val: string | undefined): number | null {
  if (!val) return null
  const num = parseFloat(val.replace(/,/g, ''))
  return isNaN(num) ? null : num
}

function escapeCSV(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return ''
  const s = String(val).replace(/"/g, '""')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
}

async function importRentContracts(options: { fresh?: boolean; limit?: number }): Promise<number> {
  const { fresh = false, limit } = options

  if (fresh) {
    console.log('  Clearing existing rent contracts...')
    await pool.query('DELETE FROM dld_rent_contracts')
  }

  // Create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dld_rent_contracts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contract_id VARCHAR(50),
      registration_type VARCHAR(50),
      start_date DATE,
      end_date DATE,
      annual_amount NUMERIC,
      property_type VARCHAR(50),
      property_subtype VARCHAR(100),
      usage_type VARCHAR(50),
      property_area NUMERIC,
      area_name VARCHAR(255),
      area_name_ar VARCHAR(255),
      project_name VARCHAR(255),
      nearest_landmark VARCHAR(255),
      nearest_metro VARCHAR(255),
      nearest_mall VARCHAR(255),
      tenant_type VARCHAR(50),
      area_id INTEGER,
      dubai_area_id UUID REFERENCES dubai_areas(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  console.log('  Importing rent contracts...')

  const parser = fs.createReadStream(RENT_FILE)
    .pipe(parse({
      columns: true,
      skip_empty_lines: true,
      relaxColumnCount: true,
      relaxQuotes: true,
    }))

  let count = 0
  let batch: string[][] = []
  let batchCount = 0

  const client = await pool.connect()

  const processBatch = async () => {
    if (batch.length === 0) return

    const csvData = batch.map(row => row.map(v => escapeCSV(v)).join(',')).join('\n')

    await client.query('BEGIN')
    try {
      const copyQuery = `COPY dld_rent_contracts (
        contract_id, registration_type, start_date, end_date, annual_amount,
        property_type, property_subtype, usage_type, property_area,
        area_name, area_name_ar, project_name,
        nearest_landmark, nearest_metro, nearest_mall, tenant_type
      ) FROM STDIN WITH (FORMAT csv)`

      const stream = client.query(copyFrom(copyQuery))

      await new Promise<void>((resolve, reject) => {
        Readable.from([csvData]).pipe(stream)
        stream.on('finish', () => resolve())
        stream.on('error', reject)
      })

      await client.query('COMMIT')
      batchCount++
      process.stdout.write(`\r  Imported: ${count.toLocaleString()} records (batch ${batchCount})    `)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }

    batch = []
  }

  try {
    for await (const row of parser) {
      // Map CSV columns to our schema (based on Dubai Pulse actual column names)
      const record: (string | null)[] = [
        row.contract_id || null,
        row.contract_reg_type_en || null,
        parseDate(row.contract_start_date),
        parseDate(row.contract_end_date),
        parseNumber(row.annual_amount)?.toString() || null,
        row.ejari_property_type_en || null,
        row.ejari_property_sub_type_en || null,
        row.property_usage_en || null,
        parseNumber(row.actual_area)?.toString() || null,
        row.area_name_en || null,
        row.area_name_ar || null,
        row.project_name_en || null,
        row.nearest_landmark_en || null,
        row.nearest_metro_en || null,
        row.nearest_mall_en || null,
        row.tenant_type_en || null,
      ]

      batch.push(record as string[])
      count++

      if (batch.length >= BATCH_SIZE) {
        await processBatch()
      }

      if (limit && count >= limit) {
        break
      }
    }

    // Process remaining batch
    await processBatch()

  } finally {
    client.release()
  }

  console.log(`\n  ✅ Imported ${count.toLocaleString()} rent contracts`)
  return count
}

// ============================================================================
// MATCH TO DUBAI AREAS
// ============================================================================

async function matchToDubaiAreas(): Promise<void> {
  console.log('\n📍 Matching rent contracts to dubai_areas...')

  // First, match via dld_areas (which are already geocoded and matched)
  const result1 = await pool.query(`
    UPDATE dld_rent_contracts rc
    SET dubai_area_id = dla.dubai_area_id
    FROM dld_areas dla
    WHERE LOWER(rc.area_name) = LOWER(dla.area_name)
      AND dla.dubai_area_id IS NOT NULL
      AND rc.dubai_area_id IS NULL
  `)
  console.log(`   Matched ${result1.rowCount} via dld_areas`)

  // Summary
  const summary = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(dubai_area_id) as matched,
      COUNT(DISTINCT dubai_area_id) as unique_areas
    FROM dld_rent_contracts
  `)
  const s = summary.rows[0]
  console.log(`   Total: ${parseInt(s.total).toLocaleString()}, Matched: ${parseInt(s.matched).toLocaleString()}, Unique areas: ${s.unique_areas}`)
}

// ============================================================================
// CALCULATE METRICS
// ============================================================================

async function calculateMetrics(): Promise<void> {
  console.log('\n📊 Calculating area metrics...')

  // Get years with data
  const yearsResult = await pool.query(`
    SELECT DISTINCT EXTRACT(YEAR FROM instance_date)::int as year
    FROM dld_transactions
    WHERE trans_group = 'Sales' AND meter_sale_price > 0
    ORDER BY year
  `)

  for (const row of yearsResult.rows) {
    process.stdout.write(`  Calculating ${row.year}...`)
    await pool.query('SELECT calculate_area_yearly_metrics($1)', [row.year])
    console.log(` ✓`)
  }

  // Calculate rolling metrics for current period
  console.log('  Calculating rolling 12-month metrics...')
  await pool.query('SELECT calculate_area_rolling_metrics(CURRENT_DATE)')

  console.log('  ✅ Metrics calculated')
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2)
  const fresh = args.includes('--fresh')
  const limitArg = args.find(a => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined

  console.log('='.repeat(60))
  console.log('DLD Rent Contracts Import')
  console.log('='.repeat(60))

  const start = Date.now()

  // Download
  console.log('\n📥 Rent Contracts Data')
  if (!await downloadRentFile()) {
    console.error('❌ Failed to download rent contracts')
    process.exit(1)
  }

  // Import
  await importRentContracts({ fresh, limit })

  // Match to areas
  await matchToDubaiAreas()

  // Calculate metrics
  await calculateMetrics()

  // Summary
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM dld_rent_contracts) as rent_contracts,
      (SELECT COUNT(*) FROM dubai_area_yearly_metrics) as yearly_metrics,
      (SELECT COUNT(*) FROM dubai_area_rolling_metrics) as rolling_metrics
  `)
  const s = stats.rows[0]

  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`   Rent contracts: ${parseInt(s.rent_contracts).toLocaleString()}`)
  console.log(`   Yearly metrics: ${parseInt(s.yearly_metrics).toLocaleString()}`)
  console.log(`   Rolling metrics: ${parseInt(s.rolling_metrics).toLocaleString()}`)
  console.log(`⏱️ Time: ${((Date.now() - start) / 1000 / 60).toFixed(1)} minutes`)

  await pool.end()
}

main().catch(e => {
  console.error('Error:', e)
  process.exit(1)
})
