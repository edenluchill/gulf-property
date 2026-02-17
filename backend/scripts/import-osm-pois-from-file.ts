/**
 * Import POIs from local GeoJSON file (exported from Overpass Turbo)
 *
 * How to get the data:
 * 1. Go to https://overpass-turbo.eu/
 * 2. Paste the query below and run it
 * 3. Export as GeoJSON, save as backend/data/dubai-pois.geojson
 * 4. Run this script: npx ts-node scripts/import-osm-pois-from-file.ts
 *
 * Overpass Query:
 * ---------------
[out:json][timeout:300];
area["name:en"="Dubai"]["boundary"="administrative"]->.dubai;
(
  nwr["amenity"~"hospital|clinic|doctors|dentist|pharmacy|school|university|college|bus_station|restaurant|cafe|fast_food|bank|atm|fuel|place_of_worship|police|fire_station|post_office|cinema"](area.dubai);
  nwr["railway"="station"](area.dubai);
  nwr["shop"~"mall|supermarket"](area.dubai);
  nwr["tourism"="hotel"](area.dubai);
  nwr["leisure"~"park|fitness_centre"](area.dubai);
);
out center tags;
 * ---------------
 */

import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'
import { readFileSync, existsSync } from 'fs'

config({ path: resolve(__dirname, '../.env') })

// Map OSM tags to our categories
const OSM_CATEGORY_MAP: Record<string, { category: string; subcategory?: string }> = {
  // Healthcare
  'hospital': { category: 'hospital' },
  'clinic': { category: 'clinic' },
  'doctors': { category: 'clinic', subcategory: 'doctor' },
  'dentist': { category: 'clinic', subcategory: 'dentist' },
  'pharmacy': { category: 'pharmacy' },

  // Education
  'school': { category: 'school' },
  'university': { category: 'university' },
  'college': { category: 'university', subcategory: 'college' },
  'kindergarten': { category: 'school', subcategory: 'kindergarten' },

  // Transport
  'station': { category: 'metro_station' },
  'bus_station': { category: 'bus_station' },

  // Shopping
  'mall': { category: 'mall' },
  'supermarket': { category: 'supermarket' },

  // Dining
  'restaurant': { category: 'restaurant' },
  'cafe': { category: 'cafe' },
  'fast_food': { category: 'restaurant', subcategory: 'fast_food' },

  // Finance
  'bank': { category: 'bank' },
  'atm': { category: 'atm' },

  // Leisure
  'hotel': { category: 'hotel' },
  'park': { category: 'park' },
  'fitness_centre': { category: 'gym' },
  'cinema': { category: 'cinema' },

  // Services
  'fuel': { category: 'gas_station' },
  'place_of_worship': { category: 'mosque' },
  'police': { category: 'police' },
  'fire_station': { category: 'fire_station' },
  'post_office': { category: 'post_office' },
}

interface GeoJsonFeature {
  type: 'Feature'
  id: string
  geometry: {
    type: 'Point'
    coordinates: [number, number]  // [lon, lat]
  }
  properties: Record<string, string>
}

interface GeoJsonData {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

function getCategoryFromProperties(props: Record<string, string>): { category: string; subcategory?: string } | null {
  // Check amenity first
  if (props.amenity && OSM_CATEGORY_MAP[props.amenity]) {
    const mapping = OSM_CATEGORY_MAP[props.amenity]

    // Special handling for places of worship
    if (props.amenity === 'place_of_worship') {
      const religion = props.religion?.toLowerCase()
      if (religion === 'christian') {
        return { category: 'church' }
      }
      return { category: 'mosque' }  // Default for Dubai
    }

    return mapping
  }

  // Check railway
  if (props.railway === 'station') {
    return { category: 'metro_station' }
  }

  // Check shop
  if (props.shop && OSM_CATEGORY_MAP[props.shop]) {
    return OSM_CATEGORY_MAP[props.shop]
  }

  // Check tourism
  if (props.tourism === 'hotel') {
    return { category: 'hotel' }
  }

  // Check leisure
  if (props.leisure && OSM_CATEGORY_MAP[props.leisure]) {
    return OSM_CATEGORY_MAP[props.leisure]
  }

  return null
}

async function importPois() {
  const dataPath = resolve(__dirname, '../data/dubai-pois.geojson')

  if (!existsSync(dataPath)) {
    console.error('❌ File not found:', dataPath)
    console.log('\nPlease download the data first:')
    console.log('1. Go to https://overpass-turbo.eu/')
    console.log('2. Run the query (see comments in this file)')
    console.log('3. Export > Download as GeoJSON')
    console.log('4. Save to: backend/data/dubai-pois.geojson')
    process.exit(1)
  }

  console.log('📂 Reading GeoJSON file...')
  const rawData = readFileSync(dataPath, 'utf-8')
  const data = JSON.parse(rawData) as GeoJsonData

  console.log(`✓ Loaded ${data.features.length} features`)

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })

  try {
    await client.connect()
    console.log('✓ Connected to database')

    // Clear existing data
    console.log('🗑️  Clearing existing POI data...')
    await client.query('TRUNCATE dubai_pois RESTART IDENTITY')
    console.log('✓ Cleared existing data')

    // Process and insert POIs
    console.log('📥 Importing POIs...')

    let imported = 0
    let skipped = 0
    const categoryStats: Record<string, number> = {}

    for (const feature of data.features) {
      const props = feature.properties || {}
      const name = props.name || props['name:en']

      // Skip if no name
      if (!name) {
        skipped++
        continue
      }

      // Get coordinates
      const coords = feature.geometry?.coordinates
      if (!coords || feature.geometry?.type !== 'Point') {
        skipped++
        continue
      }

      const [lon, lat] = coords

      // Get category
      const categoryInfo = getCategoryFromProperties(props)
      if (!categoryInfo) {
        skipped++
        continue
      }

      const { category, subcategory } = categoryInfo

      // Extract OSM ID from feature id (format: "node/123456" or "way/123456")
      const [osmType, osmId] = (feature.id || '').split('/')

      // Insert POI (skip duplicates - same POI can appear as node and way)
      await client.query(`
        INSERT INTO dubai_pois (
          name, name_ar, location, category, subcategory,
          address, phone, website, osm_id, osm_type, data_source
        ) VALUES (
          $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326),
          $5, $6, $7, $8, $9, $10, $11, 'openstreetmap'
        )
        ON CONFLICT (osm_id) DO NOTHING
      `, [
        name,
        props['name:ar'] || null,
        lon,
        lat,
        category,
        subcategory || null,
        props['addr:full'] || props['addr:street'] || null,
        props.phone || props['contact:phone'] || null,
        props.website || props['contact:website'] || null,
        osmId || null,
        osmType || null
      ])

      imported++
      categoryStats[category] = (categoryStats[category] || 0) + 1

      // Progress indicator
      if (imported % 500 === 0) {
        console.log(`  ... imported ${imported} POIs`)
      }
    }

    console.log('\n✅ Import complete!')
    console.log(`   Imported: ${imported}`)
    console.log(`   Skipped: ${skipped} (no name or invalid data)`)
    console.log('\n📊 By category:')

    Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`   ${cat}: ${count}`)
      })

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

importPois()
