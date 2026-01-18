import { Link, useLocation } from 'react-router-dom'
import { Building2, Menu, MapPin, Heart, Briefcase, Settings } from 'lucide-react'
import { Button } from './ui/button'
import { useState } from 'react'
import { motion } from 'framer-motion'

export default function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)

  const navItems = [
    { path: '/map', label: 'Map Explore', icon: MapPin },
    { path: '/favorites', label: 'Favorites', icon: Heart },
    { path: '/developer/upload', label: 'For Developers', icon: Briefcase },
  ]

  const adminItems = [
    { path: '/admin/dubai', label: 'Dubai Map Editor' },
  ]

  const isAdminPage = location.pathname.startsWith('/admin')

  return (
    <header
      className="bg-white/80 backdrop-blur-xl border-b border-slate-200/60 sticky top-0 z-40 shadow-sm relative"
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
                Nextway
              </motion.span>
              <span className="text-[11px] text-amber-600 font-medium tracking-tight -mt-0.5">
                A New Way to Buy Off-Plan in Dubai
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
                <span>Admin</span>
              </Button>
              
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                {adminItems.map(({ path, label }) => (
                  <Link
                    key={path}
                    to={path}
                    className={`block px-4 py-2 text-sm hover:bg-slate-50 first:rounded-t-xl last:rounded-b-xl transition-colors ${
                      location.pathname === path ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
          >
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 rounded-xl backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <motion.div
                animate={{ rotate: mobileMenuOpen ? 90 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <Menu className="h-6 w-6" />
              </motion.div>
            </Button>
          </motion.div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <motion.nav
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden mt-4 pb-2 space-y-1 border-t border-slate-200/60 pt-4"
          >
            {navItems.map(({ path, label, icon: Icon }, index) => (
              <motion.div
                key={path}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Link
                  to={path}
                  className={`flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                    location.pathname === path
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25 backdrop-blur-sm'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/80 backdrop-blur-sm'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                </Link>
              </motion.div>
            ))}
            
            {/* Admin Section */}
            <div className="pt-2 mt-2 border-t border-slate-200/60">
              <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Admin
              </div>
              {adminItems.map(({ path, label }, index) => (
                <motion.div
                  key={path}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: (navItems.length + index) * 0.1 }}
                >
                  <Link
                    to={path}
                    className={`flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                      location.pathname === path
                        ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                        : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100/80'
                    }`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Settings className="h-5 w-5" />
                    <span>{label}</span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.nav>
        )}
      </div>
    </header>
  )
}
