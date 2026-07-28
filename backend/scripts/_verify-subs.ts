import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })
import { getSubscribers, getSubscriptionSummary } from '../src/services/adminBizQueries'
;(async () => {
  const t = Date.now()
  const subs = await getSubscribers()
  const sum = await getSubscriptionSummary()
  console.log(`getSubscribers: ${subs.length} 行, ${Date.now() - t}ms`)
  console.log('summary:', JSON.stringify(sum, null, 1))
  const byRole: Record<string, number> = {}
  for (const s of subs) byRole[s.role || '?'] = (byRole[s.role || '?'] || 0) + 1
  console.log('按真实角色:', byRole)
  const failed = subs.filter(s => ['past_due','unpaid','incomplete'].includes(s.status))
  console.log('扣款失败:', failed.map(f => `${f.email} (${f.status})`))
  process.exit(0)
})()
