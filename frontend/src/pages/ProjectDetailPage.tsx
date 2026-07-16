import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Helmet } from 'react-helmet-async'
import { motion, AnimatePresence } from 'framer-motion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useScrollChrome } from '../hooks/useScrollChrome'
import { Button } from '../components/ui/button'
import { ArrowLeft, MapPin, Building2, Heart, ChevronUp, X, DollarSign, Calendar, Bed, Copy, Check, Share2, LayoutDashboard, Dumbbell, Receipt, BarChart3 } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useFavorites } from '../contexts/FavoritesContext'
import { fetchResidentialProjectById, fetchProjectInsights, ProjectInsights } from '../lib/api'
import { ImageGallery } from './ProjectDetailPage/ImageGallery'
import { OverviewTab } from './ProjectDetailPage/OverviewTab'
import { CompareTab } from './ProjectDetailPage/CompareTab'
import { UnitTypesTab } from './ProjectDetailPage/UnitTypesTab'
import { PaymentPlanTab } from './ProjectDetailPage/PaymentPlanTab'
import { AmenitiesTab } from './ProjectDetailPage/AmenitiesTab'
import { LocationTab } from './ProjectDetailPage/LocationTab'
import { TransactionsTab } from './ProjectDetailPage/TransactionsTab'
import AgentCardEditor from '../components/AgentCardEditor'
import { UnitTypesSubPage } from './ProjectDetailPage/UnitTypesSubPage'
import { DesktopHeroGallery } from './ProjectDetailPage/DesktopHeroGallery'
import { CollapsibleDetails } from './ProjectDetailPage/CollapsibleDetails'
import { formatPrice } from '../lib/utils'
import { generateProjectNotes } from '../lib/generateProjectNotes'
import { trackEvent } from '../lib/track'

type DeviceType = 'mobile' | 'tablet' | 'desktop'

function getDeviceType(): DeviceType {
  const width = window.innerWidth
  if (width < 768) return 'mobile'
  // pad 全走「往下滚动」的 tablet 布局（经纪大量用 iPad）：
  //  - 1280 以下一律 tablet（旧阈值 1024 让 iPad Air/Pro 横屏 1180+ 掉进 desktop 布局）
  //  - 触屏设备放宽到 1440（罩住 iPad Pro 12.9 横屏 1366）
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (width < 1280 || (coarse && width < 1440)) return 'tablet'
  return 'desktop'
}

export default function ProjectDetailPage() {
  const { t, i18n } = useTranslation(['project', 'common'])
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<any>(null)
  const [insights, setInsights] = useState<ProjectInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [reportUrl, setReportUrl] = useState<string | null>(null)
  const [genningReport, setGenningReport] = useState(false)
  const [showCardEditor, setShowCardEditor] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const { isProjectFavorite, toggleProjectFavorite } = useFavorites()

  // Tab state with URL sync
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'overview')

  // Unit detail view state
  const selectedUnitId = searchParams.get('unit')
  const isUnitDetailView = activeTab === 'units' && selectedUnitId

  // Ref for scroll container
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (id) {
      setLoading(true)
      setInsights(null)
      // Investment + location intelligence (parallel, non-blocking).
      fetchProjectInsights(id).then(setInsights).catch(() => {})
      fetchResidentialProjectById(id)
        .then((result) => {
          if (result?.success && result.project) {
            setProject(result.project)
            // Behaviour analytics: a real property view (project loaded).
            trackEvent('property_view', {
              project_name: result.project.project_name,
              area: result.project.area,
            }, { project_id: id })
          }
          setLoading(false)
        })
        .catch((error) => {
          console.error('Error fetching project:', error)
          setLoading(false)
        })
    }
  }, [id])

  // Sync tab with URL
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && tab !== activeTab) {
      setActiveTab(tab)
    }
  }, [searchParams])


  const handleTabChange = (value: string) => {
    trackEvent('tab_switch', { tab_name: value, source: 'user' }, { project_id: project?.id })
    setActiveTab(value)
    const newParams = new URLSearchParams(searchParams)
    newParams.set('tab', value)
    newParams.delete('unit')
    setSearchParams(newParams, { replace: true })
    // Scroll to top when changing tabs
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleUnitSelect = (unitId: string) => {
    const newParams = new URLSearchParams(searchParams)
    newParams.set('tab', 'units')
    newParams.set('unit', unitId)
    setSearchParams(newParams, { replace: true })
  }

  const handleBackFromUnitDetail = () => {
    const newParams = new URLSearchParams(searchParams)
    newParams.delete('unit')
    setSearchParams(newParams, { replace: true })
  }

  const handleToggleFavorite = () => {
    if (!project) return
    toggleProjectFavorite(project.id)
  }

  const isFav = project ? isProjectFavorite(project.id) : false

  // Mobile info sheet state
  const [showMobileInfo, setShowMobileInfo] = useState(false)
  // 手机/pad 下滑收起顶部导航+tab 栏,上滑先回 tab 栏(方便切户型/付款计划)。
  // active=!!project:loading 态滚动容器还没挂载,等内容出来再接监听
  const { secondaryHidden } = useScrollChrome(scrollContainerRef, !!project)
  const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType)
  const isMobile = deviceType === 'mobile'
  const isTablet = deviceType === 'tablet'
  const [copied, setCopied] = useState(false)

  const handleCopyNotes = async () => {
    if (!project) return
    // Get current language from i18next
    const currentLang = document.documentElement.lang || localStorage.getItem('i18nextLng') || 'en'
    const notesLang = currentLang.startsWith('zh') ? 'zh-CN' : 'en'
    const projectUrl = `${window.location.origin}/project/${project.id}`

    const notes = generateProjectNotes({
      project,
      units: project.units || [],
      paymentPlan: project.payment_plan || [],
      projectUrl
    }, notesLang as 'en' | 'zh-CN')

    try {
      await navigator.clipboard.writeText(notes)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = notes
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // Agent-branded shareable report: generate (or fetch) a /r/:code link + copy it.
  const handleGenerateReport = async () => {
    if (!project || genningReport) return
    trackEvent('report_action', { action: 'generate' }, { project_id: project.id })
    setGenningReport(true)
    try {
      const { lunaFetch } = await import('../luna-tour/lunaApi')
      const r = await lunaFetch('/project-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
      const j = await r.json()
      if (j?.shareCode) {
        const url = `${window.location.origin}/r/${j.shareCode}`
        setReportUrl(url)
        try { await navigator.clipboard.writeText(url) } catch { /* ignore */ }
      } else {
        alert('生成失败,请确认已登录经纪账户')
      }
    } catch {
      alert('生成失败,请确认已登录经纪账户')
    } finally {
      setGenningReport(false)
    }
  }

  const handleShare = async () => {
    if (!project) return
    trackEvent('share_action', { method: typeof navigator.share === 'function' ? 'native' : 'clipboard' }, { project_id: project.id })
    const currentLang = document.documentElement.lang || localStorage.getItem('i18nextLng') || 'en'
    const notesLang = currentLang.startsWith('zh') ? 'zh-CN' : 'en'
    const projectUrl = `${window.location.origin}/project/${project.id}`

    const notes = generateProjectNotes({
      project,
      units: project.units || [],
      paymentPlan: project.payment_plan || [],
      projectUrl
    }, notesLang as 'en' | 'zh-CN')

    if (navigator.share) {
      try {
        // Try sharing with text (works well for WeChat, WhatsApp, etc.)
        await navigator.share({
          text: notes
        })
      } catch (err) {
        // User cancelled or share failed - ignore
        console.log('Share cancelled or failed:', err)
      }
    } else {
      // Fallback: copy notes to clipboard
      try {
        await navigator.clipboard.writeText(notes)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        const textarea = document.createElement('textarea')
        textarea.value = notes
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
  }

  useEffect(() => {
    const handleResize = () => {
      setDeviceType(getDeviceType())
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Generate OG meta data for social sharing
  const ogData = useMemo(() => {
    if (!project) return null

    const title = `${project.project_name} | ${project.developer}`
    const description = project.starting_price
      ? `${project.area} - Starting from ${formatPrice(project.starting_price)}. ${project.min_bedrooms}-${project.max_bedrooms} BR units available.`
      : `${project.area} - Premium off-plan development by ${project.developer}.`
    const image = project.project_images?.[0] || '/og-image.jpg'
    const url = `${window.location.origin}/project/${project.id}`

    return { title, description, image, url }
  }, [project])

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="text-xl">{t('project:loadingDetails')}</div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">{t('project:notFound')}</h1>
        <Link to="/map">
          <Button>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('project:backToProperties')}
          </Button>
        </Link>
      </div>
    )
  }

  // Desktop/Tablet: Unit detail sub-page view
  if (isUnitDetailView && !isMobile) {
    return (
      <UnitTypesSubPage
        unitTypes={project.units || []}
        selectedUnitId={selectedUnitId}
        projectId={project.id}
        projectName={project.project_name}
        onUnitSelect={handleUnitSelect}
        onBack={handleBackFromUnitDetail}
        yieldPct={insights?.area?.rental_yield_pct}
        growthPct={insights?.area?.price_growth_pct}
        paymentPlan={project.payment_plan}
      />
    )
  }

  // Compact header for non-overview tabs
  const CompactProjectHeader = () => (
    <div className="bg-white border-b py-4">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Thumbnail */}
            {project.project_images?.[0] && (
              <img
                src={project.project_images[0]}
                alt={project.project_name}
                className="w-16 h-16 object-cover rounded-lg"
              />
            )}
            <div>
              <h1 className="text-xl font-bold text-slate-900">{project.project_name}</h1>
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span className="flex items-center gap-1">
                  <Building2 className="h-4 w-4" />
                  {project.developer}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {project.area}
                </span>
              </div>
              {/* Investment highlights (every tab) */}
              {insights?.investment && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {insights.area?.rental_yield_pct != null && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
                      {i18n.language?.startsWith('zh') ? '回报' : 'Yield'} {insights.area.rental_yield_pct}%
                    </span>
                  )}
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    {i18n.language?.startsWith('zh') ? '5年年化' : '5yr'} {insights.investment.annualized_return_pct}%
                  </span>
                  {insights.investment.payback_years != null && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                      {i18n.language?.startsWith('zh') ? `回本 ${insights.investment.payback_years} 年` : `${insights.investment.payback_years}y payback`}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            {project.starting_price && (
              <div className="text-right hidden sm:block">
                <div className="text-xs text-slate-500">{t('common:price.startingPrice')}</div>
                <div className="text-lg font-bold text-primary">{formatPrice(project.starting_price)}</div>
              </div>
            )}
            <Button
              variant={isFav ? "default" : "outline"}
              size="icon"
              onClick={handleToggleFavorite}
            >
              <Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Dynamic OG meta tags for social sharing */}
      {ogData && (
        <Helmet>
          <title>{ogData.title}</title>
          <meta property="og:title" content={ogData.title} />
          <meta property="og:description" content={ogData.description} />
          <meta property="og:image" content={ogData.image} />
          <meta property="og:url" content={ogData.url} />
          <meta property="og:type" content="website" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={ogData.title} />
          <meta name="twitter:description" content={ogData.description} />
          <meta name="twitter:image" content={ogData.image} />
        </Helmet>
      )}
      <div ref={scrollContainerRef} className="flex-1 bg-slate-50 overflow-auto">
      {/* Tabs Container */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Sticky TabsList — 下滑随导航一起收起,上滑立即回来(useScrollChrome) */}
        <div className={`sticky top-0 z-50 bg-white border-b shadow-sm transition-transform duration-300 ease-out ${secondaryHidden ? '-translate-y-full' : ''}`}>
          <div className="container mx-auto px-4">
            <div className="flex items-center h-12">
              {/* Back button - both mobile and desktop */}
              <Link to="/map" className="mr-3 -ml-2 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>

              {/* Tabs */}
              <TabsList className="flex-1 overflow-x-auto flex justify-start md:justify-center h-10 bg-transparent">
                <TabsTrigger value="overview" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><LayoutDashboard className="h-3.5 w-3.5" />{t('project:tabs.overview')}</TabsTrigger>
                <TabsTrigger value="units" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><Bed className="h-3.5 w-3.5" />{t('project:tabs.unitTypes')}</TabsTrigger>
                <TabsTrigger value="payment" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><Calendar className="h-3.5 w-3.5" />{t('project:tabs.paymentPlan')}</TabsTrigger>
                <TabsTrigger value="amenities" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><Dumbbell className="h-3.5 w-3.5" />{t('project:tabs.amenities')}</TabsTrigger>
                <TabsTrigger value="location" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><MapPin className="h-3.5 w-3.5" />{t('project:tabs.location')}</TabsTrigger>
                <TabsTrigger value="transactions" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><Receipt className="h-3.5 w-3.5" />{t('project:tabs.transactions', '成交')}</TabsTrigger>
                <TabsTrigger value="compare" className="flex-shrink-0 gap-1.5 data-[state=active]:bg-primary/10"><BarChart3 className="h-3.5 w-3.5" />{t('project:tabs.compare', '对比分析')}</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </div>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-0">
            {/* Mobile: Compact header + gallery only */}
            {isMobile ? (
              <>
                {/* Mobile compact header */}
                <div className="bg-white border-b py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2">
                        <h1 className="text-base font-bold text-slate-900 truncate">{project.project_name}</h1>
                        {/* Sold Out Badge */}
                        {project.status === 'sold-out' && (
                          <span className="flex-shrink-0 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                            {t('common:status.soldOut')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1 truncate">
                          <Building2 className="h-3 w-3 flex-shrink-0" />
                          {project.developer}
                        </span>
                        <span className="flex items-center gap-1 truncate">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          {project.area}
                        </span>
                      </div>
                      {/* Investment highlights — 收益率/回报率(蕾姐反馈这里以前能看到) */}
                      {insights?.investment && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {insights.area?.rental_yield_pct != null && (
                            <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
                              {i18n.language?.startsWith('zh') ? '回报' : 'Yield'} {insights.area.rental_yield_pct}%
                            </span>
                          )}
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                            {i18n.language?.startsWith('zh') ? '5年年化' : '5yr'} {insights.investment.annualized_return_pct}%
                          </span>
                          {insights.investment.payback_years != null && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                              {i18n.language?.startsWith('zh') ? `回本 ${insights.investment.payback_years} 年` : `${insights.investment.payback_years}y payback`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={handleShare}
                      >
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        onClick={handleCopyNotes}
                      >
                        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant={isFav ? "default" : "outline"}
                        size="icon"
                        className="h-9 w-9"
                        onClick={handleToggleFavorite}
                      >
                        <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Mobile gallery - full scroll */}
                <div className="px-3 py-3 pb-24">
                  <ImageGallery
                    images={project.project_images}
                    buildingName={project.project_name}
                    currentImageIndex={currentImageIndex}
                    onImageIndexChange={setCurrentImageIndex}
                  />
                </div>
              </>
            ) : isTablet ? (
              /* Tablet: Scroll-based gallery with floating info button */
              <>
                {/* Tablet compact header with actions */}
                <div className="bg-white border-b py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2">
                        <h1 className="text-lg font-bold text-slate-900 truncate">{project.project_name}</h1>
                        {project.status === 'sold-out' && (
                          <span className="flex-shrink-0 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                            {t('common:status.soldOut')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-4 w-4 flex-shrink-0" />
                          {project.developer}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4 flex-shrink-0" />
                          {project.area}
                        </span>
                      </div>
                      {/* Investment highlights — 收益率/回报率(蕾姐反馈这里以前能看到) */}
                      {insights?.investment && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                          {insights.area?.rental_yield_pct != null && (
                            <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-700">
                              {i18n.language?.startsWith('zh') ? '回报' : 'Yield'} {insights.area.rental_yield_pct}%
                            </span>
                          )}
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                            {i18n.language?.startsWith('zh') ? '5年年化' : '5yr'} {insights.investment.annualized_return_pct}%
                          </span>
                          {insights.investment.payback_years != null && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                              {i18n.language?.startsWith('zh') ? `回本 ${insights.investment.payback_years} 年` : `${insights.investment.payback_years}y payback`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        className="h-10 bg-teal-500 px-3 text-white hover:bg-teal-600"
                        onClick={handleGenerateReport}
                        disabled={genningReport}
                      >
                        <Share2 className="mr-1.5 h-4 w-4" />{genningReport ? '生成中…' : '客户报告'}
                      </Button>
                      <Button variant="outline" size="sm" className="h-10 px-3" onClick={() => setShowCardEditor(true)}>名片</Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={handleShare}
                      >
                        <Share2 className="h-5 w-5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-10 w-10"
                        onClick={handleCopyNotes}
                      >
                        {copied ? <Check className="h-5 w-5 text-green-600" /> : <Copy className="h-5 w-5" />}
                      </Button>
                      <Button
                        variant={isFav ? "default" : "outline"}
                        size="icon"
                        className="h-10 w-10"
                        onClick={handleToggleFavorite}
                      >
                        <Heart className={`h-5 w-5 ${isFav ? 'fill-current' : ''}`} />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Tablet uses same gallery as mobile - simple and intuitive */}
                <div className="px-4 py-3 pb-24">
                  <ImageGallery
                    images={project.project_images}
                    buildingName={project.project_name}
                    currentImageIndex={currentImageIndex}
                    onImageIndexChange={setCurrentImageIndex}
                  />
                </div>
              </>
            ) : (
              /* Desktop: Immersive Hero + Grid layout */
              <>
                {/* Desktop compact header with project info and actions */}
                <div className="bg-white border-b py-4">
                  <div className="container mx-auto px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {/* Thumbnail */}
                        {project.project_images?.[0] && (
                          <img
                            src={project.project_images[0]}
                            alt={project.project_name}
                            className="w-14 h-14 object-cover rounded-lg"
                          />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h1 className="text-xl font-bold text-slate-900">{project.project_name}</h1>
                            {project.status === 'sold-out' && (
                              <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded">
                                {t('common:status.soldOut')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-slate-600 mt-0.5">
                            <span className="flex items-center gap-1">
                              <Building2 className="h-4 w-4" />
                              {project.developer}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-4 w-4" />
                              {project.area}
                            </span>
                            {project.starting_price && (
                              <span className="font-semibold text-primary">
                                {formatPrice(project.starting_price)}+
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleShare}
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          {t('project:share', 'Share')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCopyNotes}
                        >
                          {copied ? (
                            <>
                              <Check className="h-4 w-4 mr-2 text-green-600" />
                              {t('project:copyNotes.copied')}
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-2" />
                              {t('project:copyNotes.button')}
                            </>
                          )}
                        </Button>
                        <Button
                          variant={isFav ? "default" : "outline"}
                          size="sm"
                          onClick={handleToggleFavorite}
                        >
                          <Heart className={`h-4 w-4 mr-2 ${isFav ? 'fill-current' : ''}`} />
                          {isFav ? t('project:saved', 'Saved') : t('project:save', 'Save')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Hero Gallery */}
                <div className="container mx-auto px-4 py-6">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    <DesktopHeroGallery
                      images={project.project_images}
                      projectName={project.project_name}
                      minBedrooms={project.min_bedrooms}
                      maxBedrooms={project.max_bedrooms}
                      startingPrice={project.starting_price}
                      completionDate={project.completion_date}
                    />

                    {/* Collapsible Details */}
                    <CollapsibleDetails
                      project={project}
                      paymentPlan={project.payment_plan}
                      amenities={project.amenities}
                    />

                    {/* Overview Content (additional content below collapsible) */}
                    <div className="mt-8">
                      <OverviewTab project={project} insights={insights} />
                    </div>
                  </motion.div>
                </div>
              </>
            )}
          </TabsContent>

          {/* 对比分析 tab —— 本盘 vs 区域 + 附近项目横评 */}
          <TabsContent value="compare" className="mt-0">
            <CompactProjectHeader />
            <CompareTab project={project} insights={insights} />
          </TabsContent>

          {/* Other Tabs - Compact header + content */}
          <TabsContent value="units" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <UnitTypesTab
                unitTypes={project.units || []}
                projectId={project.id}
                onUnitSelect={handleUnitSelect}
                yieldPct={insights?.area?.rental_yield_pct}
                growthPct={insights?.area?.price_growth_pct}
                paymentPlan={project.payment_plan}
              />
            </div>
          </TabsContent>

          <TabsContent value="payment" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <PaymentPlanTab
                paymentPlan={project.payment_plan || []}
                referencePrice={insights?.investment?.reference_price ?? project.starting_price ?? project.min_price}
                units={project.units || []}
                projectId={project.id}
                projectName={project.project_name}
              />
            </div>
          </TabsContent>

          <TabsContent value="amenities" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <AmenitiesTab amenities={project.amenities} />
            </div>
          </TabsContent>

          <TabsContent value="location" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <LocationTab
                buildingName={project.project_name}
                areaName={project.area}
                location={{
                  lat: project.latitude,
                  lng: project.longitude
                }}
                insights={insights}
              />
            </div>
          </TabsContent>

          <TabsContent value="transactions" className="mt-0">
            <CompactProjectHeader />
            <TransactionsTab projectId={project.id} />
          </TabsContent>
        </Tabs>

        {/* Generated shareable report link */}
        {reportUrl && (
          <div className="fixed bottom-4 left-4 right-4 z-[10000] mx-auto flex max-w-lg items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-white shadow-2xl">
            <Check className="h-5 w-5 flex-shrink-0 text-emerald-400" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-300">客户专属报告已生成(链接已复制)</div>
              <div className="truncate text-sm font-medium">{reportUrl}</div>
            </div>
            <button onClick={() => { setReportUrl(null); setShowCardEditor(true) }} className="flex-shrink-0 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700">完善名片</button>
            <a href={reportUrl} target="_blank" rel="noreferrer" className="flex-shrink-0 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold hover:bg-teal-600">打开</a>
            <button onClick={() => setReportUrl(null)} className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-700"><X className="h-4 w-4" /></button>
          </div>
        )}
        {showCardEditor && <AgentCardEditor onClose={() => setShowCardEditor(false)} />}

        {/* Mobile & Tablet: Floating Pull-up Handle & Sheet */}
        {(isMobile || isTablet) && activeTab === 'overview' && (
          <>
            {/* Large mist effect covering bottom 20% */}
            <AnimatePresence>
              {!showMobileInfo && (
                <>
                {/* White mist visual effect - non-clickable, above mobile nav */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={`fixed left-0 right-0 z-40 pointer-events-none ${isMobile ? 'bottom-16' : 'bottom-20'}`}
                  style={{ height: '10vh' }}
                >
                  {/* Compact white mist gradient */}
                  <div
                    className="absolute inset-0"
                    style={{
                      background: 'linear-gradient(to top, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.6) 60%, transparent 100%)'
                    }}
                  />

                  {/* Subtle glow - smaller */}
                  <div className="absolute bottom-4 left-4 right-4 h-10 bg-white/60 blur-xl animate-glow" />
                </motion.div>

                {/* Transparent clickable area - text only, above mobile nav */}
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowMobileInfo(true)}
                  className={`fixed left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 ${isMobile ? 'bottom-[72px]' : 'bottom-[88px]'}`}
                >
                  <div className="flex items-center gap-2 animate-float">
                    <ChevronUp className="h-5 w-5 text-slate-600" />
                    <span className="text-sm font-medium text-slate-600">
                      {t('project:moreDetails', 'More Details')}
                    </span>
                  </div>
                </motion.button>
                </>
              )}
            </AnimatePresence>

            {/* Bottom sheet with project info */}
            <AnimatePresence>
              {showMobileInfo && (
                <>
                  {/* Backdrop */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setShowMobileInfo(false)}
                    className="fixed inset-0 bg-black/40 z-[9999]"
                  />

                  {/* Sheet — z 必须盖过底部导航(MobileNav z-50,pad 上 h-20),否则
                      分享/复制/收藏一行会被导航条压住(2026-07-03 真机 pad 反馈) */}
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed bottom-0 left-0 right-0 z-[10000] bg-white rounded-t-3xl max-h-[80vh] overflow-auto"
                  >
                    {/* Handle bar */}
                    <div className="sticky top-0 bg-white pt-3 pb-2">
                      <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto" />
                    </div>

                    {/* Content — 底部多留白,安全区/手势条不压按钮 */}
                    <div className="p-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
                      {/* Header with close */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-xl font-bold text-slate-900">{project.project_name}</h2>
                            {/* Sold Out Badge */}
                            {project.status === 'sold-out' && (
                              <span className="px-2.5 py-1 bg-red-600 text-white text-xs font-bold rounded-full shadow-sm">
                                {t('common:status.soldOut')}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-slate-600 mt-1">
                            <Building2 className="h-4 w-4" />
                            <span className="text-sm">{project.developer}</span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-600 mt-0.5">
                            <MapPin className="h-4 w-4" />
                            <span className="text-sm">{project.area}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => setShowMobileInfo(false)}
                          className="p-2 -mt-1 -mr-2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      {/* Price */}
                      {project.starting_price && (
                        <div className="bg-primary/5 rounded-xl p-4 mb-4">
                          <div className="flex items-center gap-2 text-primary">
                            <DollarSign className="h-5 w-5" />
                            <span className="text-sm font-medium">{t('common:price.startingPrice')}</span>
                          </div>
                          <div className="text-2xl font-bold text-primary mt-1">
                            {formatPrice(project.starting_price)}
                          </div>
                        </div>
                      )}

                      {/* Quick info grid */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        {/* Bedrooms */}
                        {(project.min_bedrooms !== undefined || project.max_bedrooms !== undefined) && (
                          <div className="bg-slate-50 rounded-xl p-3">
                            <div className="flex items-center gap-2 text-slate-500 text-sm">
                              <Bed className="h-4 w-4" />
                              <span>{t('project:bedrooms', 'Bedrooms')}</span>
                            </div>
                            <div className="text-lg font-semibold text-slate-900 mt-1">
                              {project.min_bedrooms === project.max_bedrooms
                                ? (project.min_bedrooms === 0 ? t('map:studio', 'Studio') : `${project.min_bedrooms} BR`)
                                : `${project.min_bedrooms || 'Studio'} - ${project.max_bedrooms} BR`}
                            </div>
                          </div>
                        )}

                        {/* Completion */}
                        {project.completion_date && (
                          <div className="bg-slate-50 rounded-xl p-3">
                            <div className="flex items-center gap-2 text-slate-500 text-sm">
                              <Calendar className="h-4 w-4" />
                              <span>{t('project:completion', 'Completion')}</span>
                            </div>
                            <div className="text-lg font-semibold text-slate-900 mt-1">
                              {new Date(project.completion_date).toLocaleDateString('en-US', {
                                month: 'short',
                                year: 'numeric'
                              })}
                            </div>
                          </div>
                        )}

                        {/* Status */}
                        {project.status && (
                          <div className={`rounded-xl p-3 ${
                            project.status === 'sold-out' ? 'bg-red-50' :
                            project.status === 'selling' ? 'bg-emerald-50' :
                            project.status === 'completed' ? 'bg-green-50' :
                            project.status === 'under-construction' ? 'bg-blue-50' :
                            'bg-slate-50'
                          }`}>
                            <div className="text-slate-500 text-sm">{t('project:status', 'Status')}</div>
                            <div className={`text-lg font-semibold mt-1 ${
                              project.status === 'sold-out' ? 'text-red-700' :
                              project.status === 'selling' ? 'text-emerald-700' :
                              project.status === 'completed' ? 'text-green-700' :
                              project.status === 'under-construction' ? 'text-blue-700' :
                              'text-slate-900'
                            }`}>
                              {project.status === 'sold-out' ? t('common:status.soldOut') :
                               project.status === 'selling' ? t('common:status.selling') :
                               project.status === 'completed' ? t('common:status.completed') :
                               project.status === 'under-construction' ? t('common:status.underConstruction') :
                               project.status === 'upcoming' ? t('common:status.upcoming') :
                               project.status.replace('-', ' ')}
                            </div>
                          </div>
                        )}

                        {/* Units count */}
                        {project.units?.length > 0 && (
                          <div className="bg-slate-50 rounded-xl p-3">
                            <div className="text-slate-500 text-sm">{t('project:unitTypes', 'Unit Types')}</div>
                            <div className="text-lg font-semibold text-slate-900 mt-1">
                              {project.units.length}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex gap-2 mb-3">
                        <Button
                          onClick={handleShare}
                          variant="outline"
                          className="flex-1"
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          {t('project:share', 'Share')}
                        </Button>
                        <Button
                          onClick={handleCopyNotes}
                          variant="outline"
                          className="flex-1"
                        >
                          {copied ? (
                            <>
                              <Check className="h-4 w-4 mr-2 text-green-600" />
                              {t('project:copyNotes.copied')}
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4 mr-2" />
                              {t('project:copyNotes.button')}
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={handleToggleFavorite}
                          variant={isFav ? "default" : "outline"}
                          className="flex-1"
                        >
                          <Heart className={`h-4 w-4 mr-2 ${isFav ? 'fill-current' : ''}`} />
                          {isFav ? t('project:saved', 'Saved') : t('project:save', 'Save')}
                        </Button>
                      </div>
                      <Button
                        onClick={() => {
                          setShowMobileInfo(false)
                          handleTabChange('units')
                        }}
                        className="w-full"
                      >
                        {t('project:viewUnits', 'View Units')}
                      </Button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </>
        )}
    </div>
    </>
  )
}
