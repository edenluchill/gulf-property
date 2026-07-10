/**
 * Luna Tour — agent API helper (Phase 1 auth).
 *
 * Wraps fetch to the agent API with the logged-in agent's Supabase token, so the
 * backend scopes every call to that agent (their own sessions / clients). Falls
 * back to no token (→ demo agent server-side) when not logged in. FormData bodies
 * keep the browser-set Content-Type (don't override the multipart boundary).
 */
import { API_BASE_URL } from '../lib/config'
import { supabase } from '../lib/supabase'

export const AGENT_API = `${API_BASE_URL}/api/luna/agent`

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) return { Authorization: `Bearer ${session.access_token}` }
  } catch {
    /* not logged in / supabase off */
  }
  return {}
}

/** fetch the agent API at `path` (relative to AGENT_API) with the agent token. */
export async function lunaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const isForm = init.body instanceof FormData
  const headers: Record<string, string> = {
    ...(init.body != null && !isForm ? { 'Content-Type': 'application/json' } : {}),
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) || {}),
  }
  return fetch(`${AGENT_API}${path}`, { ...init, headers })
}

/* ---- Clients workbench (knows-who-to-chase) ---- */

export type PipelineStage = 'new' | 'engaged' | 'viewing' | 'offer' | 'closed' | 'lost'
export type InteractionKind = 'note' | 'call' | 'whatsapp' | 'email' | 'meeting' | 'viewing'
export type InteractionOutcome = 'interested' | 'follow_up' | 'not_interested' | 'closed_won' | 'closed_lost'

export interface Client {
  id: string
  name: string
  avatar_url: string | null
  background: string | null
  budget: string | null
  expectations: string | null
  traits: string | null
  report_count?: number
  heat?: number
  pipeline_stage?: PipelineStage
  interaction_count?: number
  last_interaction_at?: string | null
  next_followup_at?: string | null
  last_activity_at?: string | null
}

export interface ClientInteraction {
  id: string
  kind: InteractionKind
  note: string | null
  outcome: InteractionOutcome | null
  next_followup_at: string | null
  created_at: string
}

export interface ClientEngagement {
  event_type: string
  created_at: string
  dwell_ms: number | null
  project_name: string | null
}

export interface ClientHeat {
  heat: number
  opens: number
  completes: number
  cta: number
  last_activity_at: string | null
}

export interface ClientDetailResponse {
  success: boolean
  client: Client
  reports: any[]
  interactions: ClientInteraction[]
  heat: ClientHeat | null
  engagement: ClientEngagement[]
}

/** List the agent's clients, optionally filtered by pipeline stage / search query. */
export async function getClients(opts: { stage?: string; q?: string } = {}): Promise<Client[]> {
  const qs = new URLSearchParams()
  if (opts.stage) qs.set('stage', opts.stage)
  if (opts.q) qs.set('q', opts.q)
  const suffix = qs.toString() ? `?${qs}` : ''
  const r = await lunaFetch(`/clients${suffix}`)
  const j = await r.json()
  return (j.clients || []) as Client[]
}

/** Full client detail: profile + reports + interactions + heat + engagement. */
export async function getClientDetail(id: string): Promise<ClientDetailResponse> {
  const r = await lunaFetch(`/clients/${id}`)
  return (await r.json()) as ClientDetailResponse
}

/** Log a follow-up interaction (optionally advancing the pipeline stage). */
export async function addInteraction(
  id: string,
  body: { kind: InteractionKind; note?: string; outcome?: InteractionOutcome; next_followup_at?: string; stage?: PipelineStage }
): Promise<Response> {
  return lunaFetch(`/clients/${id}/interactions`, { method: 'POST', body: JSON.stringify(body) })
}

/** Move a client to a pipeline stage. */
export async function setClientStage(id: string, stage: PipelineStage): Promise<Response> {
  return lunaFetch(`/clients/${id}/stage`, { method: 'POST', body: JSON.stringify({ stage }) })
}

/* ---- Compare report (branded, shareable project comparison) ---- */

export interface CompareSearchProject {
  id: number
  project_name: string
  area: string | null
  primary_image: string | null
  min_price: number | null
}

export interface CompareGenerateResult {
  shareCode: string
  url: string
}

export interface ClientReportStatus {
  status: 'generating' | 'ready' | 'error'
  progress?: { key: string; label: string; done: boolean }[]
}

/** Search projects to pick for a compare report (min 2, max 4 are selectable). */
export async function searchProjectsForCompare(q: string): Promise<CompareSearchProject[]> {
  const r = await lunaFetch(`/projects/search?q=${encodeURIComponent(q)}`)
  const j = await r.json()
  return (j.projects || []) as CompareSearchProject[]
}

/** Kick off an async branded compare report bound to a client. Returns the share code + path. */
export async function generateCompareReport(body: { client_id: string; project_ids: number[] }): Promise<CompareGenerateResult> {
  const r = await lunaFetch('/client-reports/compare', { method: 'POST', body: JSON.stringify(body) })
  const j = await r.json()
  if (!j.success || !j.shareCode) throw new Error(j.error || '生成失败')
  return { shareCode: j.shareCode, url: j.url }
}

/** Poll a client report's generation status by share code. */
export async function getClientReportStatus(code: string): Promise<ClientReportStatus> {
  const r = await lunaFetch(`/client-reports/${code}/status`)
  return (await r.json()) as ClientReportStatus
}

// ── 使用记录(逐笔积分流水)────────────────────────────────
export interface LedgerEntry {
  id: number
  feature: string
  credits: number
  ref_type: string | null
  ref_id: string | null
  ref_label: string | null
  created_at: string
  actor_agent_id: string | null
  actor_name: string | null
}
export interface LedgerFeature { key: string; label: string; credits: number; minPlan: string }
export interface LedgerResponse {
  success: boolean
  /** true = 团队 owner 视角(整个共享池,显示操作人列);false = 只看自己 */
  pool: boolean
  entries: LedgerEntry[]
  features: LedgerFeature[]
}

/** 使用记录:席位成员只看自己,团队 owner 看整个池。 */
export async function fetchLedger(feature?: string, limit = 200): Promise<LedgerResponse> {
  const qs = new URLSearchParams()
  if (feature) qs.set('feature', feature)
  qs.set('limit', String(limit))
  const r = await lunaFetch(`/ledger?${qs.toString()}`)
  return (await r.json()) as LedgerResponse
}

// ── 共享线索池 + 认领 ────────────────────────────────────
export interface Lead {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  source: string | null
  intent: { areas?: string[]; project_ids?: string[]; searches?: number; property_views?: number; opened_luna?: boolean } | null
  lead_score: number
  status: string
  last_seen_at: string | null
  created_at: string
  assigned_agent_id: string | null
  assigned_at: string | null
  converted_client_id: string | null
}

/** 线索池:未认领 + 我已认领(未转客户)的。 */
export async function fetchLeads(): Promise<Lead[]> {
  const r = await lunaFetch('/leads')
  const j = await r.json()
  return (j.leads || []) as Lead[]
}
/** 认领(已被别人领走返回 false)。 */
export async function claimLead(id: number): Promise<boolean> {
  const r = await lunaFetch(`/leads/${id}/claim`, { method: 'POST' })
  return r.ok
}
/** 释放回池子。 */
export async function releaseLead(id: number): Promise<boolean> {
  const r = await lunaFetch(`/leads/${id}/release`, { method: 'POST' })
  return r.ok
}
/** 转为客户(进 CRM),返回新 client id。 */
export async function convertLead(id: number): Promise<string | null> {
  const r = await lunaFetch(`/leads/${id}/convert`, { method: 'POST' })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.clientId as string) : null
}
