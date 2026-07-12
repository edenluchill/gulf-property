/**
 * ProfileShell — 个人中心统一外壳(路由 /profile 与 /agent/* 共用的 layout route)。
 *
 * 左侧栏 = 身份小卡 + 通用 tab(个人资料/订阅与套餐)+「经纪工作台」独立深色模块
 * (只有经纪能展开;非经纪显示上锁,点击去开通)。手机端为顶部横向 tab。
 * URL 方案不变:/agent/* 深链、Stripe 回跳(/agent/billing?status=success)、
 * 底部导航全部照旧 —— 只是视觉上统一归入「个人中心」一个页面。
 * 经纪台的审批门(登录/审核中/未开通)仍由 AgentLayout 在内容区处理;
 * 订阅与套餐(/agent/billing)是通用页,不在审批门内。
 */
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Loader2, LogIn, LogOut, UserRound, LayoutDashboard, Radar, Wand2, Zap,
  CreditCard, ArrowRight, ShieldCheck, Briefcase, Lock, ChevronDown,
  Menu, X, ChevronRight, Receipt,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useUserProfile } from '../../contexts/UserProfileContext'
import { useMyRole } from '../../hooks/useMyRole'
import { fetchBillingMe, type BillingMe } from '../../lib/billingApi'
import { badgeForPlan, type RoleBadge } from '../../lib/roleBadge'
import { useScrollChrome } from '../../hooks/useScrollChrome'
import { Sheet, SheetContent } from '../../components/ui/sheet'

// 角色小徽章(与 UserMenu / 角色选择卡同一套颜色/emoji)
const ROLE_CHIP: Record<string, { zh: string; en: string; emoji: string; cls: string }> = {
  buyer: { zh: '买家', en: 'Buyer', emoji: '🏠', cls: 'bg-teal-100 text-teal-700' },
  agent: { zh: '经纪人', en: 'Agent', emoji: '🧑‍💼', cls: 'bg-indigo-100 text-indigo-700' },
  agency: { zh: '经纪公司', en: 'Agency', emoji: '🏢', cls: 'bg-violet-100 text-violet-700' },
  developer: { zh: '开发商', en: 'Developer', emoji: '🏗️', cls: 'bg-amber-100 text-amber-700' },
}

export type ProfileShellContext = { badge: RoleBadge | null; me: BillingMe | null }

type Tab = { to: string; end?: boolean; zh: string; en: string; icon: typeof UserRound }

// 通用组:所有登录用户可见(订阅页自己按套餐渲染,买家看到的是升级选项)
const ACCOUNT_TABS: Tab[] = [
  { to: '/profile', end: true, zh: '个人资料', en: 'Profile', icon: UserRound },
  { to: '/agent/billing', zh: '订阅与套餐', en: 'Billing', icon: CreditCard },
]

// 经纪工作台(经纪专属模块;名字要让人想点开用)
//
// ⚠️ 「线索」(/agent/leads) 暂时下架 (2026-07-12, owner 定)。
//
// 为什么:leads 全部是**匿名访客**,一条联系方式都没有。实测 8 条 lead →
// 有联系方式 0、有名字 0、被认领 0、转化 0。「认领」按钮点下去,经纪拿到的是
// 一个他**永远联系不上**的人 —— 这不是功能不完善,是逻辑上就走不通。
//
// 真正有用的意向信号在别处,而且那里**知道人是谁**:
//   • 实时带看 —— 客户进带看时过身份门(填了称呼/电话/WhatsApp)
//   • Luna 导览 —— 分享链接是经纪发给**特定客户**的,行为自然归属到人
//
// 路由和后端**保留**(数据继续采,owner 直接访问 /agent/leads 仍可看)——
// 只藏导航入口,随时可以放回来。要恢复:把下面这行取消注释。
//   { to: '/agent/leads', zh: '线索', en: 'Leads', icon: Inbox },
const AGENT_TABS: Tab[] = [
  { to: '/agent', end: true, zh: '工作台', en: 'Dashboard', icon: LayoutDashboard },
  { to: '/agent/clients', zh: '客户雷达', en: 'Client radar', icon: Radar },
  { to: '/agent/tour', zh: 'AI 导览', en: 'AI tours', icon: Wand2 },
  { to: '/agent/report', zh: '客户分析报告', en: 'Client fit reports', icon: Zap },
]
// 使用记录:只在付费后显示(有积分消耗才有意义;免费/未订阅不显示)
const USAGE_TAB: Tab = { to: '/agent/usage', zh: '使用记录', en: 'Usage', icon: Receipt }

const AGENT_NAV_OPEN_KEY = 'pz-agent-nav-open'

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

  // 当前是否在经纪工作台的功能页(订阅页除外——它是通用 tab)
  const onAgentWorkspace = location.pathname.startsWith('/agent') && !location.pathname.startsWith('/agent/billing')

  // 经纪工作台展开状态(记住上次选择;进入工作台路由时强制展开)
  const [agentOpen, setAgentOpen] = useState(() => {
    try { return localStorage.getItem(AGENT_NAV_OPEN_KEY) !== '0' } catch { return true }
  })
  useEffect(() => { if (onAgentWorkspace) setAgentOpen(true) }, [onAgentWorkspace])
  const toggleAgentOpen = () => {
    setAgentOpen((v) => {
      try { localStorage.setItem(AGENT_NAV_OPEN_KEY, v ? '0' : '1') } catch { /* noop */ }
      return !v
    })
  }

  // 订阅信息 + 认证勋章(付费订阅推导;买家/无订阅勋章 = null)
  const [me, setMe] = useState<BillingMe | null>(null)
  const [badge, setBadge] = useState<RoleBadge | null>(null)
  useEffect(() => {
    if (!user) { setMe(null); setBadge(null); return }
    let stale = false
    void fetchBillingMe()
      .then((m) => {
        if (stale || !m) return
        setMe(m)
        setBadge(badgeForPlan(m.plan?.id, m.status, m.teamMember))
      })
      .catch(() => { /* 未付费 */ })
    return () => { stale = true }
  }, [user?.email])

  // 手机端板块菜单(汉堡 → 底部 Sheet;换页自动关)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  // 滚动收纳:手机/pad 下滑收顶部导航(app 根不滚动,必须容器驱动)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const { secondaryHidden } = useScrollChrome(scrollRef, !loading)

  const [avatarError, setAvatarError] = useState(false)
  useEffect(() => { setAvatarError(false) }, [user?.user_metadata?.avatar_url])

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
            {L('登录后管理你的资料、收藏与经纪工作台。支持 Google 一键登录或邮箱验证码。',
               'Sign in to manage your profile, favorites and agent workspace.')}
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

  // 使用记录 tab 只在付费(active/trialing)后出现;免费/未订阅不显示。
  const isPaid = !!me && ['active', 'trialing'].includes(me.status)
  const agentTabs: Tab[] = isPaid ? [...AGENT_TABS, USAGE_TAB] : AGENT_TABS

  // 手机端全部可达板块(个人资料 → 工作台各功能(经纪)→ 订阅),
  // 用于顶栏标题识别 + 菜单 Sheet 列表。
  const mobileTabs: Tab[] = [ACCOUNT_TABS[0], ...(isAgent ? agentTabs : []), ACCOUNT_TABS[1]]

  // 当前板块(最长前缀匹配;/agent/billing 优先于 /agent)
  const currentTab = mobileTabs
    .filter((t) => location.pathname === t.to || location.pathname.startsWith(t.to + '/'))
    .sort((a, b) => b.to.length - a.to.length)[0] ?? mobileTabs[0]

  const sheetRowCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium transition ${
      isActive ? 'bg-teal-50 text-teal-700' : 'text-slate-700 active:bg-slate-100'
    }`

  return (
    // 自带滚动容器(Layout 的 <main> 是 overflow-hidden);overflow-y-scroll 常驻
    // 滚动条槽位,切 tab 时内容宽度不跳。
    <div ref={scrollRef} className="flex-1 overflow-y-scroll bg-slate-50">
      {/* 手机/pad:极简顶栏 —— 当前板块名 + 汉堡菜单(点开底部 Sheet 选板块)。
          替代原横滑 pill 排:账户页横滑 tab 不是行业做法,菜单归一更干净。 */}
      <div
        className={`md:hidden sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200/70 bg-slate-50/95 px-4 py-2.5 backdrop-blur transition-transform duration-300 ease-out ${
          secondaryHidden ? '-translate-y-full' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <currentTab.icon className="h-4 w-4 shrink-0 text-teal-600" />
          <span className="truncate text-[15px] font-bold text-slate-900">
            {zh ? currentTab.zh : currentTab.en}
          </span>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 ring-1 ring-slate-200 transition active:scale-95"
        >
          <Menu className="h-4 w-4" />
          {L('菜单', 'Menu')}
        </button>
      </div>

      {/* 板块菜单 Sheet(手机) */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="bottom" className="h-auto max-h-[88vh] rounded-t-2xl md:hidden">
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-slate-300" />
          </div>
          {/* 身份行 + 关闭 */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 pb-4 pt-1">
            {avatarUrl && !avatarError ? (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                onError={() => setAvatarError(true)}
                className="h-10 w-10 rounded-full object-cover ring-2 ring-teal-500/20"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-sm font-semibold text-white">
                {(user.email || 'U').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-900">{displayName}</div>
              <div className="truncate text-xs text-slate-400">{user.email}</div>
            </div>
            <button
              onClick={() => setMenuOpen(false)}
              className="-mr-1 rounded-full p-2 text-slate-400 transition hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4 overflow-y-auto px-3 pb-8 pt-3">
            {/* 账户组 */}
            <div>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {L('账户', 'Account')}
              </div>
              {ACCOUNT_TABS.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end} className={sheetRowCls}>
                  <tab.icon className="h-[18px] w-[18px]" />
                  <span className="flex-1">{zh ? tab.zh : tab.en}</span>
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </NavLink>
              ))}
            </div>

            {/* 经纪工作台组 */}
            <div>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {L('经纪工作台', 'Agent workspace')}
              </div>
              {isAgent ? (
                agentTabs.map((tab) => (
                  <NavLink key={tab.to} to={tab.to} end={tab.end} className={sheetRowCls}>
                    <tab.icon className="h-[18px] w-[18px]" />
                    <span className="flex-1">{zh ? tab.zh : tab.en}</span>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </NavLink>
                ))
              ) : (
                <Link to="/choose-role" className="flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium text-slate-700 transition active:bg-slate-100">
                  <Lock className="h-[18px] w-[18px] text-slate-400" />
                  <span className="flex-1">{L('解锁经纪工作台', 'Unlock agent workspace')}</span>
                  <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[11px] font-bold text-white">
                    {L('去解锁', 'Unlock')}
                  </span>
                </Link>
              )}
            </div>

            {/* 退出登录(显眼,置于菜单底部) */}
            <div className="border-t border-slate-100 pt-2">
              <button
                onClick={() => void signOut()}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-semibold text-red-500 transition active:bg-red-50"
              >
                <LogOut className="h-[18px] w-[18px]" />
                {L('退出登录', 'Sign out')}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="flex gap-6">
          {/* 桌面左侧栏 */}
          <aside className="hidden w-60 shrink-0 md:block">
            <div className="sticky top-6 space-y-4">
              {/* 身份小卡(紧凑;详细信息在「个人资料」hero 里) */}
              <div className="flex items-center gap-2.5 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.06]">
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={() => setAvatarError(true)}
                    className="h-9 w-9 rounded-full object-cover ring-2 ring-teal-500/20"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-sm font-semibold text-white">
                    {(user.email || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{displayName}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {isAdmin && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-100 px-1.5 py-px text-[10px] font-medium text-teal-700">
                        <ShieldCheck className="h-2.5 w-2.5" /> Admin
                      </span>
                    )}
                    {roleChip && (
                      <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-medium ${roleChip.cls}`}>
                        <span aria-hidden>{roleChip.emoji}</span>
                        {zh ? roleChip.zh : roleChip.en}
                      </span>
                    )}
                    {badge && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold text-white"
                        style={{ background: `linear-gradient(90deg, ${badge.from}, ${badge.to})` }}
                      >
                        <span aria-hidden>{badge.emoji}</span>
                        {zh ? badge.titleZh : badge.titleEn}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 通用 tab(所有用户) */}
              <nav className="space-y-0.5">
                {ACCOUNT_TABS.map((tab) => (
                  <NavLink key={tab.to} to={tab.to} end={tab.end} className={navItemCls}>
                    <tab.icon className="h-4 w-4" />
                    {zh ? tab.zh : tab.en}
                  </NavLink>
                ))}
              </nav>

              {/* 经纪工作台:浅色分组卡(与页面协调;左侧青色竖条 + 标签头点明"经纪专属") */}
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
                {isAgent ? (
                  <>
                    <button
                      onClick={toggleAgentOpen}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 ring-1 ring-teal-100">
                        <Briefcase className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-slate-900">{L('经纪工作台', 'Agent workspace')}</span>
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-teal-600">
                          {L('经纪专属', 'Agents only')}
                        </span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${agentOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {agentOpen && (
                      <div className="space-y-0.5 border-t border-slate-100 p-1.5">
                        {agentTabs.map((tab) => (
                          <NavLink key={tab.to} to={tab.to} end={tab.end} className={navItemCls}>
                            <tab.icon className="h-4 w-4" />
                            {zh ? tab.zh : tab.en}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  /* 非经纪:上锁,点击去开通 */
                  <Link to="/choose-role" className="group flex w-full items-center gap-2.5 px-3 py-2.5 transition hover:bg-slate-50">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <Lock className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-slate-900">{L('经纪工作台', 'Agent workspace')}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {L('客户雷达 · AI 导览 · 秒出提案', 'Client radar · AI tours · proposals')}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm transition group-hover:opacity-95">
                      {L('去解锁', 'Unlock')}
                    </span>
                  </Link>
                )}
              </div>

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
            <Outlet context={{ badge, me } satisfies ProfileShellContext} />
          </main>
        </div>
      </div>
    </div>
  )
}
