/**
 * publicSearchLimit — per-IP throttle for the ANONYMOUS project autocomplete.
 *
 * Why this exists: `/api/luna/agent/projects/search` is the agent-side picker and
 * lives behind the agent namespace. The ROI simulator (/roi) must work for a
 * logged-out buyer, so it needs a public twin — and a public autocomplete over
 * the whole project table is exactly the endpoint a scraper walks a..zz through
 * to enumerate our catalogue.
 *
 * Same shape as [[map-metering-tiered-pricing]]: the brake is in the DATA layer
 * and returns a real 429. Blocking in the UI (debounce, min length) only slows
 * down honest browsers.
 *
 * Deliberately generous vs a human: typing "marina" behind a 280ms debounce is
 * ~6 requests. 40/min + 400/hour lets someone search continuously for an hour
 * and never see it, while capping a bot at ~400 result pages/hour instead of
 * tens of thousands.
 *
 * In-memory on purpose — single API instance (INITIAL_INSTANCES=1), and a
 * restart resetting the counters is not a security hole for a read-only,
 * already-public catalogue.
 */
import { Request, Response, NextFunction } from 'express'
import { clientIp } from './rateLimit'

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

const PER_MINUTE = Number(process.env.PUBLIC_SEARCH_PER_MIN) || 40
const PER_HOUR = Number(process.env.PUBLIC_SEARCH_PER_HOUR) || 400

type Bucket = { minuteStart: number; minuteHits: number; hourStart: number; hourHits: number }
const buckets = new Map<string, Bucket>()

// Bounded sweep: drop anything untouched for an hour. Without this the map is an
// unbounded leak keyed by attacker-controlled IPs.
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < HOUR_MS) return
  lastSweep = now
  for (const [k, b] of buckets) if (now - b.hourStart > HOUR_MS) buckets.delete(k)
}

export function publicSearchLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now()
  sweep(now)
  const key = clientIp(req)

  let b = buckets.get(key)
  if (!b) {
    b = { minuteStart: now, minuteHits: 0, hourStart: now, hourHits: 0 }
    buckets.set(key, b)
  }
  if (now - b.minuteStart >= MINUTE_MS) {
    b.minuteStart = now
    b.minuteHits = 0
  }
  if (now - b.hourStart >= HOUR_MS) {
    b.hourStart = now
    b.hourHits = 0
  }
  b.minuteHits++
  b.hourHits++

  if (b.minuteHits > PER_MINUTE || b.hourHits > PER_HOUR) {
    const retryAfter = b.minuteHits > PER_MINUTE
      ? Math.ceil((b.minuteStart + MINUTE_MS - now) / 1000)
      : Math.ceil((b.hourStart + HOUR_MS - now) / 1000)
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)))
    res.status(429).json({ error: 'search_rate_limited', retryAfter })
    return
  }
  next()
}
