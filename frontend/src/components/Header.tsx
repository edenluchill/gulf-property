import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, MapPin, Settings, LogIn, GitCompare, Globe, ClipboardList, HelpCircle, Upload, MapPinned, TrendingUp, Briefcase, LineChart, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'
import { useAuth } from '../contexts/AuthContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import UserMenu from './auth/UserMenu'
import { FavoritesButton } from './favorites'
import AboutSheet from './AboutSheet'

// 精致浅色主题：与亮色 app 统一。质感来自克制 + 真实层级，不是发光特效
const theme = {
  dark: false,
  // 近白微磨砂 + 冷灰 hairline + 极淡柔影(悬浮感，非发光) + 顶部内高光
  header: 'bg-[#FBFCFE]/82 supports-[backdrop-filter]:bg-[#FBFCFE]/66 border-slate-900/[0.07] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.85),0_1px_2px_0_rgba(15,23,42,0.04),0_10px_28px_-18px_rgba(15,23,42,0.18)]',
  idleText: 'text-slate-500 hover:text-slate-900',
  logoText: 'text-slate-900',
  tagline: 'text-slate-500',
  divider: 'bg-slate-200',
  primaryGrad: 'from-teal-500 to-emerald-500 shadow-teal-500/20',
  accentGrad: 'from-amber-500 to-orange-500 shadow-amber-500/20',
  panel: 'border-slate-200/80 bg-white/95 text-slate-700'
}

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation(['common', 'nav', 'auth'])
  const { user, loading } = useAuth()
  const { profile } = useUserProfile()
  const isAgent = !!profile?.agent

  // About sheet state
  const [aboutOpen, setAboutOpen] = useState(false)

  // Dropdown menu (分析 / 管理)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!openMenu) return
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [openMenu])
  // 路由变化时关闭下拉
  useEffect(() => { setOpenMenu(null) }, [location.pathname])

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

  // 分组导航：地图(主) · 分析(下拉) · 经纪人 · 管理(下拉)
  const analysisItems = [
    { path: '/transactions', label: t('nav:transactions'), icon: TrendingUp, desc: t('nav:desc.transactions') },
    { path: '/areas', label: t('nav:areaInsights'), icon: MapPinned, desc: t('nav:desc.areaInsights') },
    { path: '/report', label: t('nav:buyingReport'), icon: ClipboardList, desc: t('nav:desc.buyingReport') },
    { path: '/compare', label: t('nav:compare'), icon: GitCompare, desc: t('nav:desc.compare') },
  ]

  const adminItems = [
    { path: '/developer/upload', label: t('nav:uploadBrochure'), icon: Upload, desc: '' },
    { path: '/admin/properties', label: t('nav:projectManagement'), icon: Building2, desc: '' },
    { path: '/admin/dubai', label: t('nav:dubaiMapEditor'), icon: MapPinned, desc: '' },
    { path: '/admin/tasks', label: t('nav:taskManagement'), icon: ClipboardList, desc: '' },
  ]

  const isAdminPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/developer')
  const isAnalysisActive = analysisItems.some(i => location.pathname === i.path)
  const isMapActive = location.pathname === '/' || location.pathname === '/map'
  const isAgentActive = location.pathname.startsWith('/agent')

  return (
    <header
      className={`${theme.header} backdrop-blur-xl backdrop-saturate-150 border-b sticky top-0 z-[1000] relative transition-transform duration-300 ease-out ${
        mobileHidden ? '-translate-y-full xl:translate-y-0' : 'translate-y-0'
      }`}
    >
      {/* 浅色质感层：极淡顶部高光 + 渐隐冷灰 hairline（克制，不发光） */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-x-0 top-0 h-2/3"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.65), transparent)' }}
        />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-900/[0.08] to-transparent" />
      </div>

      {/* Mobile/Tablet: py-2 (compact), Desktop: py-4 */}
      <div className="container mx-auto px-4 py-2 xl:py-4 relative z-10">
        <div className="flex items-center justify-between">
          {/* Logo - Compact on mobile/tablet */}
          <Link to="/" className="flex items-center space-x-2 xl:space-x-3 group relative z-10">
            {/* 定制 mark：地图 Pin（呼应 "Pin"zos / 选址）内嵌上升数据柱（AI 分析 / 资本增值），
                最高柱金色 = 迪拜贵气 + 峰值收益。裸 mark，无通用圆角方块 */}
            <motion.div
              className="relative"
              whileHover={{ scale: 1.06, rotate: -3 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            >
              <svg
                viewBox="0 0 32 42"
                className="h-8 w-8 xl:h-9 xl:w-9"
                style={{ filter: 'drop-shadow(0 3px 6px rgba(13,148,136,0.28))' }}
                aria-hidden
              >
                <defs>
                  <linearGradient id="pinzosPin" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" />
                    <stop offset="55%" stopColor="#0d9488" />
                    <stop offset="100%" stopColor="#0f766e" />
                  </linearGradient>
                </defs>
                <path
                  d="M16 1 C7.7 1 1 7.7 1 16 C1 26 16 41 16 41 C16 41 31 26 31 16 C31 7.7 24.3 1 16 1 Z"
                  fill="url(#pinzosPin)"
                />
                {/* 上升数据柱 */}
                <rect x="8.4" y="15.5" width="3.4" height="6.7" rx="1.1" fill="#ffffff" fillOpacity="0.9" />
                <rect x="13.9" y="12" width="3.4" height="10.2" rx="1.1" fill="#ffffff" fillOpacity="0.9" />
                <rect x="19.4" y="8.4" width="3.4" height="13.8" rx="1.1" fill="#fbbf24" />
              </svg>
            </motion.div>

            <div className="flex flex-col">
              <motion.span
                className={`text-xl xl:text-2xl leading-none transition-colors ${theme.logoText}`}
                style={{
                  fontFamily: '"Fraunces", Georgia, serif',
                  fontOpticalSizing: 'auto',
                  fontWeight: 600,
                  letterSpacing: '-0.015em'
                }}
                whileHover={{ scale: 1.02 }}
              >
                {t('brand')}
              </motion.span>
              {/* Subtitle with info icon - visible on all screens */}
              <div className="flex items-center gap-1 -mt-0.5">
                <span className={`text-[9px] xl:text-[11px] font-medium tracking-tight transition-colors ${theme.tagline}`}>
                  {t('tagline')}
                </span>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigate('/about')
                  }}
                  className="flex items-center justify-center w-3.5 h-3.5 xl:w-4 xl:h-4 rounded-full bg-teal-100 hover:bg-teal-200 transition-colors"
                  aria-label={t('nav:learnMore')}
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

          {/* Desktop Navigation — 分组 + 流畅动效 */}
          <nav ref={navRef} className="hidden xl:flex items-center gap-1.5">
            {/* 地图探索（主入口） */}
            <NavPill to="/" active={isMapActive} icon={MapPin} label={t('nav:mapExplore')}
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} accentGrad={theme.accentGrad} />

            {/* 分析（下拉） */}
            <DropdownNav
              label={t('nav:analysis')}
              icon={LineChart}
              active={isAnalysisActive}
              open={openMenu === 'analysis'}
              onToggle={() => setOpenMenu(openMenu === 'analysis' ? null : 'analysis')}
              items={analysisItems}
              currentPath={location.pathname}
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} panel={theme.panel} dark={theme.dark}
            />

            {/* 经纪人入口：已开通 → 经纪台；未开通 → 成为经纪（强调色） */}
            <NavPill to={isAgent ? '/agent' : '/agent/join'} active={isAgentActive} icon={Briefcase}
              label={isAgent ? t('nav:agentHub') : t('nav:becomeAgent')} accent
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} accentGrad={theme.accentGrad} />

            {user && (
              <>
                <span className={`mx-1 h-5 w-px ${theme.divider}`} />
                <DropdownNav
                  label={t('nav:admin')}
                  icon={Settings}
                  active={isAdminPage}
                  open={openMenu === 'admin'}
                  onToggle={() => setOpenMenu(openMenu === 'admin' ? null : 'admin')}
                  items={adminItems}
                  currentPath={location.pathname}
                  tone="blue"
                  idleText={theme.idleText} primaryGrad={theme.primaryGrad} panel={theme.panel} dark={theme.dark}
                />
              </>
            )}

            <span className={`mx-1 h-5 w-px ${theme.divider}`} />

            <div className="flex items-center gap-1.5">
              <FavoritesButton />
              <LanguageSwitcher />
            </div>

            {!loading && (
              user ? (
                <UserMenu />
              ) : (
                <Link to="/login">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Button className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white rounded-xl text-sm font-medium shadow-md shadow-teal-500/20">
                      <LogIn className="h-4 w-4" />
                      <span>{t('auth:login', 'Sign In')}</span>
                    </Button>
                  </motion.div>
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

/* ---- 顶级导航胶囊：滑动高亮 + 悬停微动 ---- */
function NavPill({
  to, active, icon: Icon, label, accent, idleText, primaryGrad, accentGrad
}: {
  to: string; active: boolean; icon: typeof MapPin; label: string; accent?: boolean
  idleText: string; primaryGrad: string; accentGrad: string
}) {
  return (
    <Link to={to} className="relative">
      <motion.div
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.96 }}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-200 ${
          active ? 'text-white' : idleText
        }`}
      >
        {active && (
          <motion.span
            layoutId="nav-active-pill"
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            className={`absolute inset-0 -z-10 rounded-xl shadow-lg bg-gradient-to-r ${accent ? accentGrad : primaryGrad}`}
          />
        )}
        {!active && (
          <span className="absolute inset-0 -z-10 rounded-xl bg-current/0 opacity-0 hover:opacity-10 transition-opacity" />
        )}
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </motion.div>
    </Link>
  )
}

/* ---- 下拉导航：弹簧展开 + 子项错峰进入 ---- */
function DropdownNav({
  label, icon: Icon, active, open, onToggle, items, currentPath, tone = 'teal',
  idleText, primaryGrad, panel, dark
}: {
  label: string; icon: typeof MapPin; active: boolean; open: boolean
  onToggle: () => void; currentPath: string; tone?: 'teal' | 'blue'
  items: { path: string; label: string; icon: typeof MapPin; desc: string }[]
  idleText: string; primaryGrad: string; panel: string; dark: boolean
}) {
  const activeBg = tone === 'blue'
    ? 'bg-gradient-to-r from-blue-500 to-indigo-500 shadow-blue-500/25'
    : `bg-gradient-to-r ${primaryGrad}`
  return (
    <div className="relative">
      <motion.button
        type="button"
        onClick={onToggle}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.96 }}
        className={`relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors duration-200 ${
          active || open ? 'text-white' : idleText
        }`}
      >
        {(active || open) && (
          <motion.span
            layoutId={active ? 'nav-active-pill' : undefined}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
            className={`absolute inset-0 -z-10 rounded-xl shadow-lg ${activeBg}`}
          />
        )}
        <Icon className="h-4 w-4" />
        <span>{label}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={`absolute right-0 mt-2 w-64 origin-top-right rounded-2xl border p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-xl z-[1001] ${panel}`}
          >
            {items.map((it, i) => {
              const ItIcon = it.icon
              const isItemActive = currentPath === it.path ||
                (it.path === '/developer/upload' && currentPath.startsWith('/developer')) ||
                (it.path === '/admin/properties' && currentPath.startsWith('/admin/properties'))
              return (
                <motion.div
                  key={it.path}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.03 + i * 0.04 }}
                >
                  <Link
                    to={it.path}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      isItemActive
                        ? (dark ? 'bg-white/10 text-white font-medium' : 'bg-slate-100 text-slate-900 font-medium')
                        : (dark ? 'text-slate-300 hover:bg-white/5' : 'text-slate-700 hover:bg-slate-50')
                    }`}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                      isItemActive
                        ? (dark ? 'bg-white/15 text-teal-300' : 'bg-white text-teal-600 shadow-sm')
                        : (dark ? 'bg-white/10 text-slate-400 group-hover:text-teal-300' : 'bg-slate-100 text-slate-500 group-hover:text-teal-600')
                    }`}>
                      <ItIcon className="h-4 w-4" />
                    </span>
                    <span className="flex flex-col">
                      <span>{it.label}</span>
                      {it.desc && <span className={`text-[11px] ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{it.desc}</span>}
                    </span>
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
