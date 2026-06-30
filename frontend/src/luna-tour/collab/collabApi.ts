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

// 去掉易混的 0/O/1/I —— 必须与后端 collab-rooms 的字母表一致。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 从经纪身份(user.id / email)确定性派生一个稳定的 5 位带看 code。
 * 同一经纪每次「开始带看」都得到同一条链接,客户旧链接永不失效。每个字符独立
 * 哈希 (seed+index),分布均匀;31^5 ≈ 2860 万,几十个经纪碰撞概率可忽略。
 */
export function deriveHostCode(seed: string, len = 5): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    let h = (0x811c9dc5 ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0
    const s = `${seed}:${i}`
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    out += CODE_ALPHABET[h % CODE_ALPHABET.length]
  }
  return out
}

/** POST /api/collab/rooms → { code, url }. Presenter (owner) creates a room.
 *  带登录经纪 token,后端按订阅额度拦截实时带看(超额返回 402)。
 *  传 code 则后端复用/复活该 code 的房间(经纪稳定链接)。 */
export async function createCollabRoom(name?: string, code?: string): Promise<CreateRoomResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  } catch { /* not logged in */ }
  const res = await fetch(`${API_BASE_URL}/api/collab/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...(name ? { name } : {}), ...(code ? { code } : {}) }),
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
