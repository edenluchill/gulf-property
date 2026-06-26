/**
 * Weekly reference-data refresh — runs on the UAE box (systemd timer, Sundays).
 * These datasets change slowly (projects progress, service charges, valuations),
 * so a full atomic replace once a week is plenty (no need for the daily window job).
 *
 *   npx ts-node --transpile-only scripts/dubai-weekly.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'
import { applyFieldMap } from '../src/sync/dubai/core/transform'
import { DATASETS } from '../src/sync/dubai/config/datasets'

// Slow-moving datasets to full-replace weekly. Add more keys here (they must be
// in DATASETS with a matching target table) to extend coverage.
const WEEKLY = ['dld_valuations', 'dld_projects', 'dld_oa_service_charges']

async function fullReplace(key: string) {
  const ds = DATASETS.find((d) => d.key === key)
  if (!ds) { console.warn(`[weekly] no dataset config for ${key}, skip`); return }
  const cols = Object.keys(ds.fieldMap)
  const client = await pool.connect()
  let inserted = 0
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${ds.targetTable}`)
    // Pull the whole dataset (every row has load_timestamp; >'2000' = all).
    const base: any = { pageSize: 1000, order_by: 'load_timestamp', order_dir: 'asc', filter: `load_timestamp>'2000-01-01'` }
    for await (const { results } of iteratePages(ds.entity, ds.dataset, base)) {
      const mapped = results.map((r) => applyFieldMap(r, ds.fieldMap))
      if (!mapped.length) continue
      const vals: any[] = []
      const tuples = mapped.map((m, i) => {
        const b = i * cols.length
        cols.forEach((c) => vals.push((m as any)[c] ?? null))
        return `(${cols.map((_, j) => `$${b + j + 1}`).join(',')})`
      })
      await client.query(`INSERT INTO ${ds.targetTable} (${cols.join(',')}) VALUES ${tuples.join(',')}`, vals)
      inserted += mapped.length
    }
    await client.query('COMMIT')
    console.log(`[weekly] ${ds.targetTable}: replaced with ${inserted} rows`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`[weekly] ${ds.targetTable} FAILED (rolled back, old data kept):`, e instanceof Error ? e.message : e)
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  console.log(`[weekly] start @ ${new Date().toISOString()}`)
  let failed = 0
  for (const key of WEEKLY) {
    try { await fullReplace(key) } catch { failed++ }
  }
  console.log(`[weekly] done (${WEEKLY.length - failed}/${WEEKLY.length} ok).`)
  await pool.end()
  if (failed) process.exit(1)
}
main().catch((e) => { console.error('[weekly] FATAL', e?.message || e); process.exit(1) })
