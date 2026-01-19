/**
 * Add description column to project_unit_types table
 */
const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
})

const migrationSQL = `
-- Add description column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'project_unit_types' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE project_unit_types 
        ADD COLUMN description TEXT;
        
        RAISE NOTICE 'Added description column to project_unit_types table';
    ELSE
        RAISE NOTICE 'Description column already exists in project_unit_types table';
    END IF;
END $$;
`

async function runMigration() {
  console.log('🔧 Running migration to add description column...')
  console.log(`📊 Database: ${process.env.DB_NAME}@${process.env.DB_HOST}`)
  
  try {
    const result = await pool.query(migrationSQL)
    console.log('✅ Migration completed successfully!')
    
    // Verify the column exists
    const verifyResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'project_unit_types' 
      AND column_name = 'description'
    `)
    
    if (verifyResult.rows.length > 0) {
      console.log('✅ Verified: description column exists')
      console.log('   Column type:', verifyResult.rows[0].data_type)
    } else {
      console.log('⚠️  Warning: Could not verify column exists')
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigration()
