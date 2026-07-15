/**
 * setup-referral-coupon — 幂等建好「被推荐人首月折扣券」。
 *
 *   npx ts-node scripts/setup-referral-coupon.ts
 *
 * 券:percent_off=20, duration=once(只抵首期)。id 固定 = REFERRED_FIRST_MONTH_20,
 * checkout 时按 id 挂券(services/referral.REFERRAL_COUPON_ID)。已存在则跳过,重复跑安全。
 *
 * ⚠️ 生产是 LIVE 模式,券必须在 **live** 建。本地 .env 若无 live key,在服务器容器里跑:
 *   docker cp ... && docker exec -w /app pinzos-api npx ts-node scripts/setup-referral-coupon.ts
 * 或从服务器取 key(同 map metering 的做法)。别把 live key 贴进聊天。
 */
import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.join(__dirname, '..', '.env') })

import Stripe from 'stripe'

const COUPON_ID = process.env.STRIPE_REFERRAL_COUPON || 'REFERRED_FIRST_MONTH_20'
const PERCENT_OFF = Number(process.env.REFERRAL_DISCOUNT_PERCENT || 20)

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY not set')
  const stripe = new Stripe(key)
  console.log(`Stripe mode: ${key.startsWith('sk_live') ? 'LIVE ⚠️' : 'test'}`)

  try {
    const existing = await stripe.coupons.retrieve(COUPON_ID)
    console.log(`✓ coupon already exists: ${existing.id} (${existing.percent_off}% off, ${existing.duration})`)
    if (existing.percent_off !== PERCENT_OFF) {
      // coupon 的 percent_off 不可改 —— 要变幅度得删了重建(改 id 或先 stripe.coupons.del)。
      console.warn(`  ⚠️ 现有券是 ${existing.percent_off}%,与目标 ${PERCENT_OFF}% 不一致。` +
        `Stripe 不允许改 coupon 折扣;要改请删除后重建或换 id。`)
    }
    return
  } catch {
    // 不存在 → 建
  }

  const coupon = await stripe.coupons.create({
    id: COUPON_ID,
    percent_off: PERCENT_OFF,
    duration: 'once',           // 只抵首期账单
    name: `Referred — first month ${PERCENT_OFF}% off`,
    metadata: { purpose: 'referral_referee_first_month' },
  })
  console.log(`✓ created coupon ${coupon.id}: ${coupon.percent_off}% off, ${coupon.duration}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
