/**
 * setup-stripe-portal — 配置 Stripe Billing Portal,让订阅自助管理闭环:
 *   1. 三档(rookie/agent/founder)月/年价互相升降级(改价即时按比例计费)
 *   2. 取消必须选原因 + 可留言 → webhook 把 cancellation_details 写进 plan_change_log
 *   3. 到期取消(cancel at period end),留挽回窗口
 *
 *   STRIPE_SECRET_KEY=... npx ts-node scripts/setup-stripe-portal.ts
 *
 * 幂等:更新默认 portal configuration(没有则创建)。price/product 映射读 DB。
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env') })

import Stripe from 'stripe'
import pool from '../src/db/pool'

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  const stripe = new Stripe(key)

  // DB 里的三档价格(月+年)→ 按 product 分组(portal 的 subscription_update 要求按 product 列 prices)
  const { rows } = await pool.query<{ id: string; m: string | null; y: string | null }>(
    `SELECT id, stripe_price_id AS m, stripe_price_id_year AS y
       FROM lt_subscription_plans WHERE id IN ('rookie','agent','founder')`
  )
  const byProduct = new Map<string, string[]>()
  for (const r of rows) {
    for (const priceId of [r.m, r.y].filter(Boolean) as string[]) {
      const price = await stripe.prices.retrieve(priceId)
      const product = typeof price.product === 'string' ? price.product : price.product.id
      if (!byProduct.has(product)) byProduct.set(product, [])
      byProduct.get(product)!.push(priceId)
    }
  }
  const products = [...byProduct.entries()].map(([product, prices]) => ({ product, prices }))
  console.log('portal products:', JSON.stringify(products, null, 2))

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      products,
      proration_behavior: 'create_prorations',
    },
    subscription_cancel: {
      enabled: true,
      mode: 'at_period_end', // 到期才停,留挽回窗口
      cancellation_reason: {
        enabled: true,
        options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'too_complex', 'low_quality', 'customer_service', 'other'],
      },
    },
  }

  const existing = await stripe.billingPortal.configurations.list({ limit: 10 })
  const target = process.env.STRIPE_PORTAL_CONFIG
    ? existing.data.find((c) => c.id === process.env.STRIPE_PORTAL_CONFIG)
    : existing.data.find((c) => c.is_default) || existing.data[0]

  if (target) {
    const updated = await stripe.billingPortal.configurations.update(target.id, { features })
    console.log(`✓ updated portal configuration ${updated.id} (default=${updated.is_default})`)
  } else {
    const created = await stripe.billingPortal.configurations.create({
      features,
      business_profile: { headline: 'Pinzos — 管理你的订阅' },
    })
    console.log(`✓ created portal configuration ${created.id}(如需指定,server compose 加 STRIPE_PORTAL_CONFIG=${created.id})`)
  }
  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
