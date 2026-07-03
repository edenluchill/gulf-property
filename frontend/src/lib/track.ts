/**
 * App-wide behaviour tracking (FULLY DECOUPLED, fail-safe).
 *
 * Elegant collection (see docs/analytics-dashboard-spec.md §5.1): trackEvent()
 * only pushes into an in-memory queue — NO network call per action. The queue
 * flushes in batch when any of these happen:
 *   1. queue reaches MAX_BATCH events
 *   2. FLUSH_INTERVAL_MS elapsed since last flush
 *   3. the page is being hidden/unloaded (sendBeacon, so nothing is lost)
 *
 * High-value conversions (lead capture, hot lead) can force an immediate flush
 * via trackEvent(type, payload, { immediate: true }) — those can't wait for the
 * batch window because the visitor may leave right after.
 *
 * HARD RULE: this must NEVER throw into the app. Every call is best-effort.
 * Delete this file + the instrumentation call sites + backend routes/events.ts
 * to remove the feature entirely.
 */
import { supabase } from './supabase'
import { API_BASE_URL } from './config'

export type AppEvent =
  | 'search'
  | 'search_result_click'
  | 'property_view'
  | 'luna_open'
  | 'luna_close'
  | 'tutorial_step'
  | 'page_view'
  // Conversion / intent signals — interest is a view; intent is these. Kept in
  // sync with the backend whitelist (backend/src/services/eventIngest.ts).
  | 'favorite_toggle'
  | 'contact_attempt'
  | 'resource_download'
  | 'report_action'
  | 'share_action'
  | 'image_view'
  | 'area_detail'
  | 'tab_switch'
  // Error telemetry — surfaced in the owner dashboard's 错误监控 tab so we can
  // see failures real users hit (esp. mobile login) instead of losing them silently.
  | 'auth_failure'
  | 'api_error'

// '/api/sync' (not '/api/events') — "events" is on ad-block keyword lists, which
// silently eats real users' telemetry. The backend double-mounts both paths.
const ENDPOINT = `${API_BASE_URL}/api/sync`
const VISITOR_KEY = 'app-visitor-id'
const SESSION_KEY = 'app-session-id'
const MAX_BATCH = 10
const FLUSH_INTERVAL_MS = 10_000

interface QueuedEvent {
  event_type: AppEvent
  visitor_id: string
  session_id: string
  project_id?: string
  path?: string
  payload?: Record<string, unknown>
}

let queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = makeId('v')
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return makeId('v_anon')
  }
}

/** A session = one browser tab/page-load lifetime (sessionStorage). */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY)
    if (!id) {
      id = makeId('s')
      sessionStorage.setItem(SESSION_KEY, id)
    }
    return id
  } catch {
    return makeId('s_anon')
  }
}

/** Pull the access token synchronously-ish from the cached supabase session. */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
}

/**
 * Send everything currently queued. `useBeacon` is for page-hide, where async
 * fetch may be killed — sendBeacon is synchronous-dispatch and survives unload
 * (but can't attach an auth header, so logged-in attribution falls back to the
 * normal fetch path during the session).
 */
async function flush(useBeacon = false): Promise<void> {
  if (queue.length === 0) return
  const batch = queue
  queue = []
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const body = JSON.stringify({ events: batch })
  try {
    if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(ENDPOINT, blob)) return
    }
    const headers = { 'Content-Type': 'application/json', ...(await authHeader()) }
    await fetch(ENDPOINT, { method: 'POST', headers, body, keepalive: true })
  } catch {
    // Swallow — never disrupt the app. Dropped batch is acceptable for analytics.
  }
}

/**
 * Queue an event. Returns immediately. Pass { immediate: true } to flush now
 * (use only for high-value conversions that can't wait for the batch window).
 */
export function trackEvent(
  type: AppEvent,
  payload?: Record<string, unknown>,
  opts?: { project_id?: string; immediate?: boolean }
): void {
  try {
    queue.push({
      event_type: type,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      project_id: opts?.project_id,
      path: typeof location !== 'undefined' ? location.pathname : undefined,
      payload,
    })
    if (opts?.immediate || queue.length >= MAX_BATCH) {
      void flush()
    } else {
      scheduleFlush()
    }
  } catch {
    // Never let tracking throw into the UI.
  }
}

/**
 * Report an error (auth_failure | api_error). Flushes immediately because the
 * user is often about to leave (a broken login/page), and a lost error report
 * is exactly the data we can't afford to drop. Best-effort; never throws.
 */
export function trackError(
  type: 'auth_failure' | 'api_error',
  payload: Record<string, unknown>
): void {
  trackEvent(type, payload, { immediate: true })
}

/** Convenience for the current visitor id (e.g. to tie a lead to prior events). */
export function visitorId(): string {
  return getVisitorId()
}

/**
 * Link this browser's visitor_id to the logged-in account and backfill prior
 * events with the email server-side. Call right after auth resolves with a user
 * (most batched events flush via sendBeacon, which can't carry the token, so
 * without this explicit authenticated ping the email is rarely captured).
 * Best-effort; never throws.
 */
export async function identifyVisitor(): Promise<void> {
  try {
    const auth = await authHeader()
    if (!auth.Authorization) return // not logged in
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...auth }
    await fetch(`${ENDPOINT}/identify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ visitor_id: getVisitorId() }),
      keepalive: true,
    })
  } catch {
    /* swallow — telemetry must never disrupt the app */
  }
}

/**
 * Stamp every request to OUR API with the anonymous visitor id, so the backend
 * can attribute successful business calls to a customer (server-side api_calls)
 * — not just the handful of interactions we explicitly trackEvent(). One global
 * fetch wrapper covers all call sites (current and future) with no per-call
 * change. Scoped to API_BASE_URL only; other origins are untouched. Idempotent.
 */
/** 分享路由(/t /v /r /cr /factsheet)的 code —— 带给后端换取地图计量豁免(服务端验真)。 */
function shareCodeFromPath(): string | null {
  const m = window.location.pathname.match(/^\/(?:t|v|r|cr|factsheet)\/([\w-]{1,64})/)
  return m ? m[1] : null
}

/** 地图配额 429 → 全局事件,MapPage 的 overlay 监听它。 */
export const MAP_QUOTA_EVENT = 'pinzos:map-quota-exhausted'

function installApiAttribution(): void {
  const w = window as unknown as { __apiAttrInstalled?: boolean; fetch: typeof fetch }
  if (w.__apiAttrInstalled || typeof w.fetch !== 'function') return
  w.__apiAttrInstalled = true
  const orig = w.fetch.bind(window)
  w.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string' ? input
        : input instanceof URL ? input.href
        : (input as Request).url
      if (url && url.startsWith(API_BASE_URL)) {
        const headers = new Headers(
          init?.headers || (input instanceof Request ? input.headers : undefined)
        )
        if (!headers.has('X-Visitor-Id')) headers.set('X-Visitor-Id', getVisitorId())
        const shareCode = shareCodeFromPath()
        if (shareCode && !headers.has('X-Share-Code')) headers.set('X-Share-Code', shareCode)
        const req = input instanceof Request && !init
          ? orig(new Request(input, { headers }))
          : orig(input as RequestInfo, { ...init, headers })
        return req.then((res) => {
          if (res.status === 429) {
            // 匿名地图额度用尽:后端返回 code=map_quota_exhausted → 广播给 overlay。
            res.clone().json().then((j) => {
              if (j?.code === 'map_quota_exhausted') window.dispatchEvent(new CustomEvent(MAP_QUOTA_EVENT))
            }).catch(() => {})
          }
          return res
        })
      }
    } catch { /* fall through to the untouched original */ }
    return orig(input as RequestInfo, init)
  }
}

let installed = false
/** Wire page-hide flushing + API attribution once, at app start. Idempotent. */
export function installTracking(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  installApiAttribution()
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush(true)
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', () => void flush(true))
}
