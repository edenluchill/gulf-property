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
import { ADMIN_EMAILS } from '../lib/adminEmails'
import { sendAlertEmail } from '../services/notify'
import { buildOutreach, outreachLang } from '../lib/agentOutreachTemplate'

const router = Router()

/** 地图/区域入口没有具体项目 —— 用全零 UUID 占位,让 sticky 唯一索引照样生效。 */
const NO_PROJECT = '00000000-0000-0000-0000-000000000000'
const NOTE_MAX = 500
const CONTACT_MAX = 120

/**
 * **自己人绝不进派单池。** owner 2026-08-09:「不要发给我,要匹配给付费/试用的经纪」。
 *
 * 不排的话池子里 4 个人有 2 个是我们自己(owner + 合伙人,两人都有生效订阅和手机号),
 * 等于把一半买家派回给自己 —— 而且会把「派单是否真的转起来」这个指标彻底污染。
 * demo 号也一起排:它的手机号是 +971500000000,派出去买家永远打不通。
 */
const INTERNAL_EMAILS = [
  ...ADMIN_EMAILS,                 // lzp6529 / shelldubai26(单一真源,别在这里再抄一遍)
  'admin@yesir.ai',
  'demo-agent@luna.tour',
].map((e) => e.toLowerCase())

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
 * ⚠️ 用到的查询都要把 INTERNAL_EMAILS 当 $1 传进去。
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
const NEXT_IN_ROTATION = `
  SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, a.phone, a.whatsapp, a.public_email, b.name AS brokerage_name
    ${POOL_JOIN}
    LEFT JOIN lt_brokerages b ON b.id = a.brokerage_id
    LEFT JOIN (
      SELECT agent_id, count(*) AS n, max(created_at) AS last_at
        FROM agent_match_assignments
       WHERE created_at > now() - interval '30 days'
       GROUP BY agent_id
    ) m ON m.agent_id = a.id
   WHERE ${POOL_WHERE}
   ORDER BY COALESCE(m.n, 0) ASC, COALESCE(m.last_at, 'epoch'::timestamptz) ASC, a.id ASC
   LIMIT 1
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
    const { rows } = await pool.query(NEXT_IN_ROTATION, [INTERNAL_EMAILS])
    if (!rows.length) return res.json({ agent: null, empty: true })
    // id 一起给出去:点击时带回来当 prefer,保证「看到谁点开就是谁」
    res.json({ agent: { ...agentCard(rows[0]), id: String(rows[0].id) } })
  } catch (err) {
    console.error('[agent-match] peek failed:', err)
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
        [INTERNAL_EMAILS, prefer]
      )
    }
    if (!pick.rows.length) {
      pick = await client.query(NEXT_IN_ROTATION, [INTERNAL_EMAILS])
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
              buyer_lang    = COALESCE(m.buyer_lang, $5)
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
     * 转发失败不能当成功:买家会以为"已经发出去了"然后一直等。所以 sendAlertEmail
     * 的返回值要看,失败就如实告诉他没送到。
     */
    if (channel === 'relay') {
      if (!buyerContact) {
        // 这条路买家看不到任何联系方式,经纪只能回过去 —— 没有回址就是死信
        return res.status(400).json({ error: 'contact_required', channel })
      }
      const projName = String(rows[0].project_name || '').trim()
      /**
       * 给**经纪**的通知信。两个原则:
       *   ① 必须有清楚的主题 —— 他要在一堆邮件里一眼认出这是条线索
       *   ② 把**写好的模板**一起给他,而不是让他自己现编
       *      (2026-08-09 实测:不给模板,他发出去的是一封无主题的一句话邮件)
       * 模板按**买家的**语言,不是经纪的 —— 收信的是买家。
       */
      const tpl = buildOutreach(outreachLang(buyerLang), {
        agentName: a.display_name, agentTitle: (a.brand as { title?: string } | null)?.title,
        brokerage: null, projectName: projName, buyerNote,
      })
      const subject = projName
        ? `【Pinzos】新买家线索 · ${projName}`
        : '【Pinzos】新买家线索'
      const text = [
        `${a.display_name || ''}你好,`,
        '',
        `有位买家在 Pinzos 上${projName ? `浏览 ${projName} 时` : ''}请求联系顾问,系统按轮值把他分给了你。`,
        '',
        '─── 买家信息 ───',
        `联系方式:${buyerContact}`,
        `留言:${buyerNote || '(未填写)'}`,
        `使用语言:${buyerLang || '未知(按英文处理)'}`,
        '',
        '─── 可直接发给他的邮件(已按买家语言写好)───',
        `主题:${tpl.subject}`,
        '',
        tpl.body,
        '',
        '────────────',
        '这封模板只是给你省事,发信请用你自己的邮箱 —— 署名和后续往来都在你手里。',
        `全部分给你的买家:https://www.pinzos.com/agent/matches`,
      ].join('\n')
      const sent = await sendAlertEmail(subject, text, undefined, [String(a.email)])
      return res.json({ display_name: a.display_name || null, channel, relayed: sent })
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

/** 经纪标记「已跟进」。只能改派给自己的那些。 */
router.patch('/mine/:id(\\d+)', requireAuth, async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  const id = Number(req.params.id)
  if (!email) return res.status(401).json({ error: 'auth required' })
  try {
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
    const { rows } = await pool.query(
      `SELECT a.id, a.match_paused_at,
              COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,'')) IS NOT NULL AS has_contact,
              COALESCE(a.photo_url,'') <> '' AS has_photo,
              COALESCE(a.rera_brn,'')  <> '' AS has_brn,
              EXISTS (SELECT 1 FROM lt_subscriptions s
                       WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                         AND s.status IN ('active','trialing','past_due')) AS subscribed,
              (SELECT count(*) FROM agent_match_assignments x
                WHERE x.agent_id = a.id AND x.created_at > now() - interval '30 days') AS matched_30d
         FROM lt_agents a WHERE lower(a.email) = $1 LIMIT 1`,
      [email]
    )
    if (!rows.length) return res.json({ in_pool: false, subscribed: false, has_contact: false })
    const r = rows[0]
    res.json({
      in_pool: r.subscribed && r.has_contact && !r.match_paused_at,
      subscribed: r.subscribed,
      has_contact: r.has_contact,
      has_photo: r.has_photo,
      has_brn: r.has_brn,
      paused: !!r.match_paused_at,
      matched_30d: Number(r.matched_30d),
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
    const roster = await pool.query(
      `SELECT a.email, a.display_name,
              COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,'')) IS NOT NULL AS has_contact,
              a.match_paused_at IS NOT NULL AS paused,
              EXISTS (SELECT 1 FROM lt_subscriptions s
                       WHERE s.agent_id = COALESCE(a.billing_agent_id, a.id)
                         AND s.status IN ('active','trialing','past_due')) AS subscribed,
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
        WHERE COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,'')) IS NOT NULL
           OR COALESCE(m.n, 0) > 0
        ORDER BY COALESCE(m.n, 0) DESC, a.display_name`
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
    const size = await pool.query(`SELECT count(*)::int AS n ${POOL_JOIN} WHERE ${POOL_WHERE}`, [INTERNAL_EMAILS])
    res.json({ roster: roster.rows, matches: matches.rows, pool_size: size.rows[0]?.n ?? 0 })
  } catch (err) {
    console.error('[agent-match] admin failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
