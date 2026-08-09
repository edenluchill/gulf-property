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
const POOL_WHERE = `
  s.status IN ('active','trialing','past_due')
  AND COALESCE(NULLIF(a.phone,''), NULLIF(a.whatsapp,'')) IS NOT NULL
  AND a.match_paused_at IS NULL
  AND lower(a.email) <> ALL($1::text[])
`

/** 对外的经纪卡片 —— **没有任何联系方式**。 */
function agentCard(r: Record<string, unknown>) {
  return {
    display_name: (r.display_name as string) || null,
    photo_url: (r.photo_url as string) || null,
    // brand.title 是经纪自己填的头衔(「认证顾问」之类)
    title: (r.brand as { title?: string } | null)?.title ?? null,
    brokerage: (r.brokerage_name as string) || null,
    rera_brn: (r.rera_brn as string) || null,
  }
}

function visitorOf(req: Request): string {
  return String(req.headers['x-visitor-id'] || req.body?.visitorId || req.query.visitorId || '').trim().slice(0, 64)
}

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
      `SELECT m.id, a.display_name, a.photo_url, a.brand, a.rera_brn, b.name AS brokerage_name,
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
    const pick = await client.query(
      `SELECT a.id, a.display_name, a.photo_url, a.brand, a.rera_brn, b.name AS brokerage_name
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
        LIMIT 1`,
      [INTERNAL_EMAILS]
    )
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
  try {
    // visitor_id 一起进 WHERE:光有自增 id 的话,把 id 从 1 数到 N 就能把全池的
    // 手机号刷出来。带上 visitor 之后,别人的匹配记录你 reveal 不了。
    const { rows } = await pool.query(
      `UPDATE agent_match_assignments
          SET revealed_at   = COALESCE(revealed_at, now()),
              buyer_contact = COALESCE($3, buyer_contact),
              buyer_note    = COALESCE($4, buyer_note)
        WHERE id = $1 AND visitor_id = $2
      RETURNING agent_id`,
      [id, visitor, buyerContact, buyerNote]
    )
    if (!rows.length) return res.status(404).json({ error: 'not found' })
    const { rows: ag } = await pool.query(
      `SELECT display_name, phone, whatsapp FROM lt_agents WHERE id = $1`, [rows[0].agent_id]
    )
    const a = ag[0] || {}
    res.json({
      display_name: a.display_name || null,
      phone: a.phone || null,
      // 没单独填 whatsapp 就用手机号 —— 迪拜这边 WhatsApp 就是主要联系方式
      whatsapp: a.whatsapp || a.phone || null,
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
              m.agent_ack_at, m.source, m.project_id,
              p.project_name
         FROM agent_match_assignments m
         JOIN lt_agents a ON a.id = m.agent_id
         LEFT JOIN residential_projects p ON p.id = m.project_id
        WHERE lower(a.email) = $1
        ORDER BY m.created_at DESC
        LIMIT 200`,
      [email]
    )
    res.json({ matches: rows })
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
