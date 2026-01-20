/**
 * 从 Nominatim + Overpass 获取迪拜所有区域边界
 * 使用更稳定的查询方式
 */

import axios from 'axios'
import pool from '../src/db/pool'

const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search'
const OVERPASS_API = 'https://overpass-api.de/api/interpreter'

// 颜色方案
const COLORS = [
  '#FFD700', '#4169E1', '#32CD32', '#FF6347', '#00CED1',
  '#90EE90', '#FFA07A', '#F4A460', '#20B2AA', '#DDA0DD',
  '#F08080', '#98FB98', '#87CEEB', '#FFB6C1', '#F0E68C',
  '#E0FFFF', '#FFDAB9', '#EEE8AA', '#F5DEB3', '#FFC0CB',
]

let colorIndex = 0

function getNextColor(): string {
  const color = COLORS[colorIndex % COLORS.length]
  colorIndex++
  return color
}

/**
 * 获取迪拜市的所有 suburbs/neighbourhoods
 */
async function fetchDubaiSuburbs(): Promise<any[]> {
  try {
    console.log('\n🔍 Step 1: Fetching all Dubai neighborhoods from Nominatim...\n')
    
    // 搜索迪拜的所有suburbs
    const response = await axios.get(NOMINATIM_API, {
      params: {
        q: 'Dubai, United Arab Emirates',
        format: 'json',
        addressdetails: 1,
        extratags: 1,
        namedetails: 1,
        limit: 1
      },
      headers: {
        'User-Agent': 'GulfPropertyDubai/1.0'
      },
      timeout: 30000
    })
    
    if (response.data.length === 0) {
      throw new Error('Dubai not found')
    }
    
    const dubaiOsmId = response.data[0].osm_id
    const dubaiOsmType = response.data[0].osm_type
    
    console.log(`✅ Found Dubai: OSM ${dubaiOsmType} ${dubaiOsmId}\n`)
    
    // 获取迪拜内的所有 suburbs/neighbourhoods
    console.log('🔍 Step 2: Querying Overpass for all neighborhoods in Dubai...\n')
    
    const overpassQuery = `
      [out:json][timeout:180];
      area(id:${3600000000 + dubaiOsmId})->.dubai;
      (
        node["place"~"suburb|neighbourhood|quarter"](area.dubai);
        way["place"~"suburb|neighbourhood|quarter"](area.dubai);
        relation["place"~"suburb|neighbourhood|quarter"](area.dubai);
      );
      out center;
    `
    
    await new Promise(resolve => setTimeout(resolve, 2000)) // 礼貌延迟
    
    const overpassResponse = await axios.post(OVERPASS_API, overpassQuery, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 180000, // 3 minutes
    })
    
    const elements = overpassResponse.data.elements || []
    
    console.log(`✅ Found ${elements.length} neighborhoods in Dubai\n`)
    
    return elements
    
  } catch (error: any) {
    console.error('❌ Error fetching suburbs:', error.message)
    return []
  }
}

/**
 * 获取单个区域的详细边界
 */
async function fetchAreaBoundary(osmType: string, osmId: number, name: string): Promise<any> {
  try {
    const query = `
      [out:json][timeout:60];
      (
        ${osmType}(${osmId});
      );
      out geom;
    `
    
    const response = await axios.post(OVERPASS_API, query, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 60000,
    })
    
    if (!response.data.elements || response.data.elements.length === 0) {
      return null
    }
    
    const element = response.data.elements[0]
    const geoJSON = convertToGeoJSON(element)
    
    if (!geoJSON) {
      return null
    }
    
    return {
      name: name,
      nameAr: element.tags?.['name:ar'] || null,
      boundary: geoJSON,
      description: `${name} area in Dubai`,
    }
    
  } catch (error: any) {
    console.error(`   ❌ Error fetching boundary: ${error.message}`)
    return null
  }
}

/**
 * 转换为 GeoJSON
 */
function convertToGeoJSON(element: any): any {
  try {
    if (element.type === 'way' && element.geometry) {
      const coordinates = element.geometry.map((node: any) => [node.lon, node.lat])
      
      if (
        coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
        coordinates[0][1] !== coordinates[coordinates.length - 1][1]
      ) {
        coordinates.push(coordinates[0])
      }
      
      return {
        type: 'Polygon',
        coordinates: [coordinates],
      }
    } else if (element.type === 'relation' && element.members) {
      const outerMembers = element.members.filter((m: any) => m.role === 'outer')
      
      if (outerMembers.length > 0 && outerMembers[0].geometry) {
        const coordinates = outerMembers[0].geometry.map((node: any) => [node.lon, node.lat])
        
        if (
          coordinates[0][0] !== coordinates[coordinates.length - 1][0] ||
          coordinates[0][1] !== coordinates[coordinates.length - 1][1]
        ) {
          coordinates.push(coordinates[0])
        }
        
        return {
          type: 'Polygon',
          coordinates: [coordinates],
        }
      }
    }
    
    return null
  } catch (error) {
    return null
  }
}

/**
 * 保存到数据库
 */
async function saveArea(areaData: any): Promise<boolean> {
  try {
    await pool.query(
      `
      INSERT INTO dubai_areas (
        name, name_ar, boundary,
        description, color, opacity
      ) VALUES (
        $1, $2, ST_GeomFromGeoJSON($3)::geography, $4, $5, $6
      )
      ON CONFLICT (name) DO UPDATE SET
        name_ar = $2,
        boundary = ST_GeomFromGeoJSON($3)::geography,
        description = $4,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        areaData.name,
        areaData.nameAr,
        JSON.stringify(areaData.boundary),
        areaData.description,
        getNextColor(),
        0.35,
      ]
    )
    
    return true
  } catch (error: any) {
    console.error(`   ❌ Error saving: ${error.message}`)
    return false
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 Fetching ALL Dubai Areas from OpenStreetMap\n')
  console.log('⏱️  This will take 5-10 minutes (API rate limits)\n')
  console.log('='.repeat(60))
  
  // 1. 获取所有neighborhoods
  const suburbs = await fetchDubaiSuburbs()
  
  if (suburbs.length === 0) {
    console.log('\n❌ No neighborhoods found. Exiting.')
    await pool.end()
    return
  }
  
  // 2. 过滤出有名称的
  const namedSuburbs = suburbs.filter(s => s.tags?.name).slice(0, 50) // 限制50个避免太久
  
  console.log(`\n📊 Processing ${namedSuburbs.length} named neighborhoods\n`)
  console.log('='.repeat(60) + '\n')
  
  let successCount = 0
  let failCount = 0
  
  // 3. 逐个获取边界
  for (let i = 0; i < namedSuburbs.length; i++) {
    const suburb = namedSuburbs[i]
    const name = suburb.tags.name
    
    console.log(`[${i + 1}/${namedSuburbs.length}] ${name}`)
    
    const areaData = await fetchAreaBoundary(suburb.type, suburb.id, name)
    
    if (areaData) {
      const saved = await saveArea(areaData)
      if (saved) {
        console.log(`   ✅ Saved`)
        successCount++
      } else {
        failCount++
      }
    } else {
      console.log(`   ⚠️  No boundary data`)
      failCount++
    }
    
    // 延迟避免限流
    if (i < namedSuburbs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000)) // 3秒延迟
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`   ✅ Success: ${successCount}`)
  console.log(`   ❌ Failed: ${failCount}`)
  console.log(`   📈 Success Rate: ${((successCount / namedSuburbs.length) * 100).toFixed(1)}%`)
  console.log('='.repeat(60))
  
  await pool.end()
  
  console.log('\n✨ Done!\n')
}

main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
