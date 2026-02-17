import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { ArrowLeft, MapPin, Building2, Heart } from 'lucide-react'
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
      {/* Back Button */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <Link to="/map">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('project:backToProperties')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs Container */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Sticky TabsList */}
        <div className="sticky top-0 z-50 bg-white border-b shadow-sm">
          <div className="container mx-auto px-4">
            <TabsList className="w-full overflow-x-auto flex md:grid md:grid-cols-5 justify-start md:justify-center h-12 bg-transparent">
              <TabsTrigger value="overview" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.overview')}</TabsTrigger>
              <TabsTrigger value="units" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.unitTypes')}</TabsTrigger>
              <TabsTrigger value="payment" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.paymentPlan')}</TabsTrigger>
              <TabsTrigger value="amenities" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.amenities')}</TabsTrigger>
              <TabsTrigger value="location" className="flex-shrink-0 data-[state=active]:bg-primary/10">{t('project:tabs.location')}</TabsTrigger>
            </TabsList>
          </div>
        </div>

          {/* Overview Tab - Full content with gallery and info card */}
          <TabsContent value="overview" className="mt-0">
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
    </div>
  )
}
