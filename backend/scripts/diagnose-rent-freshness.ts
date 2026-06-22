/**
 * Why is dld_rent_contracts stale? Compare the live table's max load_timestamp
 * to what the data.dubai SOURCE currently has. If the source has newer rows, the
 * VPS rebuild/sync failed to pull them (we can catch up). If not, the source
 * itself hasn't published newer data. Run from a UAE egress.
 */
import dotenv from 'dotenv'
dotenv.config()
import { fetchPage } from '../src/sync/dubai/client/dataApi'
import pool from '../src/db/pool'

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

async function main(): Promise<void> {
  const live = await pool.query('SELECT max(load_timestamp) AS m, max(start_date) AS sd FROM dld_rent_contracts')
  const liveMax: Date = live.rows[0].m
  console.log('live rent: max load_timestamp =', liveMax?.toISOString(), ' max start_date =', live.rows[0].sd?.toISOString())

  // How many SOURCE rows have load_timestamp strictly newer than our live max?
  const filter = `load_timestamp>'${fmt(liveMax)}'`
  const { results } = await fetchPage('dld', 'dld_rent_contracts-open-api', { filter, pageSize: 1000 })
  const newerDates = results.map((r) => r.load_timestamp).filter(Boolean).sort()
  console.log(`SOURCE rows newer than live (page of up to 1000): ${results.length}`)
  if (newerDates.length) {
    console.log('  newest few load_timestamps in source:', newerDates.slice(-5))
    console.log('  → SOURCE HAS NEWER DATA: VPS rebuild/sync did not pull it. Catch-up needed.')
  } else {
    console.log('  → source has nothing newer; the rent dataset itself has not advanced past live.')
  }
  await pool.end()
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1) })
