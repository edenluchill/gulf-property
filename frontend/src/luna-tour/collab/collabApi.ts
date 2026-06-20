/**
 * Luna Collaborative Tour — REST helpers for the room lifecycle (§6).
 *
 * Thin wrappers over the backend's `/api/collab/rooms` endpoints (the WS is
 * owned by CollabClient). ISOLATION: only depends on API_BASE_URL.
 */
import { API_BASE_URL } from '../../lib/config'

export interface CreateRoomResult {
  code: string
  url: string
}

/** POST /api/collab/rooms → { code, url }. Presenter (owner) creates a room. */
export async function createCollabRoom(name?: string): Promise<CreateRoomResult> {
  const res = await fetch(`${API_BASE_URL}/api/collab/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name ? { name } : {}),
  })
  if (!res.ok) throw new Error(`createCollabRoom failed: ${res.status}`)
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
