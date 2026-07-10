/** 查某 Stripe customer 的订阅真实状态。用法:npx ts-node scripts/stripe-check-customer.ts cus_xxx */
import { config } from 'dotenv'
import Stripe from 'stripe'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

async function run() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) { console.log('❌ 本地 .env 没有 STRIPE_SECRET_KEY(key 在服务器容器)'); process.exit(0) }
  const stripe = new Stripe(key)
  const custId = process.argv[2] || 'cus_UqzCGCKArATUma'
  try {
    const cust = await stripe.customers.retrieve(custId)
    const c = cust as Stripe.Customer
    console.log(`customer: ${c.email} | livemode=${c.livemode} | deleted=${(cust as { deleted?: boolean }).deleted || false}`)
    const subs = await stripe.subscriptions.list({ customer: custId, status: 'all', limit: 20 })
    if (!subs.data.length) { console.log('subscriptions: (无 —— 只建了 customer,从未订阅)'); return }
    for (const s of subs.data) {
      const item = s.items.data[0]
      console.log(`  sub ${s.id} | status=${s.status} | price=${item?.price?.id} | created=${new Date(s.created * 1000).toISOString()}`)
    }
  } catch (e) {
    console.error('Stripe error:', (e as Error).message)
  }
}
run()
