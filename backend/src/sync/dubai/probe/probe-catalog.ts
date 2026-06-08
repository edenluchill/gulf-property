/** Try to find an enumeration/catalog endpoint (entity-only, list, metadata). */
import { getToken } from '../client/auth'
import { apiGet } from '../client/httpClient'
import { makeLogger } from '../observability/log'

const log = makeLogger('probe-catalog')

const PATHS = [
  '/open',
  '/open/dld',
  '/open/dld/',
  '/secure/ddads/openapi/1.0.0',
  '/secure/ddads/openapi/1.0.0/',
  '/secure/ddads/openapi/1.0.0/dld',
  '/secure/ddads/openapi/1.0.0/catalog',
  '/secure/ddads/openapi/1.0.0/datasets',
  '/secure/ddads/openapi/1.0.0/entities',
]

async function main(): Promise<void> {
  await getToken()
  for (const p of PATHS) {
    try {
      const data = await apiGet<any>(p, {})
      const preview = JSON.stringify(data).slice(0, 300)
      log.info(`✅ ${p} → ${preview}`)
    } catch (err: any) {
      log.warn(`❌ ${p} → ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 160)}`)
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
