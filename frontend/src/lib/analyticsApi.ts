/**
 * Owner dashboard API client. All calls are authenticated (Supabase bearer
 * token) and hit /api/admin/analytics/* — the server enforces the owner
 * allow-list, so a non-owner gets 403 even if they reach these.
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

const BASE = `${API_BASE_URL}/api/admin/analytics`
const KEY_STORAGE = 'dashboard-key'

/** Error thrown when the server rejects the dashboard key (403). */
export class ForbiddenError extends Error {
  constructor() {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}

export function getDashboardKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}
export function setDashboardKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim())
  } catch {
    /* ignore */
  }
}

async function authedGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const key = getDashboardKey()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}` // future: server-side Supabase email gate
  if (key) headers['x-dashboard-key'] = key
  const res = await fetch(`${BASE}${path}`, { headers })
  if (res.status === 403) throw new ForbiddenError()
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
