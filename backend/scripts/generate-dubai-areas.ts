/**
 * 自动从 OpenStreetMap 获取迪拜区域边界并存储到数据库
 * 
 * 使用 Overpass API 获取真实的地理边界数据
 * 
 * 运行: npx ts-node backend/scripts/generate-dubai-areas.ts
 */

import axios from 'axios'
import pool from '../src/db/pool'

// ============================================================================
// 配置
// ============================================================================

const OVERPASS_API = 'https://overpass-api.de/api/interpreter'

// 迪拜主要区域名称（英文）
// 这些是迪拜最重要的住宅和商业区域
const DUBAI_AREAS = [
  // 超豪华区域
  'Downtown Dubai',
  'Dubai Marina',
  'Palm Jumeirah',
  'Emirates Hills',
  'Jumeirah Bay Island',
  
  // 豪华区域
  'Business Bay',
  'Dubai Hills Estate',
  'Jumeirah Beach Residence',
  'Bluewaters Island',
  'City Walk',
  'Dubai Harbour',
  
  // 高端区域
  'Arabian Ranches',
  'The Springs',
  'The Meadows',
  'The Lakes',
  'Jumeirah',
  'Umm Suqeim',
  'Mirdif',
  'Dubai Sports City',
  
  // 中高端区域
  'Jumeirah Village Circle',
  'Jumeirah Village Triangle',
  'Dubai Silicon Oasis',
  'Motor City',
  'Discovery Gardens',
  'The Greens',
  'Al Barsha',
  'Arjan',
  
  // 新兴区域
  'Town Square',
  'Mudon',
  'Reem',
  'Damac Hills',
  'Tilal Al Ghaf',
  'Dubai South',
  
  // 传统/商业区域
  'Deira',
  'Bur Dubai',
  'Al Karama',
  'Al Nahda',
  'Al Qusais',
  'International City',
]

// 区域类型映射
const AREA_TYPE_MAP: Record<string, {
  areaType: string
  wealthLevel: string
  culturalAttribute: string
  color: string
  opacity: number
}> = {
  'Downtown Dubai': { 
    areaType: 'mixed', 
    wealthLevel: 'luxury', 
    culturalAttribute: 'business-hub',
    color: '#FFD700',
    opacity: 0.35
  },
  'Dubai Marina': { 
    areaType: 'residential', 
    wealthLevel: 'luxury', 
    culturalAttribute: 'expatriate',
    color: '#4169E1',
    opacity: 0.35
  },
  'Palm Jumeirah': { 
    areaType: 'residential', 
    wealthLevel: 'luxury', 
    culturalAttribute: 'family-oriented',
    color: '#32CD32',
    opacity: 0.35
  },
  'Emirates Hills': { 
    areaType: 'residential', 
    wealthLevel: 'luxury', 
    culturalAttribute: 'family-oriented',
    color: '#9370DB',
    opacity: 0.35
  },
  'Business Bay': { 
    areaType: 'commercial', 
    wealthLevel: 'premium', 
    culturalAttribute: 'business-hub',
    color: '#FF6347',
    opacity: 0.35
  },
  'Jumeirah Beach Residence': { 
    areaType: 'residential', 
    wealthLevel: 'premium', 
    culturalAttribute: 'entertainment',
    color: '#00CED1',
    opacity: 0.35
  },
  'Dubai Hills Estate': { 
    areaType: 'residential', 
    wealthLevel: 'premium', 
    culturalAttribute: 'family-oriented',
    color: '#90EE90',
    opacity: 0.35
  },
  'Arabian Ranches': { 
    areaType: 'residential', 
    wealthLevel: 'premium', 
    culturalAttribute: 'family-oriented',
    color: '#F4A460',
    opacity: 0.35
  },
  'Jumeirah Village Circle': { 
    areaType: 'residential', 
    wealthLevel: 'mid-range', 
    culturalAttribute: 'family-oriented',
    color: '#FFA07A',
    opacity: 0.35
  },
  'Dubai Silicon Oasis': { 
    areaType: 'mixed', 
    wealthLevel: 'mid-range', 
    culturalAttribute: 'business-hub',
    color: '#20B2AA',
    opacity: 0.35
  },
}

// 默认属性
const DEFAULT_PROPS = {
  areaType: 'residential',
  wealthLevel: 'mid-range',
  culturalAttribute: 'family-oriented',
  color: '#3B82F6',
  opacity: 0.3,
}

// ============================================================================
// Overpass API 查询
// ============================================================================

/**
 * 构建 Overpass QL 查询语句
 */
function buildOverpassQuery(areaName: string): string {
  // 使用 Nominatim 搜索 + 区域边界获取
  return `
    [out:json][timeout:30];
    area["name:en"="${areaName}"]["place"~"suburb|neighbourhood|quarter"](25.0,54.9,25.4,55.6)->.searchArea;
    (
      relation["name:en"="${areaName}"](area.searchArea);
      way["name:en"="${areaName}"](area.searchArea);
    );
    out geom;
  `
}

/**
 * 备用查询：使用阿拉伯语名称
 */
function buildAlternativeQuery(areaName: string): string {
  return `
    [out:json][timeout:30];
    area["name"~"${areaName}",i]["place"~"suburb|neighbourhood|quarter"](25.0,54.9,25.4,55.6)->.searchArea;
    (
      relation["name"~"${areaName}",i](area.searchArea);
      way["name"~"${areaName}",i](area.searchArea);
    );
    out geom;
  `
}

/**
 * 从 Overpass API 获取区域数据
 */
async function fetchAreaFromOSM(areaName: string): Promise<any | null> {
  try {
    console.log(`🔍 Fetching boundary for: ${areaName}...`)
    
    // 尝试主查询
    let query = buildOverpassQuery(areaName)
    let response = await axios.post(OVERPASS_API, query, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 60000,
    })
    
    // 如果没有结果，尝试备用查询
    if (!response.data.elements || response.data.elements.length === 0) {
      console.log(`   ⚠️  No results with English name, trying alternative...`)
      query = buildAlternativeQuery(areaName)
      response = await axios.post(OVERPASS_API, query, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 60000,
      })
    }
    
    if (!response.data.elements || response.data.elements.length === 0) {
      console.log(`   ❌ No boundary found for ${areaName}`)
      return null
    }
    
    const element = response.data.elements[0]
    
    // 将 OSM 数据转换为 GeoJSON Polygon
    const geoJSON = convertToGeoJSON(element)
    
    if (!geoJSON) {
      console.log(`   ❌ Failed to convert ${areaName} to GeoJSON`)
      return null
    }
    
    console.log(`   ✅ Found boundary for ${areaName}`)
    return {
      name: areaName,
      nameAr: element.tags?.['name:ar'] || null,
      boundary: geoJSON,
      tags: element.tags,
    }
    
  } catch (error: any) {
    console.error(`   ❌ Error fetching ${areaName}:`, error.message)
    return null
  }
}

/**
 * 将 OSM element 转换为 GeoJSON Polygon
 */
function convertToGeoJSON(element: any): any {
  try {
    if (element.type === 'way' && element.geometry) {
      // Way with geometry
      const coordinates = element.geometry.map((node: any) => [node.lon, node.lat])
      
      // 确保闭合
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
      // Relation - 找到 outer 成员
      const outerMembers = element.members.filter((m: any) => m.role === 'outer')
      
      if (outerMembers.length > 0 && outerMembers[0].geometry) {
        const coordinates = outerMembers[0].geometry.map((node: any) => [node.lon, node.lat])
        
        // 确保闭合
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
    console.error('Error converting to GeoJSON:', error)
    return null
  }
}

// ============================================================================
// 数据库操作
// ============================================================================

/**
 * 保存区域到数据库
 */
async function saveAreaToDatabase(areaData: any): Promise<boolean> {
  try {
    const props = AREA_TYPE_MAP[areaData.name] || DEFAULT_PROPS
    
    await pool.query(
      `
      INSERT INTO dubai_areas (
        name, name_ar, boundary, area_type, wealth_level, cultural_attribute,
        description, color, opacity, display_order
      ) VALUES (
        $1, $2, ST_GeomFromGeoJSON($3)::geography, $4, $5, $6, $7, $8, $9, $10
      )
      ON CONFLICT (name) DO UPDATE SET
        boundary = ST_GeomFromGeoJSON($3)::geography,
        name_ar = $2,
        area_type = $4,
        wealth_level = $5,
        cultural_attribute = $6,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        areaData.name,
        areaData.nameAr,
        JSON.stringify(areaData.boundary),
        props.areaType,
        props.wealthLevel,
        props.culturalAttribute,
        areaData.tags?.description || `${areaData.name} district in Dubai`,
        props.color,
        props.opacity,
        0,
      ]
    )
    
    console.log(`   💾 Saved ${areaData.name} to database`)
    return true
  } catch (error: any) {
    console.error(`   ❌ Error saving ${areaData.name}:`, error.message)
    return false
  }
}

/**
 * 为区域添加唯一性约束
 */
async function addUniqueConstraint(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE dubai_areas 
      ADD CONSTRAINT dubai_areas_name_unique UNIQUE (name)
    `)
    console.log('✅ Added unique constraint to dubai_areas.name')
  } catch (error) {
    // 约束可能已存在，忽略错误
  }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  console.log('🚀 Starting Dubai Areas Generation from OpenStreetMap\n')
  console.log(`📍 Total areas to fetch: ${DUBAI_AREAS.length}\n`)
  
  // 添加唯一性约束
  await addUniqueConstraint()
  
  let successCount = 0
  let failCount = 0
  
  for (let i = 0; i < DUBAI_AREAS.length; i++) {
    const areaName = DUBAI_AREAS[i]
    console.log(`\n[${i + 1}/${DUBAI_AREAS.length}] Processing: ${areaName}`)
    
    // 获取边界数据
    const areaData = await fetchAreaFromOSM(areaName)
    
    if (areaData) {
      // 保存到数据库
      const saved = await saveAreaToDatabase(areaData)
      if (saved) {
        successCount++
      } else {
        failCount++
      }
    } else {
      failCount++
    }
    
    // 延迟避免API限流（Overpass API 建议每次请求间隔 1-2 秒）
    if (i < DUBAI_AREAS.length - 1) {
      console.log(`   ⏳ Waiting 2 seconds...`)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`   ✅ Success: ${successCount}`)
  console.log(`   ❌ Failed: ${failCount}`)
  console.log(`   📈 Success Rate: ${((successCount / DUBAI_AREAS.length) * 100).toFixed(1)}%`)
  console.log('='.repeat(60))
  
  // 关闭数据库连接
  await pool.end()
  
  console.log('\n✨ Done!\n')
}

// 运行
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
