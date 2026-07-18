/**
 * 健康度面板 —— 「我们现在到底健不健康」一屏可判。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 设计前提：**这个面板的主角是绝对数，不是百分比。**
 *
 * 现阶段真实外部用户是个位数。n=1~3 时百分比会骗人：再来 1 个激活用户，激活率就从
 * 2% 跳到 4%（翻倍），但什么都没发生。所以每个比率都必须**带着它的分母 n 一起返回**，
 * 前端在 n 太小时显示「样本不足」而不是假精度的百分比。
 *
 * benchmark 只作灰色参考线，不做红绿告警 —— 一个天天全红的面板，一周内就会变成墙纸。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️⚠️ **最容易搞反的坑：这里绝不能套 analyticsQueries.internalVisitorIds()。**
 *
 * 那个函数排除的是「非客户流量」，其中包括**所有注册经纪**（因为对 C 端 lead 分析来说，
 * 经纪是卖房的、不是买家）。但这个面板要测的**恰恰就是经纪的活跃度和试用情况** ——
 * 直接套用会把要测的对象全删光，面板永远显示 0。
 *
 * 所以这里是两套过滤：
 *   • B 端指标（经纪注册/试用/活跃/产出）→ 直查 lt_agents，只排下面的 INTERNAL_AGENTS
 *   • C 端指标（客户观看产出物）→ 不需要排除，因为观看者本来就是外部客户
 *
 * 见 docs/reports/2026-07-09-admin-dashboard-audit.md 与 analytics-internal-exclusion 记忆条。
 */
import pool from '../db/pool'

export interface HealthRange {
  days: number
}

/**
 * 「自己人」经纪账号 —— B 端统计里要剔除的。
 *
 * ⚠️ 这份名单**故意写死在代码里而不是读 env**，因为它直接决定面板上每一个数字，
 *    必须能在 code review 里一眼看到、在 git 里留下修改记录。改它 = 改口径。
 *
 * 🔴 **2026-07-18 owner 逐个确认过。这份名单是「谁不算真实客户」的唯一真相源。**
 *    在此之前，`shelldubai26` 被 2026-07-17 的使用率报告当成「唯一真实外部经纪」，
 *    并据此得出「真实外部用户建过 tour = 1 人」——**那是错的，他是合伙人。**
 *    更正后的事实：**至今没有任何外部经纪创建过哪怕一个 Luna Tour。**
 *    往这个数组里加人 = 让某个「客户」消失，**必须 owner 明确确认过才能加**。
 */
const INTERNAL_AGENTS = [
  'lzp6529@gmail.com',      // owner
  'demo-agent@luna.tour',   // 内置 demo 账号
  'edenlu1995@gmail.com',   // owner 另一个账号
  'shelldubai26@gmail.com', // 合伙人 SHUAI WANG（乙方，见 docs/signed/ 的合伙协议）
  'admin@yesir.ai',         // owner 另一个账号
  'realtorgptapp@gmail.com',
].map((s) => s.toLowerCase())

/** 一个「产出 → 被消费」的功能。produced 是经纪做出来的，consumed 是客户真的看了。 */
export interface FeatureHealth {
  key: string
  label: string
  /** 本期产出数（经纪做了多少） */
  produced: number
  /** 上一个等长周期的产出数，用于环比 */
  producedPrev: number
  /** 本期被真实消费数（客户真的打开/看了） */
  consumed: number
  consumedPrev: number
  /** 消费侧的原始计数（如总观看次数），比 consumed 更细 */
  consumedDetail: string | null
  /** 这个功能的数据是否能区分内外部；不能的话前端要明说，不能假装干净 */
  canSplitInternal: boolean
  /** 数据口径说明，直接显示给 owner，避免他对着数字猜 */
  note: string
}

/**
 * 四个付费功能的「产出 → 被消费」。
 *
 * 🔴 为什么盯「被消费」而不是「产出」：**生成了 ≠ 有价值。**
 *    经纪建了一个 tour 但从没发给客户，或发了客户没打开 —— 说明他自己都不信这东西值得发。
 *    这是最早能看出功能没被认可的信号，比留存率早得多。
 */
async function featureHealth(days: number): Promise<FeatureHealth[]> {
  const cur = `now() - interval '${days} days'`
  const prevFrom = `now() - interval '${days * 2} days'`
  const prevTo = cur

  // ── Sales Offer（报价单 /pp/:code）──────────────────────────────────────
  // 消费侧只有 view_count 计数器（public-router.ts 里 +1），没有时间戳 →
  // 无法按周期切分观看数，只能给「本期新建的报价单中，有多少被看过」。
  const offer = await pool.query(
    `SELECT
       count(*) FILTER (WHERE created_at > ${cur})                                        AS produced,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo})        AS produced_prev,
       count(*) FILTER (WHERE created_at > ${cur} AND view_count > 0)                      AS consumed,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo} AND view_count > 0) AS consumed_prev,
       COALESCE(sum(view_count) FILTER (WHERE created_at > ${cur}), 0)                     AS total_views
     FROM lt_payment_shares
     WHERE lower(COALESCE(created_by_email, '')) <> ALL($1::text[])`,
    [INTERNAL_AGENTS]
  )

  // ── Luna Tour（/v/:code）────────────────────────────────────────────────
  // 消费侧是 lt_engagement_events，逐事件带 visitor + dwell_ms —— 四个功能里数据最好的一个。
  // 「被消费」= 该 tour 至少有一条 engagement 事件（客户真的打开过）。
  const tour = await pool.query(
    `SELECT
       count(*) FILTER (WHERE s.created_at > ${cur})                                 AS produced,
       count(*) FILTER (WHERE s.created_at > ${prevFrom} AND s.created_at <= ${prevTo}) AS produced_prev,
       count(*) FILTER (WHERE s.created_at > ${cur} AND EXISTS (
         SELECT 1 FROM lt_engagement_events e WHERE e.session_id = s.id))             AS consumed,
       count(*) FILTER (WHERE s.created_at > ${prevFrom} AND s.created_at <= ${prevTo} AND EXISTS (
         SELECT 1 FROM lt_engagement_events e WHERE e.session_id = s.id))             AS consumed_prev,
       (SELECT count(*) FROM lt_engagement_events e2
         JOIN lt_demo_sessions s2 ON s2.id = e2.session_id
         JOIN lt_agents a2 ON a2.id = s2.agent_id
        WHERE e2.created_at > ${cur} AND lower(a2.email) <> ALL($1::text[]))          AS total_events
     FROM lt_demo_sessions s
     JOIN lt_agents a ON a.id = s.agent_id
     WHERE lower(COALESCE(a.email, '')) <> ALL($1::text[])`,
    [INTERNAL_AGENTS]
  )

  // ── 实时带看（collab_rooms）──────────────────────────────────────────────
  // ⚠️ 这张表**没有 agent_id**，无法区分是你自己测试开的房还是经纪真的在带看。
  //    351 个房间里绝大多数是测试产生的（见 2026-07-17 报告）。
  //    这里如实标 canSplitInternal=false，前端必须显示「含内部测试」——
  //    宁可标注不确定，也不要给一个看起来干净其实是脏的数字。
  const collab = await pool.query(
    `SELECT
       count(*) FILTER (WHERE created_at > ${cur})                                  AS produced,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo})  AS produced_prev,
       count(*) FILTER (WHERE created_at > ${cur} AND peak_participants >= 2)        AS consumed,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo}
                          AND peak_participants >= 2)                                AS consumed_prev
     FROM collab_rooms`
  )

  // ── Luna 语音对话（luna_sessions）───────────────────────────────────────
  // 这个不是「产出物」而是会话本身：produced = 开了会话，consumed = 真的聊起来了（≥2 轮）。
  // ⚠️ user_email 目前**全是 NULL**（全为匿名访客），无法区分内外部，也说明
  //    使用它的是 C 端买家而非登录经纪 —— 这本身就是个重要信号。
  const voice = await pool.query(
    `SELECT
       count(*) FILTER (WHERE created_at > ${cur})                                  AS produced,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo})  AS produced_prev,
       count(*) FILTER (WHERE created_at > ${cur} AND turn_count >= 2)               AS consumed,
       count(*) FILTER (WHERE created_at > ${prevFrom} AND created_at <= ${prevTo}
                          AND turn_count >= 2)                                       AS consumed_prev,
       COALESCE(round(avg(turn_count) FILTER (WHERE created_at > ${cur}))::int, 0)   AS avg_turns,
       COALESCE(round(avg(duration_ms) FILTER (WHERE created_at > ${cur}) / 1000)::int, 0) AS avg_sec,
       count(DISTINCT COALESCE(user_email, visitor_id)) FILTER (WHERE created_at > ${cur}) AS uniq
     FROM luna_sessions`
  )

  const n = (v: unknown) => Number(v || 0)
  const o = offer.rows[0], t = tour.rows[0], c = collab.rows[0], v = voice.rows[0]

  return [
    {
      key: 'sales_offer',
      label: 'Sales Offer 报价单',
      produced: n(o.produced), producedPrev: n(o.produced_prev),
      consumed: n(o.consumed), consumedPrev: n(o.consumed_prev),
      consumedDetail: `共 ${n(o.total_views)} 次观看`,
      canSplitInternal: true,
      note: '被消费 = 该报价单 view_count > 0。观看只有计数器无时间戳，故按「本期新建的里有多少被看过」统计。',
    },
    {
      key: 'luna_tour',
      label: 'Luna Tour 导览',
      produced: n(t.produced), producedPrev: n(t.produced_prev),
      consumed: n(t.consumed), consumedPrev: n(t.consumed_prev),
      consumedDetail: `共 ${n(t.total_events)} 条互动事件`,
      canSplitInternal: true,
      note: '被消费 = 该 tour 至少有一条客户端互动事件（真的被打开过）。四个功能里数据最扎实的一个。',
    },
    {
      key: 'live_tour',
      label: '实时带看',
      produced: n(c.produced), producedPrev: n(c.produced_prev),
      consumed: n(c.consumed), consumedPrev: n(c.consumed_prev),
      consumedDetail: null,
      canSplitInternal: false,
      note: '⚠️ collab_rooms 表没有 agent_id，无法剔除内部测试。历史房间绝大多数由测试产生，此数字仅供看趋势。被消费 = 峰值人数 ≥ 2（客户真的进来了）。',
    },
    {
      key: 'luna_voice',
      label: 'Luna 语音对话',
      produced: n(v.produced), producedPrev: n(v.produced_prev),
      consumed: n(v.consumed), consumedPrev: n(v.consumed_prev),
      consumedDetail: `${n(v.uniq)} 人 · 平均 ${n(v.avg_turns)} 轮 / ${n(v.avg_sec)} 秒`,
      canSplitInternal: false,
      note: '被消费 = 真实多轮对话（≥2 轮），排掉点开就关。⚠️ 使用者目前全部是匿名访客、无一登录经纪 —— 它在给 C 端买家创造价值，却按 B 端功能在卖。',
    },
  ]
}

/** B 端经纪侧：注册 / 试用 / 活跃 / 付费。**不套 internalVisitorIds()**，见文件头说明。 */
async function agentHealth(days: number) {
  const { rows } = await pool.query(
    `WITH ext AS (
       SELECT id, email, created_at, free_trial_started_at
         FROM lt_agents
        WHERE lower(COALESCE(email, '')) <> ALL($1::text[])
     ),
     /**
      * 🔴 「活跃」**绝不能**定义成「有任何埋点事件」。
      *    每个人注册当天必然产生 pageview → 那样算出来是 45/47「活跃」，看着一片健康，
      *    实际什么都没说明。（第一版就是这么写的，数字好看得可疑才发现。）
      *
      *    真实信号是**注册那天之后有没有再回来**。同口径下 47 人里只有 13 个回来过。
      */
     act AS (
       SELECT lower(e.user_email) AS email,
              count(DISTINCT e.created_at::date)                                   AS active_days,
              count(*) FILTER (WHERE e.created_at::date > x.joined)                AS after_join,
              count(*) FILTER (WHERE e.created_at::date > x.joined
                                 AND e.created_at > now() - interval '${days} days') AS after_join_cur,
              count(*) FILTER (WHERE e.created_at::date > x.joined
                                 AND e.created_at > now() - interval '${days * 2} days'
                                 AND e.created_at <= now() - interval '${days} days') AS after_join_prev
         FROM app_events e
         JOIN (SELECT lower(email) AS email, created_at::date AS joined FROM lt_agents) x
           ON x.email = lower(e.user_email)
        WHERE e.user_email IS NOT NULL
        GROUP BY 1
     ),
     produced AS (  -- 「激活」= 做出过任何一个产出物（tour / 报价单 / 报告）
       SELECT DISTINCT e.id
         FROM ext e
        WHERE EXISTS (SELECT 1 FROM lt_demo_sessions s WHERE s.agent_id = e.id)
           OR EXISTS (SELECT 1 FROM lt_payment_shares p WHERE lower(COALESCE(p.created_by_email,'')) = lower(e.email))
           OR EXISTS (SELECT 1 FROM lt_client_reports r WHERE r.agent_id = e.id)
     )
     SELECT
       (SELECT count(*) FROM ext)                                                      AS total,
       (SELECT count(*) FROM ext WHERE created_at > now() - interval '${days} days')    AS new_cur,
       (SELECT count(*) FROM ext WHERE created_at > now() - interval '${days * 2} days'
                                   AND created_at <= now() - interval '${days} days')   AS new_prev,
       (SELECT count(*) FROM ext WHERE free_trial_started_at IS NOT NULL)               AS trial_started,
       (SELECT count(*) FROM produced)                                                  AS activated,
       -- 回访 = 注册那天之后还回来过（唯一有意义的活跃口径，见上方 act CTE 注释）
       (SELECT count(*) FROM ext e JOIN act a ON a.email = lower(e.email) WHERE a.after_join      > 0) AS returned,
       (SELECT count(*) FROM ext e JOIN act a ON a.email = lower(e.email) WHERE a.after_join_cur  > 0) AS returned_cur,
       (SELECT count(*) FROM ext e JOIN act a ON a.email = lower(e.email) WHERE a.after_join_prev > 0) AS returned_prev,
       -- 有 ≥3 天活动 = 真正在用的人。这个数字比任何比率都诚实。
       (SELECT count(*) FROM ext e JOIN act a ON a.email = lower(e.email) WHERE a.active_days >= 3) AS deep_users,
       -- ⚠️ paying **必须排除自己人**。全库唯一 active/stripe 是 owner 本人，
       --    不排掉的话面板会显示「有 1 个付费客户」——那是你自己刷的卡。
       (SELECT count(*) FROM lt_subscriptions s JOIN ext e ON e.id = s.agent_id
          WHERE s.status = 'active' AND s.source = 'stripe')                            AS paying,
       -- past_due = **有人想付钱但扣款失败**。这是要今天就去追的事，不是看趋势的指标。
       (SELECT count(*) FROM lt_subscriptions s JOIN ext e ON e.id = s.agent_id
          WHERE s.status = 'past_due')                                                  AS past_due`,
    [INTERNAL_AGENTS]
  )
  const r = rows[0]
  const n = (v: unknown) => Number(v || 0)
  return {
    total: n(r.total),
    newCur: n(r.new_cur), newPrev: n(r.new_prev),
    trialStarted: n(r.trial_started),
    activated: n(r.activated),
    returned: n(r.returned),
    returnedCur: n(r.returned_cur), returnedPrev: n(r.returned_prev),
    deepUsers: n(r.deep_users),
    paying: n(r.paying),
    pastDue: n(r.past_due),
  }
}

/**
 * 漏斗比率 + 市场基准。
 *
 * ⚠️ 每一条都**必须带 n（分母）**。前端在 n < MIN_SAMPLE 时显示「样本不足」而不是百分比。
 * 基准来源见 docs/reports/2026-07-17-usage-analysis-vs-saas-benchmarks.md 里的引用链接。
 */
export interface FunnelRate {
  key: string
  label: string
  value: number | null   // 百分比；分母为 0 时是 null
  n: number              // 分母
  median: number         // 市场中位
  good: number           // 优秀线
  source: string
}

function rate(hit: number, total: number): number | null {
  return total > 0 ? Math.round((hit / total) * 1000) / 10 : null
}

async function funnelRates(agents: Awaited<ReturnType<typeof agentHealth>>): Promise<FunnelRate[]> {
  // pricing_view → trial_start 走埋点（这条历史上是**远超基准**的，说明获客侧没问题）
  const { rows } = await pool.query(
    `SELECT
       count(DISTINCT COALESCE(user_email, visitor_id)) FILTER (WHERE event_type='pricing_view') AS pricing,
       count(DISTINCT COALESCE(user_email, visitor_id)) FILTER (WHERE event_type='trial_start')  AS trial
     FROM app_events WHERE created_at > now() - interval '90 days'`
  )
  const pricing = Number(rows[0]?.pricing || 0)
  const trial = Number(rows[0]?.trial || 0)

  return [
    {
      key: 'activation',
      label: '注册 → 激活（做出过任何产出物）',
      value: rate(agents.activated, agents.total), n: agents.total,
      median: 37, good: 60,
      source: 'Userpilot 62 家 SaaS / PLG 30-45%',
    },
    {
      key: 'trial_to_paid',
      label: '免费试用 → 付费',
      value: rate(agents.paying, agents.trialStarted), n: agents.trialStarted,
      median: 8.9, good: 20,
      source: 'ChartMogul 200 产品（免绑卡试用）',
    },
    {
      key: 'returned',
      label: '注册 → 注册日之后再回来',
      value: rate(agents.returned, agents.total), n: agents.total,
      median: 60, good: 75,
      source: '行业首日后回访 55-65%',
    },
    {
      key: 'pricing_to_trial',
      label: '看定价 → 开试用',
      value: rate(trial, pricing), n: pricing,
      median: 25, good: 35,
      source: '行业 20-30%',
    },
  ]
}

/** 面板主查询。一次返回全部，前端不用串多个请求。 */
export async function getHealthSnapshot({ days }: HealthRange) {
  const agents = await agentHealth(days)
  const [features, funnel] = await Promise.all([featureHealth(days), funnelRates(agents)])
  return {
    days,
    agents,
    features,
    funnel,
    /** 把「谁被算作自己人」透明地交给前端显示 —— 口径不透明的面板没人敢信。 */
    internalAgents: INTERNAL_AGENTS,
  }
}
