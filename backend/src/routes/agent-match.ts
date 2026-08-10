/**
 * 买家找经纪 —— 派单(owner 2026-08-09)
 *
 *   GET   /api/agent-match?projectId=&source=   给这个访客派一个经纪(sticky)   公开
 *   POST  /api/agent-match/:id/reveal           买家要联系方式 → 才吐电话       公开
 *   GET   /api/agent-match/mine                 经纪台:派给我的买家            [requireAuth]
 *   PATCH /api/agent-match/mine/:id             经纪标记「已跟进」              [requireAuth]
 *   GET   /api/agent-match/pool                 我在不在池子里 / 差什么资料      [requireAuth]
 *   PATCH /api/agent-match/pool                 自己开关接单                    [requireAuth]
 *   GET   /api/agent-match/admin                全量记录 + 排班                 [requireOwner]
 *
 * 🔴 **联系方式绝不跟匹配结果一起返回。** 见 db/agent-match.sql 的说明:
 *    公开接口直接吐经纪的私人手机号 = 送给爬虫。要电话必须再点一次(reveal),
 *    而那一次点击才是真正的转化信号。
 *
 * 🔴 **入池条件不是「是经纪」,是「联系得上的付费/试用经纪」。**
 *    2026-08-09 实测:付费/试用 33 人,其中**只有 2 人**填了手机或 WhatsApp。
 *    把联系不上的人派给买家,比不派更糟 —— 买家白等,经纪也不知道有人找过他。
 *    所以 poolFilter 里那几个 coalesce 判据一个都不能松。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'
import { requireAuth } from '../middleware/auth'
import { requireOwner } from '../middleware/requireOwner'
import { DISPATCH_EXCLUDED_EMAILS } from '../lib/internalAccounts'
import { buildOutreach, outreachLang } from '../lib/agentOutreachTemplate'

const router = Router()

/** 地图/区域入口没有具体项目 —— 用全零 UUID 占位,让 sticky 唯一索引照样生效。 */
const NO_PROJECT = '00000000-0000-0000-0000-000000000000'
const NOTE_MAX = 500
const CONTACT_MAX = 120

/**
 * 派单池排除的账号 —— **走 lib/internalAccounts 的单一真源**。
 *
 * ⚠️ 别再在这里自己拼名单。2026-08-09 我就是自己拼了 4 个,漏掉
 *    `edenlu1995@gmail.com`(owner 另一个号)和 `realtorgptapp@gmail.com`,
 *    结果 owner 的小号真的出现在给买家挑的候选里。
 *
 * 注意用的是 DISPATCH_EXCLUDED_EMAILS 而不是 INTERNAL_EMAILS ——
 * **合伙人留在池子里**(owner 明确要求:他是迪拜本地真能接待买家的人)。

/**
 * 谁能进派单池。
 *
 * 四个条件缺一不可:
 *   ① 付费或试用中 —— owner 定的:这是给客户的回报,不是给白嫖的
 *      (past_due 也算,他仍是付费客户,别顺手降级他)
 *   ② 留了手机或 WhatsApp —— 联系不上的人派出去等于把买家丢进黑洞
 *   ③ 没有自己按暂停
 *   ④ 不是自己人
 *
 * ⚠️ 用到的查询都要把 DISPATCH_EXCLUDED_EMAILS 当 $1 传进去。
 *
 * ⚠️ **JOIN 段和 WHERE 段必须分开两个常量。** 合成一个 `FROM…JOIN…WHERE…` 的话,
 *    调用方想再接一个 LEFT JOIN(挑人时要 join 曝光计数)就变成
 *    `WHERE … LEFT JOIN …` —— 语法非法。我已经踩过一次。
 */
const POOL_JOIN = `
  FROM lt_agents a
  JOIN lt_subscriptions s ON s.agent_id = COALESCE(a.billing_agent_id, a.id)
`
/**
 * ⚠️ **联系渠道不再要求手机号。** owner 2026-08-09:「没有手机那可以 email 呀」。
 *
 * 实测:付费/试用 33 人里只有 **2 人**填了手机/WhatsApp,但 **33 人全都有登录邮箱**。
 * 卡在手机号上等于这个功能永远只有 2 个人能接单。
 *
 * 但**不是**把登录邮箱丢给买家看 —— 那是人家注册用的私人地址,没同意过公开。
 * 走中转:买家提交需求 → **我们把邮件发给经纪**(见 reveal 里的 relay 分支),
 * 买家全程看不到那个地址。这也是门户的通行做法(Zillow / Bayut 都这样),
 * 而且顺带解决了另一个问题:以前连手机那条路,经纪都不知道有买家被派给了他。
 */
const POOL_WHERE = `
  s.status IN ('active','trialing','past_due')
  AND COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,''), NULLIF(a.public_email,''), NULLIF(a.email,'')) IS NOT NULL
  AND a.match_paused_at IS NULL
  AND lower(a.email) <> ALL($1::text[])
`

/**
 * 这个经纪该用哪条渠道联系。
 *   'whatsapp' 有手机/WhatsApp → 买家直接点 WhatsApp / 打电话(最快,首选)
 *   'email'    只填了 public_email(他主动公开的) → 直接给买家看
 *   'relay'    只有登录邮箱 → **买家看不到地址**,我们把需求转发给他
 */
type Channel = 'whatsapp' | 'email' | 'relay'
function channelOf(r: { phone?: string | null; whatsapp?: string | null; public_email?: string | null }): Channel {
  if ((r.whatsapp || '').trim() || (r.phone || '').trim()) return 'whatsapp'
  if ((r.public_email || '').trim()) return 'email'
  return 'relay'
}

/** 对外的经纪卡片 —— **没有任何联系方式**。 */
function agentCard(r: Record<string, unknown>) {
  return {
    display_name: (r.display_name as string) || null,
    photo_url: (r.photo_url as string) || null,
    // brand.title 是经纪自己填的头衔(「认证顾问」之类)
    title: (r.brand as { title?: string } | null)?.title ?? null,
    brokerage: (r.brokerage_name as string) || null,
    rera_brn: (r.rera_brn as string) || null,
    // relay 渠道下买家看不到任何联系方式,只能靠我们转发 —— 所以前端要**强制**
    // 他留一个自己的联系方式,否则经纪收到需求也回不过去。
    channel: channelOf(r as { phone?: string; whatsapp?: string; public_email?: string }),
  }
}

function visitorOf(req: Request): string {
  return String(req.headers['x-visitor-id'] || req.body?.visitorId || req.query.visitorId || '').trim().slice(0, 64)
}

/**
 * 「下一个轮到谁」的查询 —— 挑人和 peek 共用同一条 SQL,**必须共用**:
 * 两份各写一遍的话,peek 显示的脸和真正派到的人迟早会不一致,
 * 而那正是这个功能最不能出的错(买家看到 A 的头像,点开变成 B)。
 *
 * 最少曝光优先,同数按最久没派过的优先。窗口 30 天,让排班自己愈合
 * (不设窗口的话上个月接多了的人会被永久压在队尾,即使现在很闲)。
 * 计数用 LEFT JOIN + COALESCE(n,0):从没被派过的人计数是 NULL,
 * 不 COALESCE 的话新人永远排不到最前面 —— 和「公平」正好相反。
 */
/**
 * 「下一个轮到谁」—— **真正的轮次制**,没有任何时间成分。
 *
 * owner 2026-08-09:「32 个全都拿到 lead 了就自动轮到新的一轮,不能每天 24 小时
 * reset —— 每天只有 10 个客户的话后面的经纪永远收不到 email」。
 *
 * 两条:
 *   ① 只从**本轮还没拿过 lead 的人**里挑;都拿过了 → 下面那个 LEFT JOIN 匹配不到
 *      任何 round_no,等于自动开新一轮。
 *   ② 轮次在 **reveal(买家真提交)** 时才消耗,不是被分配时。
 *      只看了卡片不算 —— 否则经纪会在**从没收到过邮件**的情况下被排到队尾,
 *      10 个买家里 3 个真提交的话,后面的人永远轮不到。
 *
 * 同轮内的先后:被分配次数少的优先(把"卡片曝光"也摊平),再按最久没被分配的。
 * 这一层只影响同轮内顺序,不影响"每人一轮一条"这个硬保证。
 *
 * ⚠️ peek 和真派单**必须共用这条 SQL**。各写一遍的话,按钮上显示的脸和真正
 *    派到的人迟早不一致,而那是这功能最不能出的错。
 */
const NEXT_IN_ROTATION = `
  WITH cur AS (
    SELECT COALESCE(MAX(round_no), 1) AS r FROM agent_match_assignments WHERE round_no IS NOT NULL
  )
  SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name
    ${POOL_JOIN}
    CROSS JOIN cur
    LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
    LEFT JOIN (
      SELECT agent_id, count(*) AS n, max(created_at) AS last_at
        FROM agent_match_assignments GROUP BY agent_id
    ) m ON m.agent_id = a.id
   WHERE ${POOL_WHERE}
     -- 本轮已经拿过 lead 的人,这一轮不再排他
     AND NOT EXISTS (
       SELECT 1 FROM agent_match_assignments x
        WHERE x.agent_id = a.id AND x.round_no = cur.r
     )
   ORDER BY COALESCE(m.n, 0) ASC, COALESCE(m.last_at, 'epoch'::timestamptz) ASC, a.id ASC
   LIMIT $2
`

/**
 * 上面那条一个人都挑不出来 = **本轮 32 个人全拿过了** → 开新一轮。
 * 这里不带 round 条件,纯按同轮内的顺序挑。
 */
const NEXT_NEW_ROUND = `
  SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name
    ${POOL_JOIN}
    LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
    LEFT JOIN (
      SELECT agent_id, count(*) AS n, max(created_at) AS last_at
        FROM agent_match_assignments GROUP BY agent_id
    ) m ON m.agent_id = a.id
   WHERE ${POOL_WHERE}
   ORDER BY COALESCE(m.n, 0) ASC, COALESCE(m.last_at, 'epoch'::timestamptz) ASC, a.id ASC
   LIMIT $2
`

/**
 * ── 值班中的经纪是谁(只读 peek)─────────────────────────────────────────────
 *
 * 买家侧要在按钮上直接显示**头像和名字**(owner 2026-08-09:「要显示值班的经纪的
 * 头像和名字」)。所以需要一个能先看一眼、又**不落库**的接口。
 *
 * 🔴 **绝不能拿 GET / 来做这件事。** 那个接口会写一条派单记录并占用轮换名额 ——
 *    每个打开地图的人都触发一次的话,轮换会被一堆压根没想找经纪的人消耗光,
 *    而库里全是从没发生过的"匹配"。
 *
 * 同一访客已经派过的话,peek 直接回他自己那位(不然按钮上是 A、点开是 B)。
 */
router.get('/next', async (req: Request, res: Response) => {
  const visitor = visitorOf(req)
  const projectId = String(req.query.projectId || '').trim() || NO_PROJECT
  try {
    if (visitor) {
      const { rows } = await pool.query(
        `SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name
           FROM agent_match_assignments m
           JOIN lt_agents a ON a.id = m.agent_id
           LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
          WHERE m.visitor_id = $1 AND m.project_id = $2`,
        [visitor, projectId]
      )
      if (rows.length) return res.json({ agent: { ...agentCard(rows[0]), id: String(rows[0].id) }, mine: true })
    }
    let { rows } = await pool.query(NEXT_IN_ROTATION, [DISPATCH_EXCLUDED_EMAILS, 1])
    // 本轮全拿过了 → 自动开新一轮(见 NEXT_NEW_ROUND 的说明)
    if (!rows.length) ({ rows } = await pool.query(NEXT_NEW_ROUND, [DISPATCH_EXCLUDED_EMAILS, 1]))
    if (!rows.length) return res.json({ agent: null, empty: true })
    // id 一起给出去:点击时带回来当 prefer,保证「看到谁点开就是谁」
    res.json({ agent: { ...agentCard(rows[0]), id: String(rows[0].id) } })
  } catch (err) {
    console.error('[agent-match] peek failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * ── 给买家挑的候选名单(只读,不落库)───────────────────────────────────────
 *
 * owner 2026-08-09:「点进去后输入联系方法的地方,显示 3 个随机现在排班的人让他们选」。
 *
 * 🔴 **候选按轮值顺序取,不是真随机。** 真随机会让排在队首、等最久的人被跳过,
 *    轮值就白做了。这里取的是**本轮还没拿到 lead 的队首 3 个**;
 *    展示顺序在前端打乱,买家看着是随机的,但被"提名"的机会仍然严格按轮值走。
 *
 * 🔴 **看到候选 ≠ 消耗轮次。** 轮次只在买家真的选了人并提交需求(reveal)时才消耗。
 *    否则每个点开弹窗的人都会一次吃掉 3 个人的名额。
 *
 * 池子不足 3 人就有几个给几个。
 */
router.get('/candidates', async (req: Request, res: Response) => {
  const want = Math.min(5, Math.max(1, Number(req.query.n) || 3))
  try {
    let { rows } = await pool.query(NEXT_IN_ROTATION, [DISPATCH_EXCLUDED_EMAILS, want])
    // 本轮全拿过了 → 开新一轮
    if (!rows.length) ({ rows } = await pool.query(NEXT_NEW_ROUND, [DISPATCH_EXCLUDED_EMAILS, want]))
    res.json({ agents: rows.map((r) => ({ ...agentCard(r), id: String(r.id) })) })
  } catch (err) {
    console.error('[agent-match] candidates failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 派单 ────────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const visitor = visitorOf(req)
  if (!visitor) return res.status(400).json({ error: 'visitor required' })
  const projectId = String(req.query.projectId || '').trim() || NO_PROJECT
  const source = String(req.query.source || 'project') === 'map' ? 'map' : 'project'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    /**
     * 串行化整个「挑人 + 落库」。
     *
     * 不加锁的话,两个买家同时点会读到同一份曝光计数 → 都被派给同一个人,
     * 而这正是这个功能要避免的事。事务级 advisory lock 最省事:
     * 事务一结束自动释放,不用手动 unlock(忘了 unlock 会锁死整个派单)。
     * 代价是派单变串行 —— 每次只有一条 SQL,量级完全无所谓。
     */
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('agent_match_pick'))`)

    // 已经派过就还他同一个人(sticky) —— 刷新一次换个经纪会让人觉得这平台不靠谱
    const existing = await client.query(
      `SELECT m.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name,
              m.revealed_at IS NOT NULL AS revealed
         FROM agent_match_assignments m
         JOIN lt_agents a ON a.id = m.agent_id
         LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
        WHERE m.visitor_id = $1 AND m.project_id = $2`,
      [visitor, projectId]
    )
    if (existing.rows.length) {
      await client.query('COMMIT')
      const r = existing.rows[0]
      return res.json({ matchId: Number(r.id), agent: agentCard(r), revealed: !!r.revealed })
    }

    /**
     * 挑人 —— **最少曝光优先**,同数按最久没派过的优先。
     *
     * 窗口只看最近 30 天:不设窗口的话,一个上个月接过很多单的人会被永久压在队尾,
     * 即使他现在很闲。滚动窗口让排班自己愈合。
     *
     * 注意计数用 LEFT JOIN 而不是子查询相关列 —— 从没被派过的人计数是 NULL,
     * COALESCE 成 0 才能排到最前面(否则新人永远进不来,和"公平"正好相反)。
     */
    /**
     * `prefer` = 买家在按钮上**已经看到的那张脸**(来自 /next 的 peek)。
     *
     * 优先用它,但**必须重新验一遍他还在池子里** —— 直接信前端传来的 id 的话,
     * 谁都能指定任意一个 agent id 把买家派给自己人,连暂停接单/掉订阅都绕过去了。
     * 验完发现不在池里就退回正常轮换(宁可换个人,也不能派给一个已经停接的人)。
     *
     * 这会让被 peek 到的人偶尔连拿两单,但排班是按 30 天滚动计数的,下一轮自己就平回来了。
     */
    const prefer = String(req.query.prefer || '').trim()
    let pick = { rows: [] as Record<string, unknown>[] }
    if (/^[0-9a-f-]{36}$/i.test(prefer)) {
      pick = await client.query(
        `SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name
           ${POOL_JOIN}
           LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
          WHERE ${POOL_WHERE} AND a.id = $2`,
        [DISPATCH_EXCLUDED_EMAILS, prefer]
      )
    }
    if (!pick.rows.length) {
      pick = await client.query(NEXT_IN_ROTATION, [DISPATCH_EXCLUDED_EMAILS, 1])
      // 本轮 32 个人全拿过 lead 了 → 自动开新一轮
      if (!pick.rows.length) pick = await client.query(NEXT_NEW_ROUND, [DISPATCH_EXCLUDED_EMAILS, 1])
    }
    if (!pick.rows.length) {
      await client.query('COMMIT')
      // 池子空是**正常状态**,不是错误 —— 前端据此不渲染入口,而不是弹个报错
      return res.json({ matchId: null, agent: null, empty: true })
    }

    const a = pick.rows[0]
    const ins = await client.query(
      `INSERT INTO agent_match_assignments (visitor_id, agent_id, project_id, source)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (visitor_id, project_id) DO NOTHING
       RETURNING id`,
      [visitor, a.id, projectId, source]
    )
    await client.query('COMMIT')
    res.json({ matchId: ins.rows[0] ? Number(ins.rows[0].id) : null, agent: agentCard(a), revealed: false })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[agent-match] pick failed:', err)
    res.status(500).json({ error: 'internal error' })
  } finally {
    client.release()
  }
})

// ── 买家要联系方式 ──────────────────────────────────────────────────────────
// 这一步才发电话,也才算转化。买家可以顺便留个自己的联系方式和一句话(都不强制 ——
// 强制留手机会把大部分人挡在门外,而我们现在最缺的就是任何一条真实询盘)。
router.post('/:id(\\d+)/reveal', async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  const visitor = visitorOf(req)
  if (!visitor) return res.status(400).json({ error: 'visitor required' })
  const buyerContact = String(req.body?.contact || '').trim().slice(0, CONTACT_MAX) || null
  const buyerNote = String(req.body?.note || '').trim().slice(0, NOTE_MAX) || null
  // 买家界面语言 —— 给经纪生成联系模板用。默认英文(见 agentOutreachTemplate)
  const buyerLang = String(req.body?.lang || '').trim().slice(0, 10) || null
  try {
    // visitor_id 一起进 WHERE:光有自增 id 的话,把 id 从 1 数到 N 就能把全池的
    // 手机号刷出来。带上 visitor 之后,别人的匹配记录你 reveal 不了。
    const { rows } = await pool.query(
      /**
       * `first_reveal` 必须拿**更新前**的值判。
       * UPDATE…RETURNING 给的是新值,而 revealed_at 已经被这次写上了 ——
       * 我第一版用「revealed_at 在 5 秒内」近似,结果连点三次都在 5 秒内、
       * 三次都被判成"第一次",邮件照样发了三封(2026-08-09 实测)。
       * 用 CTE 先把旧值取出来,判据就精确了。
       */
      `WITH before AS (
          SELECT id, revealed_at FROM agent_match_assignments
           WHERE id = $1 AND visitor_id = $2
       )
       UPDATE agent_match_assignments m
          SET revealed_at   = COALESCE(m.revealed_at, now()),
              buyer_contact = COALESCE($3, m.buyer_contact),
              buyer_note    = COALESCE($4, m.buyer_note),
              buyer_lang    = COALESCE(m.buyer_lang, $5),
              /**
               * 轮次在**这一刻**才消耗 —— 买家真的提交了需求才算一条 lead。
               * 只被分配、没提交的行 round_no 保持 NULL,不占名额。
               *
               * 本人本轮已经拿过 → 说明轮次该往前走了,记到下一轮;
               * 否则记当前轮。挑人那边保证了正常情况下不会走到"下一轮"这个分支
               * (它只在本轮全员拿满时才会派到已拿过的人)。
               */
              round_no      = COALESCE(m.round_no, (
                SELECT CASE WHEN EXISTS (
                         SELECT 1 FROM agent_match_assignments y
                          WHERE y.agent_id = m.agent_id AND y.round_no = c.r
                       ) THEN c.r + 1 ELSE c.r END
                  FROM (SELECT COALESCE(MAX(round_no), 1) AS r
                          FROM agent_match_assignments WHERE round_no IS NOT NULL) c
              ))
         FROM before
        WHERE m.id = before.id
      RETURNING m.agent_id,
                (SELECT p.project_name FROM residential_projects p WHERE p.id = m.project_id) AS project_name,
                (before.revealed_at IS NULL) AS first_reveal`,
      [id, visitor, buyerContact, buyerNote, buyerLang]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    const { rows: ag } = await pool.query(
      `SELECT display_name, email, phone, whatsapp, public_email FROM lt_agents WHERE id = $1`, [rows[0].agent_id]
    )
    const a = ag[0] || {}
    const channel = channelOf(a)

    /**
     * relay:经纪只有登录邮箱 —— **绝不把那个地址给买家**(注册用的私人地址,
     * 他没同意过公开)。改成我们把需求转发过去,买家全程看不到它。
     *
     * 通知是**异步批量**发的(见 services/agentMatchNotifier),所以这里只保证
     * "需求已收下并入队",不保证"邮件已送达"。发信失败由通知器自己重试。
     */
    if (channel === 'relay') {
      if (!buyerContact) {
        // 这条路买家看不到任何联系方式,经纪只能回过去 —— 没有回址就是死信
        return res.status(400).json({ error: 'contact_required', channel })
      }
      /**
       * **不在这里同步发信**(owner:「不要一次性发,每次发的间隔要有 5 分钟,
       * 收集好 lead 一次性发给他」)。这里只把它留在待发队列里
       * (notified_at IS NULL),由 services/agentMatchNotifier 每分钟扫一次:
       * 距该经纪上次通知 ≥5 分钟才发,并把攒下的多条合成一封。
       *
       * 所以这里返回的 relayed 是「需求已收下」,不是「邮件已送达」——
       * 前端文案也要照这个说,别承诺"已经发给他了"。
       */
      if (!rows[0].first_reveal) {
        return res.json({ display_name: a.display_name || null, channel, relayed: true, resent: false })
      }
      return res.json({ display_name: a.display_name || null, channel, relayed: true, queued: true })
    }

    res.json({
      display_name: a.display_name || null,
      channel,
      phone: a.phone || null,
      // 没单独填 whatsapp 就用手机号 —— 迪拜这边 WhatsApp 就是主要联系方式
      whatsapp: a.whatsapp || a.phone || null,
      // public_email 是他**主动填的公开邮箱**,可以直接给买家(登录邮箱不行)
      email: channel === 'email' ? a.public_email : null,
    })
  } catch (err) {
    console.error('[agent-match] reveal failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 经纪台:派给我的买家 ─────────────────────────────────────────────────────
router.get('/mine', requireAuth, async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  if (!email) return res.status(401).json({ error: 'auth required' })
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.created_at, m.revealed_at, m.buyer_contact, m.buyer_note,
              m.agent_ack_at, m.source, m.project_id, m.buyer_lang,
              p.project_name, a.display_name AS agent_name, a.brand AS agent_brand
         FROM agent_match_assignments m
         JOIN lt_agents a ON a.id = m.agent_id
         LEFT JOIN residential_projects p ON p.id = m.project_id
        WHERE lower(a.email) = $1
        ORDER BY m.created_at DESC
        LIMIT 200`,
      [email]
    )
    /**
     * 每条记录都带一份**写好的联系模板**(主题 + 正文,按买家语言)。
     * owner:「不用帮他发邮件 给他准备模板就好」—— 我们不夹在中间发信,
     * 署名和后续往来都在经纪自己手里,但也不让他从零开始编
     * (不给模板的实测结果是一封无主题的一句话邮件)。
     */
    res.json({
      matches: rows.map((r) => ({
        ...r,
        template: buildOutreach(outreachLang(r.buyer_lang), {
          agentName: r.agent_name,
          agentTitle: (r.agent_brand as { title?: string } | null)?.title,
          projectName: r.project_name,
          buyerNote: r.buyer_note,
        }),
      })),
    })
  } catch (err) {
    console.error('[agent-match] mine failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/**
 * 经纪标记「已跟进」/「没联系上」。只能改派给自己的那些。
 *
 * `dead: true` = **没联系上,把轮次退回去**。
 *
 * 为什么需要这个:WhatsApp 渠道的买家可以只拿走号码、什么都不留。经纪的轮次
 * 已经被消耗掉了,但那位买家可能压根没来找他 —— 于是他白白排到队尾。
 * 退回 = `round_no` 置空,本轮他重新可被派到。
 *
 * ⚠️ 只退**没留联系方式**的那种。留了联系方式的经纪本来就能主动联系,
 *    再给退路等于"不想跟进就退掉",轮值会被玩坏。
 */
router.patch('/mine/:id(\d+)', requireAuth, async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  const id = Number(req.params.id)
  if (!email) return res.status(401).json({ error: 'auth required' })
  const dead = req.body?.dead === true
  try {
    if (dead) {
      const { rows } = await pool.query(
        `UPDATE agent_match_assignments m
            SET round_no = NULL, agent_ack_at = now()
           FROM lt_agents a
          WHERE m.id = $1 AND m.agent_id = a.id AND lower(a.email) = $2
            AND COALESCE(m.buyer_contact, '') = ''
        RETURNING m.id`,
        [id, email]
      )
      if (!rows.length) return res.status(400).json({ error: 'not_eligible' })
      return res.json({ match: { id: rows[0].id, round_returned: true } })
    }
    const { rows } = await pool.query(
      `UPDATE agent_match_assignments m
          SET agent_ack_at = CASE WHEN $3 THEN now() ELSE NULL END
         FROM lt_agents a
        WHERE m.id = $1 AND m.agent_id = a.id AND lower(a.email) = $2
      RETURNING m.id, m.agent_ack_at`,
      [id, email, req.body?.done !== false]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    res.json({ match: rows[0] })
  } catch (err) {
    console.error('[agent-match] ack failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── 我在不在池子里 / 还差什么 ───────────────────────────────────────────────
// 这个接口是这个功能的**增长钩子**:池子里现在只有 2 个人,差的就是手机号。
// 所以它不只回答"在/不在",还回答"差什么" —— 让经纪知道补一个字段就能接客户。
router.get('/pool', requireAuth, async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  if (!email) return res.status(401).json({ error: 'auth required' })
  try {
    /**
     * ⚠️ 三处判据必须和**真实派单**完全一致,否则经纪台会显示
     * 「正在接单」而实际根本轮不到他 —— 排班表刚犯过一模一样的错:
     *   ① 联系渠道:手机/WhatsApp/公开邮箱/登录邮箱 都算(不是只看手机号)
     *   ② 内部账号排除
     *   ③ 轮次:本轮拿过就要等下一轮
     */
    const { rows } = await pool.query(
      `WITH cur AS (
         SELECT COALESCE(MAX(round_no), 1) AS r FROM agent_match_assignments WHERE round_no IS NOT NULL
       )
       SELECT a.id, a.match_paused_at, cur.r AS round_no,
              COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,''),
                       NULLIF(a.public_email,''), NULLIF(a.email,'')) IS NOT NULL AS has_contact,
              CASE WHEN COALESCE(NULLIF(a.whatsapp,''), NULLIF(a.phone,'')) IS NOT NULL THEN 'whatsapp'
                   WHEN NULLIF(a.public_email,'') IS NOT NULL THEN 'email'
                   ELSE 'relay' END AS channel,
              COALESCE(a.photo_url,'') <> '' AS has_photo,
              COALESCE(a.rera_brn,'')  <> '' AS has_brn,
              -- 系统注册时按邮箱前缀填的默认名 —— 那不算"填了名字":
              -- 摆到买家面前是一串 tczhulei2001 而不是人名。
              -- ⚠️ 这段在 JS 模板字符串里,注释里**别写反引号**,会把字符串截断。
              (COALESCE(a.display_name,'') <> ''
               AND lower(a.display_name) <> lower(split_part(a.email,'@',1))) AS has_real_name,
              lower(a.email) = ANY($2::text[]) AS internal,
              EXISTS (SELECT 1 FROM lt_subscriptions s
                       WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                         AND s.status IN ('active','trialing','past_due')) AS subscribed,
              EXISTS (SELECT 1 FROM agent_match_assignments x
                       WHERE x.agent_id = a.id AND x.round_no = cur.r) AS got_this_round,
              (SELECT count(*) FROM agent_match_assignments x
                WHERE x.agent_id = a.id) AS matched_total,
              (SELECT count(*) FROM agent_match_assignments x
                WHERE x.agent_id = a.id AND x.revealed_at IS NOT NULL) AS leads_total
         FROM lt_agents a CROSS JOIN cur WHERE lower(a.email) = $1 LIMIT 1`,
      [email, DISPATCH_EXCLUDED_EMAILS]
    )
    if (!rows.length) return res.json({ in_pool: false, subscribed: false, has_contact: false })
    const r = rows[0]
    const inPool = r.subscribed && r.has_contact && !r.match_paused_at && !r.internal

    /**
     * 「本轮排第几」—— 经纪最想知道的其实是这个:还要等几个人才轮到我。
     * 算法用的是同一套排序键(累计分配少的优先,再按最久没被派的),
     * 所以这里数出来的名次就是真实队列里的名次。
     * 本轮已经拿过 / 不在池里 → 没有名次,返回 null(**不编一个数字**)。
     */
    let queuePos: number | null = null
    let queueLen: number | null = null
    if (inPool && !r.got_this_round) {
      const q = await pool.query(
        `WITH cur AS (
           SELECT COALESCE(MAX(round_no), 1) AS r FROM agent_match_assignments WHERE round_no IS NOT NULL
         ), q AS (
           SELECT a.id,
                  ROW_NUMBER() OVER (ORDER BY COALESCE(m.n, 0) ASC,
                                              COALESCE(m.last_at, 'epoch'::timestamptz) ASC, a.id ASC) AS pos
             ${POOL_JOIN}
             CROSS JOIN cur
             LEFT JOIN (SELECT agent_id, count(*) AS n, max(created_at) AS last_at
                          FROM agent_match_assignments GROUP BY agent_id) m ON m.agent_id = a.id
            WHERE ${POOL_WHERE}
              AND NOT EXISTS (SELECT 1 FROM agent_match_assignments x
                               WHERE x.agent_id = a.id AND x.round_no = cur.r)
         )
         SELECT (SELECT pos FROM q WHERE id = $2) AS pos, (SELECT count(*) FROM q) AS len`,
        [DISPATCH_EXCLUDED_EMAILS, r.id]
      )
      queuePos = q.rows[0]?.pos ? Number(q.rows[0].pos) : null
      queueLen = q.rows[0]?.len ? Number(q.rows[0].len) : null
    }

    res.json({
      in_pool: inPool,
      subscribed: r.subscribed,
      has_contact: r.has_contact,
      channel: r.channel,
      has_photo: r.has_photo,
      has_brn: r.has_brn,
      has_real_name: r.has_real_name,
      paused: !!r.match_paused_at,
      /** 内部账号(owner 的号/demo)—— 永远不进派单,如实告诉他,别显示「正在接单」 */
      internal: r.internal,
      round_no: Number(r.round_no),
      got_this_round: r.got_this_round,
      queue_position: queuePos,
      queue_length: queueLen,
      matched_30d: Number(r.matched_total),
      leads_total: Number(r.leads_total),
    })
  } catch (err) {
    console.error('[agent-match] pool status failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

/** 自己开关接单。 */
router.patch('/pool', requireAuth, async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  if (!email) return res.status(401).json({ error: 'auth required' })
  try {
    await pool.query(
      `UPDATE lt_agents SET match_paused_at = CASE WHEN $2 THEN now() ELSE NULL END
        WHERE lower(email) = $1`,
      [email, req.body?.paused === true]
    )
    res.json({ paused: req.body?.paused === true })
  } catch (err) {
    console.error('[agent-match] pause failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ── admin:全量记录 + 排班 ───────────────────────────────────────────────────
router.get('/admin', requireOwner, async (_req: Request, res: Response) => {
  try {
    // 排班:池子里每个人最近 30 天被派了几次、多少条真的要了联系方式、多少条跟进了
    /**
     * 排班表。
     *
     * 🔴 **必须排除自己人**(owner 2026-08-09:「排班别派给我」)。派单本身早就排了,
     *    但这张表漏了 —— 于是 owner、合伙人、demo 号都躺在排班里,还标着「在池中」,
     *    看起来像随时会被派到。表和真实池子用**同一份 DISPATCH_EXCLUDED_EMAILS**。
     *
     * 🔴 **「联系得上」的判据要和派单池一致**。原来只看手机号 —— 但邮箱中转上线后,
     *    只有登录邮箱的 31 个人其实也联系得上,表里却全标着「联系不上」。
     *    直接返回 channel(whatsapp / email / relay),比一个二值更有信息量。
     *
     * `in_pool` **在服务端算**,不让前端拿三个布尔量再拼一遍 —— 两处判据必然分叉,
     * 而分叉的结果就是这次这种「表里说在池中,实际根本不会被派到」。
     */
    const roster = await pool.query(
      `SELECT a.email, a.display_name,
              COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,''),
                       NULLIF(a.public_email,''), NULLIF(a.email,'')) IS NOT NULL AS has_contact,
              CASE WHEN COALESCE(NULLIF(a.whatsapp,''), NULLIF(a.phone,'')) IS NOT NULL THEN 'whatsapp'
                   WHEN NULLIF(a.public_email,'') IS NOT NULL THEN 'email'
                   ELSE 'relay' END AS channel,
              a.match_paused_at IS NOT NULL AS paused,
              EXISTS (SELECT 1 FROM lt_subscriptions s
                       WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                         AND s.status IN ('active','trialing','past_due')) AS subscribed,
              (a.match_paused_at IS NULL
                AND EXISTS (SELECT 1 FROM lt_subscriptions s
                             WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                               AND s.status IN ('active','trialing','past_due'))) AS in_pool,
              COALESCE(m.n, 0)        AS matched_30d,
              COALESCE(m.revealed, 0) AS revealed_30d,
              COALESCE(m.acked, 0)    AS acked_30d,
              m.last_at
         FROM lt_agents a
         LEFT JOIN (
           SELECT agent_id, count(*) n,
                  count(*) FILTER (WHERE revealed_at  IS NOT NULL) revealed,
                  count(*) FILTER (WHERE agent_ack_at IS NOT NULL) acked,
                  max(created_at) last_at
             FROM agent_match_assignments
            WHERE created_at > now() - interval '30 days'
            GROUP BY agent_id
         ) m ON m.agent_id = a.id
        WHERE lower(a.email) <> ALL($1::text[])
          AND (EXISTS (SELECT 1 FROM lt_subscriptions s
                        WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                          AND s.status IN ('active','trialing','past_due'))
               OR COALESCE(m.n, 0) > 0)
        ORDER BY COALESCE(m.n, 0) DESC, a.display_name`,
      [DISPATCH_EXCLUDED_EMAILS]
    )
    const matches = await pool.query(
      `SELECT m.id, m.created_at, m.revealed_at, m.agent_ack_at, m.source,
              m.buyer_contact, m.buyer_note, m.visitor_id,
              a.email AS agent_email, a.display_name AS agent_name,
              p.project_name
         FROM agent_match_assignments m
         JOIN lt_agents a ON a.id = m.agent_id
         LEFT JOIN residential_projects p ON p.id = m.project_id
        ORDER BY m.created_at DESC LIMIT 300`
    )
    // 池子大小单独给 —— 它是这个功能能不能转起来的**唯一**先决条件
    const size = await pool.query(`SELECT count(*)::int AS n ${POOL_JOIN} WHERE ${POOL_WHERE}`, [DISPATCH_EXCLUDED_EMAILS])
    /**
     * 轮次进度 —— 运营真正要看的是「本轮还剩谁没拿到」,不是谁接得多。
     * done = 本轮已拿到 lead 的人数,pool_size - done = 本轮还没轮到的人。
     */
    const round = await pool.query(
      `WITH cur AS (SELECT COALESCE(MAX(round_no), 1) AS r FROM agent_match_assignments WHERE round_no IS NOT NULL)
       SELECT cur.r AS round_no,
              (SELECT count(DISTINCT x.agent_id)::int FROM agent_match_assignments x, cur WHERE x.round_no = cur.r) AS done
         FROM cur`
    )
    // 本轮还没拿到 lead 的人(排班队列的队首就在这里面)
    const waiting = await pool.query(
      `WITH cur AS (SELECT COALESCE(MAX(round_no), 1) AS r FROM agent_match_assignments WHERE round_no IS NOT NULL)
       SELECT a.email ${POOL_JOIN} CROSS JOIN cur
        WHERE ${POOL_WHERE}
          AND NOT EXISTS (SELECT 1 FROM agent_match_assignments x WHERE x.agent_id = a.id AND x.round_no = cur.r)`,
      [DISPATCH_EXCLUDED_EMAILS]
    )
    /**
     * 漏斗总量 —— 三个数的含义差很多,别混着看:
     *   assigned  买家点开了卡片(看到了这个人)
     *   revealed  买家真的提交了需求 = **一条 lead**,也是唯一消耗轮次的事件
     *   acked     经纪自己标了「已跟进」
     * assigned 高而 revealed 为 0,说明卡片没说服力,不是派单不公平。
     */
    const totals = await pool.query(
      `SELECT count(*)::int AS assigned,
              count(*) FILTER (WHERE revealed_at  IS NOT NULL)::int AS revealed,
              count(*) FILTER (WHERE agent_ack_at IS NOT NULL)::int AS acked,
              count(*) FILTER (WHERE revealed_at IS NOT NULL AND notified_at IS NULL)::int AS queued,
              count(DISTINCT visitor_id)::int AS visitors
         FROM agent_match_assignments`
    )
    /**
     * 近 30 天逐日 —— 生成完整日历序列再 LEFT JOIN,**不能只 GROUP BY 有数据的天**:
     * 缺口天会被折叠掉,图上看起来就像"一直在涨",而不是"中间三天一条都没有"。
     */
    const daily = await pool.query(
      `SELECT d::date AS day,
              count(m.id) FILTER (WHERE m.id IS NOT NULL)::int AS assigned,
              count(m.id) FILTER (WHERE m.revealed_at IS NOT NULL)::int AS revealed
         FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') d
         LEFT JOIN agent_match_assignments m ON m.created_at::date = d::date
        GROUP BY d ORDER BY d`
    )
    res.json({
      roster: roster.rows, matches: matches.rows, pool_size: size.rows[0]?.n ?? 0,
      round_no: round.rows[0]?.round_no ?? 1,
      round_done: round.rows[0]?.done ?? 0,
      round_waiting: waiting.rows.map((r) => r.email),
      totals: totals.rows[0],
      daily: daily.rows,
    })
  } catch (err) {
    console.error('[agent-match] admin failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
