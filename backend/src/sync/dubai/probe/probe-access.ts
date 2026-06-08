/**
 * One-off: probe which datasets the current credentials can actually call.
 * There is no catalog endpoint — we test candidate slugs and classify the result.
 *   npx ts-node src/sync/dubai/probe/probe-access.ts
 */
import { getToken } from '../client/auth'
import { fetchPage } from '../client/dataApi'
import { makeLogger } from '../observability/log'

const log = makeLogger('probe-access')

// [entity, dataset] candidates — exhaustive sweep round 3.
const CANDIDATES: [string, string][] = [
  // high-value real-estate guesses
  ['dld', 'dld_oqood-open-api'],
  ['dld', 'dld_real_estate_data-open-api'],
  ['dld', 'dld_rent_index-open-api'],
  ['dld', 'dld_real_estate_index-open-api'],
  ['dld', 'dld_mortgaged_properties-open-api'],
  ['dld', 'dld_areas-open-api'],
  ['dld', 'dld_parcels-open-api'],
  ['dld', 'dld_zones-open-api'],
  ['dld', 'dld_master_projects-open-api'],
  ['dld', 'dld_escrow_accounts-open-api'],
  ['dld', 'dld_sell_permits-open-api'],
  ['dld', 'dld_advertisement_permits-open-api'],
  ['dld', 'dld_real_estate_advertisements-open-api'],
  ['dld', 'dld_accredited_valuators-open-api'],
  ['dld', 'dld_oa_companies-open-api'],
  ['dld', 'dld_owner_associations-open-api'],
  ['dld', 'dld_licensed_activities-open-api'],
  ['dld', 'dld_services-open-api'],
  // cross-entity high-value (rent index / population / transport)
  ['rera', 'rera_rent_index-open-api'],
  ['rera', 'rent_index-openapi'],
  ['dsc', 'dsc_population-openapi'],
  ['dsc', 'dsc_population-open-api'],
  ['dm', 'dm_building_permits-openapi'],
  ['rta', 'rta_metro_stations-openapi'],
]

async function main(): Promise<void> {
  await getToken()
  log.info(`probing ${CANDIDATES.length} candidate datasets…\n`)
  const ok: string[] = []
  const no: string[] = []
  for (const [e, d] of CANDIDATES) {
    try {
      const { results } = await fetchPage(e, d, { pageSize: 2 })
      const cols = results[0] ? Object.keys(results[0]) : []
      log.info(`✅ ${e}/${d} → ${results.length} rows | cols(${cols.length}): ${cols.join(', ') || '(empty)'}`)
      ok.push(`${e}/${d}`)
    } catch (err: any) {
      const m = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 140)
      log.warn(`❌ ${e}/${d} → ${m}`)
      no.push(`${e}/${d}`)
    }
  }
  log.info(`\n=== SUMMARY ===`)
  log.info(`ACCESSIBLE (${ok.length}): ${ok.join('  ') || '(none)'}`)
  log.info(`NOT (${no.length}): ${no.join('  ')}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
