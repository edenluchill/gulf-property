/** STG 数据真实性/新鲜度探测:看最新和最早的成交日期 + 样本。 */
import { fetchPage } from '../client/dataApi'
import { makeLogger } from '../observability/log'
const log = makeLogger('freshness')

async function main() {
  const latest = await fetchPage('dld', 'dld_transactions-open-api',
    { pageSize: 5, order_by: 'instance_date', order_dir: 'desc' } as any)
  log.info('=== 最新 5 笔(desc) ===')
  for (const r of latest.results) {
    log.info(`${r.instance_date} | ${r.area_name_en} | ${r.property_type_en} ${r.rooms_en ?? ''} | ${r.actual_worth} AED | load=${r.load_timestamp}`)
  }
  const oldest = await fetchPage('dld', 'dld_transactions-open-api',
    { pageSize: 3, order_by: 'instance_date', order_dir: 'asc' } as any)
  log.info('=== 最早 3 笔(asc) ===')
  for (const r of oldest.results) {
    log.info(`${r.instance_date} | ${r.area_name_en} | ${r.actual_worth} AED`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
