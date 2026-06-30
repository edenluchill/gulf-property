import { Request, Response, NextFunction } from 'express'
import { createHash, timingSafeEqual } from 'crypto'
import { isSupabaseConfigured } from '../lib/supabase'
import { isAdminEmail } from '../lib/adminEmails'

/**
 * Owner-only access gate for the analytics dashboard. FAILS CLOSED.
 *
 * The dashboard exposes PII (lead phone numbers, full Luna transcripts), so this
 * must never silently open. Two independent ways in — either is sufficient:
 *
 *  1. Verified owner email — only trustworthy when Supabase actually verified the
 *     bearer token server-side (isSupabaseConfigured). The API server currently
 *     has no Supabase creds, so this path is inert until SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY are set on it.
 *  2. Shared dashboard secret — set DASHBOARD_SECRET on the server; the dashboard
 *     sends it as the `x-dashboard-key` header. Works with no Supabase. Compared
 *     in constant time.
 *
 * Chain with optionalAuth (NOT requireAuth) so the secret path works even when no
 * Supabase token is present. A genuine-local-dev bypass is allowed ONLY when not
 * in production AND neither gate is configured.
 */
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'lzp6529@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || ''
const IS_PROD = process.env.NODE_ENV === 'production'

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false
  return OWNER_EMAILS.includes(email.toLowerCase())
}

function secretMatches(req: Request): boolean {
  if (!DASHBOARD_SECRET) return false
  const got = req.headers['x-dashboard-key']
  if (typeof got !== 'string' || !got) return false
  // Hash both sides to a fixed length so timingSafeEqual never throws on length.
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(DASHBOARD_SECRET).digest()
  return timingSafeEqual(a, b)
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  // 1. Verified Supabase owner OR admin email. The analytics dashboard ("数据管理")
  //    is shared by all admins; owner perks (billing/credits) stay narrow and are
  //    handled by OWNER_EMAILS elsewhere — admin access here grants neither.
  if (isSupabaseConfigured && (isOwnerEmail(req.user?.email) || isAdminEmail(req.user?.email))) return next()
  // 2. Shared dashboard secret.
  if (secretMatches(req)) return next()
  // 3. Local-dev convenience ONLY — never in prod, never once a gate is configured.
  if (!IS_PROD && !isSupabaseConfigured && !DASHBOARD_SECRET) {
    console.warn('⚠️  requireOwner bypassed — local dev with no auth configured')
    return next()
  }
  return res.status(403).json({ success: false, error: 'forbidden' })
}
