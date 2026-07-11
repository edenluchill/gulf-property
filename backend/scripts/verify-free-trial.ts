/**
 * 免绑卡试用生命周期验收 (2026-07-11) — 一次性脚本,跑完自清理。
 *
 * 在真库上用一个临时 agent 走一遍:开试用 → 拿到 Pro 功能门 + 200 积分 →
 * 花掉积分 → 余额门拦住 → 到期回落 explore → sweep 翻状态 → 转化清零积分。
 * 每一步都断言,任何一条不成立就抛错。finally 里删掉所有痕迹。
 *
 * 跑法: cd backend && npx ts-node scripts/_verify-free-trial.ts
 */
import pool from '../src/db/pool'
import { checkCredits, spend, creditBalance, resetCreditsOnConversion } from '../src/luna-tour/credits'
import { expireFreeTrials } from '../src/services/freeTrialSweep'

const EMAIL = `_trialtest_${Date.now()}@example.invalid`
let agentId = ''
let failures = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`) } else { failures++; console.error(`  ✗ ${name} ${detail}`) }
}

async function main() {
  // 建临时 agent
  const a = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1,'trial test') RETURNING id`, [EMAIL]
  )
  agentId = a.rows[0].id
  console.log(`临时 agent: ${agentId}\n`)

  // ── 1) 开试用前:explore,付费功能全被拦 ──────────────────
  console.log('1) 试用前(explore)')
  let c = await checkCredits(agentId, 'reports')
  check('未订阅 → 报告被拦', !c.allowed && c.reason === 'subscription_required', JSON.stringify(c))

  // ── 2) 开试用(模拟 POST /trial/start 的写入)────────────
  console.log('\n2) 开通免绑卡试用')
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
       VALUES ($1,'agent','trialing','free_trial', now() + interval '7 days')`, [agentId]
  )
  const bal = await creditBalance(agentId)
  check('积分池 = 200(不是 Pro 的 1200)', bal.creditsMonth === 200, `实得 ${bal.creditsMonth}`)
  check('标记为 freeTrial', bal.freeTrial === true)

  c = await checkCredits(agentId, 'reports')
  check('报告(minPlan=rookie)解锁', c.allowed)
  c = await checkCredits(agentId, 'luna_tours')
  check('Luna 导览(minPlan=agent)也解锁 ← 试用给 Pro 功能门', c.allowed, JSON.stringify(c))
  c = await checkCredits(agentId, 'live_tours')
  check('实时带看(minPlan=agent)也解锁', c.allowed)

  // ── 3) 花积分 → 余额门 ──────────────────────────────────
  console.log('\n3) 烧积分直到余额不足')
  await spend(agentId, 'luna_tours')  // 100
  await spend(agentId, 'luna_tours')  // 100 → 用满 200
  const after = await creditBalance(agentId)
  check('余额归零', after.balance === 0, `余额 ${after.balance}`)
  c = await checkCredits(agentId, 'reports')
  check('积分耗尽 → 402 insufficient', !c.allowed && c.reason === 'insufficient')
  check('402 带 freeTrial 标记(文案要说"订阅即恢复")', c.freeTrial === true)

  // ── 4) 转化:付费清零试用消耗 ────────────────────────────
  console.log('\n4) 试用 → 付费转化')
  await resetCreditsOnConversion(agentId)
  const led = await pool.query<{ credits: number }>(
    `SELECT credits FROM lt_credit_ledger WHERE agent_id=$1 AND feature='trial_reset'`, [agentId]
  )
  check('写了负数补偿流水(不抹历史)', led.rows[0]?.credits === -200, JSON.stringify(led.rows))
  const afterReset = await creditBalance(agentId)
  check('积分池已刷新', afterReset.used === 0 && afterReset.balance === 200, JSON.stringify(afterReset))

  // ── 5) 到期回落 ─────────────────────────────────────────
  console.log('\n5) 试用到期')
  await pool.query(
    `UPDATE lt_subscriptions SET current_period_end = now() - interval '1 minute'
      WHERE agent_id=$1 AND source='free_trial'`, [agentId]
  )
  const expired = await creditBalance(agentId)
  check('过期即回落 explore(惰性判定,不等 sweep)', expired.plan === 'explore', `plan=${expired.plan}`)
  c = await checkCredits(agentId, 'reports')
  check('过期后功能重新上锁', !c.allowed && c.reason === 'subscription_required')

  // sweep 把状态翻成 canceled(让所有其它读取方也看到真状态)
  await expireFreeTrials()
  const swept = await pool.query<{ status: string }>(
    `SELECT status FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [agentId]
  )
  check('sweep 把 DB 状态翻成 canceled', swept.rows[0]?.status === 'canceled', `status=${swept.rows[0]?.status}`)
  const logged = await pool.query(
    `SELECT 1 FROM plan_change_log WHERE agent_id=$1 AND action='free_trial_expired'`, [agentId]
  )
  check('记了 free_trial_expired 审计', logged.rows.length === 1)

  // ── 6) 回归:comp 终身账户绝不能被 sweep 干掉 ────────────
  console.log('\n6) 回归 — 后台 comp 授予的终身账户不受影响')
  const comp = await pool.query<{ status: string }>(
    `SELECT status FROM lt_subscriptions WHERE source='comp' AND status='active'`
  )
  check('两个 comp 终身账户仍是 active', comp.rows.length === 2, `找到 ${comp.rows.length} 行`)
}

main()
  .catch((e) => { failures++; console.error('\n脚本异常:', e) })
  .finally(async () => {
    if (agentId) {
      await pool.query(`DELETE FROM lt_credit_ledger WHERE agent_id=$1`, [agentId])
      await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id=$1`, [agentId])
      await pool.query(`DELETE FROM plan_change_log WHERE agent_id=$1`, [agentId])
      await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id=$1`, [agentId])
      await pool.query(`DELETE FROM lt_agents WHERE id=$1`, [agentId])
      console.log('\n已清理临时数据')
    }
    await pool.end()
    console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`)
    process.exit(failures === 0 ? 0 : 1)
  })
