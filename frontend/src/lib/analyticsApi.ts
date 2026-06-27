/**
 * Owner dashboard API client. All calls are authenticated (Supabase bearer
 * token) and hit /api/admin/analytics/* — the server enforces the owner
 * allow-list, so a non-owner gets 403 even if they reach these.
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

const BASE = `${API_BASE_URL}/api/admin/analytics`

/** Thrown when the server rejects access (401/403). Access is owner-email gated
 *  server-side (requireOwner + verified Supabase token) — no secret key. */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}

async function authedGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { headers })
  if (res.status === 403 || res.status === 401) throw new ForbiddenError()
  if (!res.ok) throw new Error(`${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'request failed')
  return json.data as T
}

export interface Overview {
  events: number
  visitors: number
  searches: number
  property_views: number
  luna_opens: number
  luna_sessions: number
  leads_total: number
  leads_new: number
}
export interface DailyPoint { day: string; visitors: number; events: number }
export interface Counted { label: string; count: number; id?: string }
export interface RecentSearch { created_at: string; query: string | null; kind: string | null; visitor_id: string | null }
export type Granularity = 'day' | 'week' | 'month'
export interface Timeseries { event: string; granularity: Granularity; points: { bucket: string; count: number }[] }
export interface LunaStats {
  sessions: number
  avg_duration_ms: number
  avg_turns: number
  total_tool_calls: number
  error_sessions: number
}
export interface FunnelStep { step: string; visitors: number }
export interface Lead {
  id: number
  created_at: string
  visitor_id: string | null
  name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  source: string | null
  intent: Record<string, unknown>
  lead_score: number
  status: string
  last_seen_at: string | null
}
export interface SessionRow {
  id: number
  session_id: string
  created_at: string
  visitor_id: string | null
  user_email: string | null
  duration_ms: number | null
  turn_count: number | null
  tool_call_count: number | null
  had_error: boolean
}
export interface SessionTranscriptMessage { role: 'user' | 'assistant'; content: string; timestamp: number }
export interface SessionDetail extends SessionRow {
  transcript: {
    messages?: SessionTranscriptMessage[]
    toolCalls?: Array<{ name: string; params: unknown; duration?: number; error?: string }>
    metrics?: Record<string, unknown>
  }
}

export type Stage = 'hot' | 'warm' | 'cooling' | 'cold'
export interface VisitorRow {
  identity: string          // email when logged in, else visitor_id — drill-down key
  visitor_id: string        // representative (most-recent) browser id
  user_email: string | null
  browser_count: number     // how many browsers/devices merged into this row
  first_seen: string
  last_seen: string
  events: number
  views: number
  searches: number
  luna_opens: number
  distinct_projects: number
  score: number
  stage: Stage
}
export interface VisitorDetail {
  visitor_id: string
  user_email: string | null
  first_seen: string
  last_seen: string
  counts: { events: number; views: number; searches: number; luna: number }
  contact: { name: string | null; email: string | null; phone: string | null; whatsapp: string | null; source: string | null; lead_score: number; status: string } | null
  score: number
  stage: Stage
  prediction: {
    budget: { min: number; max: number; median: number } | null
    topAreas: { name: string; count: number }[]
    viewedProjects: { id: string; name: string; area: string | null; minPrice: number | null; maxPrice: number | null; count: number }[]
    searchTerms: string[]
    usedLuna: boolean
    hasContact: boolean
  }
  lunaSessions: { session_id: string; created_at: string; duration_ms: number | null; turn_count: number | null; tool_call_count: number | null; had_error: boolean }[]
  timeline: { at: string; type: string; projectId: string | null; projectName: string | null; area: string | null; query: string | null; kind: string | null; path: string | null }[]
}

export const fetchVisitors = (days: number) => authedGet<VisitorRow[]>(`/visitors?days=${days}`)
export const fetchVisitor = (id: string) =>
  authedGet<{ visitor: VisitorDetail | null }>(`/visitors/${encodeURIComponent(id)}`)

export const fetchOverview = (days: number) =>
  authedGet<{ overview: Overview; daily: DailyPoint[] }>(`/overview?days=${days}`)
export const fetchSearches = (days: number) =>
  authedGet<{ terms: Counted[]; projects: Counted[]; recent: RecentSearch[] }>(`/searches?days=${days}`)
export const fetchTimeseries = (event: string, granularity: Granularity, days: number) =>
  authedGet<Timeseries>(`/timeseries?event=${event}&granularity=${granularity}&days=${days}`)
export const fetchLuna = (days: number) => authedGet<LunaStats>(`/luna?days=${days}`)
export const fetchTutorial = (days: number) => authedGet<FunnelStep[]>(`/tutorial?days=${days}`)
export const fetchLeads = () => authedGet<Lead[]>(`/leads`)
export const fetchSessions = () => authedGet<SessionRow[]>(`/sessions`)
export const fetchSession = (sessionId: string) =>
  authedGet<{ session: SessionDetail | null }>(`/sessions/${encodeURIComponent(sessionId)}`)

// ── 实时带看(collab)意向报告 ───────────────────────────
export interface CollabSessionRow {
  code: string
  name: string | null
  created_at: string
  first_event_at: string | null
  last_event_at: string | null
  peak_participants: number
  chat_count: number
  event_count: number
}
export interface CollabChatMsg { from: string; name: string; text: string; at: number | null }
export interface CollabParticipant { name: string; role: string; joinedAt: number | null; leftAt: number | null }
export interface CollabAi {
  summary: string
  interest_level: '高' | '中' | '低' | '未知'
  signals: string[]
  follow_up: string
}
export interface CollabReport {
  code: string
  name: string | null
  created_at: string
  duration_ms: number | null
  peak_participants: number
  participants: CollabParticipant[]
  areas_visited: string[]
  projects: { id: string; name: string | null; area: string | null }[]
  luna_actions: { type: string; count: number }[]
  chat: CollabChatMsg[]
  truncated: boolean
  ai: CollabAi | null
}

// ── 错误监控(auth_failure + api_error)─────────────────
export interface ErrorOverview {
  auth_failures: number
  api_errors: number
  affected_auth_visitors: number
  affected_api_visitors: number
  daily: { day: string; auth_failures: number; api_errors: number }[]
}
export interface ErrorGroup {
  event_type: 'auth_failure' | 'api_error'
  signature: string
  count: number
  visitors: number
  last_seen: string
  sample_message: string | null
}
export interface ErrorEvent {
  id: number
  created_at: string
  event_type: 'auth_failure' | 'api_error'
  visitor_id: string | null
  user_email: string | null
  path: string | null
  ua: string | null
  payload: Record<string, unknown>
}
export interface ErrorsData {
  overview: ErrorOverview
  groups: ErrorGroup[]
  recent: ErrorEvent[]
}
export const fetchErrors = (days: number) => authedGet<ErrorsData>(`/errors?days=${days}`)

export const fetchCollabSessions = () => authedGet<CollabSessionRow[]>(`/collab`)
export const fetchCollabReport = (code: string) =>
  authedGet<{ report: CollabReport | null }>(`/collab/${encodeURIComponent(code)}`)

async function authedPost<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers })
  if (res.status === 403 || res.status === 401) throw new ForbiddenError()
  if (!res.ok) throw new Error(`${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'request failed')
  return json.data as T
}

// ── 性能 / 负载监控 ─────────────────────────────────────
export interface PerfWindow {
  windowSec: number
  req: number
  err4: number
  err5: number
  slowReq: number
  query: number
  slowQuery: number
  rps: number
  errPct: number
  p50: number
  p95: number
  p99: number
  max: number
  peakConcurrency: number
  activeConcurrency: number
}
export interface PerfPoolStats { total: number; idle: number; waiting: number; max: number }
export interface PerfSnapshot {
  now: string
  last1m: PerfWindow
  last3m: PerfWindow
  pool: PerfPoolStats
  thresholds: { p95_ms: number; err_pct: number; slowq_3min: number; pool_wait: number }
}
export interface PerfRollup {
  minute: string
  req: number
  err4: number
  err5: number
  slow_req: number
  query_count: number
  slow_query: number
  p50: number
  p95: number
  p99: number
  max_ms: number
  peak_concurrency: number
  pool_total: number
  pool_waiting: number
}
export interface PerfAlert {
  id: number
  created_at: string
  resolved_at: string | null
  kind: string
  severity: string
  metric: number | null
  threshold: number | null
  window_s: number | null
  message: string
  emailed: boolean
  active: boolean
}
export interface PerfData {
  live: PerfSnapshot
  rollups: PerfRollup[]
  alerts: PerfAlert[]
}
export interface ActiveAlert { id: number; created_at: string; kind: string; message: string }

export const fetchPerf = (minutes = 180) => authedGet<PerfData>(`/perf?minutes=${minutes}`)
export const fetchActiveAlerts = () => authedGet<{ alerts: ActiveAlert[] }>(`/perf/alerts/active`)
export const ackAlert = (id: number) => authedPost<{ ok: boolean }>(`/perf/alerts/${id}/ack`)
