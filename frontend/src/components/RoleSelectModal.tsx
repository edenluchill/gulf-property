/**
 * RoleSelectRedirect(文件名保留 RoleSelectModal 以免动 Layout 引用)——
 * 2026-07-05 选角色从弹窗改为独立页面 /choose-role(用户要求):本组件只做
 * 检测与重定向:已登录 && user_profiles.role 为空 && 不在分享/回调/选档页
 * → 送去 /choose-role。选择逻辑在 pages/RoleSelectPage。
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRole } from '../lib/billingApi'

const CACHE_KEY = 'pinzos-role' // sessionStorage:避免每次导航都打接口

// 不打扰的路径:分享页(客户被经纪带着看)、登录/回调、选角色页自身、
// 各角色选档页(用户正处在"选了付费角色→付款"的中间态,别拽回去)
const QUIET_PREFIXES = [
  '/t/', '/v/', '/r/', '/cr/', '/pp/', '/factsheet/', '/auth/', '/login',
  '/choose-role', '/agent/plans', '/agency/plans', '/developer/plans', '/pricing', '/agent/join',
]

export default function RoleSelectRedirect() {
  const { user, loading, isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading || !user || isAdmin) return // 内部/owner 账号不问
    if (QUIET_PREFIXES.some((p) => location.pathname.startsWith(p))) return
    try {
      if (sessionStorage.getItem(CACHE_KEY)) return
    } catch { /* noop */ }
    let stale = false
    void fetchMyRole().then((role) => {
      if (stale) return
      if (role) {
        try { sessionStorage.setItem(CACHE_KEY, role) } catch { /* noop */ }
      } else {
        navigate('/choose-role')
      }
    })
    return () => { stale = true }
  }, [user, loading, isAdmin, location.pathname, navigate])

  return null
}
