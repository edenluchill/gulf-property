/**
 * apiRateLimiter — abuse/DoS backstop, NOT precision anti-scraping.
 *
 * Goal (per product constraint "must not degrade UX"): never hit a real user —
 * even a busy office or mobile carrier sharing one public IP — while capping the
 * blast radius of a runaway bot / scraper / DoS (load testing melted the box at
 * ~6000 req/min; this caps a single IP well below that).
 *
 * Deliberate choices:
 *  - Generous default 2000 req / 60s per IP. Tune DOWN later with the per-endpoint
 *    dashboard data, not up-front. Env: RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX.
 *    (We intentionally do NOT read the legacy API_RATE_LIMIT_* vars — the server
 *     compose defaults them to 100/15min, which would block real users instantly.)
 *  - Key on the REAL client IP behind Cloudflare+nginx (CF-Connecting-IP →
 *    X-Forwarded-For → req.ip), so all traffic isn't bucketed under one CF IP.
 *  - Skip health, the Stripe webhook, and realtime/streaming paths (SSE progress,
 *    collab, voice) where sustained requests are normal and legitimate.
 */
import rateLimit from 'express-rate-limit'
import { Request } from 'express'

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000
const MAX = Number(process.env.RATE_LIMIT_MAX) || 2000

/** Real client IP behind Cloudflare (orange-cloud) + nginx. */
function clientIp(req: Request): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
    req.ip ||
    'unknown'
  )
}

// Paths where sustained request rates are normal — exempt so the backstop can
// never interrupt a live tour, voice session, upload progress, or Stripe webhook.
const SKIP_PREFIXES = [
  '/health',
  '/api/billing/webhook',
  '/api/langgraph-progress',
  '/api/tasks',          // upload SSE progress polling
  '/api/collab',         // realtime co-presence tour
  '/api/voice',          // ephemeral token + tool calls during a live session
  '/api/voice-rtc',
]

export const apiRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX,
  standardHeaders: true,
  legacyHeaders: false,
  // We extract the client IP ourselves (CF-Connecting-IP); disable the library's
  // proxy/XFF validation so it can't throw at startup and take the API down.
  validate: false,
  keyGenerator: clientIp,
  // Only limit /api traffic; exempt realtime/webhook paths. Mounted globally so
  // req.path is the full original path (no mount-prefix stripping).
  skip: (req) => !req.path.startsWith('/api') || SKIP_PREFIXES.some((p) => req.path.startsWith(p)),
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many requests — please slow down a moment.' }),
})
