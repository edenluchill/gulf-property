/**
 * Re-fetch a date window for a DLD dataset, replacing it with no duplicates.
 *
 * Safe because the live table has a serial PK + non-unique business key (so
 * upsert can't be used). Strategy:
 *   1. Pull the fresh window from the API into a STAGING table (live untouched).
 *   2. Sanity-check the staged count vs what's live (abort if suspiciously low).
 *   3. In ONE transaction: DELETE the window from live + INSERT from staging.
 *   4. (rent) repopulate dubai_area_id via dld_areas.
 * If the pull fails/aborts, live is never modified.
 *
 *   cd backend && DUBAI_API_BASE_URL=https://apis.data.dubai \
 *     npx ts-node scripts/dubai-refetch-window.ts <transactions|rent> <from> <to>
 *   e.g. ... transactions 2025-06-17 2026-06-18
 */
import dotenv from 'dotenv'
dotenv.config()
import pool from '../src/db/pool'
import { iteratePages } from '../src/sync/dubai/client/dataApi'
import { applyFieldMap } from '../src/sync/dubai/core/transform'
import { DATASETS } from '../src/sync/dubai/config/datasets'

const TARGETS: Record<string, { key: string; dbDateCol: string; apiDateField: string; areaMatch?: boolean }> = {
  transactions: { key: 'dld_transactions', dbDateCol: 'instance_date', apiDateField: 'instance_date' },
  rent: { key: 'dld_rent_contracts', dbDateCol: 'start_date', apiDateField: 'contract_start_date', areaMatch: true },
}

async function main() {
  const [which, from, to] = process.argv.slice(2)
  const tgt = TARGETS[which]
  if (!tgt || !from || !to) throw new Error('usage: dubai-refetch-window <transactions|rent> <from YYYY-MM-DD> <to YYYY-MM-DD>')
  const cfg = DATASETS.find((d) => d.key === tgt.key)!
  const live = cfg.targetTable
  const cols = Object.keys(cfg.fieldMap)
  const stage = `_stage_${which}`
  const d10 = (v: unknown) => String(v ?? '').slice(0, 10)

  console.log(`[refetch] ${live}: window ${from}..${to}; cols=${cols.length}`)

  // 1. fresh staging table with the mapped columns' exact types, no rows.
  await pool.query(`DROP TABLE IF EXISTS ${stage}`)
  await pool.query(`CREATE TABLE ${stage} AS SELECT ${cols.join(',')} FROM ${live} WHERE false`)

  // 2. stream API window into staging.
  const base: any = { pageSize: 1000, order_by: tgt.apiDateField, order_dir: 'asc', filter: `${tgt.apiDateField}>='${from}'` }
  let staged = 0
  let done = false
  for await (const { page, results } of iteratePages(cfg.entity, cfg.dataset, base)) {
    const keep: any[] = []
    for (const r of results) {
      const dv = d10(r[tgt.apiDateField])
      if (dv > to) { done = true; continue }
      if (dv >= from) keep.push(applyFieldMap(r, cfg.fieldMap))
    }
    if (keep.length) {
      const values: any[] = []
      const tuples = keep.map((m, i) => {
        const ph = cols.map((_, j) => `$${i * cols.length + j + 1}`)
        cols.forEach((c) => values.push((m as any)[c] ?? null))
        return `(${ph.join(',')})`
      })
      await pool.query(`INSERT INTO ${stage} (${cols.join(',')}) VALUES ${tuples.join(',')}`, values)
      staged += keep.length
    }
    if (page % 20 === 0) console.log(`[refetch] staged ${staged}…`)
    if (done) break
  }

  // 3. sanity check against the existing window before any destructive write.
  const existing = Number(
    (await pool.query(`SELECT COUNT(*) AS n FROM ${live} WHERE ${tgt.dbDateCol} >= $1 AND ${tgt.dbDateCol} <= $2`, [from, to])).rows[0].n
  )
  console.log(`[refetch] staged=${staged}  existing_in_window=${existing}`)
  if (staged < 1000 || staged < existing * 0.8) {
    console.error(`[refetch] ABORT: staged (${staged}) too low vs existing (${existing}). Live untouched. Staging table ${stage} kept for inspection.`)
    process.exit(2)
  }

  // 4. atomic swap.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const del = await client.query(`DELETE FROM ${live} WHERE ${tgt.dbDateCol} >= $1 AND ${tgt.dbDateCol} <= $2`, [from, to])
    await client.query(`INSERT INTO ${live} (${cols.join(',')}) SELECT ${cols.join(',')} FROM ${stage}`)
    await client.query('COMMIT')
    console.log(`[refetch] swapped: deleted ${del.rowCount}, inserted ${staged}`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  await pool.query(`DROP TABLE IF EXISTS ${stage}`)

  // 5. rent: repopulate dubai_area_id for the fresh rows.
  if (tgt.areaMatch) {
    const upd = await pool.query(
      `UPDATE ${live} rc SET dubai_area_id = dla.dubai_area_id
         FROM dld_areas dla
        WHERE dla.area_id = rc.area_id
          AND rc.dubai_area_id IS NULL AND rc.area_id IS NOT NULL
          AND rc.${tgt.dbDateCol} >= $1 AND rc.${tgt.dbDateCol} <= $2`,
      [from, to]
    )
    console.log(`[refetch] dubai_area_id repopulated for ${upd.rowCount} rows`)
  }

  console.log('[refetch] done.')
  await pool.end()
}
main().catch((e) => { console.error(e?.response?.status, e?.message || e); process.exit(1) })
