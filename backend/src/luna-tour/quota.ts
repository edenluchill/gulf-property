/**
 * 订阅配额检查 + 计量(所有高级经纪功能统一走这里)。
 *
 * 套餐额度存 lt_subscription_plans.limits;用量存 lt_usage_counters(按月)。
 * 没有 active/trialing 订阅 → 落到 explore 档,其经纪工具额度已硬归零 → 一律拦。
 * OWNER_EMAILS 视为无限(方便自测/自用)。limit < 0 = 无限。
 *
 * 设计稿: docs/stripe-billing-spec.md §6
 */
import pool from '../db/pool'
import { isOwnerEmail } from '../middleware/requireOwner'

export type Feature = 'luna_tours' | 'live_tours' | 'reports'

// feature → 套餐额度 key + 月度计数列(列名为白名单常量,可安全内插)
const FEATURE: Record<Feature, { limitKey: string; counter: string; label: string }> = {
  luna_tours: { limitKey: 'sessions_month', counter: 'sessions_created', label: 'Luna 智能导览' },
  live_tours: { limitKey: 'live_tours_month', counter: 'live_tours_created', label: '实时带看' },
  reports: { limitKey: 'reports_month', counter: 'reports_created', label: '买家意向报告' },
}

export interface QuotaState {
  allowed: boolean
  used: number
  limit: number // -1 = 无限
  plan: string
  status: string // none | trialing | active | past_due | canceled | owner
  owner: boolean
}

/** 该经纪当前生效的套餐(无生效订阅 → explore)。 */
async function planFor(agentId: string): Promise<{ plan: string; status: string }> {
  const sub = await pool.query<{ plan_id: string; status: string }>(
    `SELECT plan_id, status FROM lt_subscriptions
       WHERE agent_id = $1 AND status IN ('active', 'trialing')
       ORDER BY created_at DESC LIMIT 1`,
    [agentId]
  )
  return { plan: sub.rows[0]?.plan_id || 'explore', status: sub.rows[0]?.status || 'none' }
}

/** 检查某功能是否还有额度(不增加计数)。 */
export async function checkQuota(agentId: string, feature: Feature): Promise<QuotaState> {
  const { limitKey, counter } = FEATURE[feature]

  // owner 无限
  const a = await pool.query<{ email: string | null }>(`SELECT email FROM lt_agents WHERE id = $1`, [agentId])
  if (isOwnerEmail(a.rows[0]?.email)) {
    return { allowed: true, used: 0, limit: -1, plan: 'founder', status: 'owner', owner: true }
  }

  const { plan, status } = await planFor(agentId)
  const lim = await pool.query<{ lim: number | null }>(
    `SELECT (limits->>$2)::int AS lim FROM lt_subscription_plans WHERE id = $1`,
    [plan, limitKey]
  )
  const limit = lim.rows[0]?.lim != null ? Number(lim.rows[0].lim) : 0 // 默认 0(没套餐就拦)
  const cnt = await pool.query<{ used: number }>(
    `SELECT COALESCE(${counter}, 0) AS used FROM lt_usage_counters
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
  const used = Number(cnt.rows[0]?.used ?? 0)
  return { allowed: limit < 0 || used < limit, used, limit, plan, status, owner: false }
}

/** 成功执行某功能后 +1 计数(月度 upsert)。 */
export async function meter(agentId: string, feature: Feature): Promise<void> {
  const { counter } = FEATURE[feature]
  const upd = await pool.query(
    `UPDATE lt_usage_counters SET ${counter} = ${counter} + 1
       WHERE agent_id = $1 AND period_month = date_trunc('month', now())::date`,
    [agentId]
  )
  if (!upd.rowCount) {
    await pool.query(
      `INSERT INTO lt_usage_counters (agent_id, period_month, ${counter})
         VALUES ($1, date_trunc('month', now())::date, 1)`,
      [agentId]
    )
  }
}

/** 统一的"额度不足/需订阅"响应(402 Payment Required)。 */
export function quotaError(feature: Feature, q: QuotaState): { status: number; body: Record<string, unknown> } {
  const label = FEATURE[feature].label
  const reason =
    q.status === 'none'
      ? `${label}需要订阅后才能使用。升级到 Agent 套餐即可解锁。`
      : `本月${label}额度已用完(${q.used}/${q.limit},${q.plan} 套餐)。升级套餐可获得更多。`
  return {
    status: 402,
    body: { success: false, error: reason, code: 'quota_exceeded', feature, used: q.used, limit: q.limit, plan: q.plan, upgradeUrl: '/agent/billing' },
  }
}
