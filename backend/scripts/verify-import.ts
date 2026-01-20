import pool from '../src/db/pool'

async function verifyImport() {
  try {
    const result = await pool.query(`
      SELECT 
        name,
        project_counts,
        average_price,
        capital_appreciation,
        rental_yield,
        color
      FROM dubai_areas 
      ORDER BY name
    `)
    
    console.log('\n📊 Imported Dubai Areas:\n')
    console.log('='.repeat(100))
    console.table(result.rows)
    console.log('='.repeat(100))
    console.log(`\n✅ Total areas: ${result.rows.length}\n`)
    
  } catch (error: any) {
    console.error('❌ Error:', error.message)
  } finally {
    await pool.end()
  }
}

verifyImport()
