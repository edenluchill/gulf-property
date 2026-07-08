/**
 * ProfileHome — 个人中心「个人资料」tab(ProfileShell 的 index 路由)。
 * 身份 hero + 功能卡片(勋章分享 / 经纪名片 / 收藏 / 订阅 / 切换身份 / 后台)。
 * 勋章数据由 ProfileShell 经 Outlet context 下发,不重复拉 billing/me。
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  User, Mail, Medal, Contact, Heart, CreditCard, ArrowLeftRight,
  BarChart3, ChevronRight, Sparkles, CalendarDays,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { isOwnerEmail } from '../../lib/config'
import { useMyRole } from '../../hooks/useMyRole'
import RoleBadgeDialog from '../../components/RoleBadgeDialog'
import AgentCardEditor from '../../components/AgentCardEditor'
import type { ProfileShellContext } from './ProfileShell'

export default function ProfileHome() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const navigate = useNavigate()
  const { user } = useAuth()
  const role = useMyRole()
  const { badge } = useOutletContext<ProfileShellContext>()

  const [showBadgeDlg, setShowBadgeDlg] = useState(false)
  const [showCardEditor, setShowCardEditor] = useState(false)
  const [avatarError, setAvatarError] = useState(false)
  useEffect(() => { setAvatarError(false) }, [user?.user_metadata?.avatar_url])

  if (!user) return null // ProfileShell 已拦未登录

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.user_metadata?.avatar_url
  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long' })
    : null

  const switchRole = () => {
    try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ }
    window.location.assign('/choose-role')
  }

  /** 统一的功能卡片:图标 + 标题 + 描述 + 右箭头 */
  function ActionCard({ icon, tint, title, desc, onClick, to }: {
    icon: React.ReactNode; tint: string; title: string; desc: string
    onClick?: () => void; to?: string
  }) {
    const inner = (
      <>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>{icon}</div>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{desc}</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
      </>
    )
    const cls = 'group flex w-full items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06] transition hover:shadow-md hover:ring-slate-900/10'
    return to
      ? <Link to={to} className={cls}>{inner}</Link>
      : <button onClick={onClick} className={cls}>{inner}</button>
  }

  return (
    <div className="space-y-4">
      {/* 身份 hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-lg md:p-8">
        {/* 质感光斑 */}
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-teal-500/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex items-center gap-4 md:gap-5">
          {avatarUrl && !avatarError ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              onError={() => setAvatarError(true)}
              className="h-16 w-16 rounded-full ring-4 ring-white/15 md:h-20 md:w-20"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-500 ring-4 ring-white/15 md:h-20 md:w-20">
              <User className="h-8 w-8 text-white md:h-10 md:w-10" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold md:text-2xl">{displayName}</h1>
            <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-300">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{user.email}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {joined && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {L(`${joined} 加入`, `Joined ${joined}`)}
                </span>
              )}
              <span>{L('登录方式', 'Via')}: {user.app_metadata?.provider === 'google' ? 'Google' : (user.app_metadata?.provider || 'Email')}</span>
            </div>
          </div>
          {/* 勋章(有则常显,点开分享) */}
          {badge && (
            <button
              onClick={() => setShowBadgeDlg(true)}
              className="hidden shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg ring-1 ring-white/20 transition active:scale-95 sm:inline-flex"
              style={{ background: `linear-gradient(90deg, ${badge.from}, ${badge.to})` }}
            >
              <span aria-hidden>{badge.emoji}</span>
              {zh ? badge.titleZh : badge.titleEn}
            </button>
          )}
        </div>
      </div>

      {/* 功能卡片 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {badge ? (
          <ActionCard
            icon={<Medal className="h-5 w-5 text-amber-600" />}
            tint="bg-amber-50"
            title={L('我的勋章', 'My badge')}
            desc={L('生成认证勋章分享图,发朋友圈 / WhatsApp', 'Share your certification badge')}
            onClick={() => setShowBadgeDlg(true)}
          />
        ) : (
          <ActionCard
            icon={<Sparkles className="h-5 w-5 text-orange-600" />}
            tint="bg-orange-50"
            title={role === 'buyer' ? L('成为经纪(7 天免费试用)', 'Become an agent (7-day trial)') : L('选择身份与套餐', 'Choose role & plan')}
            desc={L('解锁经纪台:客户管理、AI 导览、品牌提案', 'Unlock CRM, AI tours and branded proposals')}
            onClick={switchRole}
          />
        )}

        {role && role !== 'buyer' && (
          <ActionCard
            icon={<Contact className="h-5 w-5 text-indigo-600" />}
            tint="bg-indigo-50"
            title={L('经纪名片', 'Agent card')}
            desc={L('报价单 / 品牌报告上的落款:姓名、头像、电话', 'Your signature on quotes & branded reports')}
            onClick={() => setShowCardEditor(true)}
          />
        )}

        <ActionCard
          icon={<Heart className="h-5 w-5 text-rose-500" />}
          tint="bg-rose-50"
          title={L('我的收藏', 'Favorites')}
          desc={L('收藏的项目,跨设备同步', 'Saved projects, synced across devices')}
          to="/favorites"
        />

        {badge ? (
          <ActionCard
            icon={<CreditCard className="h-5 w-5 text-emerald-600" />}
            tint="bg-emerald-50"
            title={L('订阅与套餐', 'Subscription & plan')}
            desc={L('管理套餐、发票与付款方式', 'Manage plan, invoices and payment method')}
            to="/agent/billing"
          />
        ) : (
          <ActionCard
            icon={<ArrowLeftRight className="h-5 w-5 text-slate-600" />}
            tint="bg-slate-100"
            title={L('切换身份', 'Switch role')}
            desc={L('买家 / 经纪人 / 经纪公司 / 开发商', 'Buyer / Agent / Agency / Developer')}
            onClick={switchRole}
          />
        )}

        {isOwnerEmail(user.email) && (
          <ActionCard
            icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
            tint="bg-blue-50"
            title={L('数据后台', 'Analytics dashboard')}
            desc={L('客户行为 / 错误监控 / 性能负载', 'Behaviour, errors & performance')}
            onClick={() => navigate('/admin/analytics')}
          />
        )}
      </div>

      {/* 弹窗 */}
      {showBadgeDlg && badge && (
        <RoleBadgeDialog
          badge={badge}
          name={displayName}
          onClose={() => setShowBadgeDlg(false)}
        />
      )}
      {showCardEditor && <AgentCardEditor onClose={() => setShowCardEditor(false)} />}
    </div>
  )
}
