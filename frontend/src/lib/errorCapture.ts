/**
 * Global API-error capture (FULLY DECOUPLED, fail-safe).
 *
 * Monkey-patches window.fetch once at app start so we see the failures real
 * users hit — network drops, server 5xx, timeouts/429 — instead of losing them
 * in scattered per-call try/catch blocks. Reports land in the owner dashboard's
 * 错误监控 tab via the same fire-and-forget telemetry pipeline (lib/track.ts).
 *
 * Scope (per the agreed capture level): ONLY our own API host, and ONLY:
 *   • network failures (fetch rejects — offline, DNS, CORS, connection reset)
 *   • 5xx server errors
 *   • 408 / 429 (timeout / rate-limited)
 * Expected 4xx (401/403/404/validation) are intentionally NOT reported — they're
 * normal app flow and would drown the signal.
 *
 * HARD RULE: this must NEVER change fetch's behaviour or throw into the app.
 * The original response/rejection is always passed through untouched. Reporting
 * is best-effort and self-throttled so a fully-down API can't spam the ingest.
 *
 * Delete this file + the installApiErrorCapture() call in App.tsx to remove it.
 */
import { API_BASE_URL } from './config'
import { trackError } from './track'

let installed = false

// Self-throttle: a down backend makes every request fail. Cap reports per
// signature within a window, and cap total reports per window, so we record
// "this is broken" without flooding. Counters reset on an interval.
const WINDOW_MS = 60_000
const MAX_PER_SIGNATURE = 3
const MAX_TOTAL = 30
let sigCounts = new Map<string, number>()
let totalCount = 0

function resetThrottle() {
  sigCounts = new Map()
  totalCount = 0
}

function shouldReport(signature: string): boolean {
  if (totalCount >= MAX_TOTAL) return false
  const n = sigCounts.get(signature) || 0
  if (n >= MAX_PER_SIGNATURE) return false
  sigCounts.set(signature, n + 1)
  totalCount += 1
  return true
}

/** Resolve the request URL from fetch's polymorphic first arg. */
function urlOf(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    if (input instanceof Request) return input.url
  } catch {
    /* fall through */
  }
  return ''
}

/** Path only (no query/hash) — the stable part for grouping. */
function endpointOf(url: string): string {
  try {
    return new URL(url, location.origin).pathname
  } catch {
    return url.split('?')[0]
  }
}

function isOurApi(url: string): boolean {
  if (!url) return false
  // Same-origin /api/* or anything under the configured API host.
  if (url.startsWith(API_BASE_URL)) return true
  try {
    const u = new URL(url, location.origin)
    return u.origin === location.origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

export function installApiErrorCapture(): void {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return
  installed = true
  setInterval(resetThrottle, WINDOW_MS)

  const original = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input)
    const method = (init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase()
    const mine = isOurApi(url)
    // Never let the telemetry POST itself loop back into capture.
    const isTelemetry = url.includes('/api/events')

    try {
      const res = await original(input as RequestInfo, init)
      if (mine && !isTelemetry && (res.status >= 500 || res.status === 408 || res.status === 429)) {
        const endpoint = endpointOf(url)
        const signature = `${method} ${endpoint} ${res.status}`
        if (shouldReport(signature)) {
          trackError('api_error', {
            kind: 'http',
            method,
            endpoint,
            url: url.slice(0, 300),
            status: res.status,
            message: res.statusText || `HTTP ${res.status}`,
          })
        }
      }
      return res
    } catch (err) {
      // Network-level failure (offline, DNS, reset, CORS). Report, then rethrow
      // so the caller's own error handling is completely unaffected.
      if (mine && !isTelemetry) {
        const endpoint = endpointOf(url)
        const signature = `${method} ${endpoint} network`
        if (shouldReport(signature)) {
          trackError('api_error', {
            kind: 'network',
            method,
            endpoint,
            url: url.slice(0, 300),
            message: err instanceof Error ? err.message.slice(0, 200) : 'network error',
          })
        }
      }
      throw err
    }
  }
}
