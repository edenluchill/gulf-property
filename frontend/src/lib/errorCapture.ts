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
 *   • 401 —— 但仅当本地存着 session 时(kind:'stale_token')。匿名请求的 401 是正常
 *     业务流,照报会淹掉信号;而"本地有 session、服务器却说不认"是 token 已经死了,
 *     正是 [[session-logout-investigation]] 一直缺的那半条证据链。
 * 其余预期内的 4xx(403/404/校验错)不报。
 *
 * HARD RULE: this must NEVER change fetch's behaviour or throw into the app.
 * The original response/rejection is always passed through untouched. Reporting
 * is best-effort and self-throttled so a fully-down API can't spam the ingest.
 *
 * Delete this file + the installApiErrorCapture() call in App.tsx to remove it.
 */
import { API_BASE_URL } from './config'
import { trackError } from './track'
import { AUTH_STORAGE_KEY } from './supabase'

let installed = false

/**
 * 我们**自以为**登录着吗?——直接问本地存储,而不是去看请求头。
 *
 * 因为 window.fetch 被包了两层:track.ts 的 attribution 先装(内层,负责注入
 * Authorization),errorCapture 后装(外层)。外层拿到的是调用方的原始 init,
 * 那时候 Authorization 还没被注入 —— 照着请求头判断会漏掉一大半请求。
 */
function believesLoggedIn(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    return !!raw && raw.includes('access_token')
  } catch {
    return false
  }
}

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
    // Never let the telemetry POST itself loop back into capture (both the legacy
    // /api/events path and the ad-blocker-safe /api/sync alias).
    const isTelemetry = url.includes('/api/events') || url.includes('/api/sync')

    try {
      const res = await original(input as RequestInfo, init)

      // 401 但**我们带了 Authorization 头** = 我们以为自己登录着,服务器说不认。
      // 这正是 token 死掉(刷新失败/被吊销)之后前端还在拿死 token 打接口的样子 ——
      // 原先 401 一律不报,所以这场"风暴"在错误监控里完全隐形,和 auth_signed_out
      // 也串不起来。匿名请求的 401 仍然不报(那是正常业务流)。
      if (mine && !isTelemetry && res.status === 401 && believesLoggedIn()) {
        const endpoint = endpointOf(url)
        if (shouldReport(`${method} ${endpoint} 401-authed`)) {
          trackError('api_error', {
            kind: 'stale_token',
            method,
            endpoint,
            status: 401,
            message: 'sent a bearer token, server rejected it',
          })
        }
      }

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
      // 例外:map_quota_exhausted 是 track.ts 把配额 429 抛成的异常——是计量门
      // 正常工作,不是故障。记成 api_error 会让错误监控常年有红,真问题被淹
      // (429 撞墙本身服务端 mapMeter 有账,UI 由 MapMeterGuard/GlobalQuotaGate 接)。
      if (err instanceof Error && err.message === 'map_quota_exhausted') throw err
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
