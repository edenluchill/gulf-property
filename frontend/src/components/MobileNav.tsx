import { Link, useLocation } from 'react-router-dom'
import { MapPin, Heart, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function MobileNav() {
  const location = useLocation()
  const { t, i18n } = useTranslation()

  const toggleLanguage = () => {
    const next = i18n.language?.startsWith('zh') ? 'en' : 'zh-CN'
    i18n.changeLanguage(next)
  }

  const langLabel = i18n.language?.startsWith('zh') ? '中文' : 'EN'

  const navItems = [
    { path: '/map', label: t('nav.explore'), icon: MapPin },
    { path: '/favorites', label: t('nav.favorites'), icon: Heart },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
      <div className="grid grid-cols-3 h-16 px-1">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path

          return (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center justify-center gap-0.5 relative"
            >
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-0.5 bg-amber-500 rounded-full" />
              )}
              <Icon className={`h-5 w-5 transition-colors ${
                isActive ? 'text-amber-600' : 'text-slate-400'
              }`} />
              <span className={`text-[10px] font-medium transition-colors ${
                isActive ? 'text-amber-600' : 'text-slate-500'
              }`}>
                {label}
              </span>
            </Link>
          )
        })}

        {/* Language Toggle */}
        <button
          onClick={toggleLanguage}
          className="flex flex-col items-center justify-center gap-0.5"
        >
          <Globe className="h-5 w-5 text-slate-400" />
          <span className="text-[10px] font-medium text-slate-500">
            {langLabel}
          </span>
        </button>
      </div>
    </nav>
  )
}
