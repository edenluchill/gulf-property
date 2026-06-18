/**
 * Clean data.dubai backfill into the shadow tables (dld_*_new), month by month,
 * newest first. Designed to run on the UAE box (direct API, no proxy) over days;
 * resumable (each month = delete-window + insert, idempotent). Logs progress to
 * sync_backfill_progress so it can be monitored / resumed.
 *
 *   DUBAI_API_BASE_URL=https://apis.data.dubai npx ts-node scripts/dubai-backfill.ts <transactions|rent> <fromYYYY-MM> <toYYYY-MM>
 *   e.g. ... transactions 2021-01 2026-06   (loops 2026-06 down to 2021-01)
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'
import { applyFieldMap } from '../src/sync/dubai/core/transform'
import { DATASETS } from '../src/sync/dubai/config/datasets'

const CFG: Record<string, { key: string; table: string; apiDate: string }> = {
  transactions: { key: 'dld_transactions', table: 'dld_transactions_new', apiDate: 'instance_date' },
  rent: { key: 'dld_rent_contracts', table: 'dld_rent_contracts_new', apiDate: 'contract_start_date' },
}

function monthsDesc(fromYM: string, toYM: string): string[] {
  const out: string[] = []
  const [fy, fm] = fromYM.split('-').map(Number)
  const [ty, tm] = toYM.split('-').map(Number)
  let y = ty, m = tm
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m--; if (m === 0) { m = 12; y-- }
  }
  return out
}
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

async function main() {
  const [which, fromYM, toYM] = process.argv.slice(2)
  const c = CFG[which]
  if (!c || !fromYM || !toYM) throw new Error('usage: dubai-backfill <transactions|rent> <fromYYYY-MM> <toYYYY-MM>')
  const ds = DATASETS.find((d) => d.key === c.key)!
  const cols = Object.keys(ds.fieldMap)

  await pool.query(`CREATE TABLE IF NOT EXISTS sync_backfill_progress (
    dataset TEXT, month TEXT, rows INTEGER, done_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (dataset, month))`)

  const months = monthsDesc(fromYM, toYM)
  console.log(`[backfill] ${c.table}: ${months.length} months ${toYM}..${fromYM}`)

  for (const ym of months) {
    const from = `${ym}-01`, to = monthEnd(ym)
    // skip if already done (resumable)
    const seen = await pool.query(`SELECT rows FROM sync_backfill_progress WHERE dataset=$1 AND month=$2`, [which, ym])
    if (seen.rows[0]) { console.log(`[backfill] ${ym} already done (${seen.rows[0].rows}), skip`); continue }

    const dbCol = which === 'transactions' ? 'instance_date' : 'start_date'
    await pool.query(`DELETE FROM ${c.table} WHERE ${dbCol} >= $1 AND ${dbCol} < $2`, [from, to])

    const base: any = { pageSize: 1000, order_by: c.apiDate, order_dir: 'asc', filter: `${c.apiDate}>='${from}' and ${c.apiDate}<'${to}'` }
    let inserted = 0
    for await (const { results } of iteratePages(ds.entity, ds.dataset, base)) {
      const mapped = results.map((r) => applyFieldMap(r, ds.fieldMap))
      if (!mapped.length) continue
      const vals: any[] = []
      const tuples = mapped.map((m, i) => {
        const b = i * cols.length
        cols.forEach((col) => vals.push((m as any)[col] ?? null))
        return `(${cols.map((_, j) => `$${b + j + 1}`).join(',')})`
      })
      await pool.query(`INSERT INTO ${c.table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, vals)
      inserted += mapped.length
    }
    await pool.query(`INSERT INTO sync_backfill_progress (dataset,month,rows) VALUES ($1,$2,$3)
      ON CONFLICT (dataset,month) DO UPDATE SET rows=EXCLUDED.rows, done_at=now()`, [which, ym, inserted])
    console.log(`[backfill] ${ym}: +${inserted}`)
  }
  console.log('[backfill] done.')
  await pool.end()
}
main().catch((e) => { console.error(e?.response?.status, e?.message || e); process.exit(1) })
