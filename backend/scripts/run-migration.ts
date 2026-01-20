import pool from '../src/db/pool'
import fs from 'fs'
import path from 'path'

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, '../db/migrations/simplify-dubai-areas.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')
    
    console.log('🔄 Running migration: simplify-dubai-areas.sql\n')
    
    await pool.query(sql)
    
    console.log('✅ Migration completed successfully!\n')
    
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigration()
