/**
 * Owner dashboard API client. All calls are authenticated (Supabase bearer
 * token) and hit /api/admin/analytics/* — the server enforces the owner
 * allow-list, so a non-owner gets 403 even if they reach these.
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

// '/api/admin/insights' (not '/api/admin/analytics') — ad-blockers eat URLs
// containing "analytics", which broke the owner's own dashboard polling. The
// backend double-mounts both; clients read from the clean alias.
const BASE = `${API_BASE_URL}/api/admin/insights`

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
  favorites: number
  contacts: number
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
  email: string | null       // resolved: own user_email, else latest from app_events
  short_id: string | null    // last 6 of visitor_id, uppercase
  duration_ms: number | null
  turn_count: number | null
  tool_call_count: number | null
  had_error: boolean
  summary: string | null     // AI 中文摘要(null = 未生成)
}
export interface SessionTranscriptMessage { role: 'user' | 'assistant'; content: string; timestamp: number }
export interface SessionDetail extends SessionRow {
  transcript: {
    messages?: SessionTranscriptMessage[]
    toolCalls?: Array<{ name: string; params: unknown; result?: unknown; duration?: number; error?: string }>
    errors?: unknown[]
    metrics?: Record<string, unknown>
  }
}
export interface SessionFilters {
  errored?: boolean
  visitorId?: string
  q?: string
  tool?: string
}

export type Stage = 'hot' | 'warm' | 'cooling' | 'cold' | 'lost'
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
  favorites: number
  contacts: number
  distinct_projects: number
  score: number
  stage: Stage
}
export interface TimelineItem {
  at: string
  source: 'intent' | 'api'
  type: string
  projectId: string | null
  projectName: string | null
  area: string | null
  query: string | null
  kind: string | null
  action: string | null
  contactType: string | null
  path: string | null
  label: string | null
  method: string | null
  status: number | null
}
export interface VisitorDetail {
  visitor_id: string
  user_email: string | null
  first_seen: string
  last_seen: string
  counts: { events: number; views: number; searches: number; luna: number; favorites: number; contacts: number; reports: number; research: number }
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
  lunaSessions: { session_id: string; created_at: string; duration_ms: number | null; turn_count: number | null; tool_call_count: number | null; had_error: boolean; summary: string | null }[]
  timeline: TimelineItem[]
}

export interface LostCustomer {
  identity: string
  visitor_id: string
  user_email: string | null
  first_seen: string
  last_seen: string
  days_silent: number
  views: number
  searches: number
  luna_opens: number
  favorites: number
  contacts: number
  errors: number
  score: number
  reasons: ('bug_hit' | 'no_contact' | 'cooling')[]
}

export const fetchVisitors = (days: number) => authedGet<VisitorRow[]>(`/visitors?days=${days}`)
export const fetchLostCustomers = (limit?: number) => authedGet<LostCustomer[]>(`/lost?limit=${limit || 100}`)
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
export const fetchSessions = (filters: SessionFilters = {}) => {
  const p = new URLSearchParams()
  if (filters.errored) p.set('errored', '1')
  if (filters.visitorId) p.set('visitorId', filters.visitorId)
  if (filters.q && filters.q.trim()) p.set('q', filters.q.trim())
  if (filters.tool && filters.tool.trim()) p.set('tool', filters.tool.trim())
  const qs = p.toString()
  return authedGet<SessionRow[]>(`/sessions${qs ? `?${qs}` : ''}`)
}
export const fetchSession = (sessionId: string) =>
  authedGet<{ session: SessionDetail | null }>(`/sessions/${encodeURIComponent(sessionId)}`)
export const backfillSessionSummaries = () =>
  authedPost<{ generated: number }>(`/sessions/backfill-summaries`)

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
  contacts: { name: string; phone?: string; whatsapp?: string }[]
  truncated: boolean
  ai: CollabAi | null
}

// ── 错误监控(auth_failure + api_error + 失败的 auth_token_refresh)──────
/** 失败的 token 刷新也算故障:客户会被莫名登出。成功的刷新不进来(后端过滤)。 */
export type ErrorEventType = 'auth_failure' | 'api_error' | 'auth_token_refresh'
export interface ErrorOverview {
  auth_failures: number
  api_errors: number
  affected_auth_visitors: number
  affected_api_visitors: number
  daily: { day: string; auth_failures: number; api_errors: number }[]
}
export interface ErrorGroup {
  event_type: ErrorEventType
  signature: string
  count: number
  visitors: number
  last_seen: string
  sample_message: string | null
}
export interface ErrorEvent {
  id: number
  created_at: string
  event_type: ErrorEventType
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

/** Real high-intent customers who hit an api_error / login failure recently
 *  (internal test ids excluded server-side), ranked by intent score. */
export interface ErrorImpactCustomer {
  identity: string
  visitor_id: string
  user_email: string | null
  last_seen: string
  last_error_at: string
  error_urls: string[]
  views: number
  favorites: number
  contacts: number
  score: number
}
export const fetchErrorImpact = (hours?: number) =>
  authedGet<ErrorImpactCustomer[]>(`/error-impact?hours=${hours || 48}`)

// ── 自治看护 agent(cx-guardian)巡检记录 ──────────────────
export interface AgentRun {
  id: number
  created_at: string
  agent: string
  status: 'clean' | 'fixed' | 'needs_attention'
  summary: string | null
  blocked_count: number
  lost_count: number
  actions: Array<{ type: string; detail: string; commit?: string; deploy_tag?: string; verify?: string }>
  flagged: Array<{ identity: string; score: number; reason: string }>
  needs_human: Array<{ detail: string; suggestion: string }>
}
export const fetchAgentRuns = (limit?: number) =>
  authedGet<AgentRun[]>(`/agent-runs?limit=${limit || 50}`)

// ── 经纪客户总览(owner 跨经纪可见)──────────────────────
export interface AgentClientRow {
  agent_name: string | null
  agent_email: string | null
  client_id: string
  client_name: string
  pipeline_stage: string
  heat: number
  last_activity_at: string | null
  interactions: number
  created_at: string
}
export const fetchAgentClients = () => authedGet<AgentClientRow[]>('/agent-clients')

export const fetchCollabSessions = () => authedGet<CollabSessionRow[]>(`/collab`)
export const fetchCollabReport = (code: string) =>
  authedGet<{ report: CollabReport | null }>(`/collab/${encodeURIComponent(code)}`)

async function authedPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined })
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
  /** 事故(API_5XX)的现场:失败 URL、受害客户、次数,以及关闭时补的 rootCause/fix。 */
  detail: Record<string, unknown> | null
  signature: string | null
  active: boolean
}
export interface PerfEndpointStat {
  key: string
  req: number
  err: number
  slow: number
  rps: number
  p50: number
  p95: number
  p99: number
  max: number
}
/** 慢请求全量留证(不采样)——延迟告警能被追根因,全靠这个。 */
export interface PerfSlowRequest {
  at: string
  endpoint: string
  url: string | null
  status: number | null
  duration_ms: number
  who: string | null
  aborted: boolean
}
export interface PerfData {
  live: PerfSnapshot
  rollups: PerfRollup[]
  alerts: PerfAlert[]
  slow?: PerfSlowRequest[]
  endpoints?: PerfEndpointStat[]
}
export interface ActiveAlert { id: number; created_at: string; kind: string; message: string }

// ── 分成对账(FINDHOMEGO 25% / 运营方 75%)──────────────
export interface MonthShare {
  month: string
  currency: string
  txn_count: number
  gross_cents: number
  refund_cents: number
  fee_cents: number
  net_cents: number
  share_findhomego_cents: number
  share_operator_cents: number
  current: boolean
  settlement: {
    settled_at: string
    settled_by: string | null
    note: string | null
    net_cents: number
    share_findhomego_cents: number
  } | null
}
export interface RevenueShareData {
  configured: boolean
  livemode: boolean | null
  share_rate: number
  months: MonthShare[]
}
export const fetchRevenueShare = (months = 12) =>
  authedGet<RevenueShareData>(`/revenue-share?months=${months}`)
export const settleRevenueMonth = (month: string, currency: string, note?: string) =>
  authedPost<MonthShare>(`/revenue-share/settle`, { month, currency, note: note || undefined })
export const unsettleRevenueMonth = (month: string, currency: string) =>
  authedPost<{ ok: boolean }>(`/revenue-share/unsettle`, { month, currency })

export const fetchPerf = (minutes = 180) => authedGet<PerfData>(`/perf?minutes=${minutes}`)

// ── 实时带看遥测(WS 之前 100% 全盲)── docs/telemetry-spec.md ────────────────
export interface LiveTourTelemetry {
  live: {
    wsConnections: number
    activeRooms: number
    cpuPct: number
    rssMb: number
    loopLagMs: number
    capacity: { cpuWarnPct: number; note: string }
  }
  series: {
    cpu: { minute: string; value: number }[]
    conns: { minute: string; value: number }[]
    fanout: { minute: string; value: number }[]
  }
  funnel: { step: string; count: number; fromPrevPct: number | null; fromFirstPct: number | null }[]
  rum: { name: string; samples: number; p50: number; p95: number }[]
  agora: {
    days: number
    totalUnits: number
    totalUsd: number
    usdPerUnit: number
    daily: { day: string; units: number; usd: number }[]
    top: { email: string; units: number; credits: number; usd: number }[]
  }
}
export const fetchLiveTourTelemetry = (hours = 24) =>
  authedGet<LiveTourTelemetry>(`/telemetry/live-tour?hours=${hours}`)

// ── AI 成本 / PDF 管线 / 钱门 / Tour 漏斗(之前全是盲的)────────────────────
export interface OpsTelemetry {
  ai: {
    hours: number
    totalUsd: number
    totalCalls: number
    tasks: {
      task: string; calls: number; usd: number
      inTokens: number; outTokens: number
      failed: number
      /** 退到备用模型的次数 —— 主模型有问题(废弃/限流)的哨兵 */
      fallback: number
      p50: number; p95: number
    }[]
  }
  pdf: {
    queue: {
      pending: number; processing: number; oldestWaitS: number
      /** >0 = worker 被 OOM kill 留下的孤儿,永远不会重试 */
      stuck: number
      workerRssMb: number; workerCpuPct: number
    }
    jobs: { completed: number; failed: number }
    agents: { agent: string; ok: number; failed: number; invalid: number; total: number }[]
  }
  paywall: { feature: string; reason: string; trial: boolean; count: number }[]
  tourFunnel: { step: string; count: number; fromPrevPct: number | null; fromFirstPct: number | null }[]
}
export const fetchOpsTelemetry = (hours = 24) =>
  authedGet<OpsTelemetry>(`/telemetry/ops?hours=${hours}`)
export const fetchActiveAlerts = () => authedGet<{ alerts: ActiveAlert[] }>(`/perf/alerts/active`)
export const ackAlert = (id: number) => authedPost<{ ok: boolean }>(`/perf/alerts/${id}/ack`)

// ── 订阅客户(B 端:谁订阅了我们)+ 功能记录 ─────────────────────────
export interface Subscriber {
  agent_id: string
  email: string | null
  display_name: string | null
  role: string | null
  agent_since: string
  plan_id: string | null
  plan_name: string | null
  status: string                 // active / trialing / none
  paid: boolean                  // 真付费 vs 手动赠送
  approval_status: string | null // pending/approved/rejected/null
  current_period_end: string | null
  cancel_at_period_end: boolean
  credits_month: number          // -1 = 无限
  credits_used: number
  is_internal: boolean
  // 后台一次性赠送(每人只能一次):谁发的、什么时候发的。非 null = 名额已用掉。
  trial_granted_at: string | null
  trial_granted_by: string | null
}
export interface SubscriptionSummary {
  total_accounts: number
  subscribed: number
  paid: number
  trialing: number
  comp: number
  pending_approval: number
}
export const fetchSubscribers = () =>
  authedGet<{ subscribers: Subscriber[]; summary: SubscriptionSummary }>(`/subscribers`)

export interface TourScriptRow {
  id: string | number; title: string; share_code: string | null; status: string | null
  language: string | null; total_ms: number | null; edited_by_agent: boolean
  agent_email: string | null; agent_name: string | null; created_at: string
}
export interface SalesOfferRow {
  id: string | number; share_code: string | null; project_name: string; unit_name: string | null
  bedrooms: string | number | null; price: number | null; original_price: number | null
  lang: string | null; agent_name: string | null; created_by_email: string | null
  view_count: number; created_at: string
}
export interface BuyerReportRow {
  id: string | number; share_code: string | null; title: string; status: string | null
  kind: 'client' | 'project'; view_count: number; agent_name: string | null; created_at: string
}
export const fetchFeatureTours = (limit = 100) => authedGet<TourScriptRow[]>(`/feature-log/tours?limit=${limit}`)
export const fetchFeatureSalesOffers = (limit = 100) => authedGet<SalesOfferRow[]>(`/feature-log/sales-offers?limit=${limit}`)
export const fetchFeatureReports = (limit = 100) => authedGet<BuyerReportRow[]>(`/feature-log/reports?limit=${limit}`)

// ── 健康度面板 ────────────────────────────────────────────────────────────
// 后端一次返回全部（backend/src/services/healthQueries.ts），前端不串多个请求。
export interface HealthFeature {
  key: string; label: string
  produced: number; producedPrev: number
  consumed: number; consumedPrev: number
  consumedDetail: string | null
  /** false = 该功能的数据无法区分内部测试，前端必须明说，不能假装干净 */
  canSplitInternal: boolean
  note: string
}
export interface HealthFunnel {
  key: string; label: string
  /** 分母为 0 时是 null */
  value: number | null
  /** 分母。样本太小时前端显示「样本不足」而不是假精度百分比 */
  n: number
  median: number; good: number; source: string
}
export interface HealthSignal {
  severity: 'critical' | 'serious' | 'warning' | 'info'
  title: string
  /** 触发它的具体数字。没有这个，建议就是算命。 */
  evidence: string
  /** 下一步做什么，尽量具体到人、到页面。 */
  action: string
}
export interface HealthMap {
  users: number; events: number; engaged: number; multiday: number; gateHit: number
  daily: { date: string; dau: number; areas: number }[]
}
/** C 端受众（访客/买家）。⚠️ 任何「用户数」都必须说清是 C 端还是 B 端。 */
export interface HealthAudience {
  visitors: number; usedCore: number; engaged: number
  returned: number; deep: number
  lunaUsers: number; lunaConvos: number
}
export interface HealthSnapshot {
  days: number
  /** 判断层 —— 面板存在的理由，排最前 */
  signals: HealthSignal[]
  audience: HealthAudience
  map: HealthMap
  agents: {
    total: number; newCur: number; newPrev: number
    trialStarted: number; activated: number
    returned: number; returnedCur: number; returnedPrev: number
    deepUsers: number; paying: number; pastDue: number
  }
  features: HealthFeature[]
  funnel: HealthFunnel[]
  internalAgents: string[]
}
export const fetchHealth = (days = 30) => authedGet<HealthSnapshot>(`/health?days=${days}`)
