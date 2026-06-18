/**
 * One-off catch-up: pull DLD transactions newer than what's in the DB and
 * INSERT them (additive, no overlap → no dupes). Bridges the gap between the
 * bulk-CSV cutoff and the API's latest, without depending on the upsert sink
 * (the bulk-CSV table has a serial PK + non-unique transaction_id, so
 * ON CONFLICT can't be used). Re-runnable: only pulls instance_date > current max.
 *
 *   cd backend && DUBAI_API_BASE_URL=https://apis.data.dubai npx ts-node scripts/dubai-catchup-transactions.ts
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'
import { applyFieldMap } from '../src/sync/dubai/core/transform'
import { DATASETS } from '../src/sync/dubai/config/datasets'

async function main() {
  const cfg = DATASETS.find((d) => d.key === 'dld_transactions')
  if (!cfg) throw new Error('dld_transactions config not found')

  const { rows } = await pool.query("SELECT to_char(MAX(instance_date),'YYYY-MM-DD') AS max FROM dld_transactions")
  const since = rows[0]?.max
  if (!since) throw new Error('could not read current max instance_date')
  console.log(`[catchup] current max instance_date = ${since}; pulling instance_date > '${since}'`)

  const base: any = { pageSize: 1000, order_by: 'instance_date', order_dir: 'asc', filter: `instance_date>'${since}'` }
  let inserted = 0
  for await (const { page, results } of iteratePages(cfg.entity, cfg.dataset, base)) {
    const mapped = results.map((r) => applyFieldMap(r, cfg.fieldMap))
    if (mapped.length === 0) continue
    const cols = Object.keys(mapped[0])
    const values: any[] = []
    const tuples = mapped.map((m, i) => {
      const ph = cols.map((_, j) => `$${i * cols.length + j + 1}`)
      cols.forEach((c) => values.push((m as any)[c] ?? null))
      return `(${ph.join(',')})`
    })
    await pool.query(`INSERT INTO dld_transactions (${cols.join(',')}) VALUES ${tuples.join(',')}`, values)
    inserted += mapped.length
    console.log(`[catchup] page ${page}: +${mapped.length} (total ${inserted})`)
  }
  console.log(`[catchup] done. inserted ${inserted} new transactions.`)
  await pool.end()
}
main().catch((e) => { console.error(e?.response?.status, e?.message || e); process.exit(1) })
