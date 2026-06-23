/**
 * Refresh the derived materialized views after the daily data.dubai sync.
 * These precompute the expensive per-area aggregations (percentile over v_sales
 * 763k + v_rent 2.9M) so /api/dubai/areas and the find-home calculator are fast.
 * Order matters: net-yield first, then the invest summary that joins it.
 *
 *   cd backend && npx ts-node scripts/refresh-derived.ts
 *   # add to the daily sync, AFTER the sync step.
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'

const VIEWS = ['mv_area_net_yield', 'mv_area_invest_apt'] // dependency order

async function main(): Promise<void> {
  for (const v of VIEWS) {
    const t0 = process.hrtime.bigint()
    try {
      await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${v}`)
    } catch (e: any) {
      // CONCURRENTLY needs a unique index + an existing populated matview; fall back.
      console.warn(`  ${v}: concurrent refresh failed (${e.message}); plain refresh`)
      await pool.query(`REFRESH MATERIALIZED VIEW ${v}`)
    }
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n)
    console.log(`✓ refreshed ${v} (${ms}ms)`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
