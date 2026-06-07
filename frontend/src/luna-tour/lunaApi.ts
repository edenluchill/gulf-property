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
