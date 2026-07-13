/**
 * 延长/授予某经纪的免费试用(后台手动,给谈好的客户)。
 *
 * 用法:
 *   npx ts-node -T scripts/extend-trial.ts <email> <days> [credits]
 *   npx ts-node -T scripts/extend-trial.ts a@b.com,c@d.com 30 1200
 *   npx ts-node -T scripts/extend-trial.ts a@b.com            # 只查看,不改
 *
 * ⚠️ 为什么走 free_trial 行而不是后台 comp 授予:
 *   comp 行(routes/agents.ts:114)期限是 100 年,且**没有任何过期清理** ——
 *   freeTrialSweep 和各处的即时过期谓词都只作用于 source='free_trial'。
 *   拿 comp 发"一个月试用",一个月后不会自动收回 = 永久免费。
 *   改 free_trial 行的 current_period_end,到期由 sweep 自动翻 canceled。
 *
 * 积分:trial_credits 是该试用期**共用一池**(不跨月刷新,见 credits.usedFor),
 *   NULL = 默认 TRIAL_CREDITS(200)。Pro 月额是 1200。
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })

async function run() {
  const emails = (process.argv[2] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const days = process.argv[3] ? Number(process.argv[3]) : null
  const credits = process.argv[4] ? Number(process.argv[4]) : null

  if (!emails.length) {
    console.log('Usage: npx ts-node -T scripts/extend-trial.ts <email[,email2]> <days> [credits]')
    console.log('  例: ... scripts/extend-trial.ts a@b.com,c@d.com 30 1200')
    process.exit(1)
  }
  if (days !== null && (!Number.isFinite(days) || days <= 0)) {
    console.error(`❌ days 必须是正数,收到:${process.argv[3]}`)
    process.exit(1)
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  })

  await client.connect()
  try {
    for (const email of emails) {
      const a = await client.query<{ id: string }>(
        `SELECT id FROM lt_agents WHERE lower(email) = $1`,
        [email]
      )
      const agentId = a.rows[0]?.id
      if (!agentId) {
        console.error(`❌ ${email} —— 找不到经纪(还没登录过经纪台)`)
        continue
      }

      if (days === null) {
        const cur = await client.query(
          `SELECT plan_id, status, source, current_period_end, trial_credits
             FROM lt_subscriptions WHERE agent_id = $1 AND status IN ('active','trialing')
             ORDER BY created_at DESC LIMIT 1`,
          [agentId]
        )
        console.log(`📊 ${email}:`, cur.rows[0] || '(无生效订阅)')
        continue
      }

      // 已有 free_trial 行 → 延长它;没有 → 新建一条(并补 free_trial_started_at 戳)。
      // 唯一索引 idx_lt_subs_one_trial_per_agent 保证一个 agent 只有一条。
      const upd = await client.query(
        `UPDATE lt_subscriptions
            SET current_period_end = now() + ($2 || ' days')::interval,
                status = 'trialing',
                trial_credits = COALESCE($3::int, trial_credits),
                updated_at = now()
          WHERE agent_id = $1 AND source = 'free_trial'
          RETURNING current_period_end, trial_credits`,
        [agentId, String(days), credits]
      )

      if (!upd.rowCount) {
        const live = await client.query(
          `SELECT 1 FROM lt_subscriptions
            WHERE agent_id = $1 AND status IN ('active','trialing') AND source <> 'free_trial' LIMIT 1`,
          [agentId]
        )
        if (live.rowCount) {
          console.log(`⏭️  ${email} —— 已有付费/comp 订阅,跳过(不覆盖真实订阅)`)
          continue
        }
        const ins = await client.query(
          `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end, trial_credits)
             VALUES ($1, 'agent', 'trialing', 'free_trial', now() + ($2 || ' days')::interval, $3)
           RETURNING current_period_end, trial_credits`,
          [agentId, String(days), credits]
        )
        await client.query(
          `UPDATE lt_agents SET free_trial_started_at = COALESCE(free_trial_started_at, now()) WHERE id = $1`,
          [agentId]
        )
        console.log(`✅ ${email} —— 新建 ${days} 天试用,到期 ${ins.rows[0].current_period_end.toISOString().slice(0, 10)},积分 ${ins.rows[0].trial_credits ?? 200}`)
        continue
      }

      // 和后台「赠 30 天」走同一本账:名额记在 trial_granted_at/by 上,
      // 否则脚本发过之后,owner 在 admin 里还能再给同一个人赠一次。
      await client.query(
        `UPDATE lt_agents
            SET trial_granted_at = COALESCE(trial_granted_at, now()),
                trial_granted_by = COALESCE(trial_granted_by, $2)
          WHERE id = $1`,
        [agentId, `script:${process.env.USERNAME || 'owner'}`]
      )

      const r = upd.rows[0]
      console.log(`✅ ${email} —— 试用延长到 ${r.current_period_end.toISOString().slice(0, 10)}(${days} 天),积分 ${r.trial_credits ?? 200}`)
    }
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run()
