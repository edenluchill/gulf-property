import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { DubaiOffPlanDataPoint } from '../types';

// Load environment variables
dotenv.config();

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'gulf_property',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Configuration
const BATCH_SIZE = 100; // Insert in batches for better performance
const DATAPOINTS_DIR = path.join(__dirname, 'datapoints');
const IMAGE_BASE_URL = 'https://cloud.famproperties.com';

/**
 * Parse coordinates from string "lat, lng" to [lng, lat] array
 */
function parseCoordinates(coordString: string): [number, number] | null {
  try {
    const [lat, lng] = coordString.split(',').map(s => parseFloat(s.trim()));
    if (isNaN(lat) || isNaN(lng)) {
      return null;
    }
    return [lng, lat]; // PostGIS uses [lng, lat] order
  } catch (error) {
    return null;
  }
}

/**
 * Convert relative URL to absolute URL
 */
function toAbsoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url; // Already absolute
  }
  // Remove leading slash if present (will be added by path join)
  const cleanPath = url.startsWith('/') ? url : `/${url}`;
  return `${IMAGE_BASE_URL}${cleanPath}`;
}

/**
 * Transform raw Dubai data point to database row format
 */
function transformDataPoint(data: DubaiOffPlanDataPoint) {
  // Use coordinates array first, fallback to building_coordinates string
  let coordinates: [number, number] | null = null;
  
  if (data.coordinates && data.coordinates.length === 2) {
    coordinates = [data.coordinates[0], data.coordinates[1]]; // [lng, lat]
  } else if (data.building_coordinates) {
    coordinates = parseCoordinates(data.building_coordinates);
  }
  
  if (!coordinates) {
    return null;
  }

  return {
    building_id: data.building_id,
    building_name: data.building || 'Unknown',
    project_name: data.project || data.building || 'Unknown',
    building_description: data.building_description,
    
    developer: data.dev || 'Unknown',
    developer_id: data.dev_id,
    developer_logo_url: toAbsoluteUrl(data.developer_logo_url),
    
    // Location - use ST_MakePoint for PostGIS
    lng: coordinates[0],
    lat: coordinates[1],
    area_name: data.area_name || 'Unknown',
    area_id: data.area_id,
    dld_location_id: data.dld_location_id,
    
    min_bedrooms: data.min_bed || 0,
    max_bedrooms: data.max_bed || 0,
    beds_description: data.beds,
    
    min_size: data.building_min_size,
    max_size: data.building_max_size,
    
    starting_price: data.building_starting_price,
    median_price_sqft: data.building_median_price_sqft,
    median_price_per_unit: data.prop_median_price_per_unit,
    median_rent_per_unit: data.prop_median_rent_per_unit,
    
    launch_date: data.launch_date ? new Date(data.launch_date) : null,
    completion_date: data.completion_date ? new Date(data.completion_date) : null,
    completion_percent: data.completion_percent || 0,
    
    unit_count: data.unit_count,
    building_unit_count: data.building_unit_count,
    
    sales_volume: data.building_sales_volume || 0,
    prop_sales_volume: data.prop_sales_volume || 0,
    
    images: (data.images || []).map(img => toAbsoluteUrl(img)).filter(img => img !== null) as string[],
    logo_url: toAbsoluteUrl(data.logo_url),
    brochure_url: toAbsoluteUrl(data.brochure_url),
    amenities: data.amenities || [],
    
    display_as: data.display_as,
    verified: true, // Mark imported data as verified
  };
}

/**
 * Insert a batch of properties into the database
 * Uses ON CONFLICT to handle duplicates based on building_id
 */
async function insertBatch(client: any, batch: any[]) {
  if (batch.length === 0) return { inserted: 0, updated: 0 };

  // Build the INSERT query with multiple rows
  const valuesClauses: string[] = [];
  const values: any[] = [];
  let paramCounter = 1;

  for (const item of batch) {
    const params: string[] = [];
    
    // Add all parameters
    params.push(`$${paramCounter++}`); values.push(item.building_id);
    params.push(`$${paramCounter++}`); values.push(item.building_name);
    params.push(`$${paramCounter++}`); values.push(item.project_name);
    params.push(`$${paramCounter++}`); values.push(item.building_description);
    params.push(`$${paramCounter++}`); values.push(item.developer);
    params.push(`$${paramCounter++}`); values.push(item.developer_id);
    params.push(`$${paramCounter++}`); values.push(item.developer_logo_url);
    
    // PostGIS point - use ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    params.push(`ST_SetSRID(ST_MakePoint($${paramCounter++}, $${paramCounter++}), 4326)::geography`);
    values.push(item.lng);
    values.push(item.lat);
    
    params.push(`$${paramCounter++}`); values.push(item.area_name);
    params.push(`$${paramCounter++}`); values.push(item.area_id);
    params.push(`$${paramCounter++}`); values.push(item.dld_location_id);
    params.push(`$${paramCounter++}`); values.push(item.min_bedrooms);
    params.push(`$${paramCounter++}`); values.push(item.max_bedrooms);
    params.push(`$${paramCounter++}`); values.push(item.beds_description);
    params.push(`$${paramCounter++}`); values.push(item.min_size);
    params.push(`$${paramCounter++}`); values.push(item.max_size);
    params.push(`$${paramCounter++}`); values.push(item.starting_price);
    params.push(`$${paramCounter++}`); values.push(item.median_price_sqft);
    params.push(`$${paramCounter++}`); values.push(item.median_price_per_unit);
    params.push(`$${paramCounter++}`); values.push(item.median_rent_per_unit);
    params.push(`$${paramCounter++}`); values.push(item.launch_date);
    params.push(`$${paramCounter++}`); values.push(item.completion_date);
    params.push(`$${paramCounter++}`); values.push(item.completion_percent);
    params.push(`$${paramCounter++}`); values.push(item.unit_count);
    params.push(`$${paramCounter++}`); values.push(item.building_unit_count);
    params.push(`$${paramCounter++}`); values.push(item.sales_volume);
    params.push(`$${paramCounter++}`); values.push(item.prop_sales_volume);
    params.push(`$${paramCounter++}`); values.push(item.images);
    params.push(`$${paramCounter++}`); values.push(item.logo_url);
    params.push(`$${paramCounter++}`); values.push(item.brochure_url);
    params.push(`$${paramCounter++}`); values.push(item.amenities);
    params.push(`$${paramCounter++}`); values.push(item.display_as);
    params.push(`$${paramCounter++}`); values.push(item.verified);
    
    valuesClauses.push(`(${params.join(', ')})`);
  }

  const query = `
    INSERT INTO off_plan_properties (
      building_id, building_name, project_name, building_description,
      developer, developer_id, developer_logo_url,
      location,
      area_name, area_id, dld_location_id,
      min_bedrooms, max_bedrooms, beds_description,
      min_size, max_size,
      starting_price, median_price_sqft, median_price_per_unit, median_rent_per_unit,
      launch_date, completion_date, completion_percent,
      unit_count, building_unit_count,
      sales_volume, prop_sales_volume,
      images, logo_url, brochure_url, amenities,
      display_as, verified
    ) VALUES ${valuesClauses.join(', ')}
    ON CONFLICT (building_id) DO UPDATE SET
      building_name = EXCLUDED.building_name,
      project_name = EXCLUDED.project_name,
      building_description = EXCLUDED.building_description,
      developer = EXCLUDED.developer,
      developer_id = EXCLUDED.developer_id,
      developer_logo_url = EXCLUDED.developer_logo_url,
      location = EXCLUDED.location,
      area_name = EXCLUDED.area_name,
      area_id = EXCLUDED.area_id,
      dld_location_id = EXCLUDED.dld_location_id,
      min_bedrooms = EXCLUDED.min_bedrooms,
      max_bedrooms = EXCLUDED.max_bedrooms,
      beds_description = EXCLUDED.beds_description,
      min_size = EXCLUDED.min_size,
      max_size = EXCLUDED.max_size,
      starting_price = EXCLUDED.starting_price,
      median_price_sqft = EXCLUDED.median_price_sqft,
      median_price_per_unit = EXCLUDED.median_price_per_unit,
      median_rent_per_unit = EXCLUDED.median_rent_per_unit,
      launch_date = EXCLUDED.launch_date,
      completion_date = EXCLUDED.completion_date,
      completion_percent = EXCLUDED.completion_percent,
      unit_count = EXCLUDED.unit_count,
      building_unit_count = EXCLUDED.building_unit_count,
      sales_volume = EXCLUDED.sales_volume,
      prop_sales_volume = EXCLUDED.prop_sales_volume,
      images = EXCLUDED.images,
      logo_url = EXCLUDED.logo_url,
      brochure_url = EXCLUDED.brochure_url,
      amenities = EXCLUDED.amenities,
      display_as = EXCLUDED.display_as,
      verified = EXCLUDED.verified,
      updated_at = CURRENT_TIMESTAMP
  `;

  await client.query(query, values);
  
  return { 
    inserted: batch.length,
    updated: 0 // PostgreSQL doesn't easily return this with ON CONFLICT
  };
}

/**
 * Import a single JSON file
 */
async function importFile(client: any, filePath: string, fileName: string) {
  console.log(`\n📁 Processing: ${fileName}`);
  
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const rawData: DubaiOffPlanDataPoint[] = JSON.parse(fileContent);
  
  if (rawData.length === 0) {
    console.log(`   ⚠️  Empty file, skipping`);
    return { processed: 0, inserted: 0, skipped: 0 };
  }
  
  console.log(`   Found ${rawData.length} records`);
  
  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let batch: any[] = [];
  
  for (let i = 0; i < rawData.length; i++) {
    const dataPoint = rawData[i];
    processed++;
    
    const transformed = transformDataPoint(dataPoint);
    
    if (transformed) {
      batch.push(transformed);
    } else {
      skipped++;
    }
    
    // Insert batch when it reaches BATCH_SIZE or at the end
    if (batch.length >= BATCH_SIZE || i === rawData.length - 1) {
      const result = await insertBatch(client, batch);
      inserted += result.inserted;
      batch = [];
    }
  }
  
  console.log(`   ✅ Completed: ${inserted} records processed, ${skipped} skipped`);
  
  return { processed, inserted, skipped };
}

/**
 * Main import function - imports all files from datapoints directory
 */
async function importAllDatapoints() {
  console.log('🚀 Starting bulk Dubai datapoints import...\n');
  console.log('═'.repeat(60));
  
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let filesProcessed = 0;

  const client = await pool.connect();
  
  try {
    // Get all JSON files from datapoints directory
    const files = fs.readdirSync(DATAPOINTS_DIR)
      .filter(file => file.endsWith('.json'))
      .sort();
    
    console.log(`📊 Found ${files.length} JSON files to import\n`);
    
    // Start transaction
    await client.query('BEGIN');
    
    // Process each file
    for (const file of files) {
      const filePath = path.join(DATAPOINTS_DIR, file);
      const stats = await importFile(client, filePath, file);
      
      totalProcessed += stats.processed;
      totalInserted += stats.inserted;
      totalSkipped += stats.skipped;
      filesProcessed++;
    }
    
    // Commit transaction
    await client.query('COMMIT');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '═'.repeat(60));
    console.log('\n✨ Import completed successfully!\n');
    console.log('📊 Final Statistics:');
    console.log('─'.repeat(60));
    console.log(`   Files processed:        ${filesProcessed}`);
    console.log(`   Total records:          ${totalProcessed}`);
    console.log(`   Successfully imported:  ${totalInserted}`);
    console.log(`   Skipped (invalid):      ${totalSkipped}`);
    console.log(`   Duration:               ${duration}s`);
    console.log(`   Speed:                  ${(totalProcessed / parseFloat(duration)).toFixed(0)} records/sec`);
    console.log('─'.repeat(60));
    
    // Get database statistics
    console.log('\n📈 Database Statistics:');
    const countResult = await client.query(`
      SELECT COUNT(*) as total FROM off_plan_properties
    `);
    console.log(`   Total properties in DB: ${countResult.rows[0].total}`);
    
    const verifiedResult = await client.query(`
      SELECT COUNT(*) as verified FROM off_plan_properties WHERE verified = true
    `);
    console.log(`   Verified properties:    ${verifiedResult.rows[0].verified}`);
    
    // Check filters availability
    console.log('\n🔍 Filter Fields Summary:');
    const filterStats = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE starting_price IS NOT NULL) as with_price,
        COUNT(*) FILTER (WHERE min_bedrooms > 0 OR max_bedrooms > 0) as with_bedrooms,
        COUNT(*) FILTER (WHERE min_size IS NOT NULL OR max_size IS NOT NULL) as with_size,
        COUNT(*) FILTER (WHERE median_price_sqft IS NOT NULL) as with_price_sqft,
        COUNT(*) FILTER (WHERE launch_date IS NOT NULL) as with_launch_date,
        COUNT(*) FILTER (WHERE completion_date IS NOT NULL) as with_completion_date,
        COUNT(*) FILTER (WHERE completion_percent > 0) as with_completion_percent,
        COUNT(DISTINCT developer) as unique_developers,
        COUNT(DISTINCT project_name) as unique_projects
      FROM off_plan_properties
    `);
    
    const stats = filterStats.rows[0];
    console.log(`   Properties with price:        ${stats.with_price}`);
    console.log(`   Properties with bedrooms:     ${stats.with_bedrooms}`);
    console.log(`   Properties with size:         ${stats.with_size}`);
    console.log(`   Properties with price/sqft:   ${stats.with_price_sqft}`);
    console.log(`   Properties with launch date:  ${stats.with_launch_date}`);
    console.log(`   Properties with completion:   ${stats.with_completion_date}`);
    console.log(`   Properties with progress:     ${stats.with_completion_percent}`);
    console.log(`   Unique developers:            ${stats.unique_developers}`);
    console.log(`   Unique projects:              ${stats.unique_projects}`);
    
    // Status distribution
    console.log('\n📊 Status Distribution:');
    const statusResult = await client.query(`
      SELECT 
        status,
        COUNT(*) as count
      FROM off_plan_properties
      GROUP BY status
      ORDER BY count DESC
    `);
    statusResult.rows.forEach((row: any) => {
      console.log(`   ${row.status}: ${row.count}`);
    });
    
    // Verify spatial index
    console.log('\n📍 Spatial Index Status:');
    const indexResult = await client.query(`
      SELECT tablename, indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'off_plan_properties' 
      AND indexname = 'idx_off_plan_location_gist'
    `);
    
    if (indexResult.rows.length > 0) {
      console.log('   ✅ Spatial index active and ready for map queries');
    } else {
      console.log('   ⚠️  Spatial index not found - run schema.sql first');
    }
    
    // Sample properties
    console.log('\n🏢 Sample Properties:');
    const sampleResult = await client.query(`
      SELECT building_name, project_name, developer, area_name, starting_price, status
      FROM off_plan_properties
      WHERE starting_price IS NOT NULL
      ORDER BY starting_price DESC
      LIMIT 5
    `);
    
    sampleResult.rows.forEach((row: any, idx: number) => {
      console.log(`   ${idx + 1}. ${row.building_name} - ${row.project_name}`);
      console.log(`      Developer: ${row.developer} | Area: ${row.area_name}`);
      console.log(`      Price: AED ${row.starting_price?.toLocaleString() || 'N/A'} | Status: ${row.status}`);
    });
    
    console.log('\n' + '═'.repeat(60));
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error during import:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the import
if (require.main === module) {
  importAllDatapoints()
    .then(() => {
      console.log('\n✅ All datapoints imported successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import failed:', error);
      process.exit(1);
    });
}

export { importAllDatapoints };
