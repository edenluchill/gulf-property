/**
 * 从 GeoJSON 文件导入迪拜区域
 */

import fs from 'fs'
import path from 'path'
import pool from '../src/db/pool'

async function importFromGeoJSON() {
  try {
    console.log('\n🚀 Importing Dubai Areas from GeoJSON\n')
    
    // 读取 GeoJSON 文件
    const geojsonPath = path.join(__dirname, '../data/dubai-areas.geojson')
    const geojsonData = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'))
    
    const features = geojsonData.features || []
    
    console.log(`📊 Found ${features.length} areas in GeoJSON\n`)
    console.log('='.repeat(60) + '\n')
    
    let successCount = 0
    let failCount = 0
    
    for (let i = 0; i < features.length; i++) {
      const feature = features[i]
      const props = feature.properties
      const geometry = feature.geometry
      
      console.log(`[${i + 1}/${features.length}] Importing: ${props.name}`)
      
      try {
        await pool.query(
          `
          INSERT INTO dubai_areas (
            name, name_ar, boundary,
            description, color, opacity,
            project_counts, average_price, sales_volume,
            capital_appreciation, rental_yield
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
            props.name,
            props.nameAr,
            JSON.stringify(geometry),
            props.description,
            props.color,
            props.opacity,
            props.projectCounts || 0,
            props.averagePrice || null,
            props.salesVolume || null,
            props.capitalAppreciation || null,
            props.rentalYield || null,
          ]
        )
        
        console.log(`   ✅ Saved`)
        successCount++
      } catch (error: any) {
        console.log(`   ❌ Error: ${error.message}`)
        failCount++
      }
    }
    
    console.log('\n' + '='.repeat(60))
    console.log('📊 Summary:')
    console.log(`   ✅ Success: ${successCount}`)
    console.log(`   ❌ Failed: ${failCount}`)
    console.log(`   📈 Success Rate: ${((successCount / features.length) * 100).toFixed(1)}%`)
    console.log('='.repeat(60) + '\n')
    
  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await pool.end()
  }
}

importFromGeoJSON()
