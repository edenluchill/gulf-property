/**
 * 简单批量导入迪拜区域数据（无需 OSM）
 * 
 * 使用简化的矩形边界 + 手动配置的统计数据
 * 适合快速搭建原型或测试
 * 
 * 运行: npx ts-node backend/scripts/simple-import-areas.ts
 */

import pool from '../src/db/pool'

// ============================================================================
// 区域数据配置（可以手动编辑）
// ============================================================================

interface SimpleAreaData {
  name: string
  nameAr?: string
  // 使用中心点 + 半径生成矩形边界（简化版）
  center: { lat: number; lng: number }
  radiusKm?: number  // 默认 2km
  
  // 基本属性
  description: string
  
  // 视觉样式
  color: string
  opacity: number
  
  // 市场统计
  projectCounts?: number
  averagePrice?: number
  salesVolume?: number
  capitalAppreciation?: number
  rentalYield?: number
}

const SIMPLE_AREAS: SimpleAreaData[] = [
  {
    name: 'Downtown Dubai',
    nameAr: 'وسط مدينة دبي',
    center: { lat: 25.1972, lng: 55.2744 },
    radiusKm: 2,
    description: 'Heart of Dubai with Burj Khalifa, Dubai Mall, and luxury living',
    color: '#FFD700',
    opacity: 0.35,
    projectCounts: 15,
    averagePrice: 2450000,
    salesVolume: 36750000,
    capitalAppreciation: 8.5,
    rentalYield: 5.2,
  },
  {
    name: 'Dubai Marina',
    nameAr: 'مرسى دبي',
    center: { lat: 25.0771, lng: 55.1372 },
    radiusKm: 2.5,
    description: 'Upscale waterfront living with high-rise towers and marina lifestyle',
    color: '#4169E1',
    opacity: 0.35,
    projectCounts: 23,
    averagePrice: 1850000,
    salesVolume: 42550000,
    capitalAppreciation: 7.8,
    rentalYield: 6.1,
  },
  {
    name: 'Palm Jumeirah',
    nameAr: 'نخلة جميرا',
    center: { lat: 25.1124, lng: 55.1390 },
    radiusKm: 3,
    description: 'Iconic palm-shaped island with luxury villas and apartments',
    color: '#32CD32',
    opacity: 0.35,
    projectCounts: 8,
    averagePrice: 5200000,
    salesVolume: 41600000,
    capitalAppreciation: 9.2,
    rentalYield: 4.8,
  },
  {
    name: 'Business Bay',
    nameAr: 'الخليج التجاري',
    center: { lat: 25.1867, lng: 55.2631 },
    radiusKm: 2,
    description: 'Modern business district with commercial towers and offices',
    color: '#FF6347',
    opacity: 0.35,
    projectCounts: 18,
    averagePrice: 1950000,
    salesVolume: 35100000,
    capitalAppreciation: 10.5,
    rentalYield: 7.5,
  },
  {
    name: 'Jumeirah Beach Residence',
    nameAr: 'شاطئ جميرا',
    center: { lat: 25.0779, lng: 55.1329 },
    radiusKm: 1.5,
    description: 'Beachfront residential towers with dining and entertainment',
    color: '#00CED1',
    opacity: 0.35,
    projectCounts: 12,
    averagePrice: 1650000,
    salesVolume: 19800000,
    capitalAppreciation: 7.2,
    rentalYield: 6.5,
  },
  {
    name: 'Dubai Hills Estate',
    nameAr: 'دبي هيلز استيت',
    center: { lat: 25.1095, lng: 55.2453 },
    radiusKm: 3,
    description: 'Green community with golf course, parks, and family amenities',
    color: '#90EE90',
    opacity: 0.35,
    projectCounts: 20,
    averagePrice: 1750000,
    salesVolume: 35000000,
    capitalAppreciation: 12.3,
    rentalYield: 5.8,
  },
  {
    name: 'Jumeirah Village Circle',
    nameAr: 'دائرة قرية جميرا',
    center: { lat: 25.0571, lng: 55.2053 },
    radiusKm: 2,
    description: 'Affordable family community with parks and schools',
    color: '#FFA07A',
    opacity: 0.35,
    projectCounts: 25,
    averagePrice: 950000,
    salesVolume: 23750000,
    capitalAppreciation: 9.8,
    rentalYield: 7.2,
  },
  {
    name: 'Arabian Ranches',
    nameAr: 'المرابع العربية',
    center: { lat: 25.0495, lng: 55.2625 },
    radiusKm: 3,
    description: 'Golf course community with luxury villas and polo club',
    color: '#F4A460',
    opacity: 0.35,
    projectCounts: 10,
    averagePrice: 3200000,
    salesVolume: 32000000,
    capitalAppreciation: 6.5,
    rentalYield: 5.5,
  },
  {
    name: 'Dubai Silicon Oasis',
    nameAr: 'واحة دبي للسيليكون',
    center: { lat: 25.1246, lng: 55.3789 },
    radiusKm: 3,
    description: 'Technology park with residential and commercial developments',
    color: '#20B2AA',
    opacity: 0.35,
    projectCounts: 14,
    averagePrice: 850000,
    salesVolume: 11900000,
    capitalAppreciation: 11.2,
    rentalYield: 7.8,
  },
]

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 根据中心点和半径生成矩形边界
 */
function generateRectangleBoundary(
  center: { lat: number; lng: number },
  radiusKm: number = 2
): any {
  // 1 度纬度 ≈ 111 km
  // 1 度经度 ≈ 111 km * cos(latitude)
  const latOffset = radiusKm / 111
  const lngOffset = radiusKm / (111 * Math.cos(center.lat * Math.PI / 180))
  
  // 创建矩形（逆时针）
  const coordinates = [
    [center.lng - lngOffset, center.lat - latOffset], // 左下
    [center.lng + lngOffset, center.lat - latOffset], // 右下
    [center.lng + lngOffset, center.lat + latOffset], // 右上
    [center.lng - lngOffset, center.lat + latOffset], // 左上
    [center.lng - lngOffset, center.lat - latOffset], // 闭合
  ]
  
  return {
    type: 'Polygon',
    coordinates: [coordinates],
  }
}

/**
 * 导入单个区域
 */
async function importArea(area: SimpleAreaData): Promise<boolean> {
  try {
    const boundary = generateRectangleBoundary(area.center, area.radiusKm)
    
    await pool.query(
      `
      INSERT INTO dubai_areas (
        name, name_ar, boundary,
        description, color, opacity,
        project_counts, average_price, sales_volume, capital_appreciation, rental_yield
      ) VALUES (
        $1, $2, ST_GeomFromGeoJSON($3)::geography, $4, $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT (name) DO UPDATE SET
        name_ar = $2,
        boundary = ST_GeomFromGeoJSON($3)::geography,
        description = $4,
        color = $5,
        opacity = $6,
        project_counts = $7,
        average_price = $8,
        sales_volume = $9,
        capital_appreciation = $10,
        rental_yield = $11,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        area.name,
        area.nameAr,
        JSON.stringify(boundary),
        area.description,
        area.color,
        area.opacity,
        area.projectCounts || 0,
        area.averagePrice || null,
        area.salesVolume || null,
        area.capitalAppreciation || null,
        area.rentalYield || null,
      ]
    )
    
    return true
  } catch (error: any) {
    console.error(`   ❌ Error importing ${area.name}:`, error.message)
    return false
  }
}

// ============================================================================
// 主函数
// ============================================================================

async function main() {
  console.log('🚀 Starting Simple Dubai Areas Import\n')
  console.log(`📊 Total areas to import: ${SIMPLE_AREAS.length}\n`)
  
  // 确保唯一约束存在
  try {
    await pool.query(`
      ALTER TABLE dubai_areas 
      ADD CONSTRAINT dubai_areas_name_unique UNIQUE (name)
    `)
    console.log('✅ Added unique constraint\n')
  } catch (error) {
    // 约束可能已存在，忽略
  }
  
  let successCount = 0
  let failCount = 0
  
  for (let i = 0; i < SIMPLE_AREAS.length; i++) {
    const area = SIMPLE_AREAS[i]
    console.log(`[${i + 1}/${SIMPLE_AREAS.length}] Importing: ${area.name}`)
    
    const success = await importArea(area)
    
    if (success) {
      console.log(`   ✅ Imported successfully`)
      successCount++
    } else {
      failCount++
    }
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('📊 Summary:')
  console.log(`   ✅ Success: ${successCount}`)
  console.log(`   ❌ Failed: ${failCount}`)
  console.log(`   📈 Success Rate: ${((successCount / SIMPLE_AREAS.length) * 100).toFixed(1)}%`)
  console.log('='.repeat(60))
  
  await pool.end()
  
  console.log('\n✨ Done!\n')
  console.log('💡 Tip: You can now edit boundaries in the map editor')
  console.log('   or add more areas by editing simple-import-areas.ts\n')
}

// 运行
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
