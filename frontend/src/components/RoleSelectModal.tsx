/**
 * RoleSelectRedirect(文件名保留 RoleSelectModal 以免动 Layout 引用)——
 * 2026-07-05 选角色从弹窗改为独立页面 /choose-role(用户要求):本组件只做
 * 检测与重定向:已登录 && user_profiles.role 为空 && 不在分享/回调/选档页
 * → 送去 /choose-role。选择逻辑在 pages/RoleSelectPage。
 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { fetchMyRoleResult } from '../lib/billingApi'

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
    void fetchMyRoleResult().then((r) => {
      if (stale) return
      /**
       * 🔴 **只有服务端明确说「这人没有角色」时才拦人。**
       * 读失败(网络断/5xx)时什么都不做 —— 把网络抖动翻译成「你没有身份」,
       * 会把一个正在用产品的付费经纪扔到选角色页。已经发生过两次,
       * 其中一个是我们唯一收到过回信的客户(见 billingApi.fetchMyRoleResult 注释)。
       */
      if (!r.ok) return
      if (r.role) {
        try { sessionStorage.setItem(CACHE_KEY, r.role) } catch { /* noop */ }
      } else {
        navigate('/choose-role')
      }
    })
    return () => { stale = true }
  }, [user, loading, isAdmin, location.pathname, navigate])

  return null
}
