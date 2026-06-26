/**
 * 从请求的 Supabase Bearer token 解析登录经纪 → lt_agents.id。
 *
 * 用于把高级功能挂到经纪身份上做订阅 gating。验证 token(不信任可伪造的
 * x-user-* 请求头),未登录/无效 token → null(由调用方决定是否放行)。
 */
import { supabaseAdmin, isSupabaseConfigured } from './supabase'
import { ensureAgent } from '../luna-tour/session-builder'

export async function resolveAgentId(req: { headers: Record<string, unknown> }): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  const h = req.headers.authorization
  const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.substring(7) : null
  if (!token) return null
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token)
    if (user?.email) {
      return ensureAgent({
        email: user.email,
        displayName: (user.user_metadata?.name as string) || user.email.split('@')[0],
        authUserId: user.id,
        brand: { title: '认证顾问', accent: '#00E0B8' },
      })
    }
  } catch {
    /* invalid/expired token → treat as anonymous */
  }
  return null
}
