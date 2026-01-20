import pool from '../src/db/pool'

async function testDirectly() {
  try {
    console.log('\n🧪 Testing Dubai Areas API (Direct Database Query)\n')
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        name_ar,
        ST_AsGeoJSON(boundary)::json as boundary,
        description,
        description_ar,
        color,
        opacity,
        display_order,
        project_counts,
        average_price,
        sales_volume,
        capital_appreciation,
        rental_yield
      FROM dubai_areas
      WHERE visible = true
      ORDER BY display_order ASC, name ASC
      LIMIT 3
    `)
    
    console.log(`✅ Found ${result.rows.length} areas\n`)
    
    result.rows.forEach((row, i) => {
      console.log(`[${i + 1}] ${row.name}`)
      console.log(`    Projects: ${row.project_counts}`)
      console.log(`    Avg Price: ${row.average_price ? parseFloat(row.average_price).toLocaleString() : 'N/A'} AED`)
      console.log(`    Capital Appreciation: ${row.capital_appreciation}%`)
      console.log(`    Rental Yield: ${row.rental_yield}%`)
      console.log(`    Color: ${row.color}`)
      console.log()
    })
    
  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await pool.end()
  }
}

testDirectly()
