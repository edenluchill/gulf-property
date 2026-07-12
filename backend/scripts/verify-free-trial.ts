/**
 * 试用体系回归测试 (2026-07-11) — 在真库上跑,跑完自清理。
 * 改订阅 / 积分 / 试用相关代码后必须跑这个。
 *
 * 覆盖:自助试用(7天/200分) · 开发商验证试用(30天/600分) · 跨月不白送 ·
 *      功能门 · 余额门 · 到期回落 · sweep · 转化清零 · comp 终身账户回归 · 一人一次
 *
 * 跑法: cd backend && npx ts-node --transpile-only scripts/verify-free-trial.ts
 */
import pool from '../src/db/pool'
import { checkCredits, spend, creditBalance, resetCreditsOnConversion, TRIAL_CREDITS, DEV_TRIAL_CREDITS } from '../src/luna-tour/credits'
import { expireFreeTrials } from '../src/services/freeTrialSweep'
import { claimFreeTrial } from '../src/services/freeTrial'

const agentIds: string[] = []
let failures = 0
let group = ''

function g(name: string) { group = name; console.log(`\n── ${name} ${'─'.repeat(Math.max(2, 50 - name.length))}`) }
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures++; console.error(`  ✗ [${group}] ${name} ${detail}`) }
}

/** 建一个临时 agent(跑完统一删)。 */
async function mkAgent(tag: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, $2) RETURNING id`,
    [`_trialtest_${tag}_${Date.now()}@example.invalid`, `trial test ${tag}`]
  )
  agentIds.push(r.rows[0].id)
  return r.rows[0].id
}

/** 模拟 POST /trial/start(自助:7 天 / 默认 200 分,所有角色一样)。 */
async function startSelfServeTrial(agentId: string, days = 7) {
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
       VALUES ($1,'agent','trialing','free_trial', now() + ($2 || ' days')::interval)`,
    [agentId, String(days)]
  )
  await pool.query(`UPDATE lt_agents SET free_trial_started_at = now() WHERE id = $1`, [agentId])
}

/** 模拟 admin 批准开发商验证(换发 30 天 / 600 分的新试用)。 */
async function approveDeveloper(agentId: string, days = 30) {
  await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [agentId])
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end, trial_credits)
       VALUES ($1,'agent','trialing','free_trial', now() + ($2 || ' days')::interval, $3)`,
    [agentId, String(days), DEV_TRIAL_CREDITS]
  )
  await pool.query(`UPDATE lt_agents SET developer_verified_at = now() WHERE id = $1`, [agentId])
}

async function main() {
  // ══ A. 自助试用(经纪 / 经纪公司 / 未验证开发商 都是这个)══════════
  g('A. 自助试用 7 天 / 200 分')
  const a = await mkAgent('selfserve')

  let c = await checkCredits(a, 'reports')
  check('A1 未订阅 → 报告被 402 拦(subscription_required)', !c.allowed && c.reason === 'subscription_required')

  await startSelfServeTrial(a)
  const balA = await creditBalance(a)
  check(`A2 积分池 = ${TRIAL_CREDITS}(不吃 Pro 的 1200)`, balA.creditsMonth === TRIAL_CREDITS, `实得 ${balA.creditsMonth}`)
  check('A3 标记为 freeTrial', balA.freeTrial === true)
  check('A4 报告(minPlan=rookie)解锁', (await checkCredits(a, 'reports')).allowed)
  check('A5 Luna 导览(minPlan=agent)解锁 ← 试用给 Pro 功能门', (await checkCredits(a, 'luna_tours')).allowed)
  check('A6 实时带看(minPlan=agent)解锁', (await checkCredits(a, 'live_tours')).allowed)
  check('A7 楼书解析解锁', (await checkCredits(a, 'brochures')).allowed)

  await spend(a, 'luna_tours')  // 100
  await spend(a, 'luna_tours')  // 100 → 满 200
  const usedA = await creditBalance(a)
  check('A8 余额归零', usedA.balance === 0, `余额 ${usedA.balance}`)
  c = await checkCredits(a, 'reports')
  check('A9 积分耗尽 → 402 insufficient', !c.allowed && c.reason === 'insufficient')
  check('A10 402 带 freeTrial 标记(文案要说"订阅即恢复")', c.freeTrial === true)

  // ══ B. 跨月不白送(自然月计数的真漏洞)═══════════════════════
  g('B. 试用跨月不刷新积分')
  // 伪装成"试用从上月底开始、积分是上月花的"。若按自然月计数,本月 used 归零 → 白送一遍。
  await pool.query(
    `UPDATE lt_credit_ledger SET created_at = date_trunc('month', now()) - interval '2 days' WHERE agent_id = $1`, [a]
  )
  await pool.query(
    `UPDATE lt_usage_counters SET period_month = (date_trunc('month', now()) - interval '1 month')::date WHERE agent_id = $1`, [a]
  )
  await pool.query(
    `UPDATE lt_subscriptions SET created_at = date_trunc('month', now()) - interval '3 days'
      WHERE agent_id = $1 AND source = 'free_trial'`, [a]
  )
  const cross = await creditBalance(a)
  check('B1 跨月后已用积分仍算数(不按自然月归零)', cross.used === 200, `used=${cross.used}`)
  check('B2 跨月后余额仍是 0 —— 没白送第二个 200', cross.balance === 0, `余额 ${cross.balance}`)
  check('B3 跨月后功能仍被拦', !(await checkCredits(a, 'reports')).allowed)

  // ══ C. 开发商验证 → 30 天 / 600 分 ═════════════════════════
  g('C. 开发商验证试用 30 天 / 600 分')
  const d = await mkAgent('developer')
  await startSelfServeTrial(d)                       // 先自助拿 7 天 / 200
  const before = await creditBalance(d)
  check(`C1 未验证的开发商也只有 ${TRIAL_CREDITS} 分(否则经纪会去冒充开发商)`,
    before.creditsMonth === TRIAL_CREDITS, `实得 ${before.creditsMonth}`)

  await spend(d, 'brochures')                        // 花 40
  await approveDeveloper(d)                          // owner 批准 → 换发新试用
  const after = await creditBalance(d)
  check(`C2 批准后积分池 = ${DEV_TRIAL_CREDITS}`, after.creditsMonth === DEV_TRIAL_CREDITS, `实得 ${after.creditsMonth}`)
  check('C3 换发新试用 → 用量从批准日重算(旧的 40 分不带过来)', after.used === 0, `used=${after.used}`)
  check(`C4 余额 = ${DEV_TRIAL_CREDITS}`, after.balance === DEV_TRIAL_CREDITS)
  check('C5 只剩一行试用(旧行已删,没有两行并存)',
    (await pool.query(`SELECT 1 FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [d])).rowCount === 1)

  const endD = await pool.query<{ days: number }>(
    `SELECT EXTRACT(day FROM current_period_end - now())::int AS days
       FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [d]
  )
  check('C6 试用期约 30 天', Number(endD.rows[0]?.days) >= 29, `${endD.rows[0]?.days} 天`)
  check('C7 楼书解析可用(开发商的核心动作)', (await checkCredits(d, 'brochures')).allowed)
  check('C8 600 分 = 15 份楼书(40 分/份)', Math.floor(DEV_TRIAL_CREDITS / 40) === 15)

  // ══ D. 到期 → 回落 ════════════════════════════════════════
  g('D. 试用到期')
  await pool.query(
    `UPDATE lt_subscriptions SET current_period_end = now() - interval '1 minute'
      WHERE agent_id=$1 AND source='free_trial'`, [d]
  )
  const exp = await creditBalance(d)
  check('D1 过期即回落 explore(惰性判定,不等 sweep)', exp.plan === 'explore', `plan=${exp.plan}`)
  check('D2 过期后功能重新上锁', !(await checkCredits(d, 'reports')).allowed)
  check('D3 过期后楼书解析也锁', !(await checkCredits(d, 'brochures')).allowed)

  await expireFreeTrials()
  const swept = await pool.query<{ status: string }>(
    `SELECT status FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [d]
  )
  check('D4 sweep 把 DB 状态翻成 canceled', swept.rows[0]?.status === 'canceled', `status=${swept.rows[0]?.status}`)
  check('D5 记了 free_trial_expired 审计',
    (await pool.query(`SELECT 1 FROM plan_change_log WHERE agent_id=$1 AND action='free_trial_expired'`, [d])).rowCount === 1)

  // ══ E. 转化(试用 → 付费)══════════════════════════════════
  g('E. 试用 → 付费转化')
  const p = await mkAgent('convert')
  await startSelfServeTrial(p)
  await spend(p, 'luna_tours')   // 花 100
  check('E1 转化前已花 100', (await creditBalance(p)).used === 100)

  // 模拟 upsertSubscription:先删试用行 → 插 Stripe 订阅 → 清零积分
  await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [p])
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, stripe_subscription_id, current_period_end)
       VALUES ($1,'agent','active','stripe',$2, now() + interval '30 days')`,
    [p, `sub_test_${Date.now()}`]
  )
  await resetCreditsOnConversion(p)

  const conv = await creditBalance(p)
  check('E2 只剩一行订阅(试用行已删,不是两行并存)',
    (await pool.query(`SELECT 1 FROM lt_subscriptions WHERE agent_id=$1`, [p])).rowCount === 1)
  check('E3 拿到 Pro 的 1200 积分', conv.creditsMonth === 1200, `实得 ${conv.creditsMonth}`)
  check('E4 试用期消耗已清零(付了钱余额不能还是空的)', conv.used === 0, `used=${conv.used}`)
  check('E5 不再是 freeTrial', conv.freeTrial === false)
  const led = await pool.query<{ credits: number }>(
    `SELECT credits FROM lt_credit_ledger WHERE agent_id=$1 AND feature='trial_reset'`, [p]
  )
  check('E6 负数补偿流水(不抹历史)', led.rows[0]?.credits === -100, JSON.stringify(led.rows))

  // ══ G. 防重复领取(并发 / 双击)═══════════════════════════
  g('G. 一人一次 · 并发安全')
  const r = await mkAgent('race')

  // 5 个请求同时领 —— 模拟双击按钮 / 重放。只允许一个成功。
  const results = await Promise.all(Array.from({ length: 5 }, () => claimFreeTrial(r)))
  const wins = results.filter((x) => x.ok).length
  check('G1 并发领取 5 次,只有 1 次成功', wins === 1, `成功 ${wins} 次`)
  check('G2 其余全部返回 trial_used',
    results.filter((x) => !x.ok).every((x) => !x.ok && x.code === 'trial_used'))
  const trialRows = await pool.query(
    `SELECT 1 FROM lt_subscriptions WHERE agent_id=$1 AND source='free_trial'`, [r]
  )
  check('G3 数据库里只有一行试用(唯一索引兜底)', trialRows.rowCount === 1, `${trialRows.rowCount} 行`)
  check('G4 积分池没有翻倍', (await creditBalance(r)).creditsMonth === TRIAL_CREDITS)

  // 领过的人再领 → 拒
  const again = await claimFreeTrial(r)
  check('G5 领过的人再领 → trial_used', !again.ok && again.code === 'trial_used')

  // 已有订阅的人来领 → 拒(不是 trial_used,是 already_subscribed)
  const s = await mkAgent('subscribed')
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, stripe_subscription_id, current_period_end)
       VALUES ($1,'agent','active','stripe',$2, now() + interval '30 days')`,
    [s, `sub_race_${Date.now()}`]
  )
  const sub = await claimFreeTrial(s)
  check('G6 已订阅的人领 → already_subscribed', !sub.ok && sub.code === 'already_subscribed')
  check('G7 被拒后试用戳没被误打(他以后退订了还能领)',
    !(await pool.query<{ t: Date | null }>(`SELECT free_trial_started_at AS t FROM lt_agents WHERE id=$1`, [s])).rows[0]?.t)

  // ══ F. 回归:绝不能误伤的东西 ══════════════════════════════
  g('F. 回归')
  const comp = await pool.query(`SELECT 1 FROM lt_subscriptions WHERE source='comp' AND status='active'`)
  check('F1 后台 comp 授予的终身账户仍 active(sweep 绝不能碰)', comp.rowCount === 2, `找到 ${comp.rowCount} 行`)
  const stripeSubs = await pool.query(
    `SELECT 1 FROM lt_subscriptions WHERE source='stripe' AND status IN ('active','trialing')
       AND stripe_subscription_id IS NOT NULL`
  )
  check('F2 真实 Stripe 订阅未受影响', (stripeSubs.rowCount ?? 0) >= 3, `${stripeSubs.rowCount} 行`)
  check('F3 试用戳还在 → 无法二次试用(即使订阅行已删)',
    !!(await pool.query<{ t: Date | null }>(`SELECT free_trial_started_at AS t FROM lt_agents WHERE id=$1`, [p])).rows[0]?.t)
}

main()
  .catch((e) => { failures++; console.error('\n脚本异常:', e) })
  .finally(async () => {
    for (const id of agentIds) {
      await pool.query(`DELETE FROM lt_credit_ledger WHERE agent_id=$1`, [id])
      await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id=$1`, [id])
      await pool.query(`DELETE FROM plan_change_log WHERE agent_id=$1`, [id])
      await pool.query(`DELETE FROM developer_verifications WHERE agent_id=$1`, [id])
      await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id=$1`, [id])
      await pool.query(`DELETE FROM lt_agents WHERE id=$1`, [id])
    }
    console.log(`\n已清理 ${agentIds.length} 个临时 agent`)
    await pool.end()
    console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`)
    process.exit(failures === 0 ? 0 : 1)
  })
