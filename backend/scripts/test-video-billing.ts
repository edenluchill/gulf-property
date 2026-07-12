/**
 * 带看视频计费的端到端验证 —— 免费额度 → 超额扣分 → 刹车 → 幂等。
 *
 * ⚠️ 连的是**生产库**:用一个临时 agent(email 带 __videotest__ 前缀),跑完全部清理。
 *
 * 跑:  cd backend && npx ts-node scripts/test-video-billing.ts
 */
import pool from '../src/db/pool'
import { settleVideoUsage, checkVideoQuota, FEATURES, TRIAL_VIDEO_MINUTES } from '../src/luna-tour/credits'

const EMAIL = '__videotest__@pinzos.test'
let agentId = ''
let pass = 0
let fail = 0

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`)
  ok ? pass++ : fail++
}

/** 清掉这个测试 agent 的所有痕迹 */
async function cleanup() {
  if (!agentId) return
  await pool.query(`DELETE FROM lt_credit_ledger  WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_usage_counters WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_subscriptions  WHERE agent_id = $1`, [agentId])
  await pool.query(`DELETE FROM lt_agents         WHERE id = $1`, [agentId])
}

/** 重置用量,保留 agent + 订阅 */
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

async function main() {
  // 临时 agent
  const a = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name) VALUES ($1, 'video billing test') RETURNING id`,
    [EMAIL]
  )
  agentId = a.rows[0].id
  console.log(`\n临时 agent: ${agentId}\n`)

  const MIN = 60 // 1 viewer-minute = 60 viewer-seconds

  // ── 1) Pro(agent, 1200 积分 / 300 免费视频分钟)────────────────────────
  console.log('【1】Pro 档:免费额度内不扣积分')
  await setPlan('agent')
  await reset()

  let q = await checkVideoQuota(agentId)
  check('初始免费额度 = 300', q.freeQuota, 300)
  check('初始 freeLeft = 300', q.freeLeft, 300)
  check('初始不 exhausted', q.exhausted, false)

  // 一场:1 客户看 10 分钟 = 10 viewer-min
  let s = await settleVideoUsage(agentId, 'sess-1', 10 * MIN, 0)
  check('10 viewer-min → sessionUnits=10', s.sessionUnits, 10)
  check('全在免费额度内 → credits=0', s.credits, 0)
  check('freeUsed=10', s.freeUsed, 10)
  check('freeLeft=290', s.freeLeft, 290)
  check('不刹车', s.stopVideo, false)

  // ── 2) 幂等:同一场重复结算不重复扣 ────────────────────────────────────
  console.log('\n【2】幂等:同一场 heartbeat 反复结算')
  s = await settleVideoUsage(agentId, 'sess-1', 10 * MIN, 0)
  check('重复结算 sessionUnits 仍=10', s.sessionUnits, 10)
  check('freeLeft 仍=290(没被扣两次)', s.freeLeft, 290)
  const ledgerRows = await pool.query(`SELECT COUNT(*)::int AS n FROM lt_credit_ledger WHERE agent_id=$1 AND feature='live_video'`, [agentId])
  check('一场只有一行 ledger', ledgerRows.rows[0].n, 1)

  // ── 3) 多人围观:按 viewer-minute 计 ──────────────────────────────────
  console.log('\n【3】多人围观:成本按人头涨')
  // 同一场继续:6 个客户看 10 分钟 = 60 viewer-min(累计 viewer-seconds)
  s = await settleVideoUsage(agentId, 'sess-1', 60 * MIN, 0)
  check('6人×10min = 60 viewer-min', s.sessionUnits, 60)
  check('仍在 300 免费额度内 → credits=0', s.credits, 0)
  check('freeLeft = 300-60 = 240', s.freeLeft, 240)

  // ── 4) 超出免费额度 → 扣积分 ─────────────────────────────────────────
  console.log('\n【4】超出 300 免费额度 → 开始扣积分')
  await reset()
  // 新的一场,直接烧 350 viewer-min
  s = await settleVideoUsage(agentId, 'sess-2', 350 * MIN, 0)
  check('sessionUnits=350', s.sessionUnits, 350)
  check('freeUsed=300(吃满免费额度)', s.freeUsed, 300)
  check('超出 50 → 扣 50 积分', s.credits, 50)
  check('freeLeft=0', s.freeLeft, 0)
  check('1200-50=1150 积分余额', s.creditBalance, 1150)
  check('还有积分 → 不刹车', s.stopVideo, false)

  // 增量结算:同一场涨到 400 → 应只补扣差额
  s = await settleVideoUsage(agentId, 'sess-2', 400 * MIN, 50)
  check('涨到 400 → 累计扣 100 积分', s.credits, 100)
  check('余额 1200-100=1100(只补了差额 50)', s.creditBalance, 1100)

  // ── 5) ⭐ 刹车:免费额度和积分都空 → stopVideo ────────────────────────
  console.log('\n【5】⭐ 刹车:额度+积分都烧光')
  await reset()
  // 300 免费 + 1200 积分 = 1500 viewer-min 是 Pro 的绝对天花板
  s = await settleVideoUsage(agentId, 'sess-3', 1500 * MIN, 0)
  check('sessionUnits=1500', s.sessionUnits, 1500)
  check('免费 300', s.freeUsed, 300)
  check('扣 1200 积分(全部)', s.credits, 1200)
  check('积分余额=0', s.creditBalance, 0)
  check('⭐ stopVideo=true(必须刹车!)', s.stopVideo, true)

  q = await checkVideoQuota(agentId)
  check('预检也显示 exhausted', q.exhausted, true)

  // ── 6) Founder 的 0.6 折扣要在总量上取整 ────────────────────────────
  console.log('\n【6】Founder 0.6 折扣(必须在总量上取整,不能逐单位)')
  await setPlan('founder')
  await reset()
  s = await settleVideoUsage(agentId, 'sess-4', 1600 * MIN, 0)
  check('Founder 免费额度 1500', s.freeUsed, 1500)
  // 超出 100 viewer-min × 1 credit × 0.6 = 60(若逐单位取整会变成 100 → 折扣被吃掉)
  check('超出 100 min × 0.6 = 60 积分(非 100)', s.credits, 60)

  // ── 7) ⚠️ 试用不能继承套餐的 300 分钟 ───────────────────────────────
  console.log('\n【7】⚠️ 免绑卡试用:额度必须是 30,不能继承 Pro 的 300')
  await setPlan('agent', 'free_trial', 200)   // plan_id=agent 但 source=free_trial
  await reset()
  q = await checkVideoQuota(agentId)
  check(`试用额度 = TRIAL_VIDEO_MINUTES(${TRIAL_VIDEO_MINUTES})`, q.freeQuota, TRIAL_VIDEO_MINUTES)
  check('试用被识别', q.freeTrial, true)

  s = await settleVideoUsage(agentId, 'sess-5', 50 * MIN, 0)
  check('试用只免费 30 分钟', s.freeUsed, TRIAL_VIDEO_MINUTES)
  check('超出 20 → 扣 20 积分(吃试用的 200 池)', s.credits, 50 - TRIAL_VIDEO_MINUTES)
  check('试用积分余额 200-20=180', s.creditBalance, 200 - (50 - TRIAL_VIDEO_MINUTES))

  // 试用把 200 积分也烧光 → 刹车
  s = await settleVideoUsage(agentId, 'sess-5', 230 * MIN, 20)
  check('试用天花板 = 30免费 + 200积分 = 230 min', s.sessionUnits, 230)
  check('⭐ 试用烧光也刹车', s.stopVideo, true)

  console.log(`\n单价:${FEATURES.live_video.credits} 积分 / viewer-minute`)
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
