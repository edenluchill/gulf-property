/**
 * 后台一次性赠送试用 —— 单一入口(2026-07-13)。
 *
 * ⚠️ 取代旧的「授予永久套餐」:旧实现插一条 **100 年期**的 comp 行,而 100 年 comp
 * **没有任何过期清理** —— freeTrialSweep 和 credits/mapMeter 的即时过期谓词都只认
 * `source='free_trial'` → 发出去就是永久免费,没人收得回;同一个人还能反复发;
 * 操作人只存在 reason 字符串里,查不了也不可信。
 *
 * 新规则(owner 定):**每人只能一次**、固定 30 天、走 free_trial 行(到期由 sweep
 * 自动翻 canceled)、谁发的/何时发的落到 lt_agents.trial_granted_at/by 列上。
 *
 * 防重复授予 = 原子占位(同 services/freeTrial.ts 的理由):
 *   UPDATE lt_agents SET trial_granted_at = now() WHERE id = $1 AND trial_granted_at IS NULL
 * 单条语句 → 行锁天然互斥,并发双击只有一个能拿到行。**占位必须在所有业务检查之前**:
 * 若先查「有没有生效订阅」再占位,并发时输家会撞到那个检查而不是「已赠送过」,
 * 结果取决于线程时序。占位后任何校验失败**必须把戳退回去**,否则他占了名额却没拿到试用。
 */
import pool from '../db/pool'

// 30 天 / 1200 分 = 专业版满月额,给的是完整一个月的 Pro 体验。
// 发 agent(Pro)档而不是 rookie:实时带看 / Luna 导览的 minPlan 就是 agent,
// 发低了旗舰功能试不到,试用等于没试。
export const GRANT_TRIAL_DAYS = Number(process.env.GRANT_TRIAL_DAYS || 30)
export const GRANT_TRIAL_CREDITS = Number(process.env.GRANT_TRIAL_CREDITS || 1200)
export const GRANT_TRIAL_PLAN = 'agent'

export interface GrantResult {
  ok: boolean
  days?: number
  credits?: number
  code?: 'already_granted' | 'already_subscribed'
  grantedAt?: string | null
  grantedBy?: string | null
}

/** 一次性赠送 30 天试用。并发安全:同一 agent 并发调 N 次,只有一次 ok。 */
export async function grantOneTimeTrial(agentId: string, email: string, actor: string): Promise<GrantResult> {
  // ── 锁:原子占位,必须在所有检查之前 ────────────────────────────
  const claim = await pool.query(
    `UPDATE lt_agents SET trial_granted_at = now(), trial_granted_by = $2
      WHERE id = $1 AND trial_granted_at IS NULL
      RETURNING id`,
    [agentId, actor]
  )
  if (!claim.rowCount) {
    const prev = await pool.query<{ trial_granted_at: Date | null; trial_granted_by: string | null }>(
      `SELECT trial_granted_at, trial_granted_by FROM lt_agents WHERE id = $1`, [agentId]
    )
    return {
      ok: false,
      code: 'already_granted',
      grantedAt: prev.rows[0]?.trial_granted_at?.toISOString() ?? null,
      grantedBy: prev.rows[0]?.trial_granted_by ?? null,
    }
  }

  try {
    // 已有真实付费订阅 / 存量永久 comp → 不需要赠送,更不能覆盖人家的订阅。
    const live = await pool.query(
      `SELECT 1 FROM lt_subscriptions
        WHERE agent_id = $1 AND status IN ('active','trialing') AND source <> 'free_trial'
        LIMIT 1`,
      [agentId]
    )
    if (live.rowCount) {
      await releaseClaim(agentId)
      return { ok: false, code: 'already_subscribed' }
    }

    // 换发试用行:自助领的 7 天/200 分(若有)删掉,换成 30 天/1200 分。
    // created_at=now → credits.usedFor 的用量按新试用起点重新累计。
    // 唯一索引 idx_lt_subs_one_trial_per_agent 保证只会存在一条 free_trial 行。
    await pool.query(`DELETE FROM lt_subscriptions WHERE agent_id = $1 AND source = 'free_trial'`, [agentId])
    await pool.query(
      `INSERT INTO lt_subscriptions (agent_id, plan_id, status, source, current_period_end, trial_credits)
         VALUES ($1, $2, 'trialing', 'free_trial', now() + ($3 || ' days')::interval, $4)`,
      [agentId, GRANT_TRIAL_PLAN, String(GRANT_TRIAL_DAYS), GRANT_TRIAL_CREDITS]
    )
    // 自助领取戳也补上 —— 否则他还能再去前台自己领一次 7 天。
    await pool.query(
      `UPDATE lt_agents SET free_trial_started_at = COALESCE(free_trial_started_at, now()) WHERE id = $1`,
      [agentId]
    )
  } catch (e) {
    await releaseClaim(agentId)
    throw e
  }

  await audit(agentId, email, 'trial_granted', GRANT_TRIAL_PLAN,
    `${GRANT_TRIAL_DAYS} 天 / ${GRANT_TRIAL_CREDITS} 分`, actor)

  return { ok: true, days: GRANT_TRIAL_DAYS, credits: GRANT_TRIAL_CREDITS }
}

/**
 * 撤销赠送:停掉所有非 Stripe 的订阅行(comp + 赠送的试用),不动真实付费订阅。
 * **不退还赠送名额** —— 一人一次就是一次(真要退回,直接改 DB)。
 */
export async function revokeGrant(agentId: string, email: string, actor: string): Promise<void> {
  await pool.query(
    `UPDATE lt_subscriptions SET status = 'canceled', updated_at = now()
       WHERE agent_id = $1 AND stripe_subscription_id IS NULL AND status <> 'canceled'`,
    [agentId]
  )
  await audit(agentId, email, 'comp_revoked', 'explore', 'manual revoke', actor)
}

async function releaseClaim(agentId: string): Promise<void> {
  await pool.query(
    `UPDATE lt_agents SET trial_granted_at = NULL, trial_granted_by = NULL WHERE id = $1`,
    [agentId]
  ).catch((e) => console.error('[admin-grant] release claim failed:', e))
}

async function audit(
  agentId: string, email: string, action: string, toPlan: string, reason: string, actor: string
): Promise<void> {
  await pool.query(
    `INSERT INTO plan_change_log (agent_id, agent_email, action, to_plan, reason, actor_email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [agentId, email, action, toPlan, reason, actor]
  ).catch((e) => console.error('[admin-grant] audit failed:', e))
}
