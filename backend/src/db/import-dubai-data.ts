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
const DATA_FILE_PATH = path.join(__dirname, 'dubai_off_plan_datapoint.json');
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
    console.warn(`Invalid coordinates for building_id ${data.building_id}: ${data.building_coordinates}`);
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
 */
async function insertBatch(client: any, batch: any[]) {
  if (batch.length === 0) return 0;

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
    ON CONFLICT (id) DO NOTHING
  `;

  await client.query(query, values);
  return batch.length;
}

/**
 * Main import function
 */
async function importData() {
  console.log('🚀 Starting Dubai off-plan data import...\n');
  
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  const client = await pool.connect();
  
  try {
    // Read the JSON file
    console.log('📖 Reading data file...');
    const fileContent = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
    const rawData: DubaiOffPlanDataPoint[] = JSON.parse(fileContent);
    console.log(`✅ Found ${rawData.length} properties in data file\n`);

    // Start transaction
    await client.query('BEGIN');

    // Process in batches
    let batch: any[] = [];
    
    for (let i = 0; i < rawData.length; i++) {
      const dataPoint = rawData[i];
      totalProcessed++;
      
      // Transform the data point
      const transformed = transformDataPoint(dataPoint);
      
      if (transformed) {
        batch.push(transformed);
      } else {
        totalSkipped++;
      }
      
      // Insert batch when it reaches BATCH_SIZE or at the end
      if (batch.length >= BATCH_SIZE || i === rawData.length - 1) {
        const inserted = await insertBatch(client, batch);
        totalInserted += inserted;
        
        // Progress update
        const progress = ((i + 1) / rawData.length * 100).toFixed(1);
        process.stdout.write(`\r📊 Progress: ${progress}% (${i + 1}/${rawData.length}) - Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);
        
        batch = [];
      }
    }

    // Commit transaction
    await client.query('COMMIT');
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n\n✨ Import completed successfully!');
    console.log('─'.repeat(50));
    console.log(`📊 Statistics:`);
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   Successfully inserted: ${totalInserted}`);
    console.log(`   Skipped (invalid data): ${totalSkipped}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Speed: ${(totalProcessed / parseFloat(duration)).toFixed(0)} records/sec`);
    console.log('─'.repeat(50));
    
    // Create indexes summary
    console.log('\n📍 Verifying spatial index...');
    const indexResult = await client.query(`
      SELECT tablename, indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'off_plan_properties' 
      AND indexname = 'idx_off_plan_location_gist'
    `);
    
    if (indexResult.rows.length > 0) {
      console.log('✅ Spatial index is active and ready for map queries');
    } else {
      console.log('⚠️  Spatial index not found. Please run schema.sql first.');
    }
    
    // Sample query test
    console.log('\n🧪 Testing sample query (properties in Dubai Marina area)...');
    const sampleResult = await client.query(`
      SELECT building_name, project_name, area_name, starting_price
      FROM off_plan_properties
      WHERE area_name LIKE '%Marina%'
      LIMIT 5
    `);
    console.log(`Found ${sampleResult.rows.length} properties:`);
    sampleResult.rows.forEach((row: any) => {
      console.log(`   - ${row.building_name} (${row.project_name}) - AED ${row.starting_price?.toLocaleString() || 'N/A'}`);
    });
    
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
  importData()
    .then(() => {
      console.log('\n✅ Import script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Import script failed:', error);
      process.exit(1);
    });
}

export { importData };
