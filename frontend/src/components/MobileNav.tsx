import { Link, useLocation } from 'react-router-dom'
import { MapPin, Heart, Briefcase } from 'lucide-react'

export default function MobileNav() {
  const location = useLocation()

  const navItems = [
    { path: '/map', label: 'Explore', icon: MapPin },
    { path: '/favorites', label: 'Favorites', icon: Heart },
    { path: '/developer/submit', label: 'Submit', icon: Briefcase },
  ]

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/98 backdrop-blur-xl border-t border-slate-800/50 shadow-2xl shadow-black/20">
      <div className="grid grid-cols-3 h-16 px-2">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location.pathname === path
          
          return (
            <Link
              key={path}
              to={path}
              className="flex flex-col items-center justify-center space-y-1 relative group"
            >
              {/* Active Indicator */}
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-0.5 bg-slate-400 rounded-full"></div>
              )}
              
              {/* Icon Container */}
              <div className={`relative transition-all duration-300 ${
                isActive ? 'scale-100' : 'scale-95 group-hover:scale-100'
              }`}>
                <div className={`relative p-2.5 rounded-xl transition-all duration-300 ${
                  isActive 
                    ? 'bg-slate-800/80 border border-slate-700/70 shadow-lg shadow-black/30' 
                    : 'bg-slate-800/30 border border-slate-800/50 group-hover:bg-slate-800/50'
                }`}>
                  <Icon className={`h-5 w-5 transition-colors duration-300 ${
                    isActive ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-300'
                  }`} />
                </div>
              </div>
              
              {/* Label */}
              <span className={`text-[10px] font-medium tracking-wide transition-colors duration-300 ${
                isActive 
                  ? 'text-slate-300' 
                  : 'text-slate-600 group-hover:text-slate-400'
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
