/**
 * Phase-0 probe. Validates the pipeline end-to-end WITHOUT writing to the DB:
 *   1. get OAuth token (proves creds + UAE egress)
 *   2. health check
 *   3. if entity/dataset given: fetch 1 page, print column names + a sample row
 *   4. probe a few `filter` syntaxes (the incremental-sync linchpin)
 *
 * Reads the secret from process.env only — never prints it.
 */
import { getToken } from '../client/auth'
import { fetchPage } from '../client/dataApi'
import { apiGet } from '../client/httpClient'
import { getEnv } from '../config/env'
import { makeLogger } from '../observability/log'

const log = makeLogger('discover')

export async function discover(entity?: string, dataset?: string): Promise<void> {
  const env = getEnv()
  log.info(`base=${env.baseUrl}  appId=${env.appId.slice(0, 6)}…  proxy=${env.proxyUrl || '(direct)'}`)

  const token = await getToken()
  log.info(`✅ token OK (len=${token.length})`)

  try {
    const h = await apiGet('/secure/ddads/healthcheck/1.0.0/health', {})
    log.info('✅ health:', JSON.stringify(h))
  } catch (e: any) {
    log.warn('health check failed:', e.message)
  }

  if (!entity || !dataset) {
    log.info('No entity/dataset given — token + health validated.')
    log.info('Next: discover <entity> <dataset>  (after requesting that dataset on the portal)')
    return
  }

  log.info(`probing ${entity}/${dataset} …`)
  const { results } = await fetchPage(entity, dataset, { page: 1, pageSize: 5 })
  if (!results.length) {
    log.warn('0 rows returned (dataset empty, or access not granted yet).')
    return
  }
  log.info(`columns (${Object.keys(results[0]).length}): ${Object.keys(results[0]).join(', ')}`)
  log.info('sample row:\n' + JSON.stringify(results[0], null, 2))

  await probeFilter(entity, dataset, results[0])
}

async function probeFilter(entity: string, dataset: string, sample: any): Promise<void> {
  const col =
    ['load_timestamp', 'instance_date', 'contract_start_date'].find((c) => c in sample) ||
    Object.keys(sample)[0]
  const val = sample[col]
  log.info(`--- probing filter syntax on column "${col}" ---`)

  // PROD wants the value single-quoted: `col>'value'` (confirmed 2026-06-18).
  const candidates = [`${col}>'2000-01-01'`, `${col}>'${val}'`, `${col}>='2000-01-01'`, `${col}>2000-01-01`]
  for (const f of candidates) {
    try {
      const { results } = await fetchPage(entity, dataset, { filter: f, pageSize: 2 })
      log.info(`filter "${f}" → OK, ${results.length} rows`)
    } catch (e: any) {
      log.warn(`filter "${f}" → ${String(e.message).slice(0, 140)}`)
    }
  }
}
