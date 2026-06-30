import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MapPin, Heart, User, LogIn, Settings, Building2, MapPinned, ClipboardList, Upload, X, LineChart, TrendingUp, Briefcase, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { Sheet, SheetContent } from './ui/sheet'

export default function MobileNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'nav', 'auth'])
  const { user, isAdmin } = useAuth()
  const { profile } = useUserProfile()
  const isAgent = !!profile?.agent
  const [adminSheetOpen, setAdminSheetOpen] = useState(false)
  const [analysisSheetOpen, setAnalysisSheetOpen] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  // Reset avatar error when user changes
  useEffect(() => {
    setAvatarError(false)
  }, [user?.user_metadata?.avatar_url])

  // Admin menu items
  const adminItems = [
    { path: '/admin/analytics', label: t('nav:dataManagement'), icon: BarChart3, description: t('nav:desc.dataManagement') },
    { path: '/developer/upload', label: t('nav:uploadBrochure'), icon: Upload, description: t('nav:desc.uploadBrochure') },
    { path: '/admin/properties', label: t('nav:projectManagement'), icon: Building2, description: t('nav:desc.projectManagement') },
    { path: '/admin/dubai', label: t('nav:dubaiMapEditor'), icon: MapPinned, description: t('nav:desc.dubaiMapEditor') },
    { path: '/admin/tasks', label: t('nav:taskManagement'), icon: ClipboardList, description: t('nav:desc.taskManagement') },
  ]

  // Check if current path is admin-related
  const isAdminActive = location.pathname.startsWith('/admin') || location.pathname.startsWith('/developer')

  // 工具组：成交记录(买家查真实 transaction/rent) + 收藏。区域分析/AI报告/对比零使用已移除
  // (对比/AI报告能力改在经纪台为客户生成)。
  const analysisItems = [
    { path: '/transactions', label: t('nav:transactions'), icon: TrendingUp, description: t('nav:desc.transactions') },
    { path: '/favorites', label: t('nav:favorites'), icon: Heart, description: t('nav:desc.favorites') },
  ]
  const isAnalysisActive = analysisItems.some(i => location.pathname === i.path)

  // Build nav items - 5 items for logged in users, 4 for guests
  const navItems = [
    { path: '/map', label: t('nav:explore'), icon: MapPin },
    { path: 'analysis-menu', label: t('nav:analysis'), icon: LineChart, isAnalysisTrigger: true },
    isAgent
      ? { path: '/agent', label: t('nav:agentHub'), icon: Briefcase }
      : { path: '/agent/join', label: t('nav:becomeAgent'), icon: Briefcase },
    // Admin - only for whitelisted admin accounts
    ...(isAdmin ? [{ path: 'admin-menu', label: t('nav:admin'), icon: Settings, isAdminTrigger: true }] : []),
    // Login/Profile based on auth status
    user
      ? { path: '/profile', label: t('nav:profile'), icon: User }
      : { path: '/login', label: t('auth:login', 'Login'), icon: LogIn },
  ]

  // Grid columns: the admin tab (whitelisted accounts only) is the 5th item;
  // everyone else — guests and non-admin users — has 4.
  const gridCols = isAdmin ? 'grid-cols-5' : 'grid-cols-4'

  const handleNavClick = (item: typeof navItems[0], e: React.MouseEvent) => {
    if ('isAdminTrigger' in item && item.isAdminTrigger) {
      e.preventDefault()
      setAdminSheetOpen(true)
    } else if ('isAnalysisTrigger' in item && item.isAnalysisTrigger) {
      e.preventDefault()
      setAnalysisSheetOpen(true)
    }
  }

  const handleAdminItemClick = (path: string) => {
    setAdminSheetOpen(false)
    navigate(path)
  }

  const handleAnalysisItemClick = (path: string) => {
    setAnalysisSheetOpen(false)
    navigate(path)
  }

  return (
    <>
      <nav className="xl:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-1px_6px_rgba(0,0,0,0.06)]">
        {/* h-16 on mobile, h-20 on tablet for better visibility */}
        <div className={`grid ${gridCols} h-16 md:h-20 px-1 md:px-4`}>
          {navItems.map((item) => {
            const { path, label, icon: Icon } = item
            const isAdminTrigger = 'isAdminTrigger' in item && item.isAdminTrigger
            const isAnalysisTrigger = 'isAnalysisTrigger' in item && item.isAnalysisTrigger
            const isTrigger = isAdminTrigger || isAnalysisTrigger
            const isActive = isAdminTrigger
              ? isAdminActive
              : isAnalysisTrigger
                ? isAnalysisActive
                : (location.pathname === path || (path === '/profile' && location.pathname.startsWith('/profile')))

            if (isTrigger) {
              return (
                <button
                  key={path}
                  onClick={(e) => handleNavClick(item, e)}
                  className="flex flex-col items-center justify-center gap-0.5 md:gap-1 relative"
                >
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 md:w-14 h-0.5 md:h-1 bg-teal-500 rounded-full" />
                  )}
                  <Icon className={`h-5 w-5 md:h-7 md:w-7 transition-colors ${
                    isActive ? 'text-teal-600' : 'text-slate-400'
                  }`} />
                  <span className={`text-[10px] md:text-sm font-medium transition-colors ${
                    isActive ? 'text-teal-600' : 'text-slate-500'
                  }`}>
                    {label}
                  </span>
                </button>
              )
            }

            return (
              <Link
                key={path}
                to={path}
                className="flex flex-col items-center justify-center gap-0.5 md:gap-1 relative"
              >
                {isActive && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-10 md:w-14 h-0.5 md:h-1 bg-teal-500 rounded-full" />
                )}
                {/* Show user avatar if logged in and on profile tab */}
                {path === '/profile' && user?.user_metadata?.avatar_url && !avatarError ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt="avatar"
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    onError={() => setAvatarError(true)}
                    className={`h-5 w-5 md:h-7 md:w-7 rounded-full object-cover ring-2 ${
                      isActive ? 'ring-teal-500' : 'ring-slate-200'
                    }`}
                  />
                ) : (
                  <Icon className={`h-5 w-5 md:h-7 md:w-7 transition-colors ${
                    isActive ? 'text-teal-600' : 'text-slate-400'
                  }`} />
                )}
                <span className={`text-[10px] md:text-sm font-medium transition-colors ${
                  isActive ? 'text-teal-600' : 'text-slate-500'
                }`}>
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Admin Menu Sheet */}
      <Sheet open={adminSheetOpen} onOpenChange={setAdminSheetOpen}>
        <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-2xl">
          {/* Handle bar */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-slate-300 rounded-full" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pb-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">{t('nav:admin')}</h2>
            <button
              onClick={() => setAdminSheetOpen(false)}
              className="p-2 -mr-2 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          {/* Menu Items */}
          <div className="p-4 space-y-2 pb-8">
            {adminItems.map(({ path, label, icon: Icon, description }) => {
              const isActive = location.pathname === path ||
                (path === '/admin/properties' && location.pathname.startsWith('/admin/properties')) ||
                (path === '/developer/upload' && location.pathname.startsWith('/developer'))

              return (
                <button
                  key={path}
                  onClick={() => handleAdminItemClick(path)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${
                    isActive
                      ? 'bg-teal-50 border border-teal-200'
                      : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg ${
                    isActive ? 'bg-teal-500 text-white' : 'bg-white text-slate-600 shadow-sm'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`font-medium ${isActive ? 'text-teal-700' : 'text-slate-800'}`}>
                      {label}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Analysis Menu Sheet */}
      <Sheet open={analysisSheetOpen} onOpenChange={setAnalysisSheetOpen}>
        <SheetContent side="bottom" className="h-auto max-h-[75vh] rounded-t-2xl">
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-slate-300 rounded-full" />
          </div>

          <div className="flex items-center justify-between px-5 pb-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-900">{t('nav:analysis')}</h2>
            <button
              onClick={() => setAnalysisSheetOpen(false)}
              className="p-2 -mr-2 rounded-full hover:bg-slate-100 transition-colors"
            >
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>

          <div className="p-4 space-y-2 pb-8">
            {analysisItems.map(({ path, label, icon: Icon, description }) => {
              const isActive = location.pathname === path
              return (
                <button
                  key={path}
                  onClick={() => handleAnalysisItemClick(path)}
                  className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${
                    isActive
                      ? 'bg-teal-50 border border-teal-200'
                      : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <div className={`p-2.5 rounded-lg ${
                    isActive ? 'bg-teal-500 text-white' : 'bg-white text-slate-600 shadow-sm'
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`font-medium ${isActive ? 'text-teal-700' : 'text-slate-800'}`}>
                      {label}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {description}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
