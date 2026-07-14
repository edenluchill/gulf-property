import { counter, histogram } from '../telemetry'
/**
 * notify — minimal outbound alert email via Resend's HTTP API.
 *
 * No SMTP, no SDK: a single fetch to https://api.resend.com/emails. If
 * RESEND_API_KEY / ALERT_EMAIL are unset, sendAlertEmail is a graceful no-op
 * (logs a warning) so the perf monitor still works (Admin red banner) without
 * an email channel configured. NEVER throws — telemetry must not crash.
 *
 * Env:
 *   RESEND_API_KEY   — Resend API key (https://resend.com)
 *   ALERT_EMAIL      — recipient(s), comma-separated. Falls back to OWNER_EMAIL.
 *   ALERT_FROM       — verified sender. Default 'Pinzos Alerts <alerts@pinzos.com>'.
 */

const FROM = process.env.ALERT_FROM || 'Pinzos Alerts <alerts@pinzos.com>'

function recipients(): string[] {
  const raw = process.env.ALERT_EMAIL || process.env.OWNER_EMAIL || ''
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 技术/错误告警收件人 —— 默认技术方(Eden);env ALERT_EMAIL_TECH 逗号分隔可覆盖。 */
export function techAlertRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_TECH || 'lzp6529@gmail.com'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 订阅/商业通知收件人 —— shell + Eden(你也要看谁订阅了);env ALERT_EMAIL_OPS 逗号分隔可覆盖。 */
export function opsAlertRecipients(): string[] {
  const raw = process.env.ALERT_EMAIL_OPS || 'shelldubai26@gmail.com,lzp6529@gmail.com'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 未显式指定收件人时,按主题自动分流:
 *   • 订阅 / 商业通知(新订阅、付费成功、试用…)→ shell + Eden(shell 只收这类 business)
 *   • 其余(接口报错 / 性能告警 / 登录失败…)→ 只 Eden
 * 用户 2026-07-11:你「全收」(错误+订阅都收),shell「只收 business」。宁可漏判成只发你(收到总比漏好)。
 */
function autoRoute(subject: string): string[] {
  const isOps = /订阅|付费|试用|subscription|trial|payment|🎉/i.test(subject)
  return isOps ? opsAlertRecipients() : techAlertRecipients()
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && recipients().length > 0
}

/**
 * ⚠️ **这是元级的单点** —— **所有**告警都靠它送出去。
 * 它一挂,我们连「它挂了」都收不到通知(因为通知就是它发的)。
 * 所以必须埋点:`notify.email{result}` 会落进 metrics_minute,
 * Admin 上看得见,不依赖邮件本身。
 */
export async function sendAlertEmail(subject: string, text: string, html?: string, to?: string[]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  // 显式 to 优先;否则按主题分流(订阅→shell,错误/性能→Eden)。
  const recipientList = to && to.length ? to : autoRoute(subject)
  if (!key || recipientList.length === 0) {
    // 没配 = **所有告警都是哑的**。这不是"优雅降级",这是监控系统本身失效。
    counter('notify.email', { result: 'not_configured' }).inc()
    console.warn(`[notify] email not configured (RESEND_API_KEY/ALERT_EMAIL) — skipping: ${subject}`)
    return false
  }
  const t0 = Date.now()
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: recipientList,
        subject,
        text, // plain-text fallback for clients that don't render HTML
        ...(html ? { html } : {}),
      }),
    })
    histogram('notify.email.ms').observe(Date.now() - t0)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      counter('notify.email', { result: 'failed' }).inc()
      console.error(`[notify] resend failed ${res.status}: ${body.slice(0, 200)}`)
      return false
    }
    counter('notify.email', { result: 'ok' }).inc()
    return true
  } catch (err) {
    histogram('notify.email.ms').observe(Date.now() - t0)
    counter('notify.email', { result: 'failed' }).inc()
    console.error('[notify] resend request error:', err)
    return false
  }
}
