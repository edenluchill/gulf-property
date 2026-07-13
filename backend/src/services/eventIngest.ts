/**
 * Event ingest — pure-ish service for app_events.
 *
 * Keeps the route thin: validation, sanitisation and the batch INSERT live here
 * so they can be unit-tested and reused. NEVER throws into the request path —
 * telemetry must never disrupt the app (see docs/analytics-dashboard-spec.md §5).
 */
import { Request } from 'express'
import { createHash } from 'crypto'
import pool from '../db/pool'
import { processEventsForLeads } from './leadEngine'

export const ALLOWED_EVENTS = new Set([
  'search',
  'search_result_click',
  'property_view',
  'luna_open',
  'luna_close',
  'tutorial_step',
  'page_view',
  // Conversion / intent signals — the high-value actions the lead engine and
  // owner dashboard care about (a view tells us interest; these tell us intent).
  'favorite_toggle',   // saved/unsaved a project or unit type  (payload: action, item_type, unit_type_id?)
  'contact_attempt',   // tapped WhatsApp / phone / request-info (payload: contact_type, agent_id?)
  'resource_download', // opened a brochure / floor plan         (payload: resource_type)
  'report_action',     // generated / viewed / shared a report   (payload: action, success?)
  'share_action',      // shared a project (native / clipboard)  (payload: method, success?)
  'image_view',        // opened the gallery lightbox            (payload: image_count, index, view_type)
  'area_detail',       // opened/closed an area dialog           (payload: action, area_name)
  'tab_switch',        // switched a project-detail tab          (payload: tab_name, source)
  // Error telemetry (see ErrorMonitor in the owner dashboard). Same fail-safe
  // ingest path — these just carry diagnostic fields in `payload`.
  'auth_failure', // OAuth/login callback failed (provider error, race, storage blocked, …)
  'api_error',    // a fetch to our API failed: network down, 5xx, timeout/429
  'auth_signed_out', // session ended (payload: manual) — manual:false means the SDK killed it
  // token 刷新诊断 (2026-07-12)。auth_signed_out 只说"session 死了",说不出**怎么**死的。
  // 这两条补上那段:refresh 的真实 status/error_code(refresh_token_not_found? 被限流?
  // 网络断?),以及 logout 调用时用的 scope(确认线上真的是 local,没在踢别的设备)。
  'auth_token_refresh', // payload: ok, status, error_code, ms, visibility, online
  'auth_logout_call',   // payload: status, scope, ms
  // 商业化漏斗 (2026-07-11) — 在此之前我们对「定价页 → 付款」这一段是全盲的:
  // 只能拿 page_view 的 path 反推,「绑卡吓跑了多少人」在数据上根本无法回答。
  // checkout_start 与 checkout_success 的差值就是那个答案。
  'pricing_view',     // 打开定价页            (payload: variant, from)
  'plan_select',      // 点了某档的 CTA        (payload: plan_id, cycle, action)
  'trial_start',      // 开出免绑卡试用        (payload: plan_id, role)
  'checkout_start',   // 跳去 Stripe 前        (payload: plan_id, cycle, had_trial)
  'checkout_success', // 付款回跳成功          (payload: plan_id)
  'checkout_abandon', // 从 Stripe 取消回跳    (payload: plan_id)
  'paywall_hit',      // 撞到 402              (payload: code, feature, free_trial)
  'map_gate_hit',     // 撞到 429 地图门       (payload: requires_plan)
                     // (refresh-token reuse revocation, storage loss), the "why do I keep
                     // getting logged out" investigation signal
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IP_SALT = process.env.ANALYTICS_IP_SALT || process.env.LT_IP_SALT || 'app-events-static-salt'
const MAX_EVENTS_PER_BATCH = 50
const MAX_PAYLOAD_BYTES = 8000

export function hashIp(req: Request): string | null {
  const raw =
    (req.headers['cf-connecting-ip'] as string) ||
    ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
    req.ip ||
    ''
  if (!raw) return null
  return createHash('sha256').update(raw + IP_SALT).digest('hex').slice(0, 32)
}

export interface CleanEvent {
  event_type: string
  visitor_id: string
  session_id: string | null
  project_id: string | null
  payload: string // JSON string, '{}' when empty
  path: string | null
}

/** Validate + sanitise one raw client event. Returns null to drop it. */
function cleanEvent(raw: unknown): CleanEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>

  const eventType = String(b.event_type || '')
  if (!ALLOWED_EVENTS.has(eventType)) return null

  const visitorId = String(b.visitor_id || '').slice(0, 128)
  if (!visitorId) return null

  const sessionId = b.session_id ? String(b.session_id).slice(0, 128) : null
  const projectId = typeof b.project_id === 'string' && UUID_RE.test(b.project_id) ? b.project_id : null
  const path = b.path ? String(b.path).slice(0, 512) : null

  let payload = '{}'
  if (b.payload && typeof b.payload === 'object') {
    const s = JSON.stringify(b.payload)
    if (s.length <= MAX_PAYLOAD_BYTES) payload = s
  }

  // Dev-session noise gate: local dev (vite 5173/5174 → localhost:3000 API) also
  // ships error events into the PRODUCTION app_events — 2026-07-07 巡检时错误监控
  // 里 1/3 是自测错误,真客户问题被淹。localhost 出现在 url/stack 即弃(真实客户
  // 的 url 永远是 api.pinzos.com / www.pinzos.com 资产)。
  if (eventType === 'api_error' && /localhost|127\.0\.0\.1/.test(payload)) return null

  return { event_type: eventType, visitor_id: visitorId, session_id: sessionId, project_id: projectId, payload, path }
}

export interface IngestContext {
  userEmail?: string | null
  userId?: string | null
  ua?: string | null
  ipHash?: string | null
}

/**
 * Validate a raw events[] array and batch-insert the survivors.
 * Returns the number of rows written. Swallows nothing here — caller decides
 * whether to await; the route does so inside a try/catch after responding.
 */
export async function ingestEvents(rawEvents: unknown, ctx: IngestContext): Promise<number> {
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return 0

  const clean = rawEvents
    .slice(0, MAX_EVENTS_PER_BATCH)
    .map(cleanEvent)
    .filter((e): e is CleanEvent => e !== null)

  if (clean.length === 0) return 0

  // Single multi-row parameterised INSERT. created_at omitted → DB DEFAULT now().
  const COLS = 10
  const placeholders = clean
    .map((_, i) => {
      const b = i * COLS
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb,$${b + 8},$${b + 9},$${b + 10})`
    })
    .join(',')

  const flat: unknown[] = []
  for (const e of clean) {
    flat.push(
      e.event_type,
      e.visitor_id,
      ctx.userEmail ?? null,
      ctx.userId ?? null,
      e.session_id,
      e.project_id,
      e.payload,
      e.path,
      ctx.ua ?? null,
      ctx.ipHash ?? null
    )
  }

  await pool.query(
    `INSERT INTO app_events
       (event_type, visitor_id, user_email, user_id, session_id, project_id, payload, path, ua, ip_hash)
     VALUES ${placeholders}`,
    flat
  )

  // Behaviour → lead (strategy C5). Fire-and-forget: turning intent into a lead
  // must never block or break the ingest path. processEventsForLeads swallows its
  // own errors; the .catch is belt-and-suspenders.
  void processEventsForLeads(clean, ctx).catch((err) =>
    console.error('[leadEngine] trigger failed:', err)
  )

  return clean.length
}
