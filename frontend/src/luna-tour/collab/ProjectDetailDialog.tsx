/**
 * Collab 项目详情抽屉 —— 在实时带看里就地展示房产详情(含户型/付款计划/位置),
 * 不导航离开(导航会拆掉 collab 会话)。复用 ProjectDetailPage 的 tab 子组件。
 *
 * 同步:presenter 开/关/切 tab 都广播(MapPage 接 select 事件);viewer 收到后
 * 用 `tab` prop 受控切换,所以「经纪翻到户型 → 客户也看到户型」。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { fetchResidentialProjectById, fetchProjectInsights, ProjectInsights } from '../../lib/api'
import { DesktopHeroGallery } from '../../pages/ProjectDetailPage/DesktopHeroGallery'
import { OverviewTab } from '../../pages/ProjectDetailPage/OverviewTab'
import { UnitTypesTab } from '../../pages/ProjectDetailPage/UnitTypesTab'
import { PaymentPlanTab } from '../../pages/ProjectDetailPage/PaymentPlanTab'
import { AmenitiesTab } from '../../pages/ProjectDetailPage/AmenitiesTab'
import { LocationTab } from '../../pages/ProjectDetailPage/LocationTab'
import { formatPrice } from '../../lib/utils'

export interface ProjectDetailDialogProps {
  projectId: string
  /** active tab — when controlled by the presenter, viewers follow it */
  tab?: string
  /** fired when the local user changes tab (presenter broadcasts it) */
  onTabChange?: (tab: string) => void
  onClose: () => void
}

export default function ProjectDetailDialog({ projectId, tab, onTabChange, onClose }: ProjectDetailDialogProps) {
  const { t } = useTranslation(['project'])
  const [project, setProject] = useState<any>(null)
  const [insights, setInsights] = useState<ProjectInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(tab || 'overview')

  useEffect(() => {
    let alive = true
    setLoading(true)
    setProject(null)
    setInsights(null)
    fetchProjectInsights(projectId).then((d) => alive && setInsights(d)).catch(() => {})
    fetchResidentialProjectById(projectId)
      .then((r) => {
        if (!alive) return
        if (r?.success && r.project) setProject(r.project)
        setLoading(false)
      })
      .catch(() => alive && setLoading(false))
    return () => { alive = false }
  }, [projectId])

  // Viewer follows the presenter's tab (controlled from outside).
  useEffect(() => {
    if (tab && tab !== activeTab) setActiveTab(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const handleTab = (v: string) => {
    setActiveTab(v)
    onTabChange?.(v)
  }

  const priceText = (() => {
    const p = project?.starting_price ?? project?.min_price
    return typeof p === 'number' && p > 0 ? formatPrice(p) : null
  })()

  // Portal to <body> so the drawer escapes any host that traps it — e.g. the Luna
  // tour overlay (.lt-tour-host is position:absolute, z-index:20, pointer-events:none),
  // which otherwise capped our z-index below the map controls AND made the whole
  // drawer non-interactive (couldn't scroll or close). At body level `fixed
  // inset-0 z-[2100]` covers the real viewport and is fully interactive.
  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-stretch justify-end bg-black/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {loading ? (
              <div className="h-5 w-40 animate-pulse rounded bg-slate-100" />
            ) : (
              <>
                <h3 className="truncate text-base font-bold text-slate-900">{project?.project_name || '房产详情'}</h3>
                <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                  <MapPin className="h-3 w-3" />
                  {project?.area || 'Dubai'}
                  {priceText ? ` · ${t('project:from', '起')} ${priceText}` : ''}
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : !project ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">加载失败</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Tabs FIRST (sticky at the very top) so 户型/付款 etc. are reachable
                without scrolling past the whole photo gallery. The gallery now
                lives inside 概览 as a compact hero (+ lightbox for the rest) instead
                of dumping all N images in a vertical stack. */}
            <Tabs value={activeTab} onValueChange={handleTab}>
              <TabsList className="sticky top-0 z-10 flex h-10 w-full justify-start overflow-x-auto border-b border-slate-100 bg-white/95 px-2 backdrop-blur">
                <TabsTrigger value="overview" className="flex-shrink-0">{t('project:tabs.overview', '概览')}</TabsTrigger>
                <TabsTrigger value="units" className="flex-shrink-0">{t('project:tabs.unitTypes', '户型')}</TabsTrigger>
                <TabsTrigger value="payment" className="flex-shrink-0">{t('project:tabs.paymentPlan', '付款')}</TabsTrigger>
                <TabsTrigger value="amenities" className="flex-shrink-0">{t('project:tabs.amenities', '配套')}</TabsTrigger>
                <TabsTrigger value="location" className="flex-shrink-0">{t('project:tabs.location', '位置')}</TabsTrigger>
              </TabsList>

              <div className="px-3 py-4">
                <TabsContent value="overview" className="mt-0 space-y-4">
                  <DesktopHeroGallery images={project.project_images || []} projectName={project.project_name || ''} />
                  <OverviewTab project={project} insights={insights} />
                </TabsContent>
                <TabsContent value="units" className="mt-0">
                  <UnitTypesTab
                    unitTypes={project.units || []}
                    projectId={project.id}
                    onUnitSelect={() => {}}
                    yieldPct={insights?.area?.rental_yield_pct}
                    growthPct={insights?.area?.price_growth_pct}
                    paymentPlan={project.payment_plan}
                  />
                </TabsContent>
                <TabsContent value="payment" className="mt-0">
                  <PaymentPlanTab
                    paymentPlan={project.payment_plan || []}
                    referencePrice={insights?.investment?.reference_price ?? project.starting_price ?? project.min_price}
                  />
                </TabsContent>
                <TabsContent value="amenities" className="mt-0">
                  <AmenitiesTab amenities={project.amenities} />
                </TabsContent>
                <TabsContent value="location" className="mt-0">
                  <LocationTab
                    buildingName={project.project_name}
                    areaName={project.area}
                    location={{ lat: project.latitude, lng: project.longitude }}
                    insights={insights}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
