import { Link, useLocation } from 'react-router-dom'
import { Building2, Menu, MapPin, Heart, Briefcase } from 'lucide-react'
import { Button } from './ui/button'
import { useState } from 'react'
import { motion } from 'framer-motion'

export default function Header() {
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)

  const navItems = [
    { path: '/map', label: 'Map Explore', icon: MapPin },
    { path: '/map2', label: 'Map 2', icon: MapPin },
    { path: '/favorites', label: 'Favorites', icon: Heart },
    { path: '/developer/upload', label: 'For Developers', icon: Briefcase },
  ]

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 backdrop-blur-xl border-b border-slate-700/50 sticky top-0 z-40 shadow-xl shadow-black/20 relative overflow-hidden"
    >
      {/* Animated Background Shine */}
      <motion.div
        className="absolute inset-0 opacity-20"
        animate={{
          backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "linear"
        }}
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(251, 191, 36, 0.1) 25%, rgba(251, 191, 36, 0.3) 50%, rgba(251, 191, 36, 0.1) 75%, transparent 100%)',
          backgroundSize: '200% 100%',
        }}
      />

      <div className="container mx-auto px-4 py-4 relative">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-3 group relative z-10">
            <motion.div
              className="relative"
              whileHover={{ scale: 1.05, rotate: [0, -5, 5, 0] }}
              transition={{ duration: 0.5 }}
            >
              {/* Pulsing Glow */}
              <motion.div
                className="absolute inset-0 bg-amber-500/30 rounded-lg blur-xl"
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.3, 0.6, 0.3],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
              
              <motion.div
                className="relative bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 p-2.5 rounded-lg shadow-lg shadow-amber-900/50"
                whileHover={{
                  boxShadow: "0 0 30px rgba(251, 191, 36, 0.6)",
                }}
              >
                <Building2 className="h-6 w-6 text-white" />
              </motion.div>
            </motion.div>
            
            <div className="flex flex-col">
              <motion.span
                className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-200 bg-clip-text text-transparent"
                whileHover={{ scale: 1.02 }}
              >
                Gulf Property
              </motion.span>
              <motion.span
                className="text-[10px] text-amber-500/90 font-semibold tracking-[0.2em] uppercase -mt-0.5"
                animate={{
                  opacity: [0.7, 1, 0.7],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              >
                Dubai Off-Plan
              </motion.span>
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
                  className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-medium tracking-wide transition-all duration-300 relative overflow-hidden ${
                    location.pathname === path
                      ? 'bg-amber-600/90 text-white shadow-lg shadow-amber-900/50 border border-amber-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border border-slate-700/30 hover:border-slate-600/50'
                  }`}
                >
                  {/* Hover Shine Effect */}
                  {location.pathname !== path && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
                      initial={{ x: '-100%' }}
                      animate={{ x: hoveredNav === path ? '100%' : '-100%' }}
                      transition={{ duration: 0.6 }}
                    />
                  )}
                  
                  <motion.div
                    animate={{ rotate: hoveredNav === path ? 360 : 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Icon className="h-4 w-4" />
                  </motion.div>
                  <span>{label}</span>
                  
                  {/* Active Indicator Pulse */}
                  {location.pathname === path && (
                    <motion.div
                      className="absolute inset-0 bg-amber-400/20 rounded-lg"
                      animate={{
                        opacity: [0, 0.5, 0],
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                  )}
                </Link>
              </motion.div>
            ))}
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
              className="md:hidden text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-lg border border-slate-700/30"
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
            className="md:hidden mt-4 pb-2 space-y-1 border-t border-slate-700/50 pt-4"
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
                  className={`flex items-center space-x-3 px-4 py-3 text-sm font-medium rounded-lg transition-all ${
                    location.pathname === path
                      ? 'bg-amber-600/90 text-white shadow-md shadow-amber-900/30 border border-amber-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60 border border-slate-700/30'
                  }`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                </Link>
              </motion.div>
            ))}
          </motion.nav>
        )}
      </div>
    </motion.header>
  )
}
