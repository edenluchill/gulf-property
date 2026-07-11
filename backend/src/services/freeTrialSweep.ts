/**
 * 免绑卡试用过期清理 (2026-07-11) — docs/no-card-trial-plan-2026-07-11.md
 *
 * 免绑卡试用没有 Stripe 订阅,也就没有 webhook 来把它从 trialing 关掉。
 * 这个 sweep 把过期的试用行真正翻成 canceled,好处是 DB 状态对**所有**读取方
 * (billing /me、证书标题、teamSubOf、admin 后台…)都变成真的,不必在每个
 * `status IN ('active','trialing')` 的查询里散点补过期判断。
 *
 * 钱相关的两道门(credits.planFor / mapMeter.agentNeedsPlan)另外各带一个即时的
 * 过期谓词,不依赖这个 sweep —— 那两处不能容忍 5 分钟的窗口。
 *
 * ⚠️ 只动 source='free_trial'。后台 comp 授予(agents.ts,100 年期终身账户)的
 *    stripe_subscription_id 也是 NULL,拿它当判据会把终身客户一起干掉。
 */
import pool from '../db/pool'
import { beginMaintenance, endMaintenance } from './perfSink'
import { clearAgentGate } from '../middleware/mapMeter'

const SWEEP_INTERVAL_MS = 5 * 60_000

/** 把已过期的免绑卡试用翻成 canceled + 记审计。返回过期条数。 */
export async function expireFreeTrials(): Promise<number> {
  beginMaintenance() // 批量维护查询不计入慢查询告警(否则报警刷屏)
  try {
    const { rowCount } = await pool.query(
      `WITH expired AS (
         UPDATE lt_subscriptions SET status = 'canceled', updated_at = now()
          WHERE source = 'free_trial' AND status = 'trialing' AND current_period_end <= now()
        RETURNING agent_id, plan_id
       )
       INSERT INTO plan_change_log
         (agent_id, agent_email, action, from_plan, to_plan, from_status, to_status)
       SELECT e.agent_id, a.email, 'free_trial_expired', e.plan_id, 'explore', 'trialing', 'canceled'
         FROM expired e LEFT JOIN lt_agents a ON a.id = e.agent_id`
    )
    if (rowCount) {
      console.log(`[free-trial] expired ${rowCount} trial(s)`)
      clearAgentGate() // 地图门缓存按 userId,这里拿不到 → 全清,60s 内自然重建
    }
    return rowCount ?? 0
  } finally {
    endMaintenance()
  }
}

/**
 * 定时清理。
 * ⚠️ 只在生产跑:本机 ts-node-dev 残留进程连的是生产库,后台写库任务会在本地
 *    偷偷改生产数据(见 memory: local-dev-ghost-processes)。
 */
export function startFreeTrialSweep(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[free-trial] sweep disabled (NODE_ENV !== production)')
    return
  }
  const tick = () => {
    expireFreeTrials().catch((e) => console.error('[free-trial] sweep failed:', e))
  }
  tick()
  setInterval(tick, SWEEP_INTERVAL_MS).unref()
}
