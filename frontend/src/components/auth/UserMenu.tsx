import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LogOut, Settings, ChevronDown, BarChart3 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { isOwnerEmail } from '../../lib/config'

export default function UserMenu() {
  const { t } = useTranslation('auth')
  const { user, isAdmin, signOut } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
            {/* User info section */}
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
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
                <span className="inline-block mt-2 px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-medium rounded-full">
                  Admin
                </span>
              )}
            </div>

            {/* Menu items */}
            <div className="py-1">
              {isOwnerEmail(userEmail) && (
                <Link
                  to="/admin/analytics"
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <BarChart3 className="w-4 h-4 text-slate-400" />
                  {t('profile.dashboard', '数据后台')}
                </Link>
              )}

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
    </div>
  )
}
