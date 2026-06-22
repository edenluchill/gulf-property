/**
 * Data-freshness watchdog for the daily data.dubai load.
 *
 * The production tables are refreshed by a rebuild+swap flow that doesn't write
 * the sync_runs audit table, so "did today's load run?" had no signal. This checks
 * the RESULT (max load_timestamp per core table) instead of the process — robust
 * to HOW the data is loaded. Exits 1 if anything is stale so cron mail / a monitor
 * picks it up.
 *
 *   cd backend && npx ts-node scripts/check-dubai-freshness.ts
 *   # cron (hourly), anywhere that can reach the DB:
 *   #   0 * * * * /path/to/backend/scripts/run-freshness.sh
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

// max_age_hours: alert if max(load_timestamp) is older than this.
const CHECKS: { table: string; col: string; maxAgeHours: number }[] = [
  { table: 'dld_transactions', col: 'load_timestamp', maxAgeHours: 36 },
  { table: 'dld_rent_contracts', col: 'load_timestamp', maxAgeHours: 48 },
]

async function main(): Promise<void> {
  let stale = false
  for (const c of CHECKS) {
    const r = await pool.query(
      `SELECT max(${c.col}) AS latest, EXTRACT(EPOCH FROM (now() - max(${c.col})))/3600 AS age_h FROM ${c.table}`
    )
    const latest = r.rows[0]?.latest
    const ageH = r.rows[0]?.age_h != null ? Number(r.rows[0].age_h) : null
    if (latest == null || ageH == null) {
      console.error(`STALE: ${c.table} has no load_timestamp data`)
      stale = true
      continue
    }
    const tag = ageH > c.maxAgeHours ? 'STALE' : 'ok'
    const line = `${tag}: ${c.table} latest=${new Date(latest).toISOString()} age=${ageH.toFixed(1)}h (limit ${c.maxAgeHours}h)`
    if (ageH > c.maxAgeHours) { console.error(line); stale = true } else { console.log(line) }
  }
  await pool.end()
  if (stale) {
    console.error('\n❌ Dubai data is stale — the daily rebuild/sync likely did not run.')
    process.exit(1)
  }
  console.log('\n✅ Dubai data is fresh.')
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
