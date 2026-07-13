/**
 * 后台「一次性赠送 30 天试用」回归测试 —— 真库跑完整生命周期,自清理。
 *
 * 这是**钱的门**:发错了要么白送永久免费,要么覆盖掉人家的付费订阅。
 * 改 services/adminGrant.ts 或 routes/agents.ts 的授予逻辑后必须跑这个。
 *
 * 运行:cd backend && npx ts-node -T scripts/verify-admin-grant.ts
 * (用临时 agent 账号,跑完全删干净;不碰任何真实用户)
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

import pool from '../src/db/pool'
import { grantOneTimeTrial, revokeGrant, GRANT_TRIAL_DAYS, GRANT_TRIAL_CREDITS } from '../src/services/adminGrant'

let passed = 0
let failed = 0
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; console.error(`  ✗ ${label}`) }
}

const ACTOR = 'owner@test.local'
const mkEmail = (tag: string) => `_verify_grant_${tag}_${Date.now()}@test.local`

async function mkAgent(email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, 'verify') RETURNING id`, [email]
  )
  return r.rows[0].id
}
async function cleanup(ids: string[], emails: string[]) {
  if (!ids.length) return
  await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id = ANY($1)`, [ids])
  await pool.query(`DELETE FROM plan_change_log WHERE agent_id = ANY($1)`, [ids])
  await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id = ANY($1)`, [ids])
  await pool.query(`DELETE FROM lt_agents WHERE id = ANY($1)`, [ids])
  await pool.query(`DELETE FROM agents WHERE email = ANY($1)`, [emails])
}

async function run() {
  const ids: string[] = []
  const emails: string[] = []
  const track = async (tag: string) => {
    const e = mkEmail(tag); const id = await mkAgent(e)
    ids.push(id); emails.push(e); return { id, email: e }
  }

  try {
    // ── ① 干净的经纪:赠送成功,参数正确 ────────────────────────────
    console.log('\n① 全新经纪 → 赠送成功')
    const a = await track('fresh')
    const r1 = await grantOneTimeTrial(a.id, a.email, ACTOR)
    ok(r1.ok, '返回 ok')
    ok(r1.days === GRANT_TRIAL_DAYS && r1.credits === GRANT_TRIAL_CREDITS, `发的是 ${GRANT_TRIAL_DAYS} 天 / ${GRANT_TRIAL_CREDITS} 分`)

    const sub = await pool.query(
      `SELECT plan_id, status, source, trial_credits,
              round(EXTRACT(EPOCH FROM (current_period_end - now())) / 86400) AS days_left
         FROM lt_subscriptions WHERE agent_id = $1`, [a.id]
    )
    ok(sub.rowCount === 1, '只有一条订阅行')
    ok(sub.rows[0]?.source === 'free_trial', `source=free_trial(到期能被 sweep 收回)`)
    ok(sub.rows[0]?.status === 'trialing', 'status=trialing')
    ok(sub.rows[0]?.plan_id === 'agent', 'plan=agent(Pro,旗舰功能试得到)')
    ok(Number(sub.rows[0]?.trial_credits) === GRANT_TRIAL_CREDITS, `trial_credits=${GRANT_TRIAL_CREDITS}`)
    ok(Number(sub.rows[0]?.days_left) === GRANT_TRIAL_DAYS, `${GRANT_TRIAL_DAYS} 天后到期(不是 100 年!)`)

    const ag = await pool.query(`SELECT trial_granted_at, trial_granted_by, free_trial_started_at FROM lt_agents WHERE id=$1`, [a.id])
    ok(!!ag.rows[0]?.trial_granted_at, '记了赠送时间')
    ok(ag.rows[0]?.trial_granted_by === ACTOR, `记了操作人(${ACTOR})`)
    ok(!!ag.rows[0]?.free_trial_started_at, '自助领取戳也补上了(不能再去前台自己领 7 天)')

    const log = await pool.query(`SELECT action, actor_email FROM plan_change_log WHERE agent_id=$1`, [a.id])
    ok(log.rows[0]?.action === 'trial_granted', '审计写了 trial_granted')
    ok(log.rows[0]?.actor_email === ACTOR, '审计记了操作人(一等列,不是 reason 字符串)')

    // ── ② 同一个人再赠 → 拒绝 ────────────────────────────────────
    console.log('\n② 同一个人再赠一次 → 拒绝')
    const r2 = await grantOneTimeTrial(a.id, a.email, ACTOR)
    ok(!r2.ok && r2.code === 'already_granted', '返回 already_granted')
    ok(!!r2.grantedBy, '把「谁发的」带回去给 UI 显示')
    const subs2 = await pool.query(`SELECT count(*)::int AS n FROM lt_subscriptions WHERE agent_id=$1`, [a.id])
    ok(subs2.rows[0].n === 1, '没有插出第二条订阅行')

    // ── ③ 并发双击 → 只有一次成功 ────────────────────────────────
    console.log('\n③ 并发赠送 5 次 → 只有 1 次成功')
    const c = await track('concurrent')
    const results = await Promise.all(Array.from({ length: 5 }, () => grantOneTimeTrial(c.id, c.email, ACTOR)))
    ok(results.filter((r) => r.ok).length === 1, '恰好 1 次 ok')
    const cSubs = await pool.query(`SELECT count(*)::int AS n FROM lt_subscriptions WHERE agent_id=$1`, [c.id])
    ok(cSubs.rows[0].n === 1, '只有一条订阅行(唯一索引 + 原子占位)')

    // ── ④ 已有付费/永久 comp 订阅 → 拒绝,且名额退回 ──────────────
    console.log('\n④ 已有生效订阅(自己人的永久 comp)→ 拒绝,不覆盖人家订阅')
    const p = await track('paid')
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
         VALUES ($1, 'agent', 'active', 'comp', now() + interval '100 years')`, [p.id]
    )
    const r4 = await grantOneTimeTrial(p.id, p.email, ACTOR)
    ok(!r4.ok && r4.code === 'already_subscribed', '返回 already_subscribed')
    const pSub = await pool.query(`SELECT source, status FROM lt_subscriptions WHERE agent_id=$1`, [p.id])
    ok(pSub.rowCount === 1 && pSub.rows[0].source === 'comp' && pSub.rows[0].status === 'active',
      '他原来的订阅原封不动(没被试用行覆盖)')
    const pAg = await pool.query(`SELECT trial_granted_at FROM lt_agents WHERE id=$1`, [p.id])
    ok(!pAg.rows[0].trial_granted_at, '名额退回了(占位失败必须回滚,否则他白白失去资格)')

    // ── ⑤ 自助领过 7 天的人 → 仍能被赠 30 天,且换掉旧行 ───────────
    console.log('\n⑤ 自助领过 7 天试用的人 → 后台仍能赠 30 天(换掉旧行)')
    const s = await track('selfserve')
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end, trial_credits)
         VALUES ($1, 'agent', 'trialing', 'free_trial', now() + interval '7 days', 200)`, [s.id]
    )
    const r5 = await grantOneTimeTrial(s.id, s.email, ACTOR)
    ok(r5.ok, '赠送成功(自助试用不算「已有套餐」)')
    const sSub = await pool.query(
      `SELECT count(*)::int AS n, max(trial_credits) AS credits,
              max(round(EXTRACT(EPOCH FROM (current_period_end - now())) / 86400)) AS days
         FROM lt_subscriptions WHERE agent_id=$1`, [s.id]
    )
    ok(sSub.rows[0].n === 1, '旧的 7 天行被换掉,不是并存两条')
    ok(Number(sSub.rows[0].credits) === GRANT_TRIAL_CREDITS && Number(sSub.rows[0].days) === GRANT_TRIAL_DAYS,
      `现在是 ${GRANT_TRIAL_DAYS} 天 / ${GRANT_TRIAL_CREDITS} 分`)

    // ── ⑥ 撤销 → 停订阅,但名额不退回 ─────────────────────────────
    console.log('\n⑥ 撤销赠送 → 订阅停掉,但名额不退(一人一次就是一次)')
    await revokeGrant(a.id, a.email, ACTOR)
    const rSub = await pool.query(
      `SELECT 1 FROM lt_subscriptions WHERE agent_id=$1 AND status IN ('active','trialing')`, [a.id]
    )
    ok(rSub.rowCount === 0, '没有生效订阅了')
    const rAg = await pool.query(`SELECT trial_granted_at FROM lt_agents WHERE id=$1`, [a.id])
    ok(!!rAg.rows[0].trial_granted_at, '赠送记录还在(撤销不退名额)')
    const r6 = await grantOneTimeTrial(a.id, a.email, ACTOR)
    ok(!r6.ok && r6.code === 'already_granted', '撤销后也不能再赠一次')

  } finally {
    await cleanup(ids, emails)
    console.log(`\n🧹 已清理 ${ids.length} 个临时账号`)
  }

  console.log(`\n${failed === 0 ? '✅ 全过' : '❌ 有失败'}:${passed} 通过 / ${failed} 失败`)
  await pool.end()
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(async (e) => { console.error('💥', e); await pool.end(); process.exit(1) })
