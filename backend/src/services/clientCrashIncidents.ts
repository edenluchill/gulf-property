/**
 * 客户端渲染崩溃 → `perf_alerts` 事故(kind = `CLIENT_CRASH`)。
 *
 * WHY(2026-08-10 巡检发现的洞):
 * 服务端 5xx 有一整套事故机制 —— 立案、发邮件、永不自动恢复、必须人工写根因才能关。
 * **但客户浏览器里整页崩掉的那种,一条告警都不会响。** 它只静静躺在
 * `app_events` 里(`payload.kind = 'render_crash'`),除非有人手动去翻表。
 *
 * 实际代价:`1758494342@qq.com` 在 07-22 / 07-27 / 07-30 / 08-03 崩了 **4 次**,
 * 跨三周三个版本,没有任何人知道 —— 直到 08-10 手工翻表才发现。
 * 同期还有 `l13541347198@gmail.com`(/agent/plans)和 `huayingzeng8866@gmail.com`(首页)。
 * 这三位都是真实客户,页面在他们眼前变成了一张「出错了」的卡片。
 *
 * 语义**完全对齐 API_5XX**(见 [[alerts-are-incidents-not-state]]):
 *   • 一个 (页面, 报错) 一条事故,重复命中累加进去,不刷屏
 *   • **永不自动恢复** —— 只有人在 dashboard 上写清根因才能关
 *   • 受害者名单进 detail,方便回访
 *
 * 去重键用 `path|message 前 80 字`:同一个病在不同页面值得分开看
 * (翻译插件那种到处崩的,和某个页面自己算错的,不是一回事)。
 */
import pool from '../db/pool'
import { sendAlertEmail } from '../services/notify'

const APP_URL = process.env.APP_URL || 'https://www.pinzos.com'

export interface CrashEvent {
  payload: string           // 原始 JSON 串(cleanEvent 已限长)
  path: string | null
  who: string | null        // email 或 visitor_id
  ua: string | null
}

/** 从一批已清洗的事件里挑出渲染崩溃。非崩溃的一律不碰。 */
export function pickCrashes(
  events: { event_type: string; payload: string; path: string | null; visitor_id: string }[],
  ctx: { userEmail?: string | null; ua?: string | null }
): CrashEvent[] {
  const out: CrashEvent[] = []
  for (const e of events) {
    if (e.event_type !== 'api_error') continue
    let kind: unknown
    try { kind = (JSON.parse(e.payload) as Record<string, unknown>).kind } catch { continue }
    if (kind !== 'render_crash') continue
    out.push({
      payload: e.payload,
      path: e.path,
      who: ctx.userEmail || e.visitor_id || null,
      ua: ctx.ua ?? null,
    })
  }
  return out
}

/**
 * 立案 / 累加。整体 try/catch —— 告警系统自己挂了绝不能把埋点上报带崩
 * (埋点路径上任何抛错都会变成客户那边的一条失败请求)。
 */
export async function fileCrashIncidents(crashes: CrashEvent[]): Promise<void> {
  for (const c of crashes) {
    try {
      let message = 'unknown'
      let stack = ''
      try {
        const p = JSON.parse(c.payload) as Record<string, unknown>
        message = String(p.message ?? 'unknown').slice(0, 200)
        stack = String(p.stack ?? '').slice(0, 500)
      } catch { /* 解析不了就用默认值,照样立案 */ }

      const page = c.path || '(未知页面)'
      const signature = `${page}|${message.slice(0, 80)}`
      const human = `页面 ${page} 在客户浏览器里崩了:${message}`

      const upd = await pool.query(
        `UPDATE perf_alerts
            SET detail = jsonb_set(
                  jsonb_set(
                    jsonb_set(coalesce(detail,'{}'::jsonb), '{count}',
                              to_jsonb(coalesce((detail->>'count')::int, 0) + 1)),
                    '{lastAt}', to_jsonb(now()::text)),
                  '{victims}',
                  CASE
                    WHEN $2::text IS NULL THEN coalesce(detail->'victims','[]'::jsonb)
                    WHEN coalesce(detail->'victims','[]'::jsonb) @> to_jsonb($2::text)
                      THEN detail->'victims'
                    WHEN jsonb_array_length(coalesce(detail->'victims','[]'::jsonb)) >= 10
                      THEN detail->'victims'
                    ELSE coalesce(detail->'victims','[]'::jsonb) || to_jsonb($2::text)
                  END)
          WHERE kind = 'CLIENT_CRASH' AND signature = $1 AND resolved_at IS NULL
          RETURNING id`,
        [signature, c.who]
      )
      if ((upd.rowCount ?? 0) > 0) continue

      const ins = await pool.query<{ id: number }>(
        `INSERT INTO perf_alerts (kind, severity, metric, threshold, window_s, message, signature, detail)
         VALUES ('CLIENT_CRASH','error',1,0,60,$1,$2,$3) RETURNING id`,
        [
          human,
          signature,
          JSON.stringify({
            page, error: message, stack, count: 1,
            firstAt: new Date().toISOString(), lastAt: new Date().toISOString(),
            ua: c.ua, victims: c.who ? [c.who] : [],
          }),
        ]
      )

      const ok = await sendAlertEmail(
        `🚨 Pinzos 客户页面崩了: ${page}`,
        `${human}\n\n受影响: ${c.who || '匿名'}\n浏览器: ${c.ua || '未知'}\n\n` +
          `这条不会自动恢复——查清根因、修好之后到 dashboard 手动关闭。\n` +
          `${APP_URL}/admin/analytics\n\n— 错误监控自动发出`
      )
      if (ok) await pool.query(`UPDATE perf_alerts SET emailed = true WHERE id = $1`, [ins.rows[0].id])
    } catch (e) {
      console.error('[clientCrash] 立案失败:', e)
    }
  }
}
