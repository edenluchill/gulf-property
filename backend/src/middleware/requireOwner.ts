import { Request, Response, NextFunction } from 'express'
import { isSupabaseConfigured } from '../lib/supabase'

/**
 * Owner-only access gate for the analytics dashboard.
 *
 * Chain AFTER `requireAuth` so `req.user` is already populated:
 *   router.get('/...', requireAuth, requireOwner, handler)
 *
 * The allow-list lives in OWNER_EMAILS (comma-separated). Default to the single
 * project owner so the gate is safe even if the env var is missing in prod.
 * Security is enforced here on the server — the frontend only hides the entry.
 */
const OWNER_EMAILS = (process.env.OWNER_EMAILS || 'lzp6529@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export function isOwnerEmail(email?: string | null): boolean {
  if (!email) return false
  return OWNER_EMAILS.includes(email.toLowerCase())
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  // Dev mode (no Supabase): mirror requireAuth's permissive behaviour so local
  // work isn't blocked. Production always has Supabase configured.
  if (!isSupabaseConfigured) {
    console.warn('⚠️  Owner check skipped - Supabase not configured')
    return next()
  }

  if (!isOwnerEmail(req.user?.email)) {
    return res.status(403).json({ success: false, error: 'forbidden' })
  }
  next()
}
