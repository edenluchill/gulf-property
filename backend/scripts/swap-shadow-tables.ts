/**
 * Final step of the clean data.dubai rebuild. Run AFTER dubai-backfill has filled
 * the shadow tables (dld_*_new). It:
 *   1. populates dld_rent_contracts_new.dubai_area_id from dld_areas (metrics read
 *      this denormalized column; transactions bridge live via dld_areas.area_id so
 *      need nothing extra),
 *   2. guards: refuses to swap if a shadow table has < SAFETY_RATIO of the live rows,
 *   3. atomically renames live -> _old and _new -> live (single transaction),
 *   4. rebuilds the rolling metrics.
 * Old tables are kept as dld_*_old (drop manually once verified).
 *
 *   cd backend && npx ts-node scripts/swap-shadow-tables.ts --confirm
 */
import dotenv from 'dotenv'
dotenv.config()
import { readFileSync } from 'fs'
import { join } from 'path'
import pool from '../src/db/pool'

// Re-binds v_sales/v_rent/dubai_area_metrics to the new live tables + fixes
// sequence ownership. Run inside the swap txn so views never read _old.
const POST_SWAP_SQL = readFileSync(join(__dirname, '../src/db/dubai-post-swap-views.sql'), 'utf8')

const SAFETY_RATIO = 0.95 // shadow must have >= 95% of live rows IN THE SAME PERIOD
const BACKFILL_START = '2021-01-01' // shadow covers 2021+; live has older history we intentionally drop

async function count(t: string, where = ''): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${t} ${where}`)
  return Number(r.rows[0].n)
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.log('DRY RUN — pass --confirm to actually swap.')
  }
  const confirm = process.argv.includes('--confirm')

  const pairs = [
    { live: 'dld_transactions', shadow: 'dld_transactions_new', dateCol: 'instance_date' },
    { live: 'dld_rent_contracts', shadow: 'dld_rent_contracts_new', dateCol: 'start_date' },
  ]

  // Counts + guard — compare shadow to live FOR THE SAME PERIOD (2021+), since the
  // shadow is 5 years by design while live carries older 2019-2020 history.
  for (const p of pairs) {
    const liveTotal = await count(p.live)
    const livePeriod = await count(p.live, `WHERE ${p.dateCol} >= '${BACKFILL_START}'`)
    const shadowN = await count(p.shadow)
    const ratio = livePeriod ? shadowN / livePeriod : 1
    console.log(`${p.live}: live_total=${liveTotal.toLocaleString()} live_2021+=${livePeriod.toLocaleString()} shadow=${shadowN.toLocaleString()} (same-period ${(ratio * 100).toFixed(1)}%)`)
    if (shadowN === 0) throw new Error(`ABORT: ${p.shadow} is empty — backfill not done.`)
    if (ratio < SAFETY_RATIO) throw new Error(`ABORT: ${p.shadow} has only ${(ratio * 100).toFixed(1)}% of live 2021+ rows (< ${SAFETY_RATIO * 100}%). Backfill likely incomplete.`)
  }

  // 1. Bridge rent on the shadow table (denormalized dubai_area_id)
  const rb = await pool.query(`
    UPDATE dld_rent_contracts_new rc SET dubai_area_id = dla.dubai_area_id
      FROM dld_areas dla
     WHERE dla.area_id = rc.area_id AND dla.dubai_area_id IS NOT NULL`)
  console.log(`rent shadow bridged: ${rb.rowCount?.toLocaleString()} rows got dubai_area_id`)

  if (!confirm) {
    console.log('DRY RUN complete — counts/guards OK, rent bridged. Re-run with --confirm to swap.')
    await pool.end()
    return
  }

  // 2. Atomic rename swap + re-bind views (same txn)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const p of pairs) {
      await client.query(`ALTER TABLE ${p.live} RENAME TO ${p.live}_old`)
      await client.query(`ALTER TABLE ${p.shadow} RENAME TO ${p.live}`)
    }
    // ⚠️ Views bind by OID and FOLLOW the renamed table to *_old. Re-bind them to
    // the new live tables (+ fix sequence ownership) in the SAME txn, else the app
    // silently reads stale _old data. NEVER `DROP _old CASCADE` — it deletes the views.
    await client.query(POST_SWAP_SQL)
    await client.query('COMMIT')
    console.log('SWAP committed: live tables hold clean data.dubai data; views re-bound to live.')
  } catch (e) {
    await client.query('ROLLBACK')
    client.release()
    throw e
  }
  client.release()

  // Old tables are now unreferenced (views point at live) — safe to drop, no CASCADE.
  for (const p of pairs) {
    await pool.query(`DROP TABLE IF EXISTS ${p.live}_old`)
  }
  console.log('Dropped *_old tables.')

  // 3. Rebuild rolling metrics
  await pool.query(`DELETE FROM dubai_area_rolling_metrics WHERE period_end_month = DATE_TRUNC('month', CURRENT_DATE)`)
  const m = await pool.query(`SELECT calculate_area_rolling_metrics(CURRENT_DATE) AS n`)
  console.log(`metrics rebuilt: ${m.rows[0].n} area rows`)
  console.log('DONE. Views re-bound to live, *_old dropped, rolling metrics rebuilt.')
  await pool.end()
}
main().catch((e) => { console.error(e.message || e); process.exit(1) })
