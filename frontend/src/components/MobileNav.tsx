import { Link, useLocation } from 'react-router-dom'
import { MapPin, Heart, GitCompare, User, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'

export default function MobileNav() {
  const location = useLocation()
  const { t } = useTranslation()
  const { user } = useAuth()

  const navItems = [
    { path: '/map', label: t('nav.explore'), icon: MapPin },
    { path: '/favorites', label: t('nav.favorites'), icon: Heart },
    { path: '/compare', label: t('nav.compare', 'Compare'), icon: GitCompare },
    // Login/Profile based on auth status
    user
      ? { path: '/profile', label: t('nav.profile', 'Me'), icon: User }
      : { path: '/login', label: t('auth:login', 'Login'), icon: LogIn },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
      <div className="grid grid-cols-4 h-16 px-1">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path ||
            (path === '/profile' && location.pathname.startsWith('/profile'))

          return (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center justify-center gap-0.5 relative"
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-teal-500 rounded-full" />
              )}
              {/* Show user avatar if logged in and on profile tab */}
              {path === '/profile' && user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="avatar"
                  className={`h-5 w-5 rounded-full object-cover ring-2 ${
                    isActive ? 'ring-teal-500' : 'ring-slate-200'
                  }`}
                />
              ) : (
                <Icon className={`h-5 w-5 transition-colors ${
                  isActive ? 'text-teal-600' : 'text-slate-400'
                }`} />
              )}
              <span className={`text-[10px] font-medium transition-colors ${
                isActive ? 'text-teal-600' : 'text-slate-500'
              }`}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
