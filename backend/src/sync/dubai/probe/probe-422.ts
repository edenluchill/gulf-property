/** Debug the 422 datasets: try different query params, print full error. */
import { getToken } from '../client/auth'
import { fetchPage } from '../client/dataApi'
import { makeLogger } from '../observability/log'

const log = makeLogger('probe-422')

const TARGETS = [
  'dld_projects-open-api',
  'dld_buildings-open-api',
  'dld_land_registry-open-api',
  'dld_oa_service_charges-open-api',
]

const PARAM_SETS: [string, any][] = [
  ['no-params', {}],
  ['limit=2', { limit: 2 }],
  ['page=1 only', { page: 1 }],
  ['pageSize=1', { pageSize: 1 }],
]

async function main(): Promise<void> {
  await getToken()
  for (const ds of TARGETS) {
    log.info(`\n=== ${ds} ===`)
    for (const [label, params] of PARAM_SETS) {
      try {
        const { results } = await fetchPage('dld', ds, params)
        const cols = results[0] ? Object.keys(results[0]) : []
        log.info(`  ✅ ${label} → ${results.length} rows | cols(${cols.length}): ${cols.slice(0, 8).join(', ')}…`)
        break // found a working param set; move on
      } catch (err: any) {
        log.warn(`  ❌ ${label} → ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 220)}`)
      }
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
