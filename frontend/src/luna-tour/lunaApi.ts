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
