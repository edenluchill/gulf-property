import { Link, useLocation } from 'react-router-dom'
import { Building2, MapPin, Settings, LogIn, GitCompare, Globe, ClipboardList, HelpCircle, Upload, MapPinned } from 'lucide-react'
import { Button } from './ui/button'
import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'
import { useAuth } from '../contexts/AuthContext'
import UserMenu from './auth/UserMenu'
import { FavoritesButton } from './favorites'
import AboutSheet from './AboutSheet'

export default function Header() {
  const location = useLocation()
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const { t, i18n } = useTranslation()
  const { user, loading } = useAuth()

  // About sheet state
  const [aboutOpen, setAboutOpen] = useState(false)

  // Mobile scroll-to-hide state
  const [mobileHidden, setMobileHidden] = useState(false)
  const lastScrollY = useRef(0)
  const ticking = useRef(false)

  useEffect(() => {
    const handleScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          const scrollDelta = currentScrollY - lastScrollY.current

          // Only trigger on significant scroll (> 5px)
          if (Math.abs(scrollDelta) > 5) {
            // Hide when scrolling down, show when scrolling up
            // Also always show when near top (< 50px)
            if (currentScrollY < 50) {
              setMobileHidden(false)
            } else if (scrollDelta > 0) {
              setMobileHidden(true)  // Scrolling down
            } else {
              setMobileHidden(false) // Scrolling up
            }
          }

          lastScrollY.current = currentScrollY
          ticking.current = false
        })
        ticking.current = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Mobile language toggle
  const toggleLanguage = () => {
    const next = i18n.language?.startsWith('zh') ? 'en' : 'zh-CN'
    i18n.changeLanguage(next)
  }
  const langLabel = i18n.language?.startsWith('zh') ? '中' : 'EN'

  // Base nav items visible to all users
  const navItems = [
    { path: '/', label: t('nav.mapExplore'), icon: MapPin },
    { path: '/compare', label: t('nav.compare', 'Compare'), icon: GitCompare },
  ]

  // Admin items - includes upload brochure
  const adminItems = [
    { path: '/developer/upload', label: t('nav.uploadBrochure', '上传楼书'), icon: Upload },
    { path: '/admin/properties', label: t('nav.projectManagement'), icon: Building2 },
    { path: '/admin/dubai', label: t('nav.dubaiMapEditor'), icon: MapPinned },
    { path: '/admin/tasks', label: t('nav.taskManagement', 'Task Management'), icon: ClipboardList },
  ]

  const isAdminPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/developer')

  return (
    <header
      className={`bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-[1000] shadow-sm relative transition-transform duration-300 ease-out ${
        mobileHidden ? '-translate-y-full xl:translate-y-0' : 'translate-y-0'
      }`}
    >
      {/* Mobile/Tablet: py-2 (compact), Desktop: py-4 */}
      <div className="container mx-auto px-4 py-2 xl:py-4 relative">
        <div className="flex items-center justify-between">
          {/* Logo - Compact on mobile/tablet */}
          <Link to="/" className="flex items-center space-x-2 xl:space-x-3 group relative z-10">
            <motion.div
              className="relative"
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="relative bg-gradient-to-br from-teal-500 via-teal-600 to-teal-700 p-1.5 xl:p-2.5 rounded-lg xl:rounded-xl shadow-md"
                whileHover={{
                  boxShadow: "0 8px 20px rgba(20, 184, 166, 0.25)",
                }}
              >
                <Building2 className="h-5 w-5 xl:h-6 xl:w-6 text-white" />
              </motion.div>
            </motion.div>

            <div className="flex flex-col">
              <motion.span
                className="text-lg xl:text-xl font-bold tracking-tight text-slate-900"
                whileHover={{ scale: 1.02 }}
              >
                {t('brand')}
              </motion.span>
              {/* Subtitle with info icon - visible on all screens */}
              <div className="flex items-center gap-1 -mt-0.5">
                <span className="text-[9px] xl:text-[11px] text-teal-600 font-medium tracking-tight">
                  {t('tagline')}
                </span>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setAboutOpen(true)
                  }}
                  className="flex items-center justify-center w-3.5 h-3.5 xl:w-4 xl:h-4 rounded-full bg-teal-100 hover:bg-teal-200 transition-colors"
                  aria-label="Learn more"
                >
                  <HelpCircle className="h-2.5 w-2.5 xl:h-3 xl:w-3 text-teal-600" />
                </button>
              </div>
            </div>
          </Link>

          {/* Mobile/Tablet Language Toggle */}
          <button
            onClick={toggleLanguage}
            className="xl:hidden flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 transition-colors"
          >
            <Globe className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-600">{langLabel}</span>
          </button>

          {/* Desktop Navigation */}
          <nav className="hidden xl:flex items-center space-x-2">
            {navItems.map(({ path, label, icon: Icon }, index) => (
              <motion.div
                key={path}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.1, duration: 0.4 }}
              >
                <Link
                  to={path}
                  onMouseEnter={() => setHoveredNav(path)}
                  onMouseLeave={() => setHoveredNav(null)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden ${
                    location.pathname === path
                      ? 'bg-gradient-to-r from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25 backdrop-blur-sm'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 backdrop-blur-sm'
                  }`}
                >
                  <motion.div
                    animate={{ rotate: hoveredNav === path ? 360 : 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Icon className="h-4 w-4" />
                  </motion.div>
                  <span>{label}</span>
                </Link>
              </motion.div>
            ))}

            {/* Admin Dropdown - Only show if logged in */}
            {user && (
              <div className="relative group">
                <Button
                  variant="ghost"
                  className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isAdminPage
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/80'
                  }`}
                >
                  <Settings className="h-4 w-4" />
                  <span>{t('nav.admin')}</span>
                </Button>

                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[1001]">
                  {adminItems.map(({ path, label, icon: Icon }) => {
                    const isItemActive = location.pathname === path ||
                      (path === '/developer/upload' && location.pathname.startsWith('/developer')) ||
                      (path === '/admin/properties' && location.pathname.startsWith('/admin/properties'))
                    return (
                      <Link
                        key={path}
                        to={path}
                        className={`flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl transition-colors ${
                          isItemActive ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{label}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Favorites Button */}
            <FavoritesButton />

            <LanguageSwitcher />

            {/* Auth Section */}
            {!loading && (
              user ? (
                <UserMenu />
              ) : (
                <Link to="/login">
                  <Button className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white rounded-xl text-sm font-medium transition-all shadow-md">
                    <LogIn className="h-4 w-4" />
                    <span>{t('auth:login', 'Sign In')}</span>
                  </Button>
                </Link>
              )
            )}
          </nav>

        </div>
      </div>

      {/* About Sheet */}
      <AboutSheet open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  )
}
