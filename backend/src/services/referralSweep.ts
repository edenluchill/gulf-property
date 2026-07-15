/**
 * 推荐计划定时结算 (2026-07-14) — docs/referral-program-spec.md
 *
 * 每 5 分钟一轮:
 *   1) attached 超过转化死线(180 天)仍未付费 → expired
 *   2) pending 过了 30 天 clawback hold 且无风控 flag → qualified
 *   3) 每满 3 个 qualified → 建 reward(milestone)
 *   4) 未落账的 reward(pending/failed)→ 打进 Stripe customer balance
 *
 * 为什么用 sweep 而不是在 webhook 里即时算:hold 的「30 天后」没有 Stripe 事件来触发,
 * 必须靠轮询;而且 milestone 结算集中在一处,避免 webhook 各分支重复算。
 * webhook 只负责把状态往前推一格(markPaid / revoke),结算交给这里。
 *
 * ⚠️ 只在生产跑(同 freeTrialSweep):本机 ts-node-dev 残留连的是生产库,
 *    后台写库任务在本地会偷偷改生产数据(见 memory: local-dev-ghost-processes)。
 */
import Stripe from 'stripe'
import { beginMaintenance, endMaintenance } from './perfSink'
import {
  expireStaleReferrals,
  promoteHeldReferrals,
  grantDueRewards,
  applyPendingRewards,
} from './referral'
import pool from '../db/pool'

const SWEEP_INTERVAL_MS = 5 * 60_000

let _stripe: Stripe | null = null
function getStripe(): Stripe | null {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  _stripe = new Stripe(key)
  return _stripe
}

/** 跑一轮结算。返回 {expired, qualified 涉及的经纪数, applied}。 */
export async function sweepReferrals(): Promise<{ expired: number; agents: number; applied: number }> {
  beginMaintenance() // 批量维护查询不计入慢查询告警
  try {
    const expired = await expireStaleReferrals()

    // hold 期满 → qualified,拿到受影响的推荐人
    const agents = await promoteHeldReferrals()

    // 每个推荐人:结算 milestone → 立即尝试落账
    const stripe = getStripe()
    let applied = 0
    for (const agentId of agents) {
      const created = await grantDueRewards(agentId)
      if (created && stripe) applied += await applyPendingRewards(stripe, agentId)
    }

    // 兜底:捡起所有历史遗留的未落账 reward(比如上轮 Stripe 调用失败,或推荐人
    // 达标时还没订阅、后来订阅了但没走 checkout flush 的边角情况)。
    if (stripe) {
      const stuck = await pool.query<{ agent_id: string }>(
        `SELECT DISTINCT agent_id FROM lt_referral_rewards WHERE status IN ('pending','failed')`
      )
      for (const r of stuck.rows) {
        applied += await applyPendingRewards(stripe, r.agent_id)
      }
    }

    if (expired || agents.length || applied) {
      console.log(`[referral] sweep: expired=${expired} qualified-agents=${agents.length} rewards-applied=${applied}`)
    }
    return { expired, agents: agents.length, applied }
  } finally {
    endMaintenance()
  }
}

export function startReferralSweep(): void {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[referral] sweep disabled (NODE_ENV !== production)')
    return
  }
  const tick = () => {
    sweepReferrals().catch((e) => console.error('[referral] sweep failed:', e))
  }
  tick()
  setInterval(tick, SWEEP_INTERVAL_MS).unref()
}
