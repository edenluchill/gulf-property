/**
 * Luna Tour — 高意向事件 → 立刻通知经纪。
 *
 * 🔴 **这是产品的核心卖点,而它之前是假的。**
 *    行为数据一直在采(lt_engagement_events),但**没有任何人被告知** ——
 *    经纪只有主动去经纪台翻,才可能看见客户看完了。
 *
 * 最值钱的一刻是**客户刚看完的那一分钟**:他此刻正在想这件事。晚一天再打电话,
 * 热度就没了。所以高意向事件一发生:站内立案 + 给经纪发邮件。
 *
 * 什么算「高意向」——**只有这三件**。别的都不打扰他,否则通知会变成噪音,
 * 而噪音一旦形成,真正重要的那条也会被划走:
 *   • tour_complete —— 他从头看到尾了
 *   • cta_whatsapp / cta_call —— 他想联系你
 *   • feedback（❤️）—— 他挑中了某一套
 *
 * ISOLATION: 只写 lt_notifications,失败绝不冒泡(埋点不能拖垮客户的播放)。
 */
import pool from '../db/pool'
import { sendAlertEmail, isEmailConfigured } from '../services/notify'

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

/**
 * fire-and-forget —— 调用方不 await,也绝不会因为它失败而影响客户端。
 */
export async function notifyAgentOfIntent(ctx: Ctx): Promise<void> {
  if (!isHighIntent(ctx.eventType)) return
  try {
    const { rows } = await pool.query<{
      agent_id: string
      agent_email: string | null
      agent_name: string | null
      client_id: string | null
      client_name: string | null
      title: string
      share_code: string
    }>(
      `SELECT s.agent_id, a.email AS agent_email, a.display_name AS agent_name,
              s.client_id, c.name AS client_name, s.title, s.share_code
         FROM lt_demo_sessions s
         JOIN lt_agents a ON a.id = s.agent_id
         LEFT JOIN lt_clients c ON c.id = s.client_id
        WHERE s.id = $1`,
      [ctx.sessionId]
    )
    const s = rows[0]
    if (!s) return

    // demo 经纪不该收通知(公开 demo 每天都有人看)
    if ((s.agent_email || '').startsWith('demo-agent@')) return

    const kind = KIND[ctx.eventType] || ctx.eventType
    const who = s.client_name || '一位客户'

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
      kind === 'tour_complete' ? `${who}看完了你的导览`
      : kind === 'cta' ? `${who}想联系你`
      : `${who}收藏了${projectName ? `「${projectName}」` : '一套房'}`

    const body =
      kind === 'tour_complete' ? `《${s.title}》— 他从头看到了尾。现在打给他，他脑子里还全是这几套房。`
      : kind === 'cta' ? `《${s.title}》— 他主动点了联系。这是今天最热的一条线索。`
      : `《${s.title}》— ${projectName ? `他挑中了「${projectName}」。` : ''}这就是他想要的类型。`

    // 同一个访客 + 同一场 tour + 同一类事件 = 一条。看三遍不该变成三条通知。
    const dedupe = `${ctx.sessionId}:${ctx.visitorId}:${kind}${kind === 'favorite' && ctx.projectId ? ':' + ctx.projectId : ''}`

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO lt_notifications (agent_id, kind, title, body, session_id, client_id, share_code, dedupe_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [s.agent_id, kind, title, body, ctx.sessionId, s.client_id, s.share_code, dedupe]
    )
    // 已经通知过了 → 不重复发邮件
    if (!ins.rows[0]) return

    // 邮件 —— 只有「看完」和「想联系」值得打扰他。收藏留在站内。
    if ((kind === 'tour_complete' || kind === 'cta') && s.agent_email && isEmailConfigured()) {
      const url = `https://www.pinzos.com/agent/tour`
      const ok = await sendAlertEmail(
        `🔔 ${title}`,
        `${title}\n\n${body}\n\n去经纪台看他具体在哪几套房上停留最久：${url}`,
        `<p style="font-size:16px"><b>${title}</b></p><p>${body}</p>` +
          `<p><a href="${url}">去经纪台看他在哪几套房上停留最久 →</a></p>`,
        [s.agent_email]
      )
      if (ok) {
        await pool.query(`UPDATE lt_notifications SET emailed_at=now() WHERE id=$1`, [ins.rows[0].id])
      }
    }
  } catch (err) {
    // 绝不冒泡 —— 埋点失败不能影响客户播放 tour
    console.warn('[luna] notifyAgentOfIntent failed:', err instanceof Error ? err.message : err)
  }
}
