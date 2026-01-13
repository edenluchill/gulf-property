/**
 * Migration script to create developer property submissions tables
 * Run with: npx ts-node src/db/migrate-developer-submissions.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import pool from './pool'

async function runMigration() {
  const client = await pool.connect()
  
  try {
    console.log('🚀 Starting developer submissions migration...')
    
    // Read the schema file
    const schemaPath = join(__dirname, 'developer-submissions-schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    
    // Execute the schema
    await client.query(schema)
    
    console.log('✅ Developer submissions tables created successfully!')
    console.log('\nCreated tables:')
    console.log('  - developer_property_submissions')
    console.log('  - developer_submission_unit_types')
    console.log('  - developer_submission_payment_plans')
    console.log('\nYou can now submit properties through /api/developer/submit-property')
    
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

runMigration().catch(console.error)
