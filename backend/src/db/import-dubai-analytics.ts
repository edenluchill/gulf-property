/**
 * Import Dubai Analytics Data from Dubai Pulse
 * - DLD Transactions (1GB) - Historical property sales
 * - Population by Community - Demographics
 *
 * Uses streaming for large files
 */

import pool from './pool'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { parse } from 'csv-parse'
import { from as copyFrom } from 'pg-copy-streams'
import { Transform } from 'stream'

const DATA_DIR = path.join(__dirname, '../../data/dubai-pulse')

const DATASETS = {
  transactions: {
    name: 'DLD Property Transactions',
    url: 'https://www.dubaipulse.gov.ae/dataset/3b25a6f5-9077-49d7-8a1e-bc6d5dea88fd/resource/a37511b0-ea36-485d-bccd-2d6cb24507e7/download/transactions.csv',
    file: 'transactions.csv',
  },
  population: {
    name: 'Population by Community',
    url: 'https://www.dubaipulse.gov.ae/dataset/d561ddcb-c04c-4827-aa03-b9d8abcb5fff/resource/bedb04be-66cf-4b66-a628-07e5c674a3af/download/population_by_community.csv',
    file: 'population.csv',
  },
}

async function ensureTables(): Promise<void> {
  const client = await pool.connect()
  try {
    // Create transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dld_transactions (
        id SERIAL PRIMARY KEY,
        transaction_id VARCHAR(50) UNIQUE NOT NULL,
        trans_group VARCHAR(50),
        procedure_name VARCHAR(100),
        instance_date DATE NOT NULL,
        property_type VARCHAR(50),
        property_sub_type VARCHAR(100),
        property_usage VARCHAR(50),
        area_id INTEGER,
        area_name VARCHAR(100),
        building_name VARCHAR(255),
        project_name VARCHAR(255),
        master_project VARCHAR(255),
        nearest_landmark VARCHAR(255),
        nearest_metro VARCHAR(255),
        nearest_mall VARCHAR(255),
        rooms VARCHAR(20),
        has_parking BOOLEAN,
        procedure_area DECIMAL(15,2),
        actual_worth DECIMAL(15,2),
        meter_sale_price DECIMAL(10,2),
        rent_value DECIMAL(15,2),
        meter_rent_price DECIMAL(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await client.query('CREATE INDEX IF NOT EXISTS idx_trans_date ON dld_transactions(instance_date)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trans_area ON dld_transactions(area_id)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trans_type ON dld_transactions(property_type)')
    await client.query('CREATE INDEX IF NOT EXISTS idx_trans_group ON dld_transactions(trans_group)')

    // Create communities table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dubai_communities (
        id SERIAL PRIMARY KEY,
        community_number INTEGER,
        community_name VARCHAR(255) NOT NULL,
        community_name_ar VARCHAR(255),
        year INTEGER NOT NULL,
        population INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(community_number, year)
      )
    `)

    console.log('✅ Tables ready')
  } finally {
    client.release()
  }
}

async function downloadLargeFile(url: string, dest: string): Promise<boolean> {
  // Check cache
  if (fs.existsSync(dest)) {
    const stats = fs.statSync(dest)
    const ageHours = (Date.now() - stats.mtimeMs) / 3600000
    if (ageHours < 24 && stats.size > 1000) {
      console.log(`  Using cached file (${(stats.size / 1024 / 1024).toFixed(1)}MB)`)
      return true
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  console.log(`  Downloading from Dubai Pulse...`)

  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest)
    let downloadedBytes = 0
    let totalBytes = 0
    let lastLog = 0

    https.get(url, { timeout: 600000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        if (res.headers.location) {
          downloadLargeFile(res.headers.location, dest).then(resolve)
        } else {
          resolve(false)
        }
        return
      }

      if (res.statusCode !== 200) {
        console.log(`  ❌ HTTP ${res.statusCode}`)
        file.close()
        resolve(false)
        return
      }

      totalBytes = parseInt(res.headers['content-length'] || '0', 10)

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length
        const now = Date.now()
        if (now - lastLog > 3000) {
          const pct = totalBytes ? ((downloadedBytes / totalBytes) * 100).toFixed(1) : '?'
          const mb = (downloadedBytes / 1024 / 1024).toFixed(1)
          process.stdout.write(`\r  Downloading... ${mb}MB (${pct}%)    `)
          lastLog = now
        }
      })

      res.pipe(file)

      file.on('finish', () => {
        file.close()
        const mb = (downloadedBytes / 1024 / 1024).toFixed(1)
        console.log(`\r  ✅ Downloaded ${mb}MB                    `)
        resolve(true)
      })
    }).on('error', (err) => {
      console.log(`  ❌ ${err.message}`)
      file.close()
      resolve(false)
    })
  })
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null
  // Format: "16-10-2006" -> "2006-10-16"
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/)
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`
  }
  // Try ISO format
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}/)) {
    return dateStr.substring(0, 10)
  }
  return null
}

function parseDecimal(val: string): string {
  if (!val || val === 'null' || val === '') return ''
  const num = parseFloat(val)
  return isNaN(num) ? '' : num.toString()
}

function escapeCSV(val: string): string {
  if (!val || val === 'null') return ''
  const s = val.replace(/"/g, '""')
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
}

async function importTransactions(): Promise<number> {
  console.log(`\n📥 ${DATASETS.transactions.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.transactions.file)

  if (!await downloadLargeFile(DATASETS.transactions.url, filePath)) {
    return 0
  }

  console.log('  Processing (streaming)...')

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query('TRUNCATE dld_transactions RESTART IDENTITY')

    const copyQuery = `COPY dld_transactions (
      transaction_id, trans_group, procedure_name, instance_date,
      property_type, property_sub_type, property_usage,
      area_id, area_name, building_name, project_name, master_project,
      nearest_landmark, nearest_metro, nearest_mall,
      rooms, has_parking, procedure_area, actual_worth, meter_sale_price,
      rent_value, meter_rent_price
    ) FROM STDIN WITH (FORMAT csv, NULL '')`

    const copyStream = client.query(copyFrom(copyQuery))

    let count = 0
    let errors = 0

    // Transform CSV records to our format
    const transformer = new Transform({
      objectMode: true,
      transform(record, _encoding, callback) {
        try {
          const date = parseDate(record.instance_date)
          if (!date) {
            errors++
            callback()
            return
          }

          const row = [
            escapeCSV(record.transaction_id),
            escapeCSV(record.trans_group_en),
            escapeCSV(record.procedure_name_en),
            date,
            escapeCSV(record.property_type_en),
            escapeCSV(record.property_sub_type_en),
            escapeCSV(record.property_usage_en),
            parseDecimal(record.area_id),
            escapeCSV(record.area_name_en),
            escapeCSV(record.building_name_en),
            escapeCSV(record.project_name_en),
            escapeCSV(record.master_project_en),
            escapeCSV(record.nearest_landmark_en),
            escapeCSV(record.nearest_metro_en),
            escapeCSV(record.nearest_mall_en),
            escapeCSV(record.rooms_en),
            record.has_parking === '1' ? 'true' : 'false',
            parseDecimal(record.procedure_area),
            parseDecimal(record.actual_worth),
            parseDecimal(record.meter_sale_price),
            parseDecimal(record.rent_value),
            parseDecimal(record.meter_rent_price),
          ].join(',') + '\n'

          count++
          if (count % 100000 === 0) {
            process.stdout.write(`\r  Processed ${(count / 1000).toFixed(0)}k records...    `)
          }

          callback(null, row)
        } catch (e) {
          errors++
          callback()
        }
      }
    })

    // Create parser
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    })

    // Pipe everything together
    const fileStream = fs.createReadStream(filePath)

    await new Promise<void>((resolve, reject) => {
      fileStream
        .pipe(parser)
        .pipe(transformer)
        .pipe(copyStream)
        .on('finish', resolve)
        .on('error', reject)
    })

    await client.query('COMMIT')
    console.log(`\r  ✅ Imported ${count.toLocaleString()} transactions (${errors} skipped)    `)
    return count
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

async function importPopulation(): Promise<number> {
  console.log(`\n📥 ${DATASETS.population.name}`)
  const filePath = path.join(DATA_DIR, DATASETS.population.file)

  // Download
  if (!await downloadLargeFile(DATASETS.population.url, filePath)) {
    return 0
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.trim().split('\n')

  console.log(`  Parsing ${lines.length - 1} records...`)

  const client = await pool.connect()
  try {
    await client.query('TRUNCATE dubai_communities RESTART IDENTITY')

    let count = 0
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, ''))
      // Columns: id, year, communitynumber_communityname_ar, communitynumber_communityname_en, population

      const enName = cols[3] || ''
      const arName = cols[2] || ''
      const year = parseInt(cols[1]) || 0
      const population = parseInt(cols[4]) || 0

      // Parse community number from name like "101-Naif" or "101 - Naif"
      const match = enName.match(/^(\d+)\s*[-–]\s*(.+)$/)
      if (!match) continue

      const communityNumber = parseInt(match[1])
      const communityName = match[2].trim()

      await client.query(
        `INSERT INTO dubai_communities (community_number, community_name, community_name_ar, year, population)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (community_number, year) DO UPDATE SET population = $5`,
        [communityNumber, communityName, arName, year, population]
      )
      count++
    }

    console.log(`  ✅ Imported ${count} community records`)
    return count
  } finally {
    client.release()
  }
}

async function showSummary(): Promise<void> {
  console.log('\n' + '='.repeat(50))
  console.log('📊 Summary')
  console.log('='.repeat(50))

  // Transactions summary
  const txResult = await pool.query(`
    SELECT
      trans_group,
      COUNT(*) as count,
      AVG(actual_worth) as avg_price,
      MIN(instance_date) as earliest,
      MAX(instance_date) as latest
    FROM dld_transactions
    WHERE actual_worth > 0
    GROUP BY trans_group
    ORDER BY count DESC
  `)

  console.log('\n🏠 Transactions by Type:')
  for (const row of txResult.rows) {
    const avgPrice = row.avg_price ? `AED ${(row.avg_price / 1000000).toFixed(2)}M avg` : ''
    console.log(`  ${row.trans_group || 'Unknown'}: ${parseInt(row.count).toLocaleString()} (${avgPrice})`)
  }

  // Top areas
  const areaResult = await pool.query(`
    SELECT area_name, COUNT(*) as count, AVG(meter_sale_price) as avg_sqm
    FROM dld_transactions
    WHERE trans_group = 'Sales' AND meter_sale_price > 0
    GROUP BY area_name
    ORDER BY count DESC
    LIMIT 10
  `)

  console.log('\n📍 Top 10 Areas by Sales Volume:')
  for (const row of areaResult.rows) {
    const sqmPrice = row.avg_sqm ? `AED ${Math.round(row.avg_sqm).toLocaleString()}/sqm` : ''
    console.log(`  ${row.area_name}: ${parseInt(row.count).toLocaleString()} sales (${sqmPrice})`)
  }

  // Population
  const popResult = await pool.query(`
    SELECT COUNT(DISTINCT community_number) as communities, MAX(year) as latest_year
    FROM dubai_communities
  `)
  if (popResult.rows[0]) {
    console.log(`\n👥 Population: ${popResult.rows[0].communities} communities (data up to ${popResult.rows[0].latest_year})`)
  }
}

async function main() {
  console.log('='.repeat(50))
  console.log('Dubai Analytics Data Import')
  console.log('='.repeat(50))

  const start = Date.now()

  await ensureTables()
  await importTransactions()
  await importPopulation()
  await showSummary()

  console.log(`\n⏱️ Total time: ${((Date.now() - start) / 1000 / 60).toFixed(1)} minutes`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
