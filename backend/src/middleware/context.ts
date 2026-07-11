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
import { createHmac, timingSafeEqual, verify as cryptoVerify } from 'crypto'
import { getSigningKey } from '../lib/jwks'
import { User } from '@supabase/supabase-js'
import { isSupabaseConfigured } from '../lib/supabase'
import { isAdminEmail } from '../lib/adminEmails'

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
 * Verify a Supabase access token locally. Handles both signing schemes:
 *
 *   ES256/RS256 — the current Supabase key system. Verified against the public
 *     key from the project's JWKS (cached in memory by lib/jwks; no secret is
 *     stored anywhere). This is the path that actually runs here: this project
 *     issues ES256 tokens, which is why the old HS256-only fast path never once
 *     engaged in production and every logged-in request paid a 141-494ms remote
 *     auth.getUser() round-trip instead.
 *   HS256 — legacy shared-secret projects, kept for compatibility.
 *
 * Returns null on anything it can't verify (unknown kid, bad signature, expired,
 * parse error). The caller then defers to the remote check, so a null is only
 * ever slower, never wrong.
 */
export function verifyJwtLocal(token: string, secret?: string): JwtClaims | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, sig] = parts
    const header = JSON.parse(b64urlToBuf(h).toString('utf8'))
    const signed = Buffer.from(`${h}.${p}`)
    const actual = b64urlToBuf(sig)

    if (header.alg === 'ES256' || header.alg === 'RS256') {
      if (typeof header.kid !== 'string') return null
      const key = getSigningKey(header.kid)
      if (!key) return null // key not cached yet → defer to remote this once
      // A JWS ECDSA signature is raw r||s, not DER — hence dsaEncoding.
      const ok = header.alg === 'ES256'
        ? cryptoVerify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, actual)
        : cryptoVerify('sha256', signed, key, actual)
      if (!ok) return null
    } else if (header.alg === 'HS256') {
      if (!secret) return null
      const expected = createHmac('sha256', secret).update(signed).digest()
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    } else {
      return null
    }

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
  // Admin is gated strictly by the email allow-list (lib/adminEmails) — NOT by the
  // role metadata — so only the two whitelisted accounts get admin, regardless of
  // any stale `role: admin` left in a user's Supabase metadata.
  const admin = isAdminEmail(user.email)
  req.user = user
  req.isAdmin = admin
  req.ctx = {
    userId: user.id,
    email: user.email ?? null,
    role,
    visitorId: req.ctx?.visitorId ?? null,
    isAdmin: admin,
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

  // No config gate: ES256 tokens verify against the cached JWKS public key, so the
  // fast path needs no secret at all. SUPABASE_JWT_SECRET is only consulted for
  // legacy HS256 projects, and is optional.
  const claims = verifyJwtLocal(token, process.env.SUPABASE_JWT_SECRET)
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
  // No secret, or local verify didn't apply (non-HS256 / invalid) → let guards
  // decide whether a remote check is worth it for their endpoint.
  req._deferredToken = token
  next()
}
