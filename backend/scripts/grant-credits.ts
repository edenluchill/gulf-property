/**
 * 手动给某经纪本月发放/扣减积分。
 *
 * 用法:
 *   npx ts-node scripts/grant-credits.ts <email> <amount>   # +发放 / -扣减
 *   npx ts-node scripts/grant-credits.ts <email> reset       # 本月用量清零(等于满额)
 *   npx ts-node scripts/grant-credits.ts <email>             # 只查看当前用量/余额
 *
 * 例:npx ts-node scripts/grant-credits.ts shelldubai26@gmail.com 500
 *
 * 机制:积分余额 = 套餐月额度 − 本月已用(lt_usage_counters.credits_used)。
 * "发放 N 分" = 把本月已用减 N(允许为负 → 相当于超出套餐的额外额度),按月刷新。
 *
 * ⚠️ 这是发"定量"积分,只影响当月。要给某人"永久无限",改 src/luna-tour/credits.ts
 *    的 UNLIMITED_EMAILS 白名单并部署 API,而不是用这个脚本。
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })

async function run() {
  const email = process.argv[2]?.trim().toLowerCase()
  const amountArg = process.argv[3]?.trim()

  if (!email) {
    console.log('Usage: npx ts-node scripts/grant-credits.ts <email> <amount|reset>')
    console.log('  +发放:  ... shelldubai26@gmail.com 500')
    console.log('  -扣减:  ... shelldubai26@gmail.com -200')
    console.log('  清零:   ... shelldubai26@gmail.com reset')
    console.log('  查看:   ... shelldubai26@gmail.com')
    process.exit(1)
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })

  try {
    await client.connect()

    // 找 agent + 计费归属(席位成员扣 founder 的共享池)
    const a = await client.query<{ id: string; billing_agent_id: string | null }>(
      `SELECT id, billing_agent_id FROM lt_agents WHERE lower(email) = $1`,
      [email]
    )
    if (!a.rows[0]) {
      console.error(`❌ 找不到经纪:${email}(该邮箱还没成为 agent / 没登录过经纪台)`)
      process.exit(1)
    }
    const billingId = a.rows[0].billing_agent_id || a.rows[0].id

    // 当前套餐月额度
    const plan = await client.query<{ plan_id: string; credits_month: number | null }>(
      `SELECT s.plan_id, (p.limits->>'credits_month')::int AS credits_month
         FROM lt_subscriptions s JOIN lt_subscription_plans p ON p.id = s.plan_id
        WHERE s.agent_id = $1 AND s.status IN ('active','trialing')
        ORDER BY s.created_at DESC LIMIT 1`,
      [billingId]
    )
    const creditsMonth = Number(plan.rows[0]?.credits_month ?? 0)
    const planId = plan.rows[0]?.plan_id || 'explore'

    const show = async (note: string) => {
      const u = await client.query<{ used: number }>(
        `SELECT COALESCE(credits_used,0) AS used FROM lt_usage_counters
           WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
        [billingId]
      )
      const used = Number(u.rows[0]?.used ?? 0)
      console.log(`${note} | 套餐 ${planId}(月额 ${creditsMonth})| 本月已用 ${used} | 余额 ${creditsMonth - used}`)
    }

    if (!amountArg) {
      await show('📊 当前')
      return
    }

    // 应用变更
    if (amountArg.toLowerCase() === 'reset') {
      await client.query(
        `INSERT INTO lt_usage_counters (agent_id, period_month, credits_used)
           VALUES ($1, date_trunc('month', now())::date, 0)
         ON CONFLICT (agent_id, period_month) DO UPDATE SET credits_used = 0`,
        [billingId]
      )
      console.log(`✅ 已清零本月用量`)
    } else {
      const amount = Number(amountArg)
      if (!Number.isFinite(amount)) {
        console.error(`❌ amount 必须是数字或 reset,收到:${amountArg}`)
        process.exit(1)
      }
      // 发放 N 分 = 已用 − N(有行则更新,无行则以 −N 起始)
      const upd = await client.query(
        `UPDATE lt_usage_counters SET credits_used = credits_used - $2
           WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
        [billingId, amount]
      )
      if (!upd.rowCount) {
        await client.query(
          `INSERT INTO lt_usage_counters (agent_id, period_month, credits_used)
             VALUES ($1, date_trunc('month', now())::date, $2)`,
          [billingId, -amount]
        )
      }
      console.log(`✅ 已${amount >= 0 ? '发放' : '扣减'} ${Math.abs(amount)} 积分`)
    }

    await show('📊 现在')
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
