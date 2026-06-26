/**
 * Luna Collaborative Tour — REST helpers for the room lifecycle (§6).
 *
 * Thin wrappers over the backend's `/api/collab/rooms` endpoints (the WS is
 * owned by CollabClient). ISOLATION: only depends on API_BASE_URL.
 */
import { API_BASE_URL } from '../../lib/config'
import { supabase } from '../../lib/supabase'

export interface CreateRoomResult {
  code: string
  url: string
}

/** POST /api/collab/rooms → { code, url }. Presenter (owner) creates a room.
 *  带登录经纪 token,后端按订阅额度拦截实时带看(超额返回 402)。 */
export async function createCollabRoom(name?: string): Promise<CreateRoomResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  } catch { /* not logged in */ }
  const res = await fetch(`${API_BASE_URL}/api/collab/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify(name ? { name } : {}),
  })
  if (!res.ok) {
    // 配额/需订阅:抛出后端的友好中文提示(含升级引导)
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `createCollabRoom failed: ${res.status}`)
  }
  return res.json()
}

export interface RoomInfo {
  exists: boolean
  participants: number
}

/** GET /api/collab/rooms/:code → { exists, participants }. */
export async function getCollabRoom(code: string): Promise<RoomInfo> {
  const res = await fetch(`${API_BASE_URL}/api/collab/rooms/${encodeURIComponent(code)}`)
  if (!res.ok) return { exists: false, participants: 0 }
  return res.json()
}
