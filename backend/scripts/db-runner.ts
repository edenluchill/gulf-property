/**
 * Database CLI runner - executes SQL files using .env configuration
 * Usage: npx ts-node scripts/db-runner.ts <sql-file-path>
 */

import { config } from 'dotenv';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env from backend directory
config({ path: resolve(__dirname, '../.env') });

async function run() {
  const sqlFile = process.argv[2];

  if (!sqlFile) {
    console.log('Usage: npx ts-node scripts/db-runner.ts <sql-file>');
    console.log('Example: npx ts-node scripts/db-runner.ts src/db/update-area-metrics-function.sql');
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
    console.log('✓ Connected to database');

    const sqlPath = resolve(__dirname, '..', sqlFile);
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log(`✓ Executing: ${sqlFile}`);
    const result = await client.query(sql);

    if (Array.isArray(result)) {
      result.forEach((r, i) => {
        if (r.command) console.log(`  [${i + 1}] ${r.command}`);
      });
    } else if (result.command) {
      console.log(`  ${result.command}`);
    }

    console.log('✓ Done');
  } catch (error) {
    console.error('✗ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
