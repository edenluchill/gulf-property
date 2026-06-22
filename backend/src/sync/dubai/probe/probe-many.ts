/**
 * Batch reachability probe — confirm which data.dubai datasets are pullable on
 * PROD right now. For each slug: fetch 1 row, print column count + a few sample
 * fields, or the error. Run from a UAE egress (box or DUBAI_API_PROXY_URL).
 *
 *   npx ts-node src/sync/dubai/probe/probe-many.ts
 *
 * Edit SLUGS to test more. Read-only — never writes the DB.
 */
import { fetchPage } from '../client/dataApi'

// [entity, dataset]. Mostly dld (granted by default); a few other entities to
// see if they're authorized yet.
const SLUGS: [string, string][] = [
  ['dld', 'dld_units-open-api'],                 // unit registry — supply/inventory
  ['dld', 'dld_developers-open-api'],            // developer + license — due diligence
  ['dld', 'dld_projects-open-api'],              // projects (under-construction/handover) — was 422 on STG
  ['dld', 'dld_buildings-open-api'],             // buildings — was 422
  ['dld', 'dld_land_registry-open-api'],         // land registry — was 422
  ['dld', 'dld_oa_service_charges-open-api'],    // service charges — CONFIRMED
  ['dld', 'dld_rent_index-open-api'],            // RERA rent index (guess)
  ['dld', 'rera_rent_index-open-api'],           // RERA rent index (guess)
  ['dld', 'dld_oqood-open-api'],                 // off-plan Oqood contracts (guess)
  ['dld', 'dld_mortgaged_properties-open-api'],  // mortgages (guess)
  ['dld', 'dld_master_projects-open-api'],       // master projects (guess)
  ['dld', 'dld_escrow_accounts-open-api'],       // developer escrow accounts (guess)
  ['dld', 'dld_real_estate_permits-open-api'],   // ad/exhibition permits
  ['dsc', 'dsc_population-open-api'],             // population stats (likely needs grant)
  ['rta', 'rta_metro_stations-open-api'],        // metro stations (likely needs grant)
]

async function main() {
  for (const [entity, dataset] of SLUGS) {
    try {
      const { results } = await fetchPage(entity, dataset, { page: 1, pageSize: 1 })
      if (!results.length) {
        console.log(`⚪ ${entity}/${dataset} → 200 but 0 rows (empty or not granted)`)
        continue
      }
      const cols = Object.keys(results[0])
      const sample = cols.slice(0, 6).map((k) => `${k}=${JSON.stringify(results[0][k])}`).join(', ')
      console.log(`✅ ${entity}/${dataset} (${cols.length} cols)`)
      console.log(`     cols: ${cols.join(', ')}`)
      console.log(`     sample: ${sample}`)
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 120)
      console.log(`❌ ${entity}/${dataset} → ${msg}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1) })
