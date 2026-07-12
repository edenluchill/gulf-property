/**
 * 通话计费(语音 + 视频统一)的端到端验证 —— 免费额度 → 超额扣分 → 两级刹车 → 幂等。
 *
 * ⚠️ 连的是**生产库**:用一个临时 agent(email 带 __videotest__ 前缀),跑完全部清理。
 *
 * 跑:  cd backend && npx ts-node -T scripts/test-video-billing.ts
 */
import pool from '../src/db/pool'
import {
  settleCallUsage, checkCallQuota, toCallUnits,
  VIDEO_UNIT_WEIGHT, CALL_UNITS_PER_CREDIT, TRIAL_CALL_UNITS, FEATURES,
} from '../src/luna-tour/credits'

const EMAIL = '__videotest__@pinzos.test'
let agentId = ''
let pass = 0
let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

async function cleanup() {
  if (!agentId) return
  await pool.query(`DELETE FROM lt_credit_ledger  WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_subscriptions  WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_agents         WHERE id = $1`, [agentId])
}

async function reset() {
  await pool.query(`DELETE FROM lt_credit_ledger  WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id = $1`, [agentId])
}

async function setPlan(plan: string, source = 'stripe', trialCredits: number | null = null) {
  await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id = $1`, [agentId])
  await pool.query(
    `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, trial_credits, current_period_end)
     VALUES ($1, $2, 'active', $3, $4, now() + interval '30 days')`,
    [agentId, plan, source, trialCredits]
  )
}

const M = 60 // 1 分钟 = 60 秒

async function main() {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, 'call billing test') RETURNING id`,
    [EMAIL]
  )
  agentId = a.rows[0].id
  console.log(`\n临时 agent: ${agentId}`)
  console.log(`换算:视频 1 分钟 = ${VIDEO_UNIT_WEIGHT} units;${CALL_UNITS_PER_CREDIT} units = 1 积分\n`)

  // ── 0) 折算口径 ────────────────────────────────────────────────────────
  console.log('【0】units 折算(语音 1× / 视频 4×)')
  check('语音 10 min = 10 units', toCallUnits(10 * M, 0), 10)
  check('视频 10 min = 40 units', toCallUnits(0, 10 * M), 40)
  check('语音10+视频10 = 50 units', toCallUnits(10 * M, 10 * M), 50)
  // ⭐ 敞口的根:音频按 user-秒,不是会话墙钟秒
  check('⭐ 6人语音 10min = 60 user-min = 60 units', toCallUnits(6 * 10 * M, 0), 60)

  // ── 1) 实时带看免费 ────────────────────────────────────────────────────
  console.log('\n【1】实时带看:免费不限场次(成本 $0)')
  check('live_tours 单价 = 0 积分', FEATURES.live_tours.credits, 0)
  check('仍保留 minPlan 门(agent 以上)', FEATURES.live_tours.minPlan, 'agent')

  // ── 2) Pro:免费额度内不扣积分 ─────────────────────────────────────────
  console.log('\n【2】Pro(1200 units 免费额度)')
  await setPlan('agent')
  await reset()

  let q = await checkCallQuota(agentId)
  check('免费额度 = 1200 units', q.freeQuota, 1200)
  check('= 1对1 语音 10 小时', 1200 / 2 / 60, 10)
  check('= 视频 300 分钟', 1200 / VIDEO_UNIT_WEIGHT, 300)
  check('不 exhausted', q.exhausted, false)

  // 一场:1对1 语音 20 分钟(= 2 人 × 20 = 40 user-min)
  let s = await settleCallUsage(agentId, 'sess-1', 40 * M, 0, 0)
  check('40 user-min 语音 = 40 units', s.sessionUnits, 40)
  check('免费额度内 → 0 积分', s.credits, 0)
  check('freeLeft = 1160', s.freeLeft, 1160)
  check('不刹车', s.stopVideo, false)

  // ── 3) 幂等 ────────────────────────────────────────────────────────────
  console.log('\n【3】幂等:heartbeat 反复结算')
  s = await settleCallUsage(agentId, 'sess-1', 40 * M, 0, 0)
  check('重复结算 freeLeft 仍 1160', s.freeLeft, 1160)
  const n = await pool.query(`SELECT COUNT(*)::int AS n FROM lt_credit_ledger WHERE agent_id=$1 AND feature='live_call'`, [agentId])
  check('一场只有一行 ledger', n.rows[0].n, 1)

  // ── 4) 视频吃 4 倍额度 ─────────────────────────────────────────────────
  console.log('\n【4】视频吃 4 倍额度')
  await reset()
  // 语音 20min(2人=40 user-min) + 视频 10min(1人=10 viewer-min → 40 units)
  s = await settleCallUsage(agentId, 'sess-2', 40 * M, 10 * M, 0)
  check('40 + 10×4 = 80 units', s.sessionUnits, 80)
  check('仍在免费额度内', s.credits, 0)
  check('freeLeft = 1120', s.freeLeft, 1120)

  // ── 5) 超出免费额度 → 扣积分(4 units = 1 积分)──────────────────────────
  console.log('\n【5】超额 → 4 units = 1 积分')
  await reset()
  s = await settleCallUsage(agentId, 'sess-3', 1240 * M, 0, 0)  // 1240 units
  check('sessionUnits = 1240', s.sessionUnits, 1240)
  check('免费吃满 1200', s.freeUsed, 1200)
  check('超出 40 units → 10 积分', s.credits, 10)
  check('余额 1200-10 = 1190', s.creditBalance, 1190)
  check('还有积分 → 不刹车', s.stopVideo, false)

  // 增量:同一场涨到 1400 units → 只补差额
  s = await settleCallUsage(agentId, 'sess-3', 1400 * M, 0, 10)
  check('超出 200 units → 累计 50 积分', s.credits, 50)
  check('余额 1200-50 = 1150', s.creditBalance, 1150)

  // ── 6) ⭐ 两级刹车 ─────────────────────────────────────────────────────
  console.log('\n【6】⭐ 两级刹车')
  await reset()
  // 天花板:1200 免费 + 1200 积分 × 4 units = 6000 units
  // 带视频 → 先撤视频(4× 单价),语音继续
  s = await settleCallUsage(agentId, 'sess-4', 3000 * M, 750 * M, 0)  // 3000 + 3000 = 6000 units
  check('6000 units(语音3000 + 视频750×4)', s.sessionUnits, 6000)
  check('免费 1200', s.freeUsed, 1200)
  check('超出 4800 units → 1200 积分(全部)', s.credits, 1200)
  check('积分余额 = 0', s.creditBalance, 0)
  check('⭐ stopVideo=true(先砍 4× 单价的视频)', s.stopVideo, true)
  check('  stopCall=false(视频还在 → 先只撤视频,语音继续)', s.stopCall, false)

  // 纯语音也超 → 挂断整场
  await reset()
  s = await settleCallUsage(agentId, 'sess-5', 6000 * M, 0, 0)
  check('⭐ 纯语音烧光 → stopCall=true(挂断整场)', s.stopCall, true)

  q = await checkCallQuota(agentId)
  check('预检也显示 exhausted', q.exhausted, true)

  // ── 7) Founder 0.6 折扣在总量上取整 ────────────────────────────────────
  console.log('\n【7】Founder 0.6 折扣(必须在总量上取整)')
  await setPlan('founder')
  await reset()
  s = await settleCallUsage(agentId, 'sess-6', 6400 * M, 0, 0)
  check('Founder 免费额度 6000', s.freeUsed, 6000)
  // 超出 400 units / 4 = 100 积分 × 0.6 = 60(逐单位取整会变成 100 → 折扣被吃掉)
  check('超出 400 units → 60 积分(非 100)', s.credits, 60)

  // ── 8) ⚠️ 试用不继承套餐额度 ───────────────────────────────────────────
  console.log('\n【8】⚠️ 免绑卡试用:额度必须独立,不能继承 Pro 的 1200')
  await setPlan('agent', 'free_trial', 200)   // plan_id=agent 但 source=free_trial
  await reset()
  q = await checkCallQuota(agentId)
  check(`试用额度 = TRIAL_CALL_UNITS(${TRIAL_CALL_UNITS})`, q.freeQuota, TRIAL_CALL_UNITS)
  check('试用被识别', q.freeTrial, true)

  s = await settleCallUsage(agentId, 'sess-7', (TRIAL_CALL_UNITS + 40) * M, 0, 0)
  check(`试用只免费 ${TRIAL_CALL_UNITS} units`, s.freeUsed, TRIAL_CALL_UNITS)
  check('超出 40 units → 10 积分(吃试用的 200 池)', s.credits, 10)

  // 试用天花板 = 120 免费 + 200 积分 × 4 = 920 units
  s = await settleCallUsage(agentId, 'sess-7', 920 * M, 0, 10)
  check('⭐ 试用烧光也刹车', s.stopCall, true)

  console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}  ${pass} passed, ${fail} failed\n`)
}

main()
  .catch((e) => { console.error('测试炸了:', e); fail++ })
  .finally(async () => {
    await cleanup()
    console.log('🧹 测试数据已清理')
    await pool.end()
    process.exit(fail === 0 ? 0 : 1)
  })
