/**
 * useMyRole — 当前登录用户的类型(buyer/agent,来自 user_profiles.role)。
 * sessionStorage 'pinzos-role' 做会话内缓存(RoleSelectModal / 各切换入口同 key),
 * 导航按它决定给买家看「个人中心」还是给经纪看「经纪台」。
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRole } from '../lib/billingApi'

const KEY = 'pinzos-role'

export function useMyRole(): 'buyer' | 'agent' | null {
  const { user, loading } = useAuth()
  const [role, setRole] = useState<'buyer' | 'agent' | null>(() => {
    try { return (sessionStorage.getItem(KEY) as 'buyer' | 'agent' | null) || null } catch { return null }
  })

  useEffect(() => {
    if (loading) return
    if (!user) { setRole(null); return }
    try {
      const cached = sessionStorage.getItem(KEY) as 'buyer' | 'agent' | null
      if (cached) { setRole(cached); return }
    } catch { /* noop */ }
    let stale = false
    void fetchMyRole().then((r) => {
      if (stale || !r) return
      try { sessionStorage.setItem(KEY, r) } catch { /* noop */ }
      setRole(r)
    })
    return () => { stale = true }
  }, [user, loading])

  return role
}
