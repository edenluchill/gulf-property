import { Pool } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pinzos',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function addConstraint() {
  console.log('🔧 Adding building_id unique constraint...\n');
  
  const client = await pool.connect();
  
  try {
    // Check if constraint already exists
    console.log('📋 Checking existing constraints...');
    const checkResult = await client.query(`
      SELECT conname 
      FROM pg_constraint
      WHERE conrelid = 'off_plan_properties'::regclass
      AND conname = 'unique_building_id'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ Constraint already exists, no action needed.');
      return;
    }
    
    console.log('🗑️  Removing duplicates if any...');
    const deleteResult = await client.query(`
      DELETE FROM off_plan_properties a 
      USING off_plan_properties b
      WHERE a.id < b.id 
      AND a.building_id = b.building_id 
      AND a.building_id IS NOT NULL
    `);
    console.log(`   Removed ${deleteResult.rowCount} duplicate rows`);
    
    console.log('🔧 Setting temporary IDs for NULL building_ids...');
    const updateResult = await client.query(`
      UPDATE off_plan_properties 
      SET building_id = (random() * 1000000000)::int 
      WHERE building_id IS NULL
    `);
    console.log(`   Updated ${updateResult.rowCount} rows`);
    
    console.log('🔒 Adding NOT NULL constraint...');
    await client.query(`
      ALTER TABLE off_plan_properties 
      ALTER COLUMN building_id SET NOT NULL
    `);
    
    console.log('🔑 Adding UNIQUE constraint...');
    await client.query(`
      ALTER TABLE off_plan_properties 
      ADD CONSTRAINT unique_building_id UNIQUE (building_id)
    `);
    
    console.log('\n✅ Constraint added successfully!');
    
    // Verify
    const verifyResult = await client.query(`
      SELECT 
        conname AS constraint_name,
        contype AS constraint_type
      FROM pg_constraint
      WHERE conrelid = 'off_plan_properties'::regclass
      AND conname = 'unique_building_id'
    `);
    
    if (verifyResult.rows.length > 0) {
      console.log('✅ Verification passed: unique_building_id constraint is active');
    }
    
  } catch (error) {
    console.error('❌ Error adding constraint:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  addConstraint()
    .then(() => {
      console.log('\n✅ Completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error);
      process.exit(1);
    });
}

export { addConstraint };
