/**
 * 买家的「我的东西」—— 收藏 / 看过的房源 / 联系过的顾问。
 *
 *   GET /api/my-activity   一次给齐三块                     公开(靠 visitor 或登录身份)
 *
 * owner 2026-08-09:「买家 profile 也可以有点用的工具」。
 * 这三块的数据**早就在采**,只是买家自己看不到:
 *   · user_favorites        收藏(登录后才有 user_id)
 *   · app_events            property_view(匿名也有,靠 visitor_id)
 *   · agent_match_assignments 他点过「找真人帮忙」分到的顾问
 *
 * 🔴 **身份用「登录邮箱 ∪ visitor_id」两条腿。**
 *    只认登录:匿名浏览的记录全丢(而买家绝大多数时候是匿名的)。
 *    只认 visitor:换个浏览器就什么都没有。
 *    两条都认,买家登录后才能看到自己登录前逛过的东西 —— 那才是他期待的。
 *
 * 🔴 **绝不返回经纪的联系方式。** 顾问那块只给名字/头像/头衔,
 *    要电话仍然走 agent-match 的 reveal(那是唯一的出口,也是转化埋点)。
 */
import { Router, Request, Response } from 'express'
import pool from '../db/pool'

const router = Router()

const LIMIT = 24

function visitorOf(req: Request): string {
  return String(req.headers['x-visitor-id'] || req.query.visitorId || '').trim().slice(0, 64)
}

router.get('/', async (req: Request, res: Response) => {
  const email = (req.ctx?.email || req.user?.email || '').toLowerCase()
  const visitor = visitorOf(req)
  const userId = req.ctx?.userId || req.user?.id || null
  if (!email && !visitor) return res.json({ favorites: [], viewed: [], advisors: [] })

  try {
    const [fav, viewed, advisors] = await Promise.all([
      /**
       * 收藏 —— 只有登录用户有(user_favorites 挂 user_id)。
       * 没登录就是空数组,前端据此提示"登录后可以把收藏留下来"。
       */
      userId
        ? pool.query(
            `SELECT p.id, p.project_name, p.developer, p.area, p.starting_price,
                    p.completion_date, f.added_at
               FROM user_favorites f
               JOIN residential_projects p ON p.id = f.project_id
              WHERE f.user_id = $1
              ORDER BY f.added_at DESC LIMIT ${LIMIT}`,
            [userId]
          )
        : Promise.resolve({ rows: [] }),

      /**
       * 看过的房源 —— 走 app_events。
       * ⚠️ 必须 DISTINCT 到项目再取最近一次,否则同一个项目看了 5 次就占 5 个位置,
       *    列表看起来像坏了。
       */
      pool.query(
        `SELECT DISTINCT ON (e.project_id)
                p.id, p.project_name, p.developer, p.area, p.starting_price,
                e.created_at AS viewed_at
           FROM app_events e
           JOIN residential_projects p ON p.id = e.project_id
          WHERE e.event_type = 'property_view' AND e.project_id IS NOT NULL
            AND (($1 <> '' AND e.visitor_id = $1) OR ($2 <> '' AND lower(e.user_email) = $2))
          ORDER BY e.project_id, e.created_at DESC`,
        [visitor, email]
      ),

      /**
       * 联系过的顾问 —— 他点过「找真人帮忙」分到谁。
       * **不含任何联系方式**(见文件头)。带上 matchId,前端可以直接跳回去要电话。
       */
      pool.query(
        `SELECT m.id AS match_id, m.created_at, m.revealed_at,
                a.display_name, a.photo_url, a.brand,
                p.project_name
           FROM agent_match_assignments m
           JOIN lt_agents a ON a.id = m.agent_id
           LEFT JOIN residential_projects p ON p.id = m.project_id
          WHERE ($1 <> '' AND m.visitor_id = $1)
          ORDER BY m.created_at DESC LIMIT 20`,
        [visitor]
      ),
    ])

    // 看过的按时间倒序(上面为了 DISTINCT ON 必须先按 project_id 排)
    const viewedRows = [...viewed.rows].sort(
      (a, b) => new Date(b.viewed_at).getTime() - new Date(a.viewed_at).getTime()
    ).slice(0, LIMIT)

    res.json({
      favorites: fav.rows,
      viewed: viewedRows,
      advisors: advisors.rows.map((r) => ({
        match_id: Number(r.match_id),
        created_at: r.created_at,
        revealed: !!r.revealed_at,
        display_name: r.display_name,
        photo_url: r.photo_url,
        title: (r.brand as { title?: string } | null)?.title ?? null,
        project_name: r.project_name,
      })),
      signed_in: !!userId,
    })
  } catch (err) {
    console.error('[my-activity] failed:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
