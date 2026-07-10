/**
 * Admin dashboard — business / feature-usage queries (owner-only).
 *
 * Distinct from analyticsQueries.ts (which reads app_events behaviour): these read
 * the lt_* business tables — subscriptions and the actual feature-output records
 * (Luna tours, Sales Offers, buyer reports). Powers the new 「订阅」 and 「功能记录」
 * tabs. See docs/admin-dashboard-refactor-plan-2026-07-09.md.
 */
import pool from '../db/pool'
import { isOwnerEmail } from '../middleware/requireOwner'

// ── 订阅客户(B 端:谁订阅了我们的 SaaS)──────────────────────────────
export interface Subscriber {
  agent_id: string
  email: string | null
  display_name: string | null
  role: string | null
  agent_since: string
  plan_id: string | null
  plan_name: string | null
  status: string          // active / trialing / none
  paid: boolean           // 真付费(有 stripe_subscription_id)vs 手动赠送
  approval_status: string | null   // agents 审批表:pending/approved/rejected
  current_period_end: string | null
  cancel_at_period_end: boolean
  credits_month: number   // -1 = 无限
  credits_used: number
  is_internal: boolean    // owner/自己人,展示时标注
}

/**
 * Every registered agent account with its live subscription (if any), plan, real-
 * paid flag, approval status and this-month credit usage. Subscribed置顶、真付费再置顶。
 * Owner/internal rows kept (labelled) so the list is complete.
 */
export async function getSubscribers(): Promise<Subscriber[]> {
  const { rows } = await pool.query(
    `SELECT
        a.id                                   AS agent_id,
        a.email,
        a.display_name,
        a.role,
        a.created_at                           AS agent_since,
        s.plan_id,
        p.name                                 AS plan_name,
        COALESCE(s.status, 'none')             AS status,
        (s.stripe_subscription_id IS NOT NULL) AS paid,
        ag.status                              AS approval_status,
        s.current_period_end,
        COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end,
        COALESCE((p.limits->>'credits_month')::int, 0) AS credits_month,
        COALESCE(u.credits_used, 0)            AS credits_used
       FROM lt_agents a
       LEFT JOIN lt_subscriptions s
         ON s.agent_id = a.id AND s.status IN ('active','trialing')
       LEFT JOIN lt_subscription_plans p ON p.id = s.plan_id
       LEFT JOIN agents ag ON lower(ag.email) = lower(a.email)
       LEFT JOIN lt_usage_counters u
         ON u.agent_id = a.id AND u.period_month = date_trunc('month', now())::date
      ORDER BY (s.status IS NOT NULL) DESC,
               (s.stripe_subscription_id IS NOT NULL) DESC,
               a.created_at DESC`
  )
  return rows.map((r) => ({
    agent_id: r.agent_id,
    email: r.email,
    display_name: r.display_name,
    role: r.role,
    agent_since: r.agent_since,
    plan_id: r.plan_id,
    plan_name: r.plan_name,
    status: r.status,
    paid: !!r.paid,
    approval_status: r.approval_status,
    current_period_end: r.current_period_end,
    cancel_at_period_end: !!r.cancel_at_period_end,
    credits_month: Number(r.credits_month),
    credits_used: Number(r.credits_used),
    is_internal: isOwnerEmail(r.email),
  }))
}

/** Headline subscription counters for the 概览 / 订阅 tab. */
export async function getSubscriptionSummary() {
  const subs = await getSubscribers()
  const real = subs.filter((s) => s.status !== 'none')
  const paid = real.filter((s) => s.paid && !s.is_internal)
  const trialing = real.filter((s) => s.status === 'trialing')
  const comp = real.filter((s) => !s.paid && !s.is_internal) // 手动赠送
  // MRR 预估:真付费 active 订阅的套餐月价(从 plans 表口径,粗略)。
  return {
    total_accounts: subs.length,
    subscribed: real.length,
    paid: paid.length,
    trialing: trialing.length,
    comp: comp.length,
    pending_approval: subs.filter((s) => s.approval_status === 'pending').length,
  }
}

// ── 功能记录(实际产出:导览 / Sales Offer / 报告)────────────────────

/** Luna 导览生成记录(lt_tour_scripts + demo session + agent)。 */
export async function getTourScripts(limit = 100) {
  const { rows } = await pool.query(
    `SELECT ts.id, ts.language, ts.voice, ts.total_ms, ts.edited_by_agent, ts.created_at,
            ds.title, ds.share_code, ds.status, ds.view_limit,
            a.email AS agent_email, a.display_name AS agent_name
       FROM lt_tour_scripts ts
       LEFT JOIN lt_demo_sessions ds ON ds.id = ts.session_id
       LEFT JOIN lt_agents a ON a.id = ds.agent_id
      ORDER BY ts.created_at DESC LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title || '(未命名导览)',
    share_code: r.share_code,
    status: r.status,
    language: r.language,
    total_ms: r.total_ms == null ? null : Number(r.total_ms),
    edited_by_agent: !!r.edited_by_agent,
    agent_email: r.agent_email,
    agent_name: r.agent_name,
    created_at: r.created_at,
  }))
}

/** Sales Offer 报价单生成记录(lt_payment_shares + 项目名 + agent)。 */
export async function getSalesOffers(limit = 100) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.share_code, ps.unit_name, ps.bedrooms, ps.price, ps.original_price,
            ps.lang, ps.created_by_email, ps.view_count, ps.created_at,
            rp.project_name,
            a.display_name AS agent_name
       FROM lt_payment_shares ps
       LEFT JOIN residential_projects rp ON rp.id = ps.project_id
       LEFT JOIN lt_agents a ON a.id = ps.agent_id
      ORDER BY ps.created_at DESC LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({
    id: r.id,
    share_code: r.share_code,
    project_name: r.project_name || '(项目未知)',
    unit_name: r.unit_name,
    bedrooms: r.bedrooms,
    price: r.price == null ? null : Number(r.price),
    original_price: r.original_price == null ? null : Number(r.original_price),
    lang: r.lang,
    agent_name: r.agent_name,
    created_by_email: r.created_by_email,
    view_count: Number(r.view_count || 0),
    created_at: r.created_at,
  }))
}

/** 买家意向报告 + 品牌项目报告(两表 UNION,统一展示)。 */
export async function getBuyerReports(limit = 100) {
  const { rows } = await pool.query(
    `SELECT id::text, share_code, title, status, view_count, created_at, kind, agent_id
       FROM (
         SELECT cr.id, cr.share_code,
                COALESCE(NULLIF(cr.client_name,''), '买家报告') AS title,
                cr.status, cr.view_count, cr.created_at, 'client'::text AS kind, cr.agent_id
           FROM lt_client_reports cr
         UNION ALL
         SELECT pr.id, pr.share_code,
                COALESCE(NULLIF(pr.title,''), '品牌报告') AS title,
                CASE WHEN pr.is_published THEN 'published' ELSE 'draft' END AS status,
                pr.view_count, pr.created_at, 'project'::text AS kind, pr.agent_id
           FROM lt_project_reports pr
       ) u
      ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  // agent 名单一次查回,内存 map(两表 agent_id 混合,查询里 join 会重复)
  const agentIds = [...new Set(rows.map((r) => r.agent_id).filter(Boolean))]
  const nameById = new Map<string, string>()
  if (agentIds.length) {
    const a = await pool.query(`SELECT id, display_name, email FROM lt_agents WHERE id = ANY($1::uuid[])`, [agentIds])
    a.rows.forEach((x) => nameById.set(x.id, x.display_name || x.email || ''))
  }
  return rows.map((r) => ({
    id: r.id,
    share_code: r.share_code,
    title: r.title,
    status: r.status,
    kind: r.kind as 'client' | 'project',
    view_count: Number(r.view_count || 0),
    agent_name: r.agent_id ? nameById.get(r.agent_id) || null : null,
    created_at: r.created_at,
  }))
}
