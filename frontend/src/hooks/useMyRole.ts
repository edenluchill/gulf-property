/**
 * useMyRole — 当前登录用户的身份(buyer/agent/agency/developer,来自 user_profiles.role)。
 *
 * sessionStorage 'pinzos-role' 只作**乐观初值**(首帧不闪),服务端永远是真相源:
 * 每次都拉一次 /api/me/profile 并用结果覆盖缓存。
 *
 * ⚠️ 曾经的 bug(2026-07-11 修):读到缓存就 return,从不与服务端核对 —— 而
 * RoleSelectPage / AgentLayout 在**还没落库**时就把角色写进了缓存(付费角色要
 * 付款/开试用成功才落 role)。结果:侧栏显示「经纪人」,服务端却认为你是买家,
 * 于是试用领取卡(按服务端 role 判定资格)死活不出现,用户一脸问号。
 * 缓存可以抢跑,但不能撒谎 —— 服务端一回来就必须纠正它。
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRole, type UserRole } from '../lib/billingApi'

const KEY = 'pinzos-role'

export function useMyRole(): UserRole | null {
  const { user, loading } = useAuth()
  const [role, setRole] = useState<UserRole | null>(() => {
    try { return (sessionStorage.getItem(KEY) as UserRole | null) || null } catch { return null }
  })

  useEffect(() => {
    if (loading) return
    if (!user) {
      setRole(null)
      try { sessionStorage.removeItem(KEY) } catch { /* noop */ }
      return
    }
    let stale = false
    void fetchMyRole().then((r) => {
      if (stale) return
      // 服务端说了算:包括「服务端还没有 role」这种情况 —— 那也要把乐观缓存清掉,
      // 否则用户会一直看到一个自己其实并不拥有的身份。
      setRole(r ?? null)
      try {
        if (r) sessionStorage.setItem(KEY, r)
        else sessionStorage.removeItem(KEY)
      } catch { /* noop */ }
    })
    return () => { stale = true }
  }, [user, loading])

  return role
}
