import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Button } from '../components/ui/button'
import { User, LogOut, Heart, Settings, ChevronRight, Mail, Briefcase } from 'lucide-react'

export default function ProfilePage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [avatarError, setAvatarError] = useState(false)

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
    {
      icon: Briefcase,
      label: t('auth:profile.agentPortal', '经纪人工作台'),
      path: '/agent',
    },
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
              onClick={() => navigate(item.path)}
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
