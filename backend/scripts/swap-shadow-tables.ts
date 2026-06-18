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
import pool from '../src/db/pool'

const SAFETY_RATIO = 0.9 // shadow must have >= 90% of live row count

async function count(t: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${t}`)
  return Number(r.rows[0].n)
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.log('DRY RUN — pass --confirm to actually swap.')
  }
  const confirm = process.argv.includes('--confirm')

  const pairs = [
    { live: 'dld_transactions', shadow: 'dld_transactions_new' },
    { live: 'dld_rent_contracts', shadow: 'dld_rent_contracts_new' },
  ]

  // Counts + guard
  for (const p of pairs) {
    const [liveN, shadowN] = [await count(p.live), await count(p.shadow)]
    const ratio = liveN ? shadowN / liveN : 1
    console.log(`${p.live}: live=${liveN.toLocaleString()} shadow=${shadowN.toLocaleString()} (${(ratio * 100).toFixed(1)}%)`)
    if (shadowN === 0) throw new Error(`ABORT: ${p.shadow} is empty — backfill not done.`)
    if (ratio < SAFETY_RATIO) throw new Error(`ABORT: ${p.shadow} has only ${(ratio * 100).toFixed(1)}% of live rows (< ${SAFETY_RATIO * 100}%). Backfill likely incomplete.`)
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

  // 2. Atomic rename swap
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const p of pairs) {
      await client.query(`DROP TABLE IF EXISTS ${p.live}_old CASCADE`)
      await client.query(`ALTER TABLE ${p.live} RENAME TO ${p.live}_old`)
      await client.query(`ALTER TABLE ${p.shadow} RENAME TO ${p.live}`)
    }
    await client.query('COMMIT')
    console.log('SWAP committed: live tables now hold the clean data.dubai data; old kept as *_old.')
  } catch (e) {
    await client.query('ROLLBACK')
    client.release()
    throw e
  }
  client.release()

  // 3. Rebuild rolling metrics
  await pool.query(`DELETE FROM dubai_area_rolling_metrics WHERE period_end_month = DATE_TRUNC('month', CURRENT_DATE)`)
  const m = await pool.query(`SELECT calculate_area_rolling_metrics(CURRENT_DATE) AS n`)
  console.log(`metrics rebuilt: ${m.rows[0].n} area rows`)
  console.log('DONE. Verify the app, then: DROP TABLE dld_transactions_old, dld_rent_contracts_old;')
  await pool.end()
}
main().catch((e) => { console.error(e.message || e); process.exit(1) })
