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
import { internalVisitorIds } from './analyticsQueries'
import { INTERNAL_EMAILS } from '../lib/internalAccounts'

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
// 名单走 lib/internalAccounts 的单一真源(这里是**统计口径**,合伙人也算自己人)
const INTERNAL_AGENTS = INTERNAL_EMAILS

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
  // 2026-07-28 加上了 agent_id（并用 lt_credit_ledger 的 live_tours 流水回填历史），
  // 这个功能**第一次能和其它三个一样剔除内部测试**。
  //   · 内部号（owner/合伙人/demo）→ 按 INTERNAL_AGENTS 排除
  //   · agent_id IS NULL → 未登录建的房：07-14 那 251 间压测、以及我自己调试开的房。
  //     一律**不计入**——它们既不是经纪的产出，也不是客户的消费。
  const collab = await pool.query(
    `SELECT
       count(*) FILTER (WHERE r.created_at > ${cur})                                  AS produced,
       count(*) FILTER (WHERE r.created_at > ${prevFrom} AND r.created_at <= ${prevTo}) AS produced_prev,
       count(*) FILTER (WHERE r.created_at > ${cur} AND r.peak_participants >= 2)       AS consumed,
       count(*) FILTER (WHERE r.created_at > ${prevFrom} AND r.created_at <= ${prevTo}
                          AND r.peak_participants >= 2)                                 AS consumed_prev,
       -- 被剔掉的未归属房间要**说出来**,不能静默扣掉(标量子查询:上面的 JOIN 本身
       -- 就把 agent_id IS NULL 全滤没了,在里面 FILTER 恒等于 0)
       (SELECT count(*) FROM collab_rooms
         WHERE created_at > ${cur} AND agent_id IS NULL)                                AS anon_skipped
     FROM collab_rooms r
     JOIN lt_agents a ON a.id = r.agent_id
     WHERE lower(a.email) <> ALL($1)`,
    [INTERNAL_AGENTS]
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
      consumedDetail: n(c.anon_skipped) > 0 ? `另有 ${n(c.anon_skipped)} 间未登录建的房未计入` : null,
      canSplitInternal: true,
      note: '被消费 = 峰值人数 ≥ 2（客户真的进来了）。2026-07-28 加了 agent_id 并回填历史，已能剔除内部号；未登录建的房（压测/调试）一律不计入。',
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

/**
 * 地图使用 —— C 端指标，**这里才需要 internalVisitorIds()**（见文件头两套过滤说明）。
 *
 * 为什么地图要单列：它是全站唯一有真实重复使用的功能，但此前面板上完全没有它。
 * 关键不是「多少人用过」而是**「用过的人第二天还回来吗」** —— 广度好办（发个链接就有），
 * 习惯难得。这两个数字的差距就是地图的真实处境。
 */
async function mapHealth(days: number) {
  const internal = await internalVisitorIds()

  const { rows: agg } = await pool.query(
    `WITH u AS (
       SELECT visitor_id,
              count(*) FILTER (WHERE event_type = 'area_detail')            AS n,
              count(DISTINCT created_at::date) FILTER (WHERE event_type = 'area_detail') AS days
         FROM app_events
        WHERE created_at > now() - interval '${days} days'
          AND (visitor_id IS NULL OR visitor_id <> ALL($1::text[]))
        GROUP BY 1
     )
     SELECT
       (SELECT count(*) FROM u WHERE n > 0)                                       AS users,
       (SELECT COALESCE(sum(n), 0) FROM u)                                        AS events,
       (SELECT count(*) FROM u WHERE n >= 5)                                      AS engaged,
       (SELECT count(*) FROM u WHERE days >= 2)                                   AS multiday,
       (SELECT count(DISTINCT visitor_id) FROM app_events
         WHERE created_at > now() - interval '${days} days' AND event_type = 'map_gate_hit'
           AND (visitor_id IS NULL OR visitor_id <> ALL($1::text[])))             AS gate_hit`,
    [internal]
  )

  // 近 14 天 DAU 曲线。稀疏且量小 —— 前端画成单序列面积图，不做多序列。
  const { rows: daily } = await pool.query(
    `SELECT d::date AS date,
            COALESCE(x.dau, 0)   AS dau,
            COALESCE(x.areas, 0) AS areas
       FROM generate_series(now()::date - 13, now()::date, '1 day') d
       LEFT JOIN (
         SELECT created_at::date AS day,
                count(DISTINCT visitor_id)                          AS dau,
                count(*) FILTER (WHERE event_type = 'area_detail')  AS areas
           FROM app_events
          WHERE created_at > now() - interval '14 days'
            AND (visitor_id IS NULL OR visitor_id <> ALL($1::text[]))
          GROUP BY 1
       ) x ON x.day = d::date
      ORDER BY 1`,
    [internal]
  )

  const r = agg[0]
  const n = (v: unknown) => Number(v || 0)
  return {
    users: n(r.users), events: n(r.events),
    engaged: n(r.engaged), multiday: n(r.multiday),
    gateHit: n(r.gate_hit),
    daily: daily.map((d) => ({ date: String(d.date).slice(0, 10), dau: n(d.dau), areas: n(d.areas) })),
  }
}

/**
 * C 端受众（访客/买家）—— **v2 漏了它，导致面板严重误导。**
 *
 * 🔴 owner 的质问：「为什么说我只有 2 个真实用户？不是有很多客户在用功能吗？」**他是对的。**
 *
 * v2 只统计了 B 端（注册经纪做出过多少可分享产出物 = 2），却把这个数字写成
 * 「你仅有的 2 个真实激活用户」——**把一个很窄的 B 端指标说成了全部用户**。
 * 事实是同期有 244 人在用地图/项目/搜索、50 人回访过、14 人跟 Luna 语音聊过。
 *
 * 教训：这个产品有**两拨完全不同的人**，任何「用户数」都必须说清是哪一拨：
 *   · C 端 = 买家/访客,用地图和 Luna 语音（**唯一付费客户 slavynchuk 也只用地图**）
 *   · B 端 = 注册经纪,用 tour / 报价单 / 报告
 * 混为一谈会直接导致产品方向判断错误。
 */
async function audienceHealth(days: number) {
  const internal = await internalVisitorIds()
  const { rows } = await pool.query(
    `WITH v AS (
       SELECT visitor_id,
              count(DISTINCT created_at::date) AS days,
              count(*) FILTER (WHERE event_type IN ('area_detail','property_view','search')) AS core
         FROM app_events
        WHERE created_at > now() - interval '${days} days'
          AND (visitor_id IS NULL OR visitor_id <> ALL($1::text[]))
        GROUP BY 1
     )
     SELECT count(*)                              AS visitors,
            count(*) FILTER (WHERE core > 0)      AS used_core,
            count(*) FILTER (WHERE core >= 5)     AS engaged,
            count(*) FILTER (WHERE days >= 2)     AS returned,
            count(*) FILTER (WHERE days >= 3)     AS deep,
            (SELECT count(DISTINCT COALESCE(user_email, visitor_id)) FROM luna_sessions
              WHERE created_at > now() - interval '${days} days')            AS luna_users,
            (SELECT count(*) FROM luna_sessions
              WHERE created_at > now() - interval '${days} days' AND turn_count >= 2) AS luna_convos
       FROM v`,
    [internal]
  )
  const r = rows[0]
  const n = (v: unknown) => Number(v || 0)
  return {
    visitors: n(r.visitors), usedCore: n(r.used_core), engaged: n(r.engaged),
    returned: n(r.returned), deep: n(r.deep),
    lunaUsers: n(r.luna_users), lunaConvos: n(r.luna_convos),
  }
}

/**
 * 判断层 —— **面板存在的理由。**
 *
 * 🔴 owner 的原话：「是数据 但是该怎么做决策？感觉光看这个看不出」。他是对的：
 *    一屏数字不产生决策。所以规则写在**服务端**（可测试、可版本化、可在 code review
 *    里争论），每条必须带上**触发它的具体数字**和**一个具体到人的下一步动作**。
 *
 * 规则要少而准。宁可只报 2 条真事，也不要凑 8 条正确的废话 ——
 * 后者会让人学会忽略这个区块，那就跟没有一样。
 */
export interface Signal {
  severity: 'critical' | 'serious' | 'warning' | 'info'
  title: string
  /** 触发它的具体数字。没有这个，建议就是算命。 */
  evidence: string
  /** 下一步做什么。尽量具体到人、到页面。 */
  action: string
}

async function buildSignals(
  agents: Awaited<ReturnType<typeof agentHealth>>,
  features: FeatureHealth[],
  map: Awaited<ReturnType<typeof mapHealth>>,
  aud: Awaited<ReturnType<typeof audienceHealth>>,
  days: number
): Promise<Signal[]> {
  const out: Signal[] = []

  // ① 有人想付钱但扣款失败 —— 全场最高优先级：这是钱，而且是**已经想给你的钱**
  if (agents.pastDue > 0) {
    const { rows } = await pool.query(
      `SELECT a.email FROM lt_subscriptions s JOIN lt_agents a ON a.id = s.agent_id
        WHERE s.status = 'past_due' AND lower(COALESCE(a.email,'')) <> ALL($1::text[]) LIMIT 5`,
      [INTERNAL_AGENTS]
    )
    const who = rows.map((r) => r.email).join('、')
    out.push({
      severity: 'critical',
      title: `${agents.pastDue} 个账号扣款失败`,
      evidence: who || `${agents.pastDue} 个 past_due 订阅`,
      action: '今天直接联系他。有人主动要付钱却没扣成，这是最容易挽回的一笔收入。',
    })
  }

  // ② 试用规模够大但零付费 —— 说明价值没传递到，不是价格问题
  if (agents.paying === 0 && agents.trialStarted >= 20) {
    out.push({
      severity: 'critical',
      title: '零真实付费客户',
      evidence: `${agents.trialStarted} 人开了试用，${agents.paying} 人付费`,
      action: '别再调价或加功能。先搞清楚试用期里他们到底看到了什么 —— 去问那几个激活过的人。',
    })
  }

  // ③ 某功能外部产出为 0 —— 投入和回报完全脱节的信号
  for (const f of features.filter((x) => x.canSplitInternal && x.produced === 0)) {
    out.push({
      severity: 'serious',
      title: `${f.label}：${days} 天内外部产出为 0`,
      evidence: '没有任何外部经纪做过一个',
      action: `要么停止继续投入，要么先找到一个愿意用它的真人。继续打磨一个没人用的功能是最贵的浪费。`,
    })
  }

  // ④ 做出来了但没人看 —— 比「没人做」更强的负面信号：经纪自己都不敢发
  for (const f of features.filter((x) => x.produced > 0 && x.consumed === 0)) {
    out.push({
      severity: 'serious',
      title: `${f.label}：做了 ${f.produced} 个，一个都没被打开`,
      evidence: `产出 ${f.produced} · 被消费 0`,
      action: '经纪自己都没发给客户。去问他为什么没发 —— 这比问「为什么不用」更准。',
    })
  }

  // ⑤ 做出过产出物的经纪 —— 点名到 email，让「去访谈」变成可执行动作
  //
  // ⚠️ 措辞必须精确到「**经纪**做出过**可分享产出物**」。
  //    v2 这里写的是「你仅有的 N 个真实激活用户」,owner 立刻反驳「不是有很多客户在用功能吗」——
  //    他是对的:同期有几百人在用地图。把窄口径的 B 端数字说成「全部用户」会直接
  //    导致产品方向判断错误。C 端受众另有 audienceHealth() 单独统计。
  if (agents.activated > 0 && agents.activated <= 5) {
    const { rows } = await pool.query(
      `SELECT a.email FROM lt_agents a
        WHERE lower(COALESCE(a.email,'')) <> ALL($1::text[])
          AND (EXISTS (SELECT 1 FROM lt_demo_sessions s WHERE s.agent_id = a.id)
            OR EXISTS (SELECT 1 FROM lt_payment_shares p
                        WHERE lower(COALESCE(p.created_by_email,'')) = lower(a.email))
            OR EXISTS (SELECT 1 FROM lt_client_reports r WHERE r.agent_id = a.id))
        LIMIT 5`,
      [INTERNAL_AGENTS]
    )
    out.push({
      severity: 'info',
      title: `只有 ${agents.activated} 个外部经纪做出过可分享产出物`,
      evidence: `${rows.map((r) => r.email).join('、')}（注意：这是 B 端口径，不代表用户总数——C 端受众见下方）`,
      action: '经纪工具的信号源就这几个人，一人聊 20 分钟胜过再写两周代码。',
    })
  }

  // ⑥ B 端没起量、C 端却有真实使用 —— 这个对比是全站最重要的战略信号
  if (aud.usedCore >= 50 && agents.activated <= 5) {
    out.push({
      severity: 'serious',
      title: 'C 端在用，B 端没起来',
      evidence: `${aud.usedCore} 人用过地图/项目/搜索、${aud.returned} 人回访；而只有 ${agents.activated} 个经纪做出过产出物`,
      action: '真实需求集中在「查迪拜房产数据」，不在「经纪给客户做导览」。定价和产品重心是否该跟着这个事实走，值得认真想一次。',
    })
  }

  // ⑥ 拉新 vs 漏斗：往漏桶里倒水
  const actRate = agents.total > 0 ? (agents.activated / agents.total) * 100 : 0
  if (agents.newCur >= 10 && actRate < 10) {
    out.push({
      severity: 'warning',
      title: '拉新是在往漏桶里倒水',
      evidence: `近 ${days} 天新注册 ${agents.newCur} 人，激活率 ${actRate.toFixed(1)}%（市场中位 37%）`,
      action: '暂停推广，直到激活率 > 20%。现在每多拉 100 人 ≈ 多 4 个激活、0 个付费。',
    })
  }

  // ⑦ 地图：有广度没习惯
  if (map.users >= 30) {
    const back = map.users > 0 ? (map.multiday / map.users) * 100 : 0
    if (back < 20) {
      out.push({
        severity: 'warning',
        title: '地图有广度，但没有形成习惯',
        evidence: `${map.users} 人用过区域详情（${map.engaged} 人用了 ≥5 次），但只有 ${map.multiday} 人第二天还回来`,
        action: '当场愿意用、第二天不回来 = 缺少「回来的理由」。考虑做「我关注的区域有新成交」这类召回，而不是继续加功能。',
      })
    }
    if (map.gateHit <= 10) {
      out.push({
        severity: 'info',
        title: '免费额度墙几乎没人撞到',
        evidence: `${days} 天内只有 ${map.gateHit} 人触达地图免费额度上限`,
        action: '地图的收费闸门在当前量级下是无关紧要的。调它不会带来收入，别在这上面花时间。',
      })
    }
  }

  const order = { critical: 0, serious: 1, warning: 2, info: 3 }
  return out.sort((a, b) => order[a.severity] - order[b.severity])
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 【待办层】—— 2026-08-17 重做。面板真正的落地内容。
 *
 * 🔴 owner 的原话：「这些信息太挡视线而且没屌用，我也不会 take action」。他又是对的。
 *
 * buildSignals() 产出的是**结论**（「零付费客户」「拉新在往漏桶里倒水」）—— 正确，
 * 但它们下个月还是同一句话，因为那是**长期事实**不是**待办**。看第三遍就学会跳过了。
 * （这正是本文件 buildSignals 注释里自己写下的警告：「凑正确的废话会让人学会忽略」。）
 *
 * 待办层的准入门槛只有一条：**能不能今天点一下就完事**。
 *   · 有具体的人（名字 + 邮箱），不是聚合比率
 *   · 有一个明确动作（发邮件 / 批准 / 去看），不是「值得认真想一次」
 *   · 做完就消失 —— 一件事永远留在列表上，说明它根本不是待办
 *
 * 结论层（signals）没有删，收进折叠区。它对写周报有用，对「今天干什么」没用。
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface Task {
  kind: 'payment_failed' | 'trial_ending' | 'new_output'
  /** urgent = 钱/别人在等你；opportunity = 唯一的真实信号源，值得主动够上去 */
  tone: 'urgent' | 'opportunity'
  name: string
  email: string
  /** 发生了什么。一句话，带天数/数量。 */
  title: string
  /** 补充上下文（套餐、公司、官网、产出物标题）。可空。 */
  detail: string | null
  /** 动作按钮 */
  action: { label: string; href: string | null; mail: boolean }
}

/**
 * 【够得着的人】—— 常驻名单，**不是待办**（做完不会消失，所以刻意和待办分开放）。
 *
 * buildSignals 里那条「只有 N 个外部经纪做出过可分享产出物，一人聊 20 分钟胜过再写
 * 两周代码」是这个面板上最有用的一句话 —— 但它是**一段话**，读完还得自己去别的表
 * 里翻邮箱，所以从来没人照着做。这里把它变成几行带邮箱和按钮的人。
 *
 * 口径和 signals 的 activated 完全一致（外部经纪 + 至少一个产出物），只是多带上
 * 「做了什么 / 多久没动静了 / 客户打开过几次」，让「要不要现在联系他」当场可判。
 */
export interface Person {
  name: string
  email: string
  /** 做过什么。如「2 张报价单 · 1 个客户报告」 */
  made: string
  /** 最近一次产出距今天数 */
  daysAgo: number
  /** 他的东西被客户打开的总次数。0 = 做了没发出去，那是另一种谈资。 */
  views: number
}

async function reachablePeople(): Promise<Person[]> {
  const { rows } = await pool.query<{
    email: string; display_name: string | null
    offers: number; tours: number; reports: number
    views: number; d: number
  }>(
    `SELECT a.email, a.display_name,
            (SELECT count(*)::int FROM lt_payment_shares ps WHERE lower(ps.created_by_email) = lower(a.email)) AS offers,
            (SELECT count(*)::int FROM lt_demo_sessions ds  WHERE ds.agent_id = a.id)                          AS tours,
            (SELECT count(*)::int FROM lt_client_reports cr WHERE cr.agent_id = a.id)                          AS reports,
            COALESCE((SELECT sum(ps.view_count)::int FROM lt_payment_shares ps WHERE lower(ps.created_by_email) = lower(a.email)), 0)
          + COALESCE((SELECT sum(cr.view_count)::int FROM lt_client_reports cr WHERE cr.agent_id = a.id), 0)    AS views,
            EXTRACT(day FROM now() - GREATEST(
              COALESCE((SELECT max(ps.created_at) FROM lt_payment_shares ps WHERE lower(ps.created_by_email) = lower(a.email)), 'epoch'::timestamptz),
              COALESCE((SELECT max(ds.created_at) FROM lt_demo_sessions ds  WHERE ds.agent_id = a.id), 'epoch'::timestamptz),
              COALESCE((SELECT max(cr.created_at) FROM lt_client_reports cr WHERE cr.agent_id = a.id), 'epoch'::timestamptz)
            ))::int AS d
       FROM lt_agents a
      WHERE lower(COALESCE(a.email,'')) <> ALL($1::text[])
        AND (EXISTS (SELECT 1 FROM lt_payment_shares ps WHERE lower(ps.created_by_email) = lower(a.email))
          OR EXISTS (SELECT 1 FROM lt_demo_sessions ds  WHERE ds.agent_id = a.id)
          OR EXISTS (SELECT 1 FROM lt_client_reports cr WHERE cr.agent_id = a.id))
      ORDER BY d ASC
      LIMIT 8`,
    [INTERNAL_AGENTS]
  )
  return rows.map((r) => ({
    name: r.display_name || r.email.split('@')[0],
    email: r.email,
    made: [
      Number(r.offers) > 0 ? `${r.offers} 张报价单` : null,
      Number(r.tours) > 0 ? `${r.tours} 个导览` : null,
      Number(r.reports) > 0 ? `${r.reports} 份客户报告` : null,
    ].filter(Boolean).join(' · '),
    daysAgo: Number(r.d),
    views: Number(r.views),
  }))
}

async function buildTasks(): Promise<Task[]> {
  const out: Task[] = []
  const nm = (r: { display_name?: string | null; email: string }) =>
    r.display_name || r.email.split('@')[0]

  // ① 钱：有人想付却扣不成。全场最高优先级 —— 这是**已经想给你的钱**。
  const failed = await pool.query<{
    email: string; display_name: string | null; status: string; plan_id: string | null; d: number
  }>(
    `SELECT a.email, a.display_name, s.status, s.plan_id,
            GREATEST(0, EXTRACT(day FROM now() - s.updated_at))::int AS d
       FROM lt_subscriptions s JOIN lt_agents a ON a.id = s.agent_id
      WHERE s.status IN ('past_due','unpaid','incomplete')
        AND lower(COALESCE(a.email,'')) <> ALL($1::text[])
      ORDER BY s.updated_at ASC`,
    [INTERNAL_AGENTS]
  )
  for (const r of failed.rows) {
    out.push({
      kind: 'payment_failed', tone: 'urgent',
      name: nm(r), email: r.email,
      title: r.d > 0 ? `扣款失败 ${r.d} 天` : '扣款失败',
      detail: r.plan_id ? `${r.plan_id} · ${r.status}` : r.status,
      // 只给主题不给正文：催换卡的措辞必须自己斟酌，模板化的「你的卡失败了」是得罪人的
      action: { label: '发邮件', href: `mailto:${r.email}?subject=${encodeURIComponent('Pinzos — 关于您的订阅续费')}`, mail: true },
    })
  }

  // ② 原来这里有「开发商验证待审」—— 整条链路已于 2026-08-17 删除
  //    （那道审批守的门是假的：上传楼书看的是 role='developer'，自助选角色就有；
  //      唯一通过验证的开发商交付了 0 个楼盘）。见 routes/billing.ts 的墓碑注释。

  // ③ 试用快到期，而且**这人真的用过东西** —— 没用过的不提醒：给他发消息
  //    只会提醒他取消。用过的才是有话可聊的。
  const ending = await pool.query<{
    email: string; display_name: string | null; d: number; used: number; plan_id: string | null
  }>(
    `SELECT a.email, a.display_name, s.plan_id,
            GREATEST(0, EXTRACT(day FROM s.current_period_end - now()))::int AS d,
            COALESCE((SELECT sum(l.credits)::int FROM lt_credit_ledger l
                       WHERE l.agent_id = a.id AND l.credits > 0
                         AND l.created_at >= s.created_at), 0) AS used
       FROM lt_subscriptions s JOIN lt_agents a ON a.id = s.agent_id
      WHERE s.status = 'trialing'
        AND s.current_period_end BETWEEN now() AND now() + interval '3 days'
        AND lower(COALESCE(a.email,'')) <> ALL($1::text[])
      ORDER BY s.current_period_end ASC`,
    [INTERNAL_AGENTS]
  )
  for (const r of ending.rows.filter((x) => Number(x.used) > 0)) {
    out.push({
      kind: 'trial_ending', tone: 'urgent',
      name: nm(r), email: r.email,
      title: r.d <= 0 ? '试用今天到期，他用过东西' : `试用还剩 ${r.d} 天，他用过东西`,
      detail: `已消耗 ${r.used} 积分`,
      action: { label: '发邮件', href: `mailto:${r.email}?subject=${encodeURIComponent('Pinzos — 您的试用即将到期')}`, mail: true },
    })
  }

  // ④ 机会：外部经纪**刚**做出了可分享产出物。
  //    B 端至今个位数产出（见 signals），所以每一个都值得当天去够上去问一句。
  //    窗口固定 7 天而不是跟随 days —— 「30 天前有人做过一个」不是今天的待办。
  const outputs = await pool.query<{
    email: string; display_name: string | null; label: string; title: string | null
    href: string | null; d: number; views: number
  }>(
    `WITH x AS (
       -- lt_payment_shares 没有 title 列(2026-08-17 实测),用 unit_name 当标题
       SELECT a.email, a.display_name, '报价单' AS label, ps.unit_name AS title,
              '/pp/' || ps.share_code AS href, ps.created_at, COALESCE(ps.view_count,0) AS views
         FROM lt_payment_shares ps JOIN lt_agents a ON lower(a.email) = lower(ps.created_by_email)
        WHERE ps.created_at > now() - interval '7 days'
       UNION ALL
       SELECT a.email, a.display_name, 'Luna 导览', ds.title,
              '/v/' || ds.share_code, ds.created_at, 0
         FROM lt_demo_sessions ds JOIN lt_agents a ON a.id = ds.agent_id
        WHERE ds.created_at > now() - interval '7 days'
       UNION ALL
       SELECT a.email, a.display_name, '客户报告', cr.client_name,
              '/r/' || cr.share_code, cr.created_at, COALESCE(cr.view_count,0)
         FROM lt_client_reports cr JOIN lt_agents a ON a.id = cr.agent_id
        WHERE cr.created_at > now() - interval '7 days'
     )
     SELECT email, display_name, label, title, href, views,
            EXTRACT(day FROM now() - created_at)::int AS d
       FROM x
      WHERE lower(COALESCE(email,'')) <> ALL($1::text[])
      ORDER BY created_at DESC
      LIMIT 8`,
    [INTERNAL_AGENTS]
  )
  for (const r of outputs.rows) {
    const when = r.d <= 0 ? '今天' : r.d === 1 ? '昨天' : `${r.d} 天前`
    out.push({
      kind: 'new_output', tone: 'opportunity',
      name: nm(r), email: r.email,
      title: `${when}做了一个${r.label}`,
      // 「客户打开过」是比「做出来了」强一个量级的信号，必须说出来
      detail: [r.title, Number(r.views) > 0 ? `客户打开过 ${r.views} 次` : null]
        .filter(Boolean).join(' · ') || null,
      action: { label: '看他做了什么', href: r.href, mail: false },
    })
  }

  // urgent 在前；同组内保持各自的时间序
  return [...out.filter((t) => t.tone === 'urgent'), ...out.filter((t) => t.tone === 'opportunity')]
}

/** 面板主查询。一次返回全部，前端不用串多个请求。 */
export async function getHealthSnapshot({ days }: HealthRange) {
  const agents = await agentHealth(days)
  const [features, funnel, map, audience] = await Promise.all([
    featureHealth(days), funnelRates(agents), mapHealth(days), audienceHealth(days),
  ])
  const [signals, tasks, people] = await Promise.all([
    buildSignals(agents, features, map, audience, days),
    buildTasks(),
    reachablePeople(),
  ])
  return {
    days,
    /**
     * 待办层 —— 今天能点一下就完事的具体的事。**面板的落地屏就是它。**
     * ⚠️ 不受 days 影响：待办是「此刻的状态」，不是一个统计窗口。
     */
    tasks,
    /** 够得着的人 —— 常驻名单，不是待办。B 端信号源就这几个，带邮箱直接能联系。 */
    people,
    /** 结论层 —— 长期事实，前端收进折叠区。见 buildTasks 的注释说明为什么。 */
    signals,
    agents,
    /** C 端受众。**任何「用户数」都必须说清是 C 端还是 B 端**,见 audienceHealth 注释。 */
    audience,
    features,
    map,
    funnel,
    /** 把「谁被算作自己人」透明地交给前端显示 —— 口径不透明的面板没人敢信。 */
    internalAgents: INTERNAL_AGENTS,
  }
}
