/**
 * 后台「积分」列 vs 真实扣费口径 —— 对账。
 *
 * 后台显示的额度/已用,必须和**真正扣费时用的那套逻辑**(luna-tour/credits.ts 的
 * planFor + usedFor)完全一致。不一致 = 后台在给 owner 看假账。
 *
 * 曾经踩的坑:后台一律把额度显示成套餐月额 → 7 天自助试用(trial_credits IS NULL,
 * 实际只有 200 分)被显示成 0/1200,看起来像人人都拿了 Pro 满额。
 *
 * 运行:cd backend && npx ts-node -T scripts/verify-credit-display.ts (只读,不改数据)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'
import { getSubscribers } from '../src/services/adminBizQueries'
import { creditBalance } from '../src/luna-tour/credits'

async function run() {
  const subs = (await getSubscribers()).filter((s) => s.status !== 'none')
  let bad = 0

  console.log(`对账 ${subs.length} 个生效订阅(后台显示 vs 真实扣费口径):\n`)
  for (const s of subs) {
    // 真相 = 扣费时实际调用的那个函数
    const truth = await creditBalance(s.agent_id)
    // owner/无限额度账号(creditsMonth = -1)后台也显示 -1 → 一致,不算错。
    const okLimit = s.credits_month === truth.creditsMonth
    const okUsed = s.credits_used === truth.used
    if (!okLimit || !okUsed) bad++
    const mark = okLimit && okUsed ? '✓' : '✗'
    console.log(
      `  ${mark} ${(s.email || '?').padEnd(30)} 后台 ${s.credits_used}/${s.credits_month}` +
      (okLimit && okUsed ? '' : `   ← 真实扣费口径是 ${truth.used}/${truth.creditsMonth}`)
    )
  }

  console.log(`\n${bad === 0 ? '✅ 后台显示与扣费口径完全一致' : `❌ ${bad} 个账号显示的是假账`}`)
  await pool.end()
  process.exit(bad === 0 ? 0 : 1)
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
