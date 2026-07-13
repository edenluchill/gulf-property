import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { MapPin, Heart, User, LogIn, Settings, Building2, MapPinned, ClipboardList, Upload, X, TrendingUp, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { Sheet, SheetContent } from './ui/sheet'

/**
 * 手机底部导航(xl 以下)。2026-07-09 改版:
 *  - 去掉底栏「经纪台」入口 —— 经纪工作台统一走「我的」→ 个人中心(ProfileShell 内有工作台各 tab)。
 *  - 收藏提为一级 tab(放中间,用户要求),不再埋在「分析」Sheet。
 *  - 「分析」Sheet 拆掉:成交记录直接成一级 tab;区域分析/AI报告早已移除。
 * 底栏 = 探索 · 收藏 · 成交 · [管理(仅 admin/uploader)] · 我的/登录。
 */
export default function MobileNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useTranslation(['common', 'nav', 'auth'])
  const { user, loading, isAdmin, canUpload } = useAuth()
  const [adminSheetOpen, setAdminSheetOpen] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  // Reset avatar error when user changes
  useEffect(() => {
    setAvatarError(false)
  }, [user?.user_metadata?.avatar_url])

  // Admin menu items(与 Header 同规则:uploader 只看到上传三项,数据管理/地图编辑 admin-only)
  const adminItems = [
    ...(isAdmin ? [{ path: '/admin/analytics', label: t('nav:dataManagement'), icon: BarChart3, description: t('nav:desc.dataManagement') }] : []),
    { path: '/developer/upload', label: t('nav:uploadBrochure'), icon: Upload, description: t('nav:desc.uploadBrochure') },
    { path: '/admin/properties', label: t('nav:projectManagement'), icon: Building2, description: t('nav:desc.projectManagement') },
    ...(isAdmin ? [{ path: '/admin/dubai', label: t('nav:dubaiMapEditor'), icon: MapPinned, description: t('nav:desc.dubaiMapEditor') }] : []),
    { path: '/admin/tasks', label: t('nav:taskManagement'), icon: ClipboardList, description: t('nav:desc.taskManagement') },
  ]

  const isAdminActive = location.pathname.startsWith('/admin') || location.pathname.startsWith('/developer')

  // 底栏 tab:探索 · 收藏 · 成交 · [管理] · 我的/登录
  const navItems = [
    { path: '/map', label: t('nav:explore'), icon: MapPin },
    { path: '/favorites', label: t('nav:favorites'), icon: Heart },
    { path: '/transactions', label: t('nav:transactions'), icon: TrendingUp },
    // 管理 - 仅白名单 admin / uploader
    ...((isAdmin || canUpload === true) ? [{ path: 'admin-menu', label: t('nav:admin'), icon: Settings, isAdminTrigger: true }] : []),
    // 登录态还没确定时给占位,别默认画成「登录」—— 那等于在还不知道你是谁的时候就
    // 断言"你没登录",已登录的人会看到「我的」被「登录」闪掉一下。
    loading
      ? { path: 'auth-loading', label: '', icon: User, isAuthLoading: true }
      : user
        ? { path: '/profile', label: t('nav:profile'), icon: User }
        : { path: '/login', label: t('auth:login', 'Login'), icon: LogIn },
  ]

  const gridCols = ({ 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' } as Record<number, string>)[navItems.length] || 'grid-cols-4'

  const handleNavClick = (item: typeof navItems[0], e: React.MouseEvent) => {
    if ('isAdminTrigger' in item && item.isAdminTrigger) {
      e.preventDefault()
      setAdminSheetOpen(true)
    }
  }

  const handleAdminItemClick = (path: string) => {
    setAdminSheetOpen(false)
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
            const isActive = isAdminTrigger
              ? isAdminActive
              : (location.pathname === path ||
                 (path === '/profile' && location.pathname.startsWith('/profile')))

            // 登录态未定 —— 占住这一格(保持 grid 列数不变,底栏不会跳),画个骨架
            if ('isAuthLoading' in item && item.isAuthLoading) {
              return (
                <div
                  key={path}
                  aria-busy="true"
                  className="flex flex-col items-center justify-center gap-1 md:gap-1.5"
                >
                  <div className="h-5 w-5 md:h-7 md:w-7 animate-pulse rounded-full bg-slate-200" />
                  <div className="h-2 w-7 md:h-3 md:w-10 animate-pulse rounded bg-slate-200" />
                </div>
              )
            }

            if (isAdminTrigger) {
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
    </>
  )
}
