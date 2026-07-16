import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogOut, Settings, ChevronDown, Medal, ArrowLeftRight, UserRound } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { fetchBillingMe } from '../../lib/billingApi'
import { badgeForPlan, type RoleBadge } from '../../lib/roleBadge'
import RoleBadgeDialog from '../RoleBadgeDialog'
import { useMyRole } from '../../hooks/useMyRole'

// 会员认证证书入口开关。2026-07-14 owner:太正式先撤,恭喜入驻海报取而代之;翻回 true 恢复。
const MEMBERSHIP_CERT_ENABLED = false

// 账户菜单里的角色小徽章(与角色选择卡同一套颜色/emoji)
const ROLE_CHIP: Record<string, { zh: string; en: string; emoji: string; cls: string }> = {
  buyer: { zh: '买家', en: 'Buyer', emoji: '🏠', cls: 'bg-teal-100 text-teal-700' },
  agent: { zh: '经纪人', en: 'Agent', emoji: '🧑\u200d💼', cls: 'bg-indigo-100 text-indigo-700' },
  agency: { zh: '经纪公司', en: 'Agency', emoji: '🏢', cls: 'bg-violet-100 text-violet-700' },
  developer: { zh: '开发商', en: 'Developer', emoji: '🏗️', cls: 'bg-amber-100 text-amber-700' },
}

export default function UserMenu() {
  const { t, i18n } = useTranslation(['auth', 'misc'])
  const zh = !!i18n.language?.startsWith('zh')
  const { user, isAdmin, signOut } = useAuth()
  const role = useMyRole()
  const roleChip = role ? ROLE_CHIP[role] : null
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 「切换身份」:清角色缓存 → 去选择身份页(/choose-role)
  const switchRole = () => {
    setIsOpen(false)
    try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ }
    window.location.assign('/choose-role')
  }

  // 认证勋章:按生效订阅推导(买家/无订阅 = null)。登录后拉一次。
  const [badge, setBadge] = useState<RoleBadge | null>(null)
  const [showBadge, setShowBadge] = useState(false)
  useEffect(() => {
    if (!user) { setBadge(null); return }
    let stale = false
    void fetchBillingMe()
      .then((me) => { if (!stale && me) setBadge(badgeForPlan(me.plan?.id, me.status, me.teamMember)) })
      .catch(() => { /* 匿名/失败 → 无勋章 */ })
    return () => { stale = true }
  }, [user?.email])

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!user) return null

  const userEmail = user.email || ''
  const userInitial = userEmail.charAt(0).toUpperCase()
  const avatarUrl = user.user_metadata?.avatar_url
  const [avatarError, setAvatarError] = useState(false)

  // Reset avatar error state when avatarUrl changes
  useEffect(() => {
    setAvatarError(false)
  }, [avatarUrl])

  const handleAvatarError = useCallback(() => {
    setAvatarError(true)
  }, [])

  const handleSignOut = async () => {
    setIsOpen(false)
    await signOut()
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-100/80 transition-colors"
      >
        {avatarUrl && !avatarError ? (
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            className="w-8 h-8 rounded-full object-cover border-2 border-teal-500/20"
            onError={handleAvatarError}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white font-medium text-sm">
            {userInitial}
          </div>
        )}
        <ChevronDown
          className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden z-[1001]"
          >
            {/* User info section — 整块可点,进个人中心 */}
            <Link
              to="/profile"
              onClick={() => setIsOpen(false)}
              className="block px-4 py-3 bg-slate-50 border-b border-slate-100 hover:bg-slate-100/80 transition-colors"
            >
              <div className="flex items-center gap-3">
                {avatarUrl && !avatarError ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    className="w-10 h-10 rounded-full object-cover border-2 border-teal-500/20"
                    onError={handleAvatarError}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 flex items-center justify-center text-white font-semibold">
                    {userInitial}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {user.user_metadata?.full_name || userEmail.split('@')[0]}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{userEmail}</p>
                </div>
              </div>
              {isAdmin && (
                <span className="inline-block mt-2 me-1.5 px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">
                  Admin
                </span>
              )}
              {/* 当前角色徽章(买家/经纪人/经纪公司/开发商) */}
              {roleChip && (
                <span className={`inline-flex items-center gap-1 mt-2 me-1.5 px-2 py-0.5 text-xs font-medium rounded-full ${roleChip.cls}`}>
                  <span aria-hidden>{roleChip.emoji}</span>
                  {zh ? roleChip.zh : roleChip.en}
                </span>
              )}
              {/* 认证勋章:随整块进个人中心;分享图入口在下面「我的勋章」菜单项 */}
              {badge && (
                <span
                  className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow-sm"
                  style={{ background: `linear-gradient(90deg, ${badge.from}, ${badge.to})` }}
                >
                  <span aria-hidden>{badge.emoji}</span>
                  {zh ? badge.titleZh : badge.titleEn}
                </span>
              )}
            </Link>

            {/* Menu items */}
            <div className="py-1">
              <Link
                to="/profile"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <UserRound className="w-4 h-4 text-slate-400" />
                {t('misc:myProfile')}
              </Link>
              {/* 未付费:可自由切换身份;已付费:身份由订阅决定 → 引导去订阅页调整 */}
              {badge ? (
                <a
                  href="/agent/billing"
                  onClick={() => setIsOpen(false)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4 text-slate-400" />
                  {t('misc:subscriptionPlan')}
                </a>
              ) : (
                <button
                  onClick={switchRole}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <ArrowLeftRight className="w-4 h-4 text-slate-400" />
                  {t('misc:switchRole')}
                </button>
              )}
              {MEMBERSHIP_CERT_ENABLED && badge && (
                <button
                  onClick={() => { setShowBadge(true); setIsOpen(false) }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Medal className="w-4 h-4 text-amber-500" />
                  {t('misc:myMembershipCardShare')}
                </button>
              )}
              {/* 数据管理 / analytics moved into the header Admin dropdown — see Header.tsx */}
              {isAdmin && (
                <Link
                  to="/admin/properties"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Settings className="w-4 h-4 text-slate-400" />
                  {t('adminPanel', 'Admin Panel')}
                </Link>
              )}

              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {t('logout')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 勋章分享弹窗:必须 portal 到 body —— Header 有 backdrop-filter,会成为
          后代 fixed 元素的定位参照系,导致对话框被压进 Header 高度里(只剩顶部一条)。 */}
      {showBadge && badge && createPortal(
        <RoleBadgeDialog
          badge={badge}
          name={user.user_metadata?.full_name || userEmail.split('@')[0]}
          onClose={() => setShowBadge(false)}
        />,
        document.body
      )}
    </div>
  )
}
