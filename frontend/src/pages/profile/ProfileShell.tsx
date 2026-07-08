/**
 * ProfileShell — 个人中心统一外壳(路由 /profile 与 /agent/* 共用的 layout route)。
 *
 * 左侧栏 = 身份卡 + 分组 tab(个人资料 / 经纪台各功能);手机端为顶部横向 tab。
 * URL 方案不变:/agent/* 深链、Stripe 回跳(/agent/billing?status=success)、
 * 底部导航全部照旧 —— 只是视觉上统一归入「个人中心」一个页面。
 * 经纪台的审批门(登录/审核中/未开通)仍由 AgentLayout 在内容区处理。
 */
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Loader2, LogIn, LogOut, UserRound, LayoutDashboard, Users, Clapperboard,
  FileText, CreditCard, ArrowRight, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useUserProfile } from '../../contexts/UserProfileContext'
import { useMyRole } from '../../hooks/useMyRole'
import { fetchBillingMe } from '../../lib/billingApi'
import { badgeForPlan, type RoleBadge } from '../../lib/roleBadge'
import { useScrollChrome } from '../../hooks/useScrollChrome'

// 角色小徽章(与 UserMenu / 角色选择卡同一套颜色/emoji)
const ROLE_CHIP: Record<string, { zh: string; en: string; emoji: string; cls: string }> = {
  buyer: { zh: '买家', en: 'Buyer', emoji: '🏠', cls: 'bg-teal-100 text-teal-700' },
  agent: { zh: '经纪人', en: 'Agent', emoji: '🧑‍💼', cls: 'bg-indigo-100 text-indigo-700' },
  agency: { zh: '经纪公司', en: 'Agency', emoji: '🏢', cls: 'bg-violet-100 text-violet-700' },
  developer: { zh: '开发商', en: 'Developer', emoji: '🏗️', cls: 'bg-amber-100 text-amber-700' },
}

export type ProfileShellContext = { badge: RoleBadge | null }

type Tab = { to: string; end?: boolean; zh: string; en: string; icon: typeof UserRound }

const ACCOUNT_TABS: Tab[] = [
  { to: '/profile', end: true, zh: '个人资料', en: 'Profile', icon: UserRound },
]

const AGENT_TABS: Tab[] = [
  { to: '/agent', end: true, zh: '概览', en: 'Overview', icon: LayoutDashboard },
  { to: '/agent/clients', zh: '客户', en: 'Clients', icon: Users },
  { to: '/agent/tour', zh: '生成导览', en: 'Tours', icon: Clapperboard },
  { to: '/agent/report', zh: '快速提案', en: 'Proposals', icon: FileText },
  { to: '/agent/billing', zh: '订阅与套餐', en: 'Billing', icon: CreditCard },
]

export default function ProfileShell() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const { user, loading, isAdmin, signOut } = useAuth()
  const { profile } = useUserProfile()
  const role = useMyRole()
  const location = useLocation()
  // 与 Header/MobileNav 同规则:agency/developer 也走经纪台
  const isAgent = !!profile?.agent || role === 'agent' || role === 'agency' || role === 'developer'
  const roleChip = role ? ROLE_CHIP[role] : null

  // 认证勋章(付费订阅推导;买家/无订阅 = null)
  const [badge, setBadge] = useState<RoleBadge | null>(null)
  useEffect(() => {
    if (!user) { setBadge(null); return }
    let stale = false
    void fetchBillingMe()
      .then((me) => { if (!stale && me) setBadge(badgeForPlan(me.plan?.id, me.status, me.teamMember)) })
      .catch(() => { /* 未付费 */ })
    return () => { stale = true }
  }, [user?.email])

  // 滚动收纳:手机/pad 下滑收顶部导航(app 根不滚动,必须容器驱动)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { secondaryHidden } = useScrollChrome(scrollRef, !loading)

  const [avatarError, setAvatarError] = useState(false)
  useEffect(() => { setAvatarError(false) }, [user?.user_metadata?.avatar_url])

  const tabs: Tab[] = [...ACCOUNT_TABS, ...(isAgent ? AGENT_TABS : [])]

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
      </div>
    )
  }

  // 未登录:统一登录门(带 returnTo,登录后直接回来)
  if (!user) {
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
            <LogIn className="h-6 w-6 text-teal-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">{L('登录个人中心', 'Sign in')}</h2>
          <p className="mt-2 text-sm text-slate-500">
            {L('登录后管理你的资料、收藏与经纪台。支持 Google 一键登录或邮箱验证码。',
               'Sign in to manage your profile, favorites and agent console.')}
          </p>
          <Link
            to={`/login?returnTo=${returnTo}`}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-600"
          >
            {L('前往登录', 'Go to login')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.user_metadata?.avatar_url

  const navItemCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100/80'
    }`

  return (
    // 自带滚动容器(Layout 的 <main> 是 overflow-hidden);overflow-y-scroll 常驻
    // 滚动条槽位,切 tab 时内容宽度不跳。
    <div ref={scrollRef} className="flex-1 overflow-y-scroll bg-slate-50">
      {/* 手机/pad:顶部横向 tab(sticky,下滑随导航一起收起) */}
      <div
        className={`md:hidden sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/95 backdrop-blur transition-transform duration-300 ease-out ${
          secondaryHidden ? '-translate-y-full' : ''
        }`}
      >
        <div className="flex gap-1 overflow-x-auto px-3 py-2 [-webkit-overflow-scrolling:touch]">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  isActive ? 'bg-teal-500 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`
              }
            >
              <tab.icon className="h-4 w-4" />
              {zh ? tab.zh : tab.en}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="flex gap-6">
          {/* 桌面左侧栏 */}
          <aside className="hidden w-60 shrink-0 md:block">
            <div className="sticky top-6 space-y-4">
              {/* 身份卡 */}
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
                <div className="flex items-center gap-3">
                  {avatarUrl && !avatarError ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      onError={() => setAvatarError(true)}
                      className="h-11 w-11 rounded-full object-cover ring-2 ring-teal-500/20"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-base font-semibold text-white">
                      {(user.email || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{displayName}</div>
                    <div className="truncate text-xs text-slate-500" title={user.email || ''}>{user.email}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </span>
                  )}
                  {roleChip && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${roleChip.cls}`}>
                      <span aria-hidden>{roleChip.emoji}</span>
                      {zh ? roleChip.zh : roleChip.en}
                    </span>
                  )}
                  {badge && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
                      style={{ background: `linear-gradient(90deg, ${badge.from}, ${badge.to})` }}
                    >
                      <span aria-hidden>{badge.emoji}</span>
                      {zh ? badge.titleZh : badge.titleEn}
                    </span>
                  )}
                </div>
              </div>

              {/* tab 分组 */}
              <nav className="space-y-4">
                <div>
                  <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {L('我的账户', 'Account')}
                  </div>
                  <div className="space-y-0.5">
                    {ACCOUNT_TABS.map((tab) => (
                      <NavLink key={tab.to} to={tab.to} end={tab.end} className={navItemCls}>
                        <tab.icon className="h-4 w-4" />
                        {zh ? tab.zh : tab.en}
                      </NavLink>
                    ))}
                  </div>
                </div>

                {isAgent ? (
                  <div>
                    <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {L('经纪台', 'Agent console')}
                    </div>
                    <div className="space-y-0.5">
                      {AGENT_TABS.map((tab) => (
                        <NavLink key={tab.to} to={tab.to} end={tab.end} className={navItemCls}>
                          <tab.icon className="h-4 w-4" />
                          {zh ? tab.zh : tab.en}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* 买家:升级入口(不显示经纪台 tab) */
                  <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 p-4 ring-1 ring-amber-200/60">
                    <div className="text-sm font-semibold text-slate-900">{L('成为经纪', 'Become an agent')}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600">
                      {L('解锁经纪台:客户管理、AI 导览、品牌提案。7 天免费试用。',
                         'Unlock the agent console: CRM, AI tours, branded proposals. 7-day free trial.')}
                    </p>
                    <Link
                      to="/choose-role"
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:opacity-95"
                    >
                      {L('了解详情', 'Learn more')} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}
              </nav>

              {/* 退出 */}
              <button
                onClick={() => void signOut()}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-red-500 transition hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                {L('退出登录', 'Sign out')}
              </button>
            </div>
          </aside>

          {/* 内容区(个人资料 / 经纪台各 tab)。context 给 ProfileHome 复用勋章,
              避免同一份 billing/me 拉两遍。 */}
          <main className="min-w-0 flex-1">
            <Outlet context={{ badge } satisfies ProfileShellContext} />
          </main>
        </div>
      </div>
    </div>
  )
}
