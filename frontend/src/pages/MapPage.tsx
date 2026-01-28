import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import MapViewClustered from '../components/MapViewClustered'
import { AreaMetric } from '../components/MapViewClustered'
import FilterDialog from '../components/FilterDialog'
import ClusterDialog from '../components/ClusterDialog'
import AreaDetailDialog from '../components/AreaDetailDialog'
import MobileBottomSheet from '../components/MobileBottomSheet'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Search, SlidersHorizontal, Layers, RefreshCw, Building2, Bed, Calendar } from 'lucide-react'
import { formatPrice } from '../lib/utils'
import { getImageUrl } from '../lib/image-utils'
import {
  fetchResidentialProjectClusters,
  fetchResidentialDevelopers,
  fetchResidentialAreas,
  fetchResidentialProjects,
  fetchResidentialProjectsBatch,
  fetchDubaiAreas,
  fetchDubaiLandmarks
} from '../lib/api'

const METRIC_OPTIONS: { value: AreaMetric; labelKey: string }[] = [
  { value: 'avgPrice', labelKey: 'map:metric.avgPrice' },
  { value: 'capitalGrowth', labelKey: 'map:metric.capitalGrowth' },
  { value: 'salesVolume', labelKey: 'map:metric.salesVolume' },
  { value: 'rentalYield', labelKey: 'map:metric.rentalYield' },
]

export default function MapPage() {
  const { t } = useTranslation(['map', 'common'])
  const [filters, setFilters] = useState<PropertyFilters>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [clusters, setClusters] = useState<any[]>([])
  const [developers, setDevelopers] = useState<string[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [projects, setProjects] = useState<{ project_name: string; developer: string }[]>([])
  const [mapBounds, setMapBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)
  const [mapZoom, setMapZoom] = useState<number>(12)

  // Dubai areas and landmarks state
  const [dubaiAreas, setDubaiAreas] = useState<DubaiArea[]>([])
  const [dubaiLandmarks, setDubaiLandmarks] = useState<DubaiLandmark[]>([])
  const [showDubaiLayer, setShowDubaiLayer] = useState(true)
  const [dubaiDataVersion, setDubaiDataVersion] = useState(0)

  // Cluster dialog state
  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [selectedClusterProperties, setSelectedClusterProperties] = useState<any[]>([])
  const [clusterDialogPosition, setClusterDialogPosition] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const [isLoadingClusterProperties, setIsLoadingClusterProperties] = useState(false)
  const [isLoadingClusters, setIsLoadingClusters] = useState(false)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Area metric overlay state — persisted in localStorage
  const [areaMetric, setAreaMetric] = useState<AreaMetric>(() => {
    const saved = localStorage.getItem('map-area-metric')
    if (saved && ['avgPrice', 'capitalGrowth', 'salesVolume', 'rentalYield', 'none'].includes(saved)) {
      return saved as AreaMetric
    }
    return 'capitalGrowth'
  })
  const handleMetricToggle = (value: AreaMetric) => {
    const next = areaMetric === value ? 'none' : value
    setAreaMetric(next)
    localStorage.setItem('map-area-metric', next)
  }

  // Area detail dialog state
  const [showAreaDialog, setShowAreaDialog] = useState(false)
  const [selectedArea, setSelectedArea] = useState<DubaiArea | null>(null)
  const [areaProjects, setAreaProjects] = useState<any[]>([])
  const [isLoadingAreaProjects, setIsLoadingAreaProjects] = useState(false)

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Mobile bottom sheet state
  const [showClusterSheet, setShowClusterSheet] = useState(false)
  const [showAreaSheet, setShowAreaSheet] = useState(false)

  // Load initial metadata (only once, with caching)
  useEffect(() => {
    const DUBAI_CACHE_DURATION = 24 * 60 * 60 * 1000
    const METADATA_CACHE_DURATION = 5 * 60 * 1000

    const cachedDevelopers = localStorage.getItem('gulf_residential_developers')
    const cachedDevTimestamp = localStorage.getItem('gulf_residential_developers_timestamp')

    if (cachedDevelopers && cachedDevTimestamp &&
        Date.now() - parseInt(cachedDevTimestamp) < METADATA_CACHE_DURATION) {
      setDevelopers(JSON.parse(cachedDevelopers))
    } else {
      fetchResidentialDevelopers().then((data) => {
        const sorted = data.map(d => d.developer).sort()
        setDevelopers(sorted)
        localStorage.setItem('gulf_residential_developers', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_developers_timestamp', Date.now().toString())
      })
    }

    const cachedAreas = localStorage.getItem('gulf_residential_areas')
    const cachedAreasTimestamp = localStorage.getItem('gulf_residential_areas_timestamp')

    if (cachedAreas && cachedAreasTimestamp &&
        Date.now() - parseInt(cachedAreasTimestamp) < METADATA_CACHE_DURATION) {
      setAreas(JSON.parse(cachedAreas))
    } else {
      fetchResidentialAreas().then((data) => {
        const sorted = data.map(a => a.area_name).sort()
        setAreas(sorted)
        localStorage.setItem('gulf_residential_areas', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_areas_timestamp', Date.now().toString())
      })
    }

    const cachedProjects = localStorage.getItem('gulf_residential_projects')
    const cachedProjectsTimestamp = localStorage.getItem('gulf_residential_projects_timestamp')

    if (cachedProjects && cachedProjectsTimestamp &&
        Date.now() - parseInt(cachedProjectsTimestamp) < METADATA_CACHE_DURATION) {
      setProjects(JSON.parse(cachedProjects))
    } else {
      fetchResidentialProjects().then((data) => {
        const sorted = data.sort((a, b) => a.project_name.localeCompare(b.project_name))
        setProjects(sorted)
        localStorage.setItem('gulf_residential_projects', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_projects_timestamp', Date.now().toString())
      })
    }

    const cachedDubaiAreas = localStorage.getItem('gulf_dubai_areas')
    const cachedDubaiAreasTimestamp = localStorage.getItem('gulf_dubai_areas_timestamp')

    if (cachedDubaiAreas && cachedDubaiAreasTimestamp &&
        Date.now() - parseInt(cachedDubaiAreasTimestamp) < DUBAI_CACHE_DURATION) {
      const areas = JSON.parse(cachedDubaiAreas)
      setDubaiAreas(areas)
    } else {
      fetchDubaiAreas().then((data) => {
        setDubaiAreas(data)
        localStorage.setItem('gulf_dubai_areas', JSON.stringify(data))
        localStorage.setItem('gulf_dubai_areas_timestamp', Date.now().toString())
      })
    }

    const cachedDubaiLandmarks = localStorage.getItem('gulf_dubai_landmarks')
    const cachedDubaiLandmarksTimestamp = localStorage.getItem('gulf_dubai_landmarks_timestamp')

    if (cachedDubaiLandmarks && cachedDubaiLandmarksTimestamp &&
        Date.now() - parseInt(cachedDubaiLandmarksTimestamp) < DUBAI_CACHE_DURATION) {
      const landmarks = JSON.parse(cachedDubaiLandmarks)
      setDubaiLandmarks(landmarks)
    } else {
      fetchDubaiLandmarks().then((data) => {
        setDubaiLandmarks(data)
        localStorage.setItem('gulf_dubai_landmarks', JSON.stringify(data))
        localStorage.setItem('gulf_dubai_landmarks_timestamp', Date.now().toString())
      })
    }
  }, [dubaiDataVersion])

  // Listen for Dubai data updates from editor
  useEffect(() => {
    let lastReloadTime = 0

    const triggerReload = (source: string) => {
      const now = Date.now()
      if (now - lastReloadTime > 2000) {
        console.log(`🔄 Detected Dubai data update via ${source}, reloading...`)
        lastReloadTime = now
        setDubaiDataVersion(v => v + 1)
      }
    }

    const handleFocus = () => {
      const cachedTimestamp = localStorage.getItem('gulf_dubai_areas_timestamp')
      const cachedLandmarksTimestamp = localStorage.getItem('gulf_dubai_landmarks_timestamp')

      if (cachedTimestamp && Date.now() - parseInt(cachedTimestamp) < 10000) {
        triggerReload('focus')
      } else if (cachedLandmarksTimestamp && Date.now() - parseInt(cachedLandmarksTimestamp) < 10000) {
        triggerReload('focus')
      }
    }

    const handleDubaiDataUpdate = () => {
      triggerReload('custom event')
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('dubaiDataUpdated', handleDubaiDataUpdate)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('dubaiDataUpdated', handleDubaiDataUpdate)
    }
  }, [])

  // Load clusters with manual debounce
  useEffect(() => {
    if (!mapBounds) return

    const timeoutId = setTimeout(() => {
      if (isLoadingClusters) return

      const loadClusters = async () => {
        setIsLoadingClusters(true)
        try {
          const bounds = {
            minLng: mapBounds.minLng,
            minLat: mapBounds.minLat,
            maxLng: mapBounds.maxLng,
            maxLat: mapBounds.maxLat,
          }

          const data = await fetchResidentialProjectClusters(
            mapZoom,
            bounds,
            {
              developer: filters.developer,
              project: filters.project,
              area: filters.area,
              minPrice: filters.minPrice,
              maxPrice: filters.maxPrice,
              minBedrooms: filters.minBedrooms,
              maxBedrooms: filters.maxBedrooms,
              minSize: filters.minSize,
              maxSize: filters.maxSize,
              status: filters.status,
            }
          )

          const transformedClusters = data.map((cluster: any) => ({
            ...cluster,
            count: parseInt(cluster.count),
            price_range: {
              min: cluster.min_price,
              max: cluster.max_price,
              avg: cluster.avg_price
            },
            center: {
              lat: cluster.lat,
              lng: cluster.lng
            }
          }))

          setClusters(transformedClusters)
          setLastUpdated(new Date())
        } catch (error: any) {
          console.error('Error fetching clusters:', error)
        } finally {
          setIsLoadingClusters(false)
        }
      }

      loadClusters()
    }, 150)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [filters, mapBounds, mapZoom])

  const handleMapBoundsChange = useCallback((bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => {
    setMapBounds(bounds)
    setMapZoom(zoom)
  }, [])

  const handleRefreshMetadata = useCallback(async () => {
    setIsRefreshingMetadata(true)
    try {
      localStorage.removeItem('gulf_residential_developers')
      localStorage.removeItem('gulf_residential_developers_timestamp')
      localStorage.removeItem('gulf_residential_areas')
      localStorage.removeItem('gulf_residential_areas_timestamp')
      localStorage.removeItem('gulf_residential_projects')
      localStorage.removeItem('gulf_residential_projects_timestamp')

      const [developersData, areasData, projectsData] = await Promise.all([
        fetchResidentialDevelopers(),
        fetchResidentialAreas(),
        fetchResidentialProjects(),
      ])

      const sortedDevelopers = developersData.map(d => d.developer).sort()
      const sortedAreas = areasData.map(a => a.area_name).sort()
      const sortedProjects = projectsData.sort((a, b) => a.project_name.localeCompare(b.project_name))

      setDevelopers(sortedDevelopers)
      setAreas(sortedAreas)
      setProjects(sortedProjects)

      localStorage.setItem('gulf_residential_developers', JSON.stringify(sortedDevelopers))
      localStorage.setItem('gulf_residential_developers_timestamp', Date.now().toString())
      localStorage.setItem('gulf_residential_areas', JSON.stringify(sortedAreas))
      localStorage.setItem('gulf_residential_areas_timestamp', Date.now().toString())
      localStorage.setItem('gulf_residential_projects', JSON.stringify(sortedProjects))
      localStorage.setItem('gulf_residential_projects_timestamp', Date.now().toString())
    } catch (error) {
      console.error('Error refreshing metadata:', error)
    } finally {
      setIsRefreshingMetadata(false)
    }
  }, [])

  // Handle cluster click to show properties in dialog (or bottom sheet on mobile)
  const handleClusterClick = useCallback(async (cluster: any) => {
    if (!cluster.property_ids || cluster.property_ids.length === 0) return

    setSelectedClusterProperties([])
    setIsLoadingClusterProperties(true)

    if (isMobile) {
      setShowClusterSheet(true)
    } else {
      setClusterDialogPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      setShowClusterDialog(true)
    }

    try {
      const projects = await fetchResidentialProjectsBatch(cluster.property_ids)
      setSelectedClusterProperties(projects)
      setIsLoadingClusterProperties(false)
    } catch (error) {
      console.error('Error fetching cluster projects:', error)
      setIsLoadingClusterProperties(false)
    }
  }, [isMobile])

  // Handle area click to show area detail dialog (or bottom sheet on mobile)
  const handleAreaClick = useCallback(async (area: DubaiArea) => {
    setSelectedArea(area)
    setAreaProjects([])
    setIsLoadingAreaProjects(true)

    if (isMobile) {
      setShowAreaSheet(true)
    } else {
      setShowAreaDialog(true)
    }

    try {
      // Compute bounding box from polygon coordinates
      const coords = (area.boundary as any)?.coordinates?.[0]
      if (!coords || coords.length === 0) {
        setIsLoadingAreaProjects(false)
        return
      }

      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }

      const areaBounds = { minLng, minLat, maxLng, maxLat }

      // Fetch clusters at high zoom to get all individual projects in the area
      const clusterData = await fetchResidentialProjectClusters(20, areaBounds, { area: area.name })

      // Collect all property IDs
      const allPropertyIds: string[] = []
      for (const cluster of clusterData) {
        if (cluster.property_ids) {
          allPropertyIds.push(...cluster.property_ids)
        }
      }

      if (allPropertyIds.length === 0) {
        setAreaProjects([])
        setIsLoadingAreaProjects(false)
        return
      }

      // Fetch full project details (batch supports max 20)
      const uniqueIds = [...new Set(allPropertyIds)]
      const projectDetails = await fetchResidentialProjectsBatch(uniqueIds.slice(0, 20))
      setAreaProjects(projectDetails)
    } catch (error) {
      console.error('Error fetching area projects:', error)
    } finally {
      setIsLoadingAreaProjects(false)
    }
  }, [isMobile])

  const formatLastUpdated = (date: Date) => {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

    if (diffInSeconds < 60) return t('common:dates.justNow')
    if (diffInSeconds < 3600) return t('common:dates.mAgo', { count: Math.floor(diffInSeconds / 60) })
    if (diffInSeconds < 86400) return t('common:dates.hAgo', { count: Math.floor(diffInSeconds / 3600) })
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const hasActiveFilters =
    filters.developer ||
    filters.project ||
    filters.area ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.minPriceSqft ||
    filters.maxPriceSqft ||
    filters.minBedrooms ||
    filters.maxBedrooms ||
    filters.minSize ||
    filters.maxSize ||
    filters.launchDateStart ||
    filters.launchDateEnd ||
    filters.completionDateStart ||
    filters.completionDateEnd ||
    filters.minCompletionPercent !== undefined ||
    filters.maxCompletionPercent !== undefined ||
    filters.status ||
    searchQuery

  const formatValue = (value: number | undefined, type: 'price' | 'volume' | 'percent'): string => {
    if (value === undefined || value === null) return '-'
    if (type === 'percent') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M AED`
    if (value >= 1000) return `${(value / 1000).toFixed(0)}K AED`
    return `${value} AED`
  }

  // Group area projects by developer for mobile bottom sheet
  const areaDevelopers = useMemo(() => {
    if (!areaProjects || areaProjects.length === 0) return []
    const map = new Map<string, { name: string; logoUrl?: string; projectCount: number; projectNames: string[] }>()
    for (const p of areaProjects) {
      const dev = p.developer || 'Unknown'
      if (!map.has(dev)) {
        map.set(dev, { name: dev, logoUrl: p.developerLogoUrl, projectCount: 0, projectNames: [] })
      }
      const entry = map.get(dev)!
      entry.projectCount++
      if (entry.projectNames.length < 5) {
        entry.projectNames.push(p.buildingName || p.projectName || '')
      }
    }
    return Array.from(map.values()).sort((a, b) => b.projectCount - a.projectCount)
  }, [areaProjects])

  // Cluster sheet title
  const clusterSheetTitle = selectedClusterProperties.length > 0
    ? selectedClusterProperties[0].buildingName || t('map:properties')
    : t('map:properties')

  return (
    <div className="flex flex-col h-[calc(100dvh-64px-64px-14px)] md:h-[calc(100vh-80px)] bg-white">
      {/* Search and Filter Bar — desktop only */}
      <div className="hidden md:block bg-white shadow-sm z-10">
        <div className="px-6 py-4">
          <div className="flex flex-col gap-3">
            {/* Search Bar */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-5 w-5" />
                <Input
                  type="text"
                  placeholder={t('map:searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12 text-base"
                />
              </div>
              <Button
                variant="outline"
                className="h-12 px-6"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="h-5 w-5 mr-2" />
                {t('map:filters')}
                {hasActiveFilters && (
                  <span className="ml-2 bg-primary text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
                    !
                  </span>
                )}
              </Button>
              <Button
                variant={showDubaiLayer ? "default" : "outline"}
                className="h-12 px-6"
                onClick={() => setShowDubaiLayer(!showDubaiLayer)}
              >
                <Layers className="h-5 w-5 mr-2" />
                {t('map:areasAndLandmarks')}
              </Button>
              <Button
                variant="ghost"
                className="h-12 px-4"
                onClick={handleRefreshMetadata}
                disabled={isRefreshingMetadata}
                title="Refresh filter lists (developers, areas, projects)"
              >
                <RefreshCw className={`h-5 w-5 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {/* Active Filters Summary */}
            {hasActiveFilters && !showFilters && (
              <div className="flex flex-wrap gap-2 text-sm">
                {filters.developer && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:developer')}: {filters.developer}
                  </span>
                )}
                {filters.project && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:project')}: {filters.project}
                  </span>
                )}
                {filters.area && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:area')}: {filters.area}
                  </span>
                )}
                {(filters.minPrice || filters.maxPrice) && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:price')}: {filters.minPrice ? formatPrice(filters.minPrice) : '0'} - {filters.maxPrice ? formatPrice(filters.maxPrice) : '∞'}
                  </span>
                )}
                {filters.minBedrooms !== undefined && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.minBedrooms === 0 ? t('map:studio') : t('map:beds', { count: filters.minBedrooms })}
                  </span>
                )}
                {filters.status && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.status === 'under-construction' ? t('common:status.underConstruction') :
                     filters.status === 'upcoming' ? t('common:status.upcoming') : t('common:status.completed')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map Section - Full Width */}
      <div className="flex-1 p-0 md:p-6">
        <div className="h-full md:rounded-xl overflow-hidden md:shadow-2xl md:border md:border-slate-200 relative">
          <MapViewClustered
            clusters={clusters}
            onBoundsChange={handleMapBoundsChange}
            onClusterClick={handleClusterClick}
            onAreaClick={handleAreaClick}
            areaMetric={areaMetric}
            dubaiAreas={dubaiAreas}
            dubaiLandmarks={dubaiLandmarks}
            showDubaiLayer={showDubaiLayer}
          />

          {/* Floating mobile controls — search, filter, layers */}
          <div className="absolute top-3 left-3 z-[1000] flex items-center gap-2 md:hidden">
            <button
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/90 shadow-md rounded-full text-sm font-medium text-slate-700"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowFilters(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/90 shadow-md rounded-full text-sm font-medium text-slate-700"
            >
              <SlidersHorizontal className="w-4 h-4" />
              {hasActiveFilters && (
                <span className="w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
            <button
              onClick={() => setShowDubaiLayer(!showDubaiLayer)}
              className={`flex items-center gap-1.5 px-3 py-2 shadow-md rounded-full text-sm font-medium ${
                showDubaiLayer ? 'bg-primary text-white' : 'bg-white/90 text-slate-700'
              }`}
            >
              <Layers className="w-4 h-4" />
            </button>
          </div>

          {/* Last Updated Badge - Floating on Map, hidden on mobile */}
          <div className="hidden md:flex absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-slate-200 z-[1000]">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-slate-600">
                {t('common:dates.lastUpdated')}: <span className="font-medium text-slate-900">{formatLastUpdated(lastUpdated)}</span>
              </span>
            </div>
          </div>

          {/* Metric Toggle - Floating top-right, visible when areas layer is on */}
          {showDubaiLayer && (
            <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 z-[1000] p-1">
              <div className="flex items-center gap-0.5">
                {METRIC_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleMetricToggle(option.value)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      areaMetric === option.value
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {t(option.labelKey as any)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter Dialog */}
      <FilterDialog
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onFiltersChange={setFilters}
        developers={developers}
        areas={areas}
        projects={projects}
      />

      {/* Desktop: Cluster Dialog */}
      <ClusterDialog
        isOpen={showClusterDialog}
        onClose={() => setShowClusterDialog(false)}
        properties={selectedClusterProperties}
        position={clusterDialogPosition}
        isLoading={isLoadingClusterProperties}
      />

      {/* Desktop: Area Detail Dialog */}
      <AreaDetailDialog
        isOpen={showAreaDialog}
        onClose={() => setShowAreaDialog(false)}
        area={selectedArea}
        projects={areaProjects}
        isLoading={isLoadingAreaProjects}
      />

      {/* Mobile: Cluster Bottom Sheet */}
      <MobileBottomSheet
        isOpen={showClusterSheet}
        onClose={() => setShowClusterSheet(false)}
        title={clusterSheetTitle}
      >
        {isLoadingClusterProperties ? (
          <div className="flex items-center justify-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-blue-600"></div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {selectedClusterProperties.map((property) => (
              <Link
                key={property.id}
                to={`/project/${property.id}`}
                className="block p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                onClick={() => setShowClusterSheet(false)}
              >
                <div className="flex gap-3">
                  {/* Thumbnail */}
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                    {property.images && property.images.length > 0 ? (
                      <img
                        src={getImageUrl(property.images[0], 'thumbnail')}
                        alt={property.buildingName}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-slate-300" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-slate-900 truncate">{property.buildingName}</h4>
                    <p className="text-sm font-bold text-blue-700 mt-0.5">
                      {property.startingPrice ? formatPrice(property.startingPrice) : t('common:price.priceOnApplication')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{property.developer}</p>

                    {/* Beds + Completion date row */}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-500">
                      {(property.minBedrooms !== undefined || property.maxBedrooms !== undefined) && (
                        <span className="inline-flex items-center gap-1">
                          <Bed className="w-3.5 h-3.5" />
                          {property.minBedrooms === property.maxBedrooms
                            ? (property.minBedrooms === 0 ? t('map:studio') : property.minBedrooms)
                            : `${property.minBedrooms}-${property.maxBedrooms}`}
                        </span>
                      )}
                      {property.completionDate && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(property.completionDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar — only for non-completed projects */}
                {property.status !== 'completed' && property.completionPercent !== undefined && property.completionPercent >= 0 && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                      <div
                        className="bg-blue-600 h-1.5 rounded-full"
                        style={{ width: `${property.completionPercent}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-semibold text-blue-700 tabular-nums">{property.completionPercent}%</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </MobileBottomSheet>

      {/* Mobile: Area Bottom Sheet */}
      <MobileBottomSheet
        isOpen={showAreaSheet}
        onClose={() => setShowAreaSheet(false)}
        title={selectedArea?.name || ''}
      >
        {isLoadingAreaProjects ? (
          <div className="flex items-center justify-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-blue-600"></div>
          </div>
        ) : selectedArea ? (
          <div className="p-4 space-y-5">
            {/* Market Stats Grid */}
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                {t('map:areaDialog.marketStatistics')}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {selectedArea.projectCounts !== undefined && selectedArea.projectCounts > 0 && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.projects')}</div>
                    <div className="text-lg font-bold text-slate-900">{selectedArea.projectCounts}</div>
                  </div>
                )}
                {selectedArea.averagePrice !== undefined && selectedArea.averagePrice !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.avgPrice')}</div>
                    <div className="text-base font-bold text-slate-900">{formatValue(selectedArea.averagePrice, 'price')}</div>
                  </div>
                )}
                {selectedArea.salesVolume !== undefined && selectedArea.salesVolume !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.salesVolume')}</div>
                    <div className="text-base font-bold text-slate-900">{formatValue(selectedArea.salesVolume, 'volume')}</div>
                  </div>
                )}
                {selectedArea.capitalAppreciation !== undefined && selectedArea.capitalAppreciation !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.capitalGrowth')}</div>
                    <div className={`text-base font-bold ${selectedArea.capitalAppreciation >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {formatValue(selectedArea.capitalAppreciation, 'percent')}
                    </div>
                  </div>
                )}
                {selectedArea.rentalYield !== undefined && selectedArea.rentalYield !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.rentalYield')}</div>
                    <div className="text-base font-bold text-slate-900">{selectedArea.rentalYield.toFixed(1)}%</div>
                  </div>
                )}
              </div>
            </div>

            {/* Developer Cards */}
            {areaDevelopers.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                  {t('map:areaDialog.developersInArea', { count: areaDevelopers.length })}
                </h4>
                <div className="space-y-2">
                  {areaDevelopers.map((dev) => (
                    <div key={dev.name} className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-2.5">
                        {dev.logoUrl ? (
                          <img src={dev.logoUrl} alt={dev.name} className="w-8 h-8 object-contain rounded-lg border border-slate-100" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                            <Building2 className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-800 truncate">{dev.name}</div>
                          <div className="text-xs text-slate-500">
                            {t('map:areaDialog.projectCount', { count: dev.projectCount })}
                          </div>
                        </div>
                      </div>
                      {dev.projectNames.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {dev.projectNames.map((name, i) => (
                            <span key={i} className="inline-block px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-[11px] border border-slate-100 truncate max-w-[160px]">
                              {name}
                            </span>
                          ))}
                          {dev.projectCount > 5 && (
                            <span className="inline-block px-2 py-0.5 text-slate-400 text-[11px]">+{dev.projectCount - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </MobileBottomSheet>
    </div>
  )
}
