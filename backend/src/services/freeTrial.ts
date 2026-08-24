/**
 * 领取免费试用 —— 单一入口,原子、可并发安全 (2026-07-11)。
 *
 * 防重复领取有两道锁,缺一不可:
 *   1. **原子占位**:UPDATE lt_agents SET free_trial_started_at = now()
 *      WHERE id = $1 AND free_trial_started_at IS NULL RETURNING id
 *      单条语句 → 行锁天然互斥。并发 N 个请求只有一个拿到返回行,其余全是
 *      rowCount=0 → 直接 409。(原来是"先 SELECT 查戳、再 INSERT"的读后写,
 *      双击按钮就能让两个请求同时通过检查。)
 *   2. **DB 硬约束**:idx_lt_subs_one_trial_per_agent —— 一个 agent 最多一条
 *      source='free_trial' 行。就算应用层哪天写漏了,数据库也不允许出现第二条。
 *
 * 注意:抢到占位后如果后续 INSERT 失败,必须把戳退回去 —— 否则用户永远失去了
 * 领取资格(占了位却没拿到试用)。
 */
import pool from '../db/pool'
import { ENTITLED_SQL } from '../lib/subscriptionStatus'

export const TRIAL_DAYS = Number(process.env.FREE_TRIAL_DAYS || 7)
// 试用发 Pro(agent)档的功能权限;积分不吃 Pro 的 1200,由 credits.planFor 锁在 TRIAL_CREDITS。
export const TRIAL_PLAN = 'agent'
export const TRIAL_ROLES = ['agent', 'agency', 'developer'] as const
export type TrialRole = typeof TRIAL_ROLES[number]

export interface ClaimResult {
  ok: boolean
  endsAt?: string                                        // ok=true 时有
  code?: 'trial_used' | 'already_subscribed'             // ok=false 时有
  error?: string
}

/**
 * 领取 7 天免费试用。并发安全:同一 agent 并发调用 N 次,只有一次返回 ok。
 * 调用方负责鉴权、角色校验、落 role、审批与审计。
 */
export async function claimFreeTrial(agentId: string, billingAgentId = agentId): Promise<ClaimResult> {
  // ── 锁 1:原子占位,**必须放在所有检查之前**。
  // 若先查"有没有生效订阅"再占位,并发时赢家插入试用行后,输家会先撞到那个检查 →
  // 返回 already_subscribed 而不是 trial_used,结果取决于线程时序(不确定)。
  // 先占位:抢不到 = 已经领过(或另一个并发请求刚抢走)→ 永远是 trial_used。
  const claim = await pool.query(
    `UPDATE lt_agents SET free_trial_started_at = now()
      WHERE id = $1 AND free_trial_started_at IS NULL
      RETURNING id`,
    [agentId]
  )
  if (!claim.rowCount) {
    return { ok: false, code: 'trial_used', error: '免费试用已用过,订阅即可继续使用。' }
  }

  // 占位成功后再做业务校验。任何一条不通过 → **必须把戳退回去**,
  // 否则他占了位却没拿到试用 = 永远失去领取资格。
  try {
    // 已有生效订阅(自己的 / 团队席位的 / 后台 comp 授予的)→ 不需要试用
    const live = await pool.query(
      `SELECT 1 FROM lt_subscriptions
        WHERE agent_id = $1 AND status IN ${ENTITLED_SQL}
          AND (source <> 'free_trial' OR current_period_end > now())
        LIMIT 1`,
      [billingAgentId]
    )
    if (live.rows.length) {
      await releaseClaim(agentId)
      return { ok: false, code: 'already_subscribed', error: '你已有生效的套餐。' }
    }

    const endsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString()
    // ── 锁 2:唯一索引兜底(idx_lt_subs_one_trial_per_agent)—— 应用层写漏了也插不进第二条
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end)
         VALUES ($1, $2, 'trialing', 'free_trial', $3)`,
      [agentId, TRIAL_PLAN, endsAt]
    )
    return { ok: true, endsAt }
  } catch (e) {
    await releaseClaim(agentId)
    throw e
  }
}

/** 占位失败/回滚:把资格还给用户。 */
async function releaseClaim(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE lt_agents SET free_trial_started_at = NULL WHERE id = $1`, [agentId]
  ).catch((e) => console.error('[free-trial] release claim failed:', e))
}
