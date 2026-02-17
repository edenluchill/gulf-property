/**
 * Database query runner - executes SQL queries using .env configuration
 * Usage: npx ts-node scripts/db-query.ts "SELECT * FROM ..."
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { resolve } from 'path';

// Load .env from backend directory
config({ path: resolve(__dirname, '../.env') });

async function run() {
  const query = process.argv[2];

  if (!query) {
    console.log('Usage: npx ts-node scripts/db-query.ts "SQL query"');
    console.log('Example: npx ts-node scripts/db-query.ts "SELECT name, avg_price_sqm FROM get_dubai_area_metrics() LIMIT 5"');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    const result = await client.query(query);

    if (result.rows.length > 0) {
      console.table(result.rows);
    } else {
      console.log(result.command || 'Query executed');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
