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

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && recipients().length > 0
}

export async function sendAlertEmail(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const to = recipients()
  if (!key || to.length === 0) {
    console.warn(`[notify] email not configured (RESEND_API_KEY/ALERT_EMAIL) — skipping: ${subject}`)
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to,
        subject,
        text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[notify] resend failed ${res.status}: ${body.slice(0, 200)}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[notify] resend request error:', err)
    return false
  }
}
