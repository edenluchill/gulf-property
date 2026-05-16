import { Link, useLocation } from 'react-router-dom'
import { Building2, MapPin, Settings, LogIn, GitCompare, Globe, ClipboardList, HelpCircle, Upload, MapPinned, TrendingUp, Briefcase, LineChart, ChevronDown } from 'lucide-react'
import { Button } from './ui/button'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'
import { useAuth } from '../contexts/AuthContext'
import UserMenu from './auth/UserMenu'
import { FavoritesButton } from './favorites'
import AboutSheet from './AboutSheet'

// 单一「午夜」主题：深空蓝玻璃 + 低调激光折射扫光
const theme = {
  dark: true,
  header: 'bg-[#0B1220]/85 border-white/10 shadow-[0_8px_30px_-12px_rgba(20,184,166,0.35)]',
  idleText: 'text-slate-300 hover:text-white',
  logoText: 'text-white',
  tagline: 'text-teal-300',
  divider: 'bg-white/15',
  primaryGrad: 'from-teal-500 to-emerald-500 shadow-teal-500/30',
  accentGrad: 'from-amber-400 to-yellow-500 shadow-amber-400/30',
  panel: 'border-white/10 bg-[#0B1220]/95 text-slate-200'
}

export default function Header() {
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { user, loading } = useAuth()

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
    { path: '/transactions', label: t('nav.transactions', '成交记录'), icon: TrendingUp, desc: 'DLD 真实成交多维查询' },
    { path: '/areas', label: t('nav.areaInsights', '区域分析'), icon: MapPinned, desc: '区域分级与两区对比' },
    { path: '/report', label: t('nav.buyingReport', 'AI报告'), icon: ClipboardList, desc: 'AI 买房决策报告' },
    { path: '/compare', label: t('nav.compare', '对比'), icon: GitCompare, desc: '项目并排对比' },
  ]

  const adminItems = [
    { path: '/developer/upload', label: t('nav.uploadBrochure', '上传楼书'), icon: Upload, desc: '' },
    { path: '/admin/properties', label: t('nav.projectManagement'), icon: Building2, desc: '' },
    { path: '/admin/dubai', label: t('nav.dubaiMapEditor'), icon: MapPinned, desc: '' },
    { path: '/admin/tasks', label: t('nav.taskManagement', 'Task Management'), icon: ClipboardList, desc: '' },
  ]

  const isAdminPage = location.pathname.startsWith('/admin') || location.pathname.startsWith('/developer')
  const isAnalysisActive = analysisItems.some(i => location.pathname === i.path)
  const isMapActive = location.pathname === '/' || location.pathname === '/map'
  const isAgentActive = location.pathname === '/agent'

  return (
    <header
      className={`${theme.header} backdrop-blur-2xl border-b sticky top-0 z-[1000] relative transition-[transform,background-color] duration-300 ease-out ${
        mobileHidden ? '-translate-y-full xl:translate-y-0' : 'translate-y-0'
      }`}
    >
      {/* 午夜背景：静态柔光 + 低调激光折射扫光 + 极淡投资走势纹理 */}
      <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* 静态柔光底，沉稳不晃 */}
        <div className="absolute -top-24 left-1/3 h-56 w-[34rem] -translate-x-1/2 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute -top-20 right-1/4 h-48 w-[24rem] rounded-full bg-indigo-500/10 blur-3xl" />

        {/* 光子弹：细小弹头 + 拖尾，每几秒极速射出，沿不规则折线向下折射后消失 */}
        <motion.div
          className="absolute h-[2px] w-28"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(45,212,191,0.05) 40%, rgba(94,234,212,0.4) 80%, rgba(186,230,253,0.9) 95%, rgba(255,255,255,1) 100%)',
            borderRadius: '9999px',
            filter: 'drop-shadow(0 0 5px rgba(94,234,212,0.85))'
          }}
          initial={{ left: '-8rem', top: '24%', rotate: 0, opacity: 0 }}
          animate={{
            // 不规则向下折射的折线轨迹
            left: ['-8rem', '10%', '24%', '42%', '60%', '78%', '104%'],
            top: ['22%', '26%', '44%', '38%', '64%', '60%', '92%'],
            rotate: [-2, 4, 14, 6, 18, 10, 24],
            opacity: [0, 1, 1, 1, 1, 0.85, 0]
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            repeatDelay: 4,
            ease: 'easeIn'
          }}
        >
          {/* 弹头光点（小） */}
          <span
            className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white"
            style={{ boxShadow: '0 0 7px 2px rgba(94,234,212,0.9), 0 0 15px 4px rgba(45,212,191,0.4)' }}
          />
        </motion.div>
      </div>

      {/* Mobile/Tablet: py-2 (compact), Desktop: py-4 */}
      <div className="container mx-auto px-4 py-2 xl:py-4 relative z-10">
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
                className={`text-lg xl:text-xl font-bold tracking-tight transition-colors ${theme.logoText}`}
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

          {/* Desktop Navigation — 分组 + 流畅动效 */}
          <nav ref={navRef} className="hidden xl:flex items-center gap-1.5">
            {/* 地图探索（主入口） */}
            <NavPill to="/" active={isMapActive} icon={MapPin} label={t('nav.mapExplore')}
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} accentGrad={theme.accentGrad} />

            {/* 分析（下拉） */}
            <DropdownNav
              label={t('nav.analysis', '分析')}
              icon={LineChart}
              active={isAnalysisActive}
              open={openMenu === 'analysis'}
              onToggle={() => setOpenMenu(openMenu === 'analysis' ? null : 'analysis')}
              items={analysisItems}
              currentPath={location.pathname}
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} panel={theme.panel} dark={theme.dark}
            />

            {/* 经纪人（专属入口，强调色） */}
            <NavPill to="/agent" active={isAgentActive} icon={Briefcase} label={t('nav.agentPortal', '经纪人')} accent
              idleText={theme.idleText} primaryGrad={theme.primaryGrad} accentGrad={theme.accentGrad} />

            {user && (
              <>
                <span className={`mx-1 h-5 w-px ${theme.divider}`} />
                <DropdownNav
                  label={t('nav.admin')}
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

            {/* 深色 header 下强制浅色，保证图标/文字对比 */}
            <div className="flex items-center gap-1.5 [&_svg]:!text-slate-200 [&_span]:!text-slate-200 [&_a]:!text-slate-200 [&_button]:hover:!bg-white/10">
              <FavoritesButton />
              <LanguageSwitcher />
            </div>

            {!loading && (
              user ? (
                <div className="[&_svg]:!text-slate-200">
                  <UserMenu />
                </div>
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

      {/* 底部流光，AI 高级感 */}
      <motion.div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(20,184,166,0.55), rgba(16,185,129,0.35), transparent)',
          backgroundSize: '50% 100%',
          backgroundRepeat: 'no-repeat'
        }}
        animate={{ backgroundPositionX: ['-50%', '150%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />

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
