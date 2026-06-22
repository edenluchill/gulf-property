/**
 * Full-refresh sync of OA service charges (dld_oa_service_charges-open-api) into
 * dld_service_charges. Small, yearly dataset → simplest to TRUNCATE + reload in
 * one txn (avoids the composite-PK upsert pitfalls of the generic sync engine).
 * Run from a UAE egress (DUBAI_API_PROXY_URL set, or on the Dubai box):
 *   cd backend && npx ts-node scripts/sync-service-charges.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'

const COLS = [
  'master_community_id', 'master_community_name_en', 'master_community_name_ar',
  'property_group_id', 'property_group_name_en', 'property_group_name_ar',
  'project_id', 'project_name', 'usage_id', 'usage_name_en', 'usage_name_ar',
  'budget_year', 'service_cost', 'service_category_id', 'service_category_name_en',
  'service_category_name_ar', 'management_company_id', 'management_company_name_en',
  'management_company_name_ar', 'load_timestamp',
]

async function insertBatch(client: any, rows: any[]): Promise<void> {
  if (!rows.length) return
  const params: any[] = []
  const tuples = rows.map((r, i) => {
    const base = i * COLS.length
    for (const c of COLS) params.push(r[c] ?? null)
    return '(' + COLS.map((_, j) => `$${base + j + 1}`).join(',') + ')'
  })
  await client.query(`INSERT INTO dld_service_charges (${COLS.join(',')}) VALUES ${tuples.join(',')}`, params)
}

async function main(): Promise<void> {
  const client = await pool.connect()
  let total = 0
  try {
    await client.query('BEGIN')
    await client.query('TRUNCATE dld_service_charges')
    for await (const { page, results } of iteratePages('dld', 'dld_oa_service_charges-open-api', { pageSize: 1000 })) {
      await insertBatch(client, results)
      total += results.length
      if (page % 10 === 0) console.log(`  …${total} rows`)
    }
    await client.query('COMMIT')
    console.log(`✅ synced ${total} service-charge rows`)
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('sync failed (rolled back):', e?.message ?? e)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}
main()
