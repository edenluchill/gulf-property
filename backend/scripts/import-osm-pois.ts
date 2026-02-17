/**
 * Import POIs from OpenStreetMap using Overpass API
 * Replaces all existing dubai_pois data with fresh OSM data
 */

import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })

// Map OSM tags to our categories
const OSM_CATEGORY_MAP: Record<string, { category: string; subcategory?: string }> = {
  // Healthcare
  'amenity=hospital': { category: 'hospital' },
  'amenity=clinic': { category: 'clinic' },
  'amenity=doctors': { category: 'clinic', subcategory: 'doctor' },
  'amenity=dentist': { category: 'clinic', subcategory: 'dentist' },
  'amenity=pharmacy': { category: 'pharmacy' },

  // Education
  'amenity=school': { category: 'school' },
  'amenity=university': { category: 'university' },
  'amenity=college': { category: 'university', subcategory: 'college' },
  'amenity=kindergarten': { category: 'school', subcategory: 'kindergarten' },

  // Transport
  'railway=station': { category: 'metro_station' },
  'station=subway': { category: 'metro_station' },
  'amenity=bus_station': { category: 'bus_station' },
  'highway=bus_stop': { category: 'bus_station', subcategory: 'bus_stop' },

  // Shopping
  'shop=mall': { category: 'mall' },
  'shop=supermarket': { category: 'supermarket' },
  'shop=department_store': { category: 'mall', subcategory: 'department_store' },

  // Dining
  'amenity=restaurant': { category: 'restaurant' },
  'amenity=cafe': { category: 'cafe' },
  'amenity=fast_food': { category: 'restaurant', subcategory: 'fast_food' },

  // Finance
  'amenity=bank': { category: 'bank' },
  'amenity=atm': { category: 'atm' },

  // Leisure
  'tourism=hotel': { category: 'hotel' },
  'leisure=park': { category: 'park' },
  'leisure=fitness_centre': { category: 'gym' },
  'leisure=sports_centre': { category: 'gym', subcategory: 'sports_centre' },
  'natural=beach': { category: 'beach' },
  'amenity=cinema': { category: 'cinema' },

  // Services
  'amenity=fuel': { category: 'gas_station' },
  'amenity=place_of_worship': { category: 'mosque' },  // Will check religion tag
  'amenity=police': { category: 'police' },
  'amenity=fire_station': { category: 'fire_station' },
  'amenity=post_office': { category: 'post_office' },
  'office=diplomatic': { category: 'embassy' },
}

// Overpass API query for Dubai POIs
const OVERPASS_QUERY = `
[out:json][timeout:300];
area["name:en"="Dubai"]["boundary"="administrative"]->.dubai;
(
  // Healthcare
  nwr["amenity"="hospital"](area.dubai);
  nwr["amenity"="clinic"](area.dubai);
  nwr["amenity"="doctors"](area.dubai);
  nwr["amenity"="dentist"](area.dubai);
  nwr["amenity"="pharmacy"](area.dubai);

  // Education
  nwr["amenity"="school"](area.dubai);
  nwr["amenity"="university"](area.dubai);
  nwr["amenity"="college"](area.dubai);

  // Transport
  nwr["railway"="station"](area.dubai);
  nwr["station"="subway"](area.dubai);
  nwr["amenity"="bus_station"](area.dubai);

  // Shopping
  nwr["shop"="mall"](area.dubai);
  nwr["shop"="supermarket"](area.dubai);

  // Dining
  nwr["amenity"="restaurant"](area.dubai);
  nwr["amenity"="cafe"](area.dubai);
  nwr["amenity"="fast_food"](area.dubai);

  // Finance
  nwr["amenity"="bank"](area.dubai);
  nwr["amenity"="atm"](area.dubai);

  // Leisure
  nwr["tourism"="hotel"](area.dubai);
  nwr["leisure"="park"](area.dubai);
  nwr["leisure"="fitness_centre"](area.dubai);
  nwr["amenity"="cinema"](area.dubai);

  // Services
  nwr["amenity"="fuel"](area.dubai);
  nwr["amenity"="place_of_worship"](area.dubai);
  nwr["amenity"="police"](area.dubai);
  nwr["amenity"="fire_station"](area.dubai);
  nwr["amenity"="post_office"](area.dubai);
);
out center tags;
`

interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OsmResponse {
  elements: OsmElement[]
}

function getCategoryFromTags(tags: Record<string, string>): { category: string; subcategory?: string } | null {
  // Check each mapping
  for (const [osmTag, mapping] of Object.entries(OSM_CATEGORY_MAP)) {
    const [key, value] = osmTag.split('=')
    if (tags[key] === value) {
      // Special handling for places of worship
      if (tags.amenity === 'place_of_worship') {
        const religion = tags.religion?.toLowerCase()
        if (religion === 'muslim' || religion === 'islam') {
          return { category: 'mosque' }
        } else if (religion === 'christian') {
          return { category: 'church' }
        }
        return { category: 'mosque' }  // Default for Dubai
      }
      return mapping
    }
  }
  return null
}

async function fetchOsmData(): Promise<OsmElement[]> {
  console.log('📡 Fetching POI data from OpenStreetMap...')

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`
  })

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as OsmResponse
  console.log(`✓ Received ${data.elements.length} elements from OSM`)

  return data.elements
}

async function importPois() {
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

    // Fetch OSM data
    const elements = await fetchOsmData()

    // Clear existing data
    console.log('🗑️  Clearing existing POI data...')
    await client.query('TRUNCATE dubai_pois RESTART IDENTITY')
    console.log('✓ Cleared existing data')

    // Process and insert POIs
    console.log('📥 Importing POIs...')

    let imported = 0
    let skipped = 0
    const categoryStats: Record<string, number> = {}

    for (const element of elements) {
      const tags = element.tags || {}
      const name = tags.name || tags['name:en']

      // Skip if no name
      if (!name) {
        skipped++
        continue
      }

      // Get coordinates (use center for ways/relations)
      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon

      if (!lat || !lon) {
        skipped++
        continue
      }

      // Get category
      const categoryInfo = getCategoryFromTags(tags)
      if (!categoryInfo) {
        skipped++
        continue
      }

      const { category, subcategory } = categoryInfo

      // Insert POI
      await client.query(`
        INSERT INTO dubai_pois (
          name, name_ar, location, category, subcategory,
          address, phone, website, osm_id, osm_type, data_source
        ) VALUES (
          $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326),
          $5, $6, $7, $8, $9, $10, $11, 'openstreetmap'
        )
      `, [
        name,
        tags['name:ar'] || null,
        lon,
        lat,
        category,
        subcategory || null,
        tags['addr:full'] || tags['addr:street'] || null,
        tags.phone || tags['contact:phone'] || null,
        tags.website || tags['contact:website'] || null,
        element.id.toString(),
        element.type
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
    console.log(`   Skipped: ${skipped} (no name or coordinates)`)
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
