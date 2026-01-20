/**
 * 自动计算并更新迪拜区域的统计数据
 * 
 * 从 residential_projects 表聚合数据并更新到 dubai_areas 表
 * 
 * 统计字段:
 * - project_counts: 该区域的项目数量
 * - average_price: 平均价格
 * - sales_volume: 销售总额
 * - capital_appreciation: 资本增值率 (模拟数据)
 * - rental_yield: 租金回报率 (模拟数据)
 * 
 * 运行: npx ts-node backend/scripts/update-area-statistics.ts
 */

import pool from '../src/db/pool'

// ============================================================================
// 配置
// ============================================================================

// 模拟的市场数据（实际应该从真实数据源获取）
const MARKET_DATA: Record<string, {
  capitalAppreciation: number  // 年化增长率 %
  rentalYield: number          // 租金回报率 %
}> = {
  'Downtown Dubai': { capitalAppreciation: 8.5, rentalYield: 5.2 },
  'Dubai Marina': { capitalAppreciation: 7.8, rentalYield: 6.1 },
  'Palm Jumeirah': { capitalAppreciation: 9.2, rentalYield: 4.8 },
  'Business Bay': { capitalAppreciation: 10.5, rentalYield: 7.5 },
  'Dubai Hills Estate': { capitalAppreciation: 12.3, rentalYield: 5.8 },
  'Jumeirah Beach Residence': { capitalAppreciation: 7.2, rentalYield: 6.5 },
  'Jumeirah Village Circle': { capitalAppreciation: 9.8, rentalYield: 7.2 },
  'Arabian Ranches': { capitalAppreciation: 6.5, rentalYield: 5.5 },
  'Dubai Silicon Oasis': { capitalAppreciation: 11.2, rentalYield: 7.8 },
  'Motor City': { capitalAppreciation: 8.9, rentalYield: 6.9 },
}

// 默认市场数据
const DEFAULT_MARKET_DATA = {
  capitalAppreciation: 8.0,
  rentalYield: 6.5,
}

// ============================================================================
// 主函数
// ============================================================================

async function updateAreaStatistics() {
  console.log('🚀 Starting Dubai Areas Statistics Update\n')
  
  try {
    // 1. 获取所有区域
    const areasResult = await pool.query(`
      SELECT id, name FROM dubai_areas WHERE visible = true
    `)
    
    console.log(`📊 Found ${areasResult.rows.length} areas to process\n`)
    
    let updatedCount = 0
    
    for (const area of areasResult.rows) {
      console.log(`\n📍 Processing: ${area.name}`)
      
      // 2. 计算该区域的统计数据
      const statsResult = await pool.query(`
        SELECT 
          COUNT(*) as project_count,
          COALESCE(AVG(starting_price), 0) as avg_price,
          COALESCE(SUM(starting_price), 0) as total_sales
        FROM residential_projects
        WHERE area = $1
        AND starting_price IS NOT NULL
        AND starting_price > 0
      `, [area.name])
      
      const stats = statsResult.rows[0]
      const projectCount = parseInt(stats.project_count)
      const averagePrice = parseFloat(stats.avg_price)
      const salesVolume = parseFloat(stats.total_sales)
      
      // 3. 获取市场数据
      const marketData = MARKET_DATA[area.name] || DEFAULT_MARKET_DATA
      
      console.log(`   📈 Projects: ${projectCount}`)
      console.log(`   💰 Avg Price: ${averagePrice.toLocaleString()} AED`)
      console.log(`   💵 Sales Volume: ${salesVolume.toLocaleString()} AED`)
      console.log(`   📊 Capital Appreciation: ${marketData.capitalAppreciation}%`)
      console.log(`   🏠 Rental Yield: ${marketData.rentalYield}%`)
      
      // 4. 更新数据库
      await pool.query(`
        UPDATE dubai_areas
        SET 
          project_counts = $1,
          average_price = $2,
          sales_volume = $3,
          capital_appreciation = $4,
          rental_yield = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [
        projectCount,
        averagePrice > 0 ? averagePrice : null,
        salesVolume > 0 ? salesVolume : null,
        marketData.capitalAppreciation,
        marketData.rentalYield,
        area.id
      ])
      
      updatedCount++
      console.log(`   ✅ Updated`)
    }
    
    console.log('\n' + '='.repeat(60))
    console.log(`✨ Successfully updated ${updatedCount} areas`)
    console.log('='.repeat(60) + '\n')
    
  } catch (error) {
    console.error('❌ Error updating statistics:', error)
    throw error
  } finally {
    await pool.end()
  }
}

// ============================================================================
// 辅助函数：从区域边界计算统计数据（可选）
// ============================================================================

/**
 * 计算落在区域边界内的所有项目统计
 * （需要项目表有地理位置数据）
 */
async function updateAreaStatisticsWithGeo() {
  console.log('🚀 Starting Dubai Areas Statistics Update (with Geography)\n')
  
  try {
    const areasResult = await pool.query(`
      SELECT id, name, boundary FROM dubai_areas WHERE visible = true
    `)
    
    console.log(`📊 Found ${areasResult.rows.length} areas to process\n`)
    
    for (const area of areasResult.rows) {
      console.log(`\n📍 Processing: ${area.name}`)
      
      // 计算边界内的项目
      const statsResult = await pool.query(`
        SELECT 
          COUNT(*) as project_count,
          COALESCE(AVG(starting_price), 0) as avg_price,
          COALESCE(SUM(starting_price), 0) as total_sales
        FROM residential_projects
        WHERE location IS NOT NULL
        AND ST_Intersects(
          location,
          (SELECT boundary FROM dubai_areas WHERE id = $1)
        )
        AND starting_price IS NOT NULL
        AND starting_price > 0
      `, [area.id])
      
      const stats = statsResult.rows[0]
      const projectCount = parseInt(stats.project_count)
      const averagePrice = parseFloat(stats.avg_price)
      const salesVolume = parseFloat(stats.total_sales)
      
      const marketData = MARKET_DATA[area.name] || DEFAULT_MARKET_DATA
      
      console.log(`   📈 Projects (in boundary): ${projectCount}`)
      console.log(`   💰 Avg Price: ${averagePrice.toLocaleString()} AED`)
      
      await pool.query(`
        UPDATE dubai_areas
        SET 
          project_counts = $1,
          average_price = $2,
          sales_volume = $3,
          capital_appreciation = $4,
          rental_yield = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
      `, [
        projectCount,
        averagePrice > 0 ? averagePrice : null,
        salesVolume > 0 ? salesVolume : null,
        marketData.capitalAppreciation,
        marketData.rentalYield,
        area.id
      ])
      
      console.log(`   ✅ Updated`)
    }
    
    console.log('\n✨ Done!\n')
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  } finally {
    await pool.end()
  }
}

// ============================================================================
// 运行
// ============================================================================

const useGeography = process.argv.includes('--geo')

if (useGeography) {
  console.log('📍 Using geographic boundary matching\n')
  updateAreaStatisticsWithGeo().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
} else {
  console.log('📝 Using area name matching\n')
  updateAreaStatistics().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}
