/**
 * Request context — one cheap, network-free pass that resolves WHO is making a
 * request, so every downstream guard/handler reads it instead of each making its
 * own round-trip to Supabase.
 *
 * The win: auth guards used to call `supabaseAdmin.auth.getUser(token)` on EVERY
 * protected request — a remote round-trip per call. Here we verify the Supabase
 * access token LOCALLY (HS256, zero deps, just Node crypto). No network. The
 * guards (auth.ts) then only fall back to the remote check when local verify
 * isn't possible (no JWT secret configured, or a non-HS256 token) — so it
 * degrades gracefully and never regresses: configure SUPABASE_JWT_SECRET and the
 * whole app's auth gets faster; leave it unset and behaviour is exactly as before.
 *
 * attachContext NEVER makes a network call — that's the rule that keeps anonymous
 * and public endpoints free of any auth latency.
 */
import { Request, Response, NextFunction } from 'express'
import { createHmac, timingSafeEqual } from 'crypto'
import { User } from '@supabase/supabase-js'
import { isSupabaseConfigured } from '../lib/supabase'

export interface ReqContext {
  userId: string | null
  email: string | null
  role: string | null        // app-level role (admin/…), from user/app_metadata
  visitorId: string | null   // anonymous browser id (X-Visitor-Id header)
  isAdmin: boolean
  auth: 'local' | 'remote' | 'anon'
}

declare global {
  namespace Express {
    interface Request {
      user?: User
      isAdmin?: boolean
      ctx?: ReqContext
      _deferredToken?: string  // a bearer token we couldn't verify locally → guards may remote-verify
    }
  }
}

export function extractBearerToken(req: Request): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.substring(7)
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

interface JwtClaims {
  sub?: string
  email?: string
  exp?: number
  app_metadata?: Record<string, any>
  user_metadata?: Record<string, any>
  [k: string]: any
}

/**
 * Verify a Supabase access token locally (HS256 only). Returns the claims if the
 * signature is valid and the token isn't expired, else null. Returning null for
 * anything non-HS256 (e.g. asymmetric ES256/RS256 projects) or any parse error
 * is intentional: the caller defers to the remote check, so we're never wrong,
 * only sometimes slower.
 */
export function verifyJwtLocal(token: string, secret: string): JwtClaims | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, sig] = parts
    const header = JSON.parse(b64urlToBuf(h).toString('utf8'))
    if (header.alg !== 'HS256') return null  // only the symmetric fast-path; others defer
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest()
    const actual = b64urlToBuf(sig)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    const claims = JSON.parse(b64urlToBuf(p).toString('utf8')) as JwtClaims
    if (typeof claims.exp === 'number' && Date.now() / 1000 >= claims.exp) return null  // expired
    return claims
  } catch {
    return null
  }
}

function adminRoleOf(meta: { user_metadata?: any; app_metadata?: any }): string | null {
  return meta.user_metadata?.role || meta.app_metadata?.role || null
}

/** Fill req.ctx + req.user + req.isAdmin from a fully-resolved Supabase user. */
export function applyUser(req: Request, user: User, auth: 'local' | 'remote'): void {
  const role = adminRoleOf(user)
  req.user = user
  req.isAdmin = role === 'admin'
  req.ctx = {
    userId: user.id,
    email: user.email ?? null,
    role,
    visitorId: req.ctx?.visitorId ?? null,
    isAdmin: role === 'admin',
    auth,
  }
}

/**
 * Global, network-free identity pass. Resolves the visitor id from the header and
 * — when a JWT secret is configured — the logged-in user from a local signature
 * check. Anything it can't resolve locally is stashed on req._deferredToken for a
 * guard to resolve remotely only if that endpoint actually needs auth.
 */
export function attachContext(req: Request, _res: Response, next: NextFunction): void {
  const visitorId = (typeof req.headers['x-visitor-id'] === 'string'
    ? (req.headers['x-visitor-id'] as string) : '').slice(0, 128) || null
  req.ctx = { userId: null, email: null, role: null, visitorId, isAdmin: false, auth: 'anon' }

  const token = extractBearerToken(req)
  if (!token || !isSupabaseConfigured) return next()

  const secret = process.env.SUPABASE_JWT_SECRET
  if (secret) {
    const claims = verifyJwtLocal(token, secret)
    if (claims?.sub) {
      const minimalUser = {
        id: claims.sub,
        email: claims.email,
        app_metadata: claims.app_metadata || {},
        user_metadata: claims.user_metadata || {},
      } as unknown as User
      applyUser(req, minimalUser, 'local')
      req.ctx!.visitorId = visitorId
      return next()
    }
  }
  // No secret, or local verify didn't apply (non-HS256 / invalid) → let guards
  // decide whether a remote check is worth it for their endpoint.
  req._deferredToken = token
  next()
}
