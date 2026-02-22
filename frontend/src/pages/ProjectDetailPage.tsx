import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { ArrowLeft, MapPin, Building2, Heart, ChevronUp, X, DollarSign, Calendar, Bed } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useFavorites } from '../contexts/FavoritesContext'
import { fetchResidentialProjectById } from '../lib/api'
import { ImageGallery } from './ProjectDetailPage/ImageGallery'
import { ProjectInfoCard } from './ProjectDetailPage/ProjectInfoCard'
import { OverviewTab } from './ProjectDetailPage/OverviewTab'
import { UnitTypesTab } from './ProjectDetailPage/UnitTypesTab'
import { PaymentPlanTab } from './ProjectDetailPage/PaymentPlanTab'
import { AmenitiesTab } from './ProjectDetailPage/AmenitiesTab'
import { LocationTab } from './ProjectDetailPage/LocationTab'
import { UnitTypesSubPage } from './ProjectDetailPage/UnitTypesSubPage'
import { formatPrice } from '../lib/utils'

export default function ProjectDetailPage() {
  const { t } = useTranslation(['project', 'common'])
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = useState<any>(null)
  const [loading, setLoading] = useState(true)
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
      fetchResidentialProjectById(id)
        .then((result) => {
          if (result?.success && result.project) {
            setProject(result.project)
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
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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

  // Desktop: Unit detail sub-page view
  if (isUnitDetailView && !window.matchMedia('(max-width: 767px)').matches) {
    return (
      <UnitTypesSubPage
        unitTypes={project.units || []}
        selectedUnitId={selectedUnitId}
        projectId={project.id}
        projectName={project.project_name}
        onUnitSelect={handleUnitSelect}
        onBack={handleBackFromUnitDetail}
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
    <div ref={scrollContainerRef} className="flex-1 bg-slate-50 overflow-auto">
      {/* Tabs Container */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Sticky TabsList */}
        <div className="sticky top-0 z-50 bg-white border-b shadow-sm">
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
                <TabsTrigger value="overview" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.overview')}</TabsTrigger>
                <TabsTrigger value="units" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.unitTypes')}</TabsTrigger>
                <TabsTrigger value="payment" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.paymentPlan')}</TabsTrigger>
                <TabsTrigger value="amenities" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.amenities')}</TabsTrigger>
                <TabsTrigger value="location" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.location')}</TabsTrigger>
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
                      <h1 className="text-base font-bold text-slate-900 truncate">{project.project_name}</h1>
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
                    </div>
                    <Button
                      variant={isFav ? "default" : "outline"}
                      size="icon"
                      className="h-9 w-9 flex-shrink-0"
                      onClick={handleToggleFavorite}
                    >
                      <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
                    </Button>
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
            ) : (
              /* Desktop: Full content with gallery and info card */
              <div className="container mx-auto px-4 py-8">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {/* Image Gallery and Project Info */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
                    <ImageGallery
                      images={project.project_images}
                      buildingName={project.project_name}
                      currentImageIndex={currentImageIndex}
                      onImageIndexChange={setCurrentImageIndex}
                    />
                    <ProjectInfoCard
                      project={project}
                      isFavorite={isFav}
                      onToggleFavorite={handleToggleFavorite}
                    />
                  </div>

                  {/* Overview Content */}
                  <OverviewTab project={project} />
                </motion.div>
              </div>
            )}
          </TabsContent>

          {/* Other Tabs - Compact header + content */}
          <TabsContent value="units" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <UnitTypesTab
                unitTypes={project.units || []}
                projectId={project.id}
                onUnitSelect={handleUnitSelect}
              />
            </div>
          </TabsContent>

          <TabsContent value="payment" className="mt-0">
            <CompactProjectHeader />
            <div className="container mx-auto px-4 py-6">
              <PaymentPlanTab paymentPlan={project.payment_plan || []} />
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
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Mobile: Floating Pull-up Handle & Sheet */}
        {isMobile && activeTab === 'overview' && (
          <>
            {/* Large mist effect covering bottom 20% */}
            <AnimatePresence>
              {!showMobileInfo && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowMobileInfo(true)}
                  className="fixed left-0 right-0 bottom-0 z-50 flex flex-col items-center justify-end"
                  style={{ height: '22vh', paddingBottom: '75px' }}
                >
                  {/* Full-width white mist gradient - more square */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'linear-gradient(to top, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0.5) 80%, transparent 100%)'
                    }}
                  />

                  {/* Subtle animated glow - CSS animation */}
                  <div className="absolute bottom-16 left-4 right-4 h-20 bg-white/80 blur-2xl animate-glow" />

                  {/* Floating text + icon - CSS animation for smooth performance */}
                  <div className="relative flex items-center gap-2 animate-float">
                    <ChevronUp className="h-5 w-5 text-slate-500" />
                    <span className="text-sm font-medium text-slate-500">
                      {t('project:moreDetails', 'More Details')}
                    </span>
                  </div>
                </motion.button>
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
                    className="fixed inset-0 bg-black/40 z-50"
                  />

                  {/* Sheet */}
                  <motion.div
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-3xl max-h-[80vh] overflow-auto"
                  >
                    {/* Handle bar */}
                    <div className="sticky top-0 bg-white pt-3 pb-2">
                      <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto" />
                    </div>

                    {/* Content */}
                    <div className="p-5">
                      {/* Header with close */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h2 className="text-xl font-bold text-slate-900">{project.project_name}</h2>
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
                          <div className="bg-slate-50 rounded-xl p-3">
                            <div className="text-slate-500 text-sm">{t('project:status', 'Status')}</div>
                            <div className="text-lg font-semibold text-slate-900 mt-1 capitalize">
                              {project.status.replace('_', ' ')}
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
                      <div className="flex gap-3">
                        <Button
                          onClick={handleToggleFavorite}
                          variant={isFav ? "default" : "outline"}
                          className="flex-1"
                        >
                          <Heart className={`h-4 w-4 mr-2 ${isFav ? 'fill-current' : ''}`} />
                          {isFav ? t('project:saved', 'Saved') : t('project:save', 'Save')}
                        </Button>
                        <Button
                          onClick={() => {
                            setShowMobileInfo(false)
                            handleTabChange('units')
                          }}
                          className="flex-1"
                        >
                          {t('project:viewUnits', 'View Units')}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </>
        )}
    </div>
  )
}
