import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { isOwnerEmail } from '../lib/config'
import { useMyRole } from '../hooks/useMyRole'
import { fetchBillingMe } from '../lib/billingApi'
import { badgeForPlan, type RoleBadge } from '../lib/roleBadge'
import RoleBadgeDialog from '../components/RoleBadgeDialog'
import { Button } from '../components/ui/button'
import { User, LogOut, Heart, Settings, ChevronRight, Mail, Briefcase, BarChart3 } from 'lucide-react'

export default function ProfilePage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const role = useMyRole()
  const [avatarError, setAvatarError] = useState(false)

  // 买家 → 经纪的升级入口:记角色后去专属选档页(7天试用,付款即开通)
  // 成为经纪/换身份:走正规四角色流程(付款才落身份),不再预写 role
  const becomeAgent = async () => {
    window.location.href = '/choose-role'
  }

  // 身份卡(手机端唯一的角色/勋章入口;桌面头像菜单也有同款)
  const [profBadge, setProfBadge] = useState<RoleBadge | null>(null)
  const [showBadgeDlg, setShowBadgeDlg] = useState(false)
  useEffect(() => {
    let stale = false
    void fetchBillingMe()
      .then((me) => { if (!stale && me) setProfBadge(badgeForPlan(me.plan?.id, me.status)) })
      .catch(() => { /* 未付费 */ })
    return () => { stale = true }
  }, [])
  const ROLE_CHIP: Record<string, { zh: string; emoji: string; cls: string }> = {
    buyer: { zh: '买家', emoji: '🏠', cls: 'bg-teal-100 text-teal-700' },
    agent: { zh: '经纪人', emoji: '🧑\u200d💼', cls: 'bg-indigo-100 text-indigo-700' },
    agency: { zh: '经纪公司', emoji: '🏢', cls: 'bg-violet-100 text-violet-700' },
    developer: { zh: '开发商', emoji: '🏗️', cls: 'bg-amber-100 text-amber-700' },
  }

  // Reset avatar error when user changes
  useEffect(() => {
    setAvatarError(false)
  }, [user?.user_metadata?.avatar_url])

  const handleSignOut = async () => {
    await signOut()
    navigate('/map')
  }

  if (!user) {
    // Redirect to login if not authenticated
    navigate('/login')
    return null
  }

  const menuItems = [
    // Owner-only: customer-behaviour dashboard. Visible only to the owner
    // email(s); more accounts can be added via OWNER_EMAILS / VITE_OWNER_EMAILS.
    ...(isOwnerEmail(user.email)
      ? [{ icon: BarChart3, label: t('auth:profile.dashboard', '数据后台'), path: '/admin/analytics' }]
      : []),
    // 买家看到的是升级入口;经纪/未定角色照旧进工作台
    role === 'buyer'
      ? { icon: Briefcase, label: t('auth:profile.becomeAgent', '成为经纪(7 天免费试用)'), path: 'become-agent' }
      : { icon: Briefcase, label: t('auth:profile.agentPortal', '经纪人工作台'), path: '/agent' },
    {
      icon: Heart,
      label: t('common:nav.favorites'),
      path: '/favorites',
    },
    {
      icon: Settings,
      label: t('auth:profile.settings', 'Settings'),
      path: '/settings',
    },
  ]

  return (
    <div className="flex-1 bg-slate-50 pb-20 md:pb-8 overflow-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-8 md:py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            {user.user_metadata?.avatar_url && !avatarError ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="Avatar"
                referrerPolicy="no-referrer"
                crossOrigin="anonymous"
                onError={() => setAvatarError(true)}
                className="w-16 h-16 md:w-20 md:h-20 rounded-full ring-4 ring-white/20"
              />
            ) : (
              <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-teal-500 flex items-center justify-center ring-4 ring-white/20">
                <User className="h-8 w-8 md:h-10 md:w-10 text-white" />
              </div>
            )}

            {/* User Info */}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl md:text-2xl font-bold truncate">
                {user.user_metadata?.full_name || user.user_metadata?.name || t('auth:profile.user', 'User')}
              </h1>
              <div className="flex items-center gap-1 text-sm text-slate-300 mt-1">
                <Mail className="h-4 w-4" />
                <span className="truncate">{user.email}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-6">
        {/* 身份卡:当前角色 + 勋章/切换入口(手机端没有头像菜单,这里是唯一入口) */}
        <div className="bg-white rounded-xl border p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{t('auth:profile.identity', '我的身份')}</span>
            {role && ROLE_CHIP[role] && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CHIP[role].cls}`}>
                <span aria-hidden>{ROLE_CHIP[role].emoji}</span>
                {ROLE_CHIP[role].zh}
              </span>
            )}
            {profBadge && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                style={{ background: `linear-gradient(90deg, ${profBadge.from}, ${profBadge.to})` }}
              >
                <span aria-hidden>{profBadge.emoji}</span>
                {profBadge.titleZh}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {profBadge ? (
              <>
                <button
                  onClick={() => setShowBadgeDlg(true)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  我的勋章(分享朋友圈)
                </button>
                <button
                  onClick={() => navigate('/agent/billing')}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  订阅与套餐
                </button>
              </>
            ) : (
              <button
                onClick={() => { try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ } window.location.assign('/choose-role') }}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600"
              >
                切换身份
              </button>
            )}
          </div>
        </div>
        {showBadgeDlg && profBadge && (
          <RoleBadgeDialog
            badge={profBadge}
            name={user.user_metadata?.full_name || user.email?.split('@')[0] || 'Pinzos'}
            onClose={() => setShowBadgeDlg(false)}
          />
        )}

        {/* Status Card */}
        <div className="bg-white rounded-xl border p-4 mb-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>{t('auth:profile.loggedIn', 'Logged in')}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {t('auth:profile.provider', 'via')} {user.app_metadata?.provider || 'Email'}
          </p>
        </div>

        {/* Menu Items */}
        <div className="bg-white rounded-xl border overflow-hidden mb-4">
          {menuItems.map((item, idx) => (
            <button
              key={item.path}
              onClick={() => (item.path === 'become-agent' ? void becomeAgent() : navigate(item.path))}
              className={`w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors ${
                idx > 0 ? 'border-t' : ''
              }`}
            >
              <item.icon className="h-5 w-5 text-slate-500" />
              <span className="flex-1 text-slate-700">{item.label}</span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>

        {/* Sign Out */}
        <Button
          variant="outline"
          onClick={handleSignOut}
          className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {t('auth:signOut', 'Sign Out')}
        </Button>
      </div>
    </div>
  )
}
