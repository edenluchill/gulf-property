import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
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

async function runOptimization() {
  console.log('🚀 Starting database optimization...\n');
  
  const startTime = Date.now();
  const client = await pool.connect();
  
  try {
    // Read the optimization SQL file
    const sqlPath = path.join(__dirname, 'optimize-performance.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    console.log('📋 Running optimization script...\n');
    
    // Execute the SQL
    await client.query(sql);
    
    console.log('✅ Optimization completed!\n');
    
    // Check index status
    console.log('📊 Checking index status...');
    const indexResult = await client.query(`
      SELECT 
        schemaname,
        tablename,
        indexname,
        pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
      FROM pg_indexes
      WHERE schemaname = 'public'
      AND tablename = 'off_plan_properties'
      ORDER BY pg_relation_size(indexname::regclass) DESC
    `);
    
    console.log('\n📍 Indexes:');
    indexResult.rows.forEach((row: any) => {
      console.log(`   ${row.indexname}: ${row.index_size}`);
    });
    
    // Check materialized views
    console.log('\n📈 Checking materialized views...');
    const mvResult = await client.query(`
      SELECT 
        schemaname,
        matviewname as viewname,
        pg_size_pretty(pg_relation_size(matviewname::regclass)) as view_size
      FROM pg_matviews
      WHERE schemaname = 'public'
      ORDER BY matviewname
    `);
    
    if (mvResult.rows.length > 0) {
      console.log('\n✅ Materialized Views:');
      mvResult.rows.forEach((row: any) => {
        console.log(`   ${row.viewname}: ${row.view_size}`);
      });
      
      // Refresh materialized views
      console.log('\n🔄 Refreshing materialized views...');
      await client.query('SELECT refresh_metadata_views()');
      console.log('✅ Materialized views refreshed!');
    } else {
      console.log('⚠️  No materialized views found (they will be used on next optimization run)');
    }
    
    // Check table statistics
    console.log('\n📊 Table Statistics:');
    const statsResult = await client.query(`
      SELECT 
        pg_size_pretty(pg_total_relation_size('off_plan_properties')) as total_size,
        pg_size_pretty(pg_relation_size('off_plan_properties')) as table_size,
        pg_size_pretty(pg_indexes_size('off_plan_properties')) as indexes_size,
        (SELECT COUNT(*) FROM off_plan_properties) as row_count
    `);
    
    const stats = statsResult.rows[0];
    console.log(`   Total size: ${stats.total_size}`);
    console.log(`   Table size: ${stats.table_size}`);
    console.log(`   Indexes size: ${stats.indexes_size}`);
    console.log(`   Row count: ${stats.row_count}`);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n⏱️  Duration: ${duration}s`);
    
    console.log('\n' + '═'.repeat(60));
    console.log('✨ Database optimization completed successfully!');
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error during optimization:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the optimization
if (require.main === module) {
  runOptimization()
    .then(() => {
      console.log('\n✅ Optimization script completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Optimization script failed:', error);
      process.exit(1);
    });
}

export { runOptimization };
