import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import MapViewClustered from '../components/MapViewClustered'
import { AreaMetric } from '../components/MapViewClustered'
import FilterDialog from '../components/FilterDialog'
import ClusterDialog from '../components/ClusterDialog'
import AreaDetailDialog from '../components/AreaDetailDialog'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Search, SlidersHorizontal, Layers, RefreshCw } from 'lucide-react'
import { formatPrice } from '../lib/utils'
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

  // Handle cluster click to show properties in dialog
  const handleClusterClick = useCallback(async (cluster: any) => {
    if (!cluster.property_ids || cluster.property_ids.length === 0) return

    setSelectedClusterProperties([])
    setClusterDialogPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    setIsLoadingClusterProperties(true)
    setShowClusterDialog(true)

    try {
      const projects = await fetchResidentialProjectsBatch(cluster.property_ids)
      setSelectedClusterProperties(projects)
      setIsLoadingClusterProperties(false)
    } catch (error) {
      console.error('Error fetching cluster projects:', error)
      setIsLoadingClusterProperties(false)
    }
  }, [])

  // Handle area click to show area detail dialog with projects
  const handleAreaClick = useCallback(async (area: DubaiArea) => {
    setSelectedArea(area)
    setAreaProjects([])
    setIsLoadingAreaProjects(true)
    setShowAreaDialog(true)

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
  }, [])

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

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-slate-50">
      {/* Search and Filter Bar */}
      <div className="bg-white shadow-sm z-10">
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
      <div className="flex-1 p-6">
        <div className="h-full rounded-xl overflow-hidden shadow-2xl border border-slate-200 relative">
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

          {/* Last Updated Badge - Floating on Map */}
          <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-slate-200 z-[1000]">
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

      {/* Cluster Dialog */}
      <ClusterDialog
        isOpen={showClusterDialog}
        onClose={() => setShowClusterDialog(false)}
        properties={selectedClusterProperties}
        position={clusterDialogPosition}
        isLoading={isLoadingClusterProperties}
      />

      {/* Area Detail Dialog */}
      <AreaDetailDialog
        isOpen={showAreaDialog}
        onClose={() => setShowAreaDialog(false)}
        area={selectedArea}
        projects={areaProjects}
        isLoading={isLoadingAreaProjects}
      />
    </div>
  )
}
