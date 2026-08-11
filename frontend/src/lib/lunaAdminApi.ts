/**
 * Admin · Luna 可观测 + 自测 的 API 客户端。
 *
 * 服务端 `requireAdmin` 把关（`/api/admin/luna/*`），这里只负责带上 Supabase token。
 * 见 `backend/src/routes/admin-luna.ts`。
 */
import { API_BASE_URL } from './config'
import { supabase } from './supabase'

const BASE = `${API_BASE_URL}/api/admin/luna`

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}

export interface LunaHealth {
  days: number
  spoken_turns: string
  /** 🔴 Luna 没查就自己说的轮次 —— 护栏在 Brain 里，绕过 = 全失效 */
  unchecked_turns: string
  degraded_turns: string
  clarifying_turns: string
  sessions: string
  /** 客户说完 → Luna 第一个音（体感延迟） */
  p50_first_audio_ms: string | null
  p95_first_audio_ms: string | null
  avg_brain_ms: string | null
}

export interface LunaSessionRow {
  session_id: string
  started_at: string
  last_at: string
  turns: string
  unchecked: string
  degraded: string
  avg_first_audio_ms: string | null
  worst_first_audio_ms: number | null
  scopes: string[] | null
  first_question: string | null
}

export interface LunaTurn {
  id: string
  created_at: string
  source: 'brain' | 'live'
  user_said: string | null
  question: string | null
  speech: string | null
  tools: string[] | null
  intended_tool: string | null
  ms: number | null
  user_speech_ms: number | null
  to_first_audio_ms: number | null
  total_ms: number | null
  asked_brain: boolean | null
  degraded: boolean | null
  out_of_scope: string | null
  clarifying: boolean | null
}

export interface TestRun {
  id: string
  created_at: string
  finished_at: string | null
  kind: string
  model: string | null
  status: 'running' | 'done' | 'failed'
  triggered_by: string | null
  passed: number | null
  total: number | null
  avg_score: string | null
  error: string | null
}

export interface TestCase {
  scenario_id: string
  tag: string
  passed: boolean
  score: number | null
  verdict: string
  turns: Array<{ user: string; reply: string; tools: string[]; askedBrain: boolean; ms: number }>
  failures: string[] | null
  ms: number
}

export const lunaHealth = (days = 7) => authed<LunaHealth>(`/health?days=${days}`)
export const lunaSessions = (days = 14) => authed<{ sessions: LunaSessionRow[] }>(`/sessions?days=${days}`)
export const lunaSession = (id: string) => authed<{ turns: LunaTurn[] }>(`/session/${encodeURIComponent(id)}`)
export const lunaScenarios = () =>
  authed<{ scenarios: Array<{ id: string; tag: string; turns: string[]; why: string }> }>('/scenarios')
export const lunaTests = () => authed<{ runs: TestRun[] }>('/tests')
export const lunaTest = (id: string) => authed<{ run: TestRun; cases: TestCase[] }>(`/test/${id}`)
export const startLunaTest = (body: { kind: 'brain' | 'live'; only?: string[]; model?: string }) =>
  authed<{ runId: string; status: string }>('/test', { method: 'POST', body: JSON.stringify(body) })
