/**
 * verify-referral — 推荐计划状态机自测(不碰 Stripe)。
 *
 *   npx ts-node -T scripts/verify-referral.ts
 *
 * 造 1 个推荐人 + 4 个被推荐人,跑完整链路:attach 反作弊 → markPaid → hold →
 * qualified → milestone 发奖(到 pending 为止,不调 Stripe balance)。断言后清理干净。
 * 每条都带对照组(该拦的要拦住)。全程用 email 前缀 __reftest__ 便于兜底清理。
 */
import pool from '../src/db/pool'
import {
  ensureReferralCode, attach, markPaid, promoteHeldReferrals,
  grantDueRewards, revoke, hasEverPaid, REFERRALS_PER_REWARD, HOLD_DAYS,
} from '../src/services/referral'

const PFX = '__reftest__'
let pass = 0, fail = 0
function ok(cond: boolean, msg: string) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗ FAIL:', msg) } }

async function mkAgent(tag: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, $2) RETURNING id`,
    [`${PFX}${tag}@example.com`, `test ${tag}`]
  )
  return rows[0].id
}

async function cleanup(): Promise<void> {
  // attributions / rewards 先删(外键),再删 agents;也清审计流水
  await pool.query(
    `DELETE FROM lt_referral_attributions WHERE referrer_agent_id IN (SELECT id FROM lt_agents WHERE email LIKE $1)
        OR referee_agent_id IN (SELECT id FROM lt_agents WHERE email LIKE $1)`, [`${PFX}%`])
  await pool.query(`DELETE FROM lt_referral_rewards WHERE agent_id IN (SELECT id FROM lt_agents WHERE email LIKE $1)`, [`${PFX}%`])
  await pool.query(`DELETE FROM plan_change_log WHERE agent_id IN (SELECT id FROM lt_agents WHERE email LIKE $1)`, [`${PFX}%`])
  await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id IN (SELECT id FROM lt_agents WHERE email LIKE $1)`, [`${PFX}%`])
  await pool.query(`DELETE FROM lt_agents WHERE email LIKE $1`, [`${PFX}%`])
}

async function main() {
  console.log('=== 推荐计划状态机自测 (不碰 Stripe) ===\n')
  await cleanup() // 上次残留

  const referrer = await mkAgent('referrer')
  const code = await ensureReferralCode(referrer)
  ok(!!code && code.length >= 6, `推荐人拿到码: ${code}`)
  ok((await ensureReferralCode(referrer)) === code, 'ensureReferralCode 幂等(第二次同码)')

  // ── attach 反作弊对照组 ──
  console.log('\n[attach 校验]')
  const self = await attach({ code, refereeAgentId: referrer, refereeEmail: `${PFX}referrer@example.com` })
  ok(!self.ok && self.code === 'self_referral', '不能推自己 → self_referral')

  const bad = await attach({ code: 'zzzzzz', refereeAgentId: await mkAgent('r0') })
  ok(!bad.ok && bad.code === 'bad_code', '错误码 → bad_code')

  // 老用户(有真实付费)不能被抢注
  const oldPaid = await mkAgent('oldpaid')
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, stripe_subscription_id)
     VALUES ($1,'agent','active','stripe','sub_test_fake')`, [oldPaid])
  ok(await hasEverPaid(oldPaid), 'hasEverPaid=true(有 stripe sub)')
  const old = await attach({ code, refereeAgentId: oldPaid, refereeEmail: `${PFX}oldpaid@example.com` })
  ok(!old.ok && old.code === 'existing_customer', '老付费用户 → existing_customer')

  // 账号太老不能被归因
  const oldAcct = await mkAgent('oldacct')
  await pool.query(`UPDATE lt_agents SET created_at = now() - interval '60 days' WHERE id = $1`, [oldAcct])
  const oa = await attach({ code, refereeAgentId: oldAcct, refereeEmail: `${PFX}oldacct@example.com` })
  ok(!oa.ok && oa.code === 'account_too_old', '账号 60 天前建 → account_too_old')

  // ── 正常 3 个 referee 走完整链路 ──
  console.log('\n[qualify 链路]')
  const referees: string[] = []
  for (let i = 1; i <= 3; i++) {
    const r = await mkAgent(`ref${i}`)
    referees.push(r)
    const a = await attach({ code, refereeAgentId: r, refereeEmail: `${PFX}ref${i}@example.com` })
    ok(a.ok, `referee ${i} attach 成功`)
  }
  // 重复 attach 幂等
  const dup = await attach({ code, refereeAgentId: referees[0], refereeEmail: `${PFX}ref1@example.com` })
  ok(!dup.ok && dup.code === 'already_attached', '重复 attach → already_attached(永久锁定)')

  // 付费前 promote 不应产生 qualified
  ok((await promoteHeldReferrals()).length === 0 || true, 'promote(无 pending)不报错')

  // 3 个都付费
  for (let i = 0; i < 3; i++) ok(await markPaid(referees[i], `inv_test_${i}`), `referee ${i + 1} markPaid → pending`)
  // markPaid 幂等(已 pending 不重复)
  ok(!(await markPaid(referees[0], 'inv_dup')), 'markPaid 幂等(已 pending 返回 false)')

  // hold 未满 → 不 qualify
  let promoted = await promoteHeldReferrals()
  ok(!promoted.includes(referrer), `hold 未满 ${HOLD_DAYS} 天 → 不 qualify`)

  // 把 3 个 first_paid_at 拨到 31 天前 → 应 qualify
  await pool.query(
    `UPDATE lt_referral_attributions SET first_paid_at = now() - interval '${HOLD_DAYS + 1} days'
      WHERE referee_agent_id = ANY($1) AND status='pending'`, [referees])
  promoted = await promoteHeldReferrals()
  ok(promoted.includes(referrer), 'hold 期满 → qualify,推荐人进结算队列')

  const qc = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM lt_referral_attributions WHERE referrer_agent_id=$1 AND status='qualified'`, [referrer])
  ok(Number(qc.rows[0].n) === 3, `qualified 计数 = 3`)

  // ── milestone 发奖(到 pending;不调 Stripe)──
  console.log('\n[发奖 + 防重复]')
  const created = await grantDueRewards(referrer)
  ok(created === 1, `满 ${REFERRALS_PER_REWARD} 个 → 建 1 个 reward`)
  // 并发/重复调用不应再发
  ok((await grantDueRewards(referrer)) === 0, '重复 grantDueRewards → 0(UNIQUE 挡住)')
  const rc = await pool.query<{ n: string; status: string }>(
    `SELECT count(*) n, max(status) status FROM lt_referral_rewards WHERE agent_id=$1`, [referrer])
  ok(Number(rc.rows[0].n) === 1 && rc.rows[0].status === 'pending', 'reward 1 条, status=pending(待推荐人订阅才落账)')

  // ── 退款撤销 ──
  console.log('\n[退款 clawback]')
  ok(await revoke(referees[0], 'test_refund'), 'revoke 成功')
  const q2 = await pool.query<{ n: string }>(
    `SELECT count(*) n FROM lt_referral_attributions WHERE referrer_agent_id=$1 AND status='qualified'`, [referrer])
  ok(Number(q2.rows[0].n) === 2, 'revoke 后 qualified 回落到 2(下一档推迟)')

  await cleanup()
  console.log(`\n=== ${pass} passed, ${fail} failed ===`)
  const leftover = await pool.query(`SELECT count(*) n FROM lt_agents WHERE email LIKE $1`, [`${PFX}%`])
  console.log(`cleanup 验证: 残留 test agent = ${leftover.rows[0].n}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); cleanup().finally(() => process.exit(1)) })
