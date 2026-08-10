/**
 * Luna Tour — 购买意向信号 → 站内提醒经纪。
 *
 * ── owner 2026-07-13 定调（我上一版做错了两件事）─────────────────────────
 *
 * ❌ **不发邮件。** 「感觉有点骚扰了，现在还不太稳定。」
 *    产品还没稳到值得往别人收件箱里推东西。信号先留在站内，等它准了再说。
 *    (sendAlertEmail 仍然存在,但**这里不调它**。想开的话看文件末尾的注释。)
 *
 * ❌ **不要假装我们知道他是谁。** 上一版的文案是「陈先生想联系你」+ 一个
 *    「去跟进」按钮 —— 而 Luna Tour 的访客是**匿名的**:我们没有他的电话、
 *    没有微信。经纪点进去会发现**根本联系不上任何人**。
 *
 *    实测:10 场 tour **6 场完全匿名**;剩下 4 场绑了客户,而那 4 个客户
 *    **0 个有电话、0 个有 WhatsApp**。
 *
 *    这跟 leads tab 被下架是同一个病(全匿名 / 0 联系方式 / 认领了也联系不上)。
 *    **一个联系不上的"线索"不是线索,是噪音。**
 *
 * ── 所以现在的口径:这是**信号**,不是线索 ────────────────────────────────
 *
 * 两种情况,说两种话:
 *
 *   ① 这场 tour 是**发给某个客户**的(session.client_id) ——
 *      经纪自己建的客户,他本来就认识这个人(电话在他自己手机里)。
 *      → 可以指名道姓,但**不能吹**成「他要联系你了」。只说他做了什么。
 *
 *   ② 这场 tour 是**公开链接**,谁都能点 ——
 *      **我们真的不知道他是谁。** 那就**明说**,并告诉经纪下次怎么做才能知道
 *     (从客户雷达里选一个客户再生成 → 行为就会挂到那个名字下面)。
 *
 * ── 🌍 2026-08-09:文案**不在这里定语言** ────────────────────────────────
 * 原来 title/body 是在这里拼成中文成品存库的 → 英文界面的经纪看到的是
 * 「有人点了「联系经纪」」(owner 实拍工作台)。
 * 现在同时写一份 `params`(who / known / tour / project),**前端按经纪的
 * 界面语言渲染**。他换语言,历史通知也跟着换 —— 写入时定死做不到这件事。
 * title/body 照旧写,只当兜底(旧客户端 / 以后的邮件模板)。
 *
 * 🔴 新增通知类型时:**params 和 i18n 键要一起加**,否则新类型会静默掉回中文。
 *    前端键在 `lunaTour.json` 的 `sig.*`。
 *
 * ISOLATION: 只写 lt_notifications,失败绝不冒泡(埋点不能拖垮客户的播放)。
 */
import pool from '../db/pool'

const HIGH_INTENT = new Set(['tour_complete', 'cta_whatsapp', 'cta_call', 'feedback'])

interface Ctx {
  sessionId: string
  visitorId: string
  eventType: string
  projectId?: string | null
}

const KIND: Record<string, string> = {
  tour_complete: 'tour_complete',
  cta_whatsapp: 'cta',
  cta_call: 'cta',
  feedback: 'favorite',
}

export function isHighIntent(eventType: string): boolean {
  return HIGH_INTENT.has(eventType)
}

/** fire-and-forget —— 调用方不 await,也绝不会因为它失败而影响客户播放。 */
export async function notifyAgentOfIntent(ctx: Ctx): Promise<void> {
  if (!isHighIntent(ctx.eventType)) return
  try {
    const { rows } = await pool.query<{
      agent_id: string
      agent_email: string | null
      client_id: string | null
      client_name: string | null
      title: string
      share_code: string
    }>(
      `SELECT s.agent_id, a.email AS agent_email,
              s.client_id, c.name AS client_name, s.title, s.share_code
         FROM lt_demo_sessions s
         JOIN lt_agents a ON a.id = s.agent_id
         LEFT JOIN lt_clients c ON c.id = s.client_id
        WHERE s.id = $1`,
      [ctx.sessionId]
    )
    const s = rows[0]
    if (!s) return

    // demo 经纪不该收提醒(公开 demo 每天都有人看)
    if ((s.agent_email || '').startsWith('demo-agent@')) return

    const kind = KIND[ctx.eventType] || ctx.eventType

    /**
     * 🔴 **我们到底知不知道这是谁。**
     * 知道 = 这场 tour 是经纪从客户雷达里挑着某个客户生成的。
     * 不知道 = 公开链接,任何人点进来 —— 那就别装。
     */
    const known = !!s.client_id && !!s.client_name
    const who = known ? s.client_name! : '有人'

    let projectName = ''
    if (ctx.projectId) {
      const p = await pool.query<{ name: string }>(
        `SELECT snapshot->>'name' AS name FROM lt_session_properties
          WHERE session_id=$1 AND project_id=$2 LIMIT 1`,
        [ctx.sessionId, ctx.projectId]
      )
      projectName = p.rows[0]?.name || ''
    }

    const title =
      kind === 'tour_complete' ? `${who}看完了《${s.title}》`
      : kind === 'cta' ? `${who}点了「联系经纪」`
      : `${who}收藏了${projectName ? `「${projectName}」` : '一套房'}`

    /**
     * body = **他做了什么** + **你现在能做什么**。
     * 不知道是谁的时候,唯一诚实的建议是「下次从客户雷达里选客户再生成」。
     */
    let body: string
    if (kind === 'tour_complete') {
      body = known
        ? '他从头看到了尾。现在联系他，他脑子里还全是这几套房。'
        : '有人从头看到了尾 —— 但这是公开链接，**我们不知道他是谁**。下次从「客户雷达」选一位客户再生成，行为就会挂到他名下。'
    } else if (kind === 'cta') {
      body = known
        ? '他主动点了联系你。如果你还没收到消息，主动打过去 —— 他刚才是想的。'
        : '有人点了联系你，接下来他可能会给你发消息。**我们不知道他是谁** —— 从「客户雷达」选客户再生成，就能对上号。'
    } else {
      body = known
        ? `${projectName ? `他挑中了「${projectName}」。` : ''}这就是他想要的类型。`
        : `${projectName ? `有人挑中了「${projectName}」。` : ''}**我们不知道他是谁**（公开链接）。`
    }

    /**
     * 前端渲染用的参数。**这才是真正的内容**,上面的 title/body 只是兜底。
     * who 只在 known 时有意义(匿名那一半的「有人」是前端按语言出的)。
     */
    const params = {
      known,
      who: known ? s.client_name : null,
      tour: s.title || null,
      project: projectName || null,
    }

    // 同一访客 + 同一场 tour + 同一类事件 = 一条。看三遍不刷三条。
    const dedupe = `${ctx.sessionId}:${ctx.visitorId}:${kind}${kind === 'favorite' && ctx.projectId ? ':' + ctx.projectId : ''}`

    await pool.query(
      `INSERT INTO lt_notifications (agent_id, kind, title, body, session_id, client_id, share_code, dedupe_key, params)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [s.agent_id, kind, title, body, ctx.sessionId, s.client_id, s.share_code, dedupe, JSON.stringify(params)]
    )

    /**
     * ⚠️ **这里故意不发邮件。**
     *
     * owner:「暂时还是不要发邮件,感觉有点骚扰了,现在还不太稳定。」
     * 要开的时候:import { sendAlertEmail } from '../services/notify',在这里发,
     * 并把 lt_notifications.emailed_at 写上(列还留着)。
     * **但先想清楚:一个联系不上的匿名访客,值不值得往经纪的收件箱里推一封信。**
     */
  } catch (err) {
    console.warn('[luna] notifyAgentOfIntent failed:', err instanceof Error ? err.message : err)
  }
}
