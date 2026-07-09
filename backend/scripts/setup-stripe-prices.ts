/**
 * setup-stripe-prices — 幂等建好三档套餐的 Stripe product/price 并回填 DB。
 *
 *   npx ts-node scripts/setup-stripe-prices.ts
 *
 * 建/补:rookie 月$25·年$250、agent 月$99·年$990、founder 月$699·年$6990、
 * founder 加席 $49/月。价格全部回填 lt_subscription_plans 的
 * stripe_price_id / stripe_price_id_year / stripe_price_id_seat 列 —— 服务端
 * priceIdForPlan 以 env 优先、DB 回退,所以跑完这个脚本零新 env 即可售卖。
 * 已有值(env 或 DB)一律不动;重复跑安全。
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env') })

import Stripe from 'stripe'
import pool from '../src/db/pool'

const SEAT_USD_MONTH = 49

interface PlanRow {
  id: string
  name: string
  price_usd_month: string
  price_usd_year: string | null
  stripe_price_id: string | null
  stripe_price_id_year: string | null
  stripe_price_id_seat: string | null
}

/** 该 Stripe price 的美元金额(用于判断已配置的年付价是否 = 目标价)。 */
async function priceUsd(stripe: Stripe, priceId: string | null): Promise<number | null> {
  if (!priceId) return null
  try {
    const p = await stripe.prices.retrieve(priceId)
    return typeof p.unit_amount === 'number' ? p.unit_amount / 100 : null
  } catch {
    return null
  }
}

async function ensureProduct(stripe: Stripe, planId: string, name: string): Promise<string> {
  const found = await stripe.products.search({ query: `active:'true' AND metadata['plan_id']:'${planId}'` })
  if (found.data[0]) return found.data[0].id
  const p = await stripe.products.create({ name: `Pinzos ${name}`, metadata: { plan_id: planId } })
  console.log(`  + product ${p.id} (${name})`)
  return p.id
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  usd: number,
  interval: 'month' | 'year',
  tag: string
): Promise<string> {
  const existing = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  const hit = existing.data.find(
    (p) => p.recurring?.interval === interval && p.unit_amount === usd * 100 && p.currency === 'usd'
  )
  if (hit) return hit.id
  const price = await stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: usd * 100,
    recurring: { interval },
    nickname: tag,
  })
  console.log(`  + price ${price.id} (${tag}: $${usd}/${interval})`)
  return price.id
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set in backend/.env')
  const stripe = new Stripe(key)
  console.log(`Stripe mode: ${key.startsWith('sk_live') ? 'LIVE' : 'test'}`)

  const { rows } = await pool.query<PlanRow>(
    `SELECT id, name, COALESCE(price_usd_month,0) AS price_usd_month, price_usd_year,
            stripe_price_id, stripe_price_id_year, stripe_price_id_seat
       FROM lt_subscription_plans WHERE id IN ('rookie','agent','founder','developer')`
  )

  for (const plan of rows) {
    const usd = Number(plan.price_usd_month)
    // 年付价:DB 显式列优先(rookie=249),否则 month×10(送 2 个月)
    const yearUsd = plan.price_usd_year != null ? Number(plan.price_usd_year) : usd * 10
    console.log(`\n[${plan.id}] $${usd}/mo · $${yearUsd}/yr`)
    const envMonth = process.env[`STRIPE_PRICE_${plan.id.toUpperCase()}`]
    const envYear = process.env[`STRIPE_PRICE_${plan.id.toUpperCase()}_Y`]
    if (envMonth) {
      console.warn(`  ⚠ STRIPE_PRICE_${plan.id.toUpperCase()} 环境变量已设,月付价由 env 决定,DB/脚本改价不生效——改价请改 env 后重启`)
    }
    if (envYear) {
      console.warn(`  ⚠ STRIPE_PRICE_${plan.id.toUpperCase()}_Y 环境变量已设,年付价由 env 决定,DB/脚本改价不生效——改价请改 env 后重启`)
    }
    // 月付/年付:若未配置,或已配置但金额 ≠ 目标价(改价),则重新对齐
    const currentMonthUsd = await priceUsd(stripe, plan.stripe_price_id)
    const needMonth = !envMonth && (!plan.stripe_price_id || currentMonthUsd !== usd)
    const currentYearUsd = await priceUsd(stripe, plan.stripe_price_id_year)
    const needYear = !envYear && (!plan.stripe_price_id_year || currentYearUsd !== yearUsd)
    const needSeat = plan.id === 'founder' && !process.env.STRIPE_PRICE_FOUNDER_SEAT && !plan.stripe_price_id_seat
    if (!needMonth && !needYear && !needSeat) {
      console.log('  already configured (env/DB) — skip')
      continue
    }
    const productId = await ensureProduct(stripe, plan.id, plan.name)
    if (needMonth) {
      // 改价时:Stripe price 不可改金额,新建目标价 price 并把 DB 指过去
      // (旧 price 自动 archive 不影响已订阅老用户,新订阅走新价)。
      if (currentMonthUsd != null && currentMonthUsd !== usd) {
        console.log(`  ↻ 月付改价 $${currentMonthUsd} → $${usd},新建 price`)
      }
      const id = await ensurePrice(stripe, productId, usd, 'month', `${plan.id}-month`)
      await pool.query(`UPDATE lt_subscription_plans SET stripe_price_id = $2 WHERE id = $1`, [plan.id, id])
      console.log(`  ✓ stripe_price_id = ${id}`)
    }
    if (needYear) {
      // 改价时:Stripe price 不可改金额,新建一个目标价的 price 并把 DB 指过去
      // (旧 price 自动 archive 不影响已订阅老用户,新订阅走新价)。
      if (currentYearUsd != null && currentYearUsd !== yearUsd) {
        console.log(`  ↻ 年付改价 $${currentYearUsd} → $${yearUsd},新建 price`)
      }
      const id = await ensurePrice(stripe, productId, yearUsd, 'year', `${plan.id}-year`)
      await pool.query(`UPDATE lt_subscription_plans SET stripe_price_id_year = $2 WHERE id = $1`, [plan.id, id])
      console.log(`  ✓ stripe_price_id_year = ${id}`)
    }
    if (needSeat) {
      const seatProduct = await ensureProduct(stripe, 'founder_seat', 'Founder 加席')
      const id = await ensurePrice(stripe, seatProduct, SEAT_USD_MONTH, 'month', 'founder-seat')
      await pool.query(`UPDATE lt_subscription_plans SET stripe_price_id_seat = $1 WHERE id = 'founder'`, [id])
      console.log(`  ✓ stripe_price_id_seat = ${id}`)
    }
  }

  const check = await pool.query(
    `SELECT id, stripe_price_id, stripe_price_id_year, stripe_price_id_seat
       FROM lt_subscription_plans WHERE id IN ('rookie','agent','founder','developer') ORDER BY price_usd_month`
  )
  console.log('\nFinal mapping:')
  console.table(check.rows)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
