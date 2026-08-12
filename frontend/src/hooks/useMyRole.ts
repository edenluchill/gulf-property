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
 *
 * ⚠️ 但「服务端**没回来**」不等于「服务端说你没有」(2026-08-12 修)。
 * 原来网络一断就把缓存清了,侧栏当场把一个经纪降级成买家。
 * 现在只有 `ok:true` 才允许覆盖缓存。
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { fetchMyRoleResult, type UserRole } from '../lib/billingApi'

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
    void fetchMyRoleResult().then((res) => {
      if (stale) return
      // 读失败 → 保持现状(上次已知的角色)。清掉的话,网络抖一下经纪就变买家。
      if (!res.ok) return
      // 服务端说了算:包括「服务端还没有 role」这种情况 —— 那也要把乐观缓存清掉,
      // 否则用户会一直看到一个自己其实并不拥有的身份。
      setRole(res.role)
      try {
        if (res.role) sessionStorage.setItem(KEY, res.role)
        else sessionStorage.removeItem(KEY)
      } catch { /* noop */ }
    })
    return () => { stale = true }
  }, [user, loading])

  return role
}

/**
 * 这个人是不是**经纪侧**的用户(经纪 / 经纪公司 / 开发商)。
 *
 * 判据有两条,缺一不可:
 *   `profile.agent`   —— 已经建了经纪档案(有些老账号 user_profiles.role 是空的,
 *                        但人家确确实实在用经纪台;只看 role 会把他们当买家)
 *   `role`            —— 自己选的身份
 *
 * 这条规则原先在 Header / ProfileShell / UnitTypesSubPage 各抄了一遍。抄第四遍的时候
 * 收口到这里 —— 它决定「谁能看到经纪侧的东西」,散在四处早晚会有一处漏改。
 */
export function useIsAgentSide(): boolean {
  const { profile } = useUserProfile()
  const role = useMyRole()
  return !!profile?.agent || role === 'agent' || role === 'agency' || role === 'developer'
}
