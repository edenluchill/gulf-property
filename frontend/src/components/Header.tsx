import { Link, useLocation } from 'react-router-dom'
import { Building2, MapPin, Heart, Briefcase, Settings } from 'lucide-react'
import { Button } from './ui/button'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'

export default function Header() {
  const location = useLocation()
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  const { t } = useTranslation()

  const navItems = [
    { path: '/map', label: t('nav.mapExplore'), icon: MapPin },
    { path: '/favorites', label: t('nav.favorites'), icon: Heart },
    { path: '/developer/upload', label: t('nav.forDevelopers'), icon: Briefcase },
  ]

  const adminItems = [
    { path: '/admin/properties', label: t('nav.projectManagement'), icon: Building2 },
    { path: '/admin/dubai', label: t('nav.dubaiMapEditor'), icon: MapPin },
  ]

  const isAdminPage = location.pathname.startsWith('/admin')

  return (
    <header
      className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-[1000] shadow-sm relative"
    >
      <div className="container mx-auto px-4 py-4 relative">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 group relative z-10">
            <motion.div
              className="relative"
              whileHover={{ scale: 1.05 }}
              transition={{ duration: 0.3 }}
            >
              <motion.div
                className="relative bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 p-2.5 rounded-xl shadow-md"
                whileHover={{
                  boxShadow: "0 8px 20px rgba(251, 191, 36, 0.25)",
                }}
              >
                <Building2 className="h-6 w-6 text-white" />
              </motion.div>
            </motion.div>

            <div className="flex flex-col">
              <motion.span
                className="text-xl font-bold tracking-tight text-slate-900"
                whileHover={{ scale: 1.02 }}
              >
                {t('brand')}
              </motion.span>
              <span className="text-[11px] text-amber-600 font-medium tracking-tight -mt-0.5">
                {t('tagline')}
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-2">
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
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25 backdrop-blur-sm'
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

            {/* Admin Dropdown */}
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
                {adminItems.map(({ path, label, icon: Icon }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`flex items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl transition-colors ${
                      location.pathname === path ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </Link>
                ))}
              </div>
            </div>
            <LanguageSwitcher />
          </nav>
        </div>
      </div>
    </header>
  )
}
