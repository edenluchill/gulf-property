import { Request, Response, NextFunction } from 'express'
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase'
import { User } from '@supabase/supabase-js'
import { extractBearerToken, applyUser } from './context'
// NB: the Express.Request augmentation (user/isAdmin/ctx) lives in ./context.

/**
 * Resolve the user via a REMOTE Supabase check — the fallback used only when
 * attachContext couldn't verify the token locally (no JWT secret, or a non-HS256
 * token). With SUPABASE_JWT_SECRET configured this is never hit for valid tokens,
 * so the common case stays network-free.
 */
async function resolveRemote(req: Request): Promise<User | null> {
  const token = req._deferredToken || extractBearerToken(req)
  if (!token) return null
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (error || !user) return null
    applyUser(req, user, 'remote')
    return user
  } catch {
    return null
  }
}

/**
 * Middleware that requires authentication
 * Returns 401 if not authenticated
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Skip auth check if Supabase is not configured (development mode)
  if (!isSupabaseConfigured) {
    console.warn('⚠️  Auth check skipped - Supabase not configured')
    return next()
  }

  // Fast path: attachContext already verified the token locally (no network).
  if (req.ctx?.userId) return next()

  // No locally-verified user and no deferred token → unauthenticated.
  if (!req._deferredToken && !extractBearerToken(req)) {
    return res.status(401).json({ success: false, error: 'Authentication required' })
  }

  // Fallback: remote-verify the deferred token (no JWT secret / non-HS256).
  const user = await resolveRemote(req)
  if (!user) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
  next()
}

/**
 * Middleware that requires admin role
 * Returns 401 if not authenticated, 403 if not admin
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // Skip auth check if Supabase is not configured (development mode)
  if (!isSupabaseConfigured) {
    console.warn('⚠️  Admin check skipped - Supabase not configured')
    return next()
  }

  // Resolve identity (local fast path, else remote fallback).
  if (!req.ctx?.userId) {
    if (!req._deferredToken && !extractBearerToken(req)) {
      return res.status(401).json({ success: false, error: 'Authentication required' })
    }
    const user = await resolveRemote(req)
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }
  }

  if (!req.ctx?.isAdmin) {
    return res.status(403).json({ success: false, error: 'Admin access required' })
  }
  next()
}

/**
 * Optional auth middleware - attaches user if token is valid, but doesn't require it
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  if (!isSupabaseConfigured) return next()

  // Already resolved locally by attachContext (the common case when a JWT secret
  // is configured) → zero network on this hot path (e.g. /api/events ingest).
  if (req.ctx?.userId) return next()

  // Only a deferred (locally-unverifiable) token warrants a remote lookup; a
  // missing token is just an anonymous request.
  if (!req._deferredToken) return next()
  await resolveRemote(req)  // best-effort; ignore failures
  next()
}
