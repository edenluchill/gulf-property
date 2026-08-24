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
// 与扣费同源:试用额度的兜底值 / 无限白名单判定,都必须用 credits.ts 那一套,
// 不能在这里另写一份 —— 后台显示的数字和真正扣费的数字必须是同一个真相。
import { TRIAL_CREDITS, emailUnlimited } from '../luna-tour/credits'
import { ENTITLED_SQL } from '../lib/subscriptionStatus'

// ── 订阅客户(B 端:谁订阅了我们的 SaaS)──────────────────────────────
export interface Subscriber {
  agent_id: string
  email: string | null
  display_name: string | null
  /**
   * 🔴 **用户真选的角色(user_profiles.role),不是 lt_agents.role。**
   *
   * `lt_agents.role` 的列默认值就是 `'agent'`,而 `ensureAgent()` 在**每次登录**时
   * 都会给任何登录用户插一行 —— 于是买家、开发商、连角色都没选过的人,在后台
   * 一律被标成「经纪人」。2026-07-28 实测:36 个「未订阅经纪」里,9 个其实是买家、
   * 3 个是开发商、10 个从没选过角色 —— 真正没订阅的经纪只有 14 个。
   * owner 据此得出的「这么多经纪注册了不试用」是个假象。
   */
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
  // 后台一次性授予(每人只能一次)。非 null = 已用掉那次名额,不能再授予。
  trial_granted_at: string | null
  trial_granted_by: string | null
  /**
   * 以前**开过**试用(不管现在还生效没)。
   * 「从没试用」和「试用过期了」是两种完全不同的人:前者是激活问题(他连试都没试),
   * 后者是留存问题(他试了,没留下)。以前后台把两拨人塞进同一个「未订阅账户」列表,
   * 一个标签盖住了两个截然不同的结论。
   */
  trial_ever: boolean
  /** 最近一次调 API 的时间 —— 判断这个账号是不是还活着。 */
  last_seen: string | null
}

/**
 * 自愈对账:凡有生效订阅(active/trialing)的经纪,agents 审批状态强制 approved。
 *
 * webhook 的 autoApprovePaid 是主路径(付款成功即批);这个兜底修复两类不一致——
 * ① 订阅是该逻辑上线前就有的历史数据;② webhook 偶发把 agents 那步吞错(被 catch)。
 * 保证 owner 打开「订阅」后台时,绝不会看到「lt_subscriptions 已付费、agents 却待审批」
 * 的矛盾(付费即准入)。幂等、轻量(只 UPDATE 不一致的少数行);email 大小写不敏感匹配。
 */
export async function reconcilePaidApprovals(): Promise<number> {
  const r = await pool.query(
    `UPDATE agents SET status = 'approved', decided_at = now(), decided_by = 'reconcile:paid'
      WHERE status <> 'approved'
        AND EXISTS (
          SELECT 1 FROM lt_agents la
            JOIN lt_subscriptions s ON s.agent_id = la.id
           WHERE lower(la.email) = lower(agents.email)
             AND s.status IN ${ENTITLED_SQL}
        )`
  )
  return r.rowCount ?? 0
}

/**
 * Every registered agent account with its live subscription (if any), plan, real-
 * paid flag, approval status and this-month credit usage. Subscribed置顶、真付费再置顶。
 * Owner/internal rows kept (labelled) so the list is complete.
 */
export async function getSubscribers(): Promise<Subscriber[]> {
  await reconcilePaidApprovals().catch(() => { /* 自愈失败不阻塞列表 */ })
  const { rows } = await pool.query(
    `SELECT
        a.id                                   AS agent_id,
        a.email,
        a.display_name,
        -- 真实角色以 user_profiles 为准(见 Subscriber.role 的注释);
        -- 没有 user_profiles 记录 = 登录了但从没选过角色,单独标出来,别混进「经纪」。
        COALESCE(up.role, 'unset')             AS role,
        a.created_at                           AS agent_since,
        s.plan_id,
        p.name                                 AS plan_name,
        COALESCE(s.status, 'none')             AS status,
        (s.stripe_subscription_id IS NOT NULL) AS paid,
        ag.status                              AS approval_status,
        s.current_period_end,
        COALESCE(s.cancel_at_period_end, false) AS cancel_at_period_end,
        -- 额度口径必须和**扣费口径**(credits.planFor)完全一致,否则后台显示的是假账:
        --   试用 → 行上的 trial_credits;为 NULL 时兜底 TRIAL_CREDITS(200),**不是套餐月额**
        --   付费 → 套餐月额
        -- 之前一律取套餐月额 → 7 天自助试用(trial_credits IS NULL,实际只有 200 分)
        -- 被显示成 0/1200,看起来像人人都拿了 Pro 满额。
        CASE WHEN s.source = 'free_trial'
             THEN COALESCE(s.trial_credits, $1::int)
             ELSE COALESCE((p.limits->>'credits_month')::int, 0)
        END AS credits_month,
        -- 已用同理(credits.usedFor):试用**不按自然月**算,按「试用开始至今」的逐笔
        -- 流水累计 —— 否则跨月的试用一到月初就显示「已用归零」,而扣费那边照旧累计。
        -- (credits > 0 排除转化时写的负数补偿行。)
        CASE WHEN s.source = 'free_trial'
             THEN COALESCE(t.used, 0)
             ELSE COALESCE(u.credits_used, 0)
        END AS credits_used,
        a.trial_granted_at,
        a.trial_granted_by,
        EXISTS (SELECT 1 FROM lt_subscriptions ts
                 WHERE ts.agent_id = a.id AND ts.source = 'free_trial') AS trial_ever,
        ac.last_seen
       FROM lt_agents a
       LEFT JOIN user_profiles up ON lower(up.email) = lower(a.email)
       -- 最近活跃:**一次预聚合**,不要写成每行一个相关子查询。
       -- idx_api_calls_email 建在 user_email 原值上,一旦谓词写成 lower(user_email)=…
       -- 索引直接失效 → 80 个账号 = 80 次全表扫,实测整个接口 4.1s。
       -- 先 GROUP BY 出一张小表再 join:同样的结果,一次扫描。
       LEFT JOIN (
         SELECT lower(user_email) AS em, max(created_at) AS last_seen
           FROM api_calls WHERE user_email IS NOT NULL GROUP BY 1
       ) ac ON ac.em = lower(a.email)
       -- 🔴 past_due 必须算「有订阅」。
       -- 以前只 JOIN active/trialing —— 于是**卡扣失败的付费客户**掉进「未订阅账户」,
       -- 和从没付过钱的人排在一起,后台给他的唯一操作是「赠 Pro 30 天」。
       -- 2026-07-28 实测:全站唯一一个外部真付费客户(slavynchuk94)正好就是 past_due,
       -- 而后台把他显示成「注册了还没付费」。该做的是催他换卡,不是送他 30 天。
       -- unpaid / incomplete 同理:都是钱出了问题的现有客户,不是新注册。
       -- ⚠️ 这段在模板字符串里,注释**绝不能带反引号**(会直接把模板字面量截断)。
       LEFT JOIN lt_subscriptions s
         ON s.agent_id = a.id
        AND s.status IN ('active','trialing','past_due','unpaid','incomplete')
       LEFT JOIN lt_subscription_plans p ON p.id = s.plan_id
       LEFT JOIN agents ag ON lower(ag.email) = lower(a.email)
       LEFT JOIN lt_usage_counters u
         ON u.agent_id = a.id AND u.period_month = date_trunc('month', now())::date
       LEFT JOIN LATERAL (
         SELECT SUM(l.credits) AS used
           FROM lt_credit_ledger l
          WHERE l.agent_id = a.id AND l.credits > 0 AND l.created_at >= s.created_at
       ) t ON s.source = 'free_trial'
      ORDER BY (s.status IS NOT NULL) DESC,
               (s.stripe_subscription_id IS NOT NULL) DESC,
               a.created_at DESC`,
    [TRIAL_CREDITS]
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
    // 无限白名单(owner + UNLIMITED_EMAILS)扣费时根本不计费 —— 后台也必须显示
    // 「无限积分」(-1 是前端的无限标记),而不是套餐的 200/1200 那种假额度。
    credits_month: emailUnlimited(r.email) ? -1 : Number(r.credits_month),
    credits_used: emailUnlimited(r.email) ? 0 : Number(r.credits_used),
    is_internal: isOwnerEmail(r.email),
    trial_granted_at: r.trial_granted_at,
    trial_granted_by: r.trial_granted_by,
    trial_ever: !!r.trial_ever,
    last_seen: r.last_seen,
  }))
}

/** Headline subscription counters for the 概览 / 订阅 tab. */
/**
 * @param pre 已经取好的账户列表 —— 路由里 subscribers 和 summary 是一起返回的,
 *   不传的话这里会**把那条不便宜的查询原样再跑一遍**(实测各 1.5s,白等一倍)。
 */
export async function getSubscriptionSummary(pre?: Subscriber[]) {
  const subs = pre ?? await getSubscribers()
  const real = subs.filter((s) => s.status !== 'none')
  const paid = real.filter((s) => s.paid && !s.is_internal)
  const trialing = real.filter((s) => s.status === 'trialing')
  // 手动赠送 = 有订阅、非真付费,且不是扣款失败的(那是付费客户,别混进赠送数)
  const comp = real.filter((s) => !s.paid && !s.is_internal && s.status === 'active')
  /**
   * 「注册了没试用」的真实分母 —— **只数真经纪**。
   * 买家不订阅是设计如此(他们就是免费那一侧),开发商另有口径,没选过角色的连
   * 试用入口都摸不到。把他们算进「未转化的经纪」只会得出一个虚高的坏消息。
   */
  const agents = subs.filter((s) => s.role === 'agent' && !s.is_internal)
  return {
    total_accounts: subs.length,
    subscribed: real.length,
    paid: paid.length,
    trialing: trialing.length,
    comp: comp.length,
    pending_approval: subs.filter((s) => s.approval_status === 'pending').length,
    // 钱出了问题的现有客户 —— 该催换卡,不是当新注册对待
    payment_failed: real.filter((s) => ['past_due', 'unpaid', 'incomplete'].includes(s.status)).length,
    // 真经纪里:从没开过试用 vs 试用过但现在没订阅(激活问题 vs 留存问题)
    agents_total: agents.length,
    agents_never_trialed: agents.filter((s) => !s.trial_ever && s.status === 'none').length,
    agents_trial_expired: agents.filter((s) => s.trial_ever && s.status === 'none').length,
    // 登录了但从没选过角色 —— 他们连试用接口都会被 403(not_agent)挡回
    role_unset: subs.filter((s) => s.role === 'unset').length,
    buyers: subs.filter((s) => s.role === 'buyer').length,
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
