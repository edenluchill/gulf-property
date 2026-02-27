import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import MapViewMapLibre, { AreaMetric, TransportStation } from '../components/MapViewMapLibre'
import FilterDialog from '../components/FilterDialog'
import AreaDetailDialog from '../components/AreaDetailDialog'
import MobileBottomSheet from '../components/MobileBottomSheet'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import {
  Search, SlidersHorizontal, RefreshCw, Building2, MapPin, X,
  DollarSign, TrendingUp, BarChart3, Percent,
  Cross, GraduationCap, TrainFront, Phone, Globe, Navigation, ShoppingCart
} from 'lucide-react'
import { useDubaiPois, PoiCategory, POI_CATEGORIES, POI_GROUPS, Poi, getCategoryInfo } from '../hooks/useDubaiPois'
import { formatPrice } from '../lib/utils'
import {
  fetchResidentialMapPins,
  fetchResidentialDevelopers,
  fetchResidentialAreas,
  fetchResidentialProjects,
  fetchResidentialProjectsBatch,
  fetchDubaiAreas,
  fetchDubaiLandmarks,
  searchDubaiAreas,
  fetchCustomRoutesGeoJSON,
  AreaSearchResult,
  TransportGeoJSON,
  MapPinProject
} from '../lib/api'

const METRIC_OPTIONS = [
  { value: 'medianUnitPrice' as AreaMetric, labelKey: 'map:metric.medianUnitPrice', Icon: DollarSign },
  { value: 'medianPriceSqft' as AreaMetric, labelKey: 'map:metric.medianPriceSqft', Icon: DollarSign },
  { value: 'capitalGrowth' as AreaMetric, labelKey: 'map:metric.capitalGrowth', Icon: TrendingUp },
  { value: 'transactionCount' as AreaMetric, labelKey: 'map:metric.transactionCount', Icon: BarChart3 },
  { value: 'rentalYield' as AreaMetric, labelKey: 'map:metric.rentalYield', Icon: Percent },
]

// ============================================================================
// MAP DATA VERSION - Increment this to force all clients to reload map data
// Format: YYYYMMDD or any string. When changed, all cached data will be cleared.
// ============================================================================
const MAP_DATA_VERSION = '20260227-custom-routes'

// Clear all map-related cache if version changed
function checkAndClearCache() {
  const cachedVersion = localStorage.getItem('gulf_map_data_version')
  if (cachedVersion !== MAP_DATA_VERSION) {
    console.log(`[MapPage] Version changed: ${cachedVersion} → ${MAP_DATA_VERSION}, clearing cache...`)
    // Clear all gulf_ prefixed cache items and POI cache
    const keysToRemove = [
      'gulf_residential_developers', 'gulf_residential_developers_timestamp',
      'gulf_residential_areas', 'gulf_residential_areas_timestamp',
      'gulf_residential_projects', 'gulf_residential_projects_timestamp',
      'gulf_dubai_areas', 'gulf_dubai_areas_timestamp',
      'gulf_dubai_landmarks', 'gulf_dubai_landmarks_timestamp',
      'dubai_pois_cache',  // POI data from OSM
      'transport-geojson-cache',  // Custom routes data
    ]
    keysToRemove.forEach(key => localStorage.removeItem(key))
    localStorage.setItem('gulf_map_data_version', MAP_DATA_VERSION)
    return true // Cache was cleared
  }
  return false // Cache is valid
}

// Run on module load
checkAndClearCache()

export default function MapPage() {
  const { t, i18n } = useTranslation(['map', 'common'])
  const navigate = useNavigate()
  const [filters, setFilters] = useState<PropertyFilters>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [mapPins, setMapPins] = useState<MapPinProject[]>([])
  const [developers, setDevelopers] = useState<string[]>([])
  const [areas, setAreas] = useState<string[]>([])
  const [projects, setProjects] = useState<{ project_name: string; developer: string }[]>([])
  const [mapBounds, setMapBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)

  // Dubai areas and landmarks state
  const [dubaiAreas, setDubaiAreas] = useState<DubaiArea[]>([])
  const [dubaiLandmarks, setDubaiLandmarks] = useState<DubaiLandmark[]>([])
  const [dubaiDataVersion, setDubaiDataVersion] = useState(0)

  // Loading states
  const [_isLoadingPins, setIsLoadingPins] = useState(false)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Area metric overlay state — persisted in localStorage
  const [areaMetric, setAreaMetric] = useState<AreaMetric>(() => {
    const saved = localStorage.getItem('map-area-metric')
    // Migrate old values
    if (saved === 'salesVolume') return 'transactionCount'
    if (saved === 'avgPrice' || saved === 'avgPriceSqft') return 'medianPriceSqft'
    if (saved === 'medianPrice') return 'medianUnitPrice'
    if (saved && ['medianUnitPrice', 'medianPriceSqft', 'capitalGrowth', 'transactionCount', 'rentalYield', 'none'].includes(saved)) {
      return saved as AreaMetric
    }
    return 'none'
  })
  const handleMetricToggle = (value: AreaMetric) => {
    const next = areaMetric === value ? 'none' : value
    setAreaMetric(next)
    localStorage.setItem('map-area-metric', next)
  }

  // POI state — persisted in localStorage (default: true)
  const [showPois] = useState(() => {
    const saved = localStorage.getItem('map-show-pois')
    return saved === null ? true : saved === 'true'
  })
  const [showPoiPanel, setShowPoiPanel] = useState(false)
  const [enabledPoiCategories, setEnabledPoiCategories] = useState<PoiCategory[]>(() => {
    const saved = localStorage.getItem('map-poi-categories')
    if (saved) {
      try {
        return JSON.parse(saved) as PoiCategory[]
      } catch { /* ignore */ }
    }
    // Default: show school
    return ['school']
  })

  // Transport layer state - single toggle for all transit (Metro/Tram/Monorail)
  const [showTransit, setShowTransit] = useState<boolean>(() => {
    return localStorage.getItem('map-show-transit') === 'true'
  })
  // Custom routes - no localStorage cache, always fetch fresh
  const [transportGeoJSON, setTransportGeoJSON] = useState<TransportGeoJSON | null>(null)
  const showTransport = showTransit

  // Quick toggle buttons - single categories
  const QUICK_BUTTONS = [
    { id: 'hospital' as PoiCategory, labelKey: 'map:poi.categories.hospital', color: '#0d9488', Icon: Cross },
    { id: 'school' as PoiCategory, labelKey: 'map:poi.categories.school', color: '#2563eb', Icon: GraduationCap },
    { id: 'supermarket' as PoiCategory, labelKey: 'map:poi.categories.supermarket', color: '#db2777', Icon: ShoppingCart },
  ] as const

  const { pois } = useDubaiPois({
    bounds: mapBounds || undefined,
    enabledCategories: enabledPoiCategories,
    enabled: showPois
  })


  const togglePoiCategory = useCallback((category: PoiCategory) => {
    setEnabledPoiCategories(prev => {
      const next = prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
      localStorage.setItem('map-poi-categories', JSON.stringify(next))
      return next
    })
  }, [])

  const toggleAllPoiCategories = useCallback((enable: boolean) => {
    const next = enable ? POI_CATEGORIES.map(c => c.id) : []
    setEnabledPoiCategories(next)
    localStorage.setItem('map-poi-categories', JSON.stringify(next))
  }, [])

  // Transit toggle - all Metro/Tram/Monorail
  const toggleTransit = useCallback(() => {
    setShowTransit(prev => {
      const next = !prev
      localStorage.setItem('map-show-transit', String(next))
      return next
    })
  }, [])

  // Fetch custom routes GeoJSON when transit is enabled (always fresh, no cache)
  useEffect(() => {
    if (showTransit) {
      // Always fetch fresh data when transit is shown
      fetchCustomRoutesGeoJSON().then(data => {
        if (data) {
          setTransportGeoJSON(data)
        }
      })
    }
  }, [showTransit])

  // Area detail dialog state
  const [showAreaDialog, setShowAreaDialog] = useState(false)
  const [selectedArea, setSelectedArea] = useState<DubaiArea | null>(null)
  const [areaProjects, setAreaProjects] = useState<any[]>([])
  const [isLoadingAreaProjects, setIsLoadingAreaProjects] = useState(false)

  // Area search state
  const [areaSearchQuery, setAreaSearchQuery] = useState('')
  const [areaSearchResults, setAreaSearchResults] = useState<AreaSearchResult[]>([])
  const [showAreaSearchResults, setShowAreaSearchResults] = useState(false)
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const areaSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // POI popup state
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null)

  // Transport station popup state
  const [selectedStation, setSelectedStation] = useState<TransportStation | null>(null)

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Mobile bottom sheet state
  const [showAreaSheet, setShowAreaSheet] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)

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

  // Load map pins (all projects at once, no clustering)
  useEffect(() => {
    const loadMapPins = async () => {
      setIsLoadingPins(true)
      try {
        const data = await fetchResidentialMapPins()
        setMapPins(data)
      } catch (error: any) {
        console.error('Error fetching map pins:', error)
      } finally {
        setIsLoadingPins(false)
      }
    }

    loadMapPins()
  }, []) // Load once on mount

  // Filter map pins based on current filters
  const filteredMapPins = useMemo(() => {
    if (!mapPins.length) return []

    return mapPins.filter(pin => {
      // Developer filter
      if (filters.developer && pin.developer !== filters.developer) return false

      // Area filter
      if (filters.area && pin.area !== filters.area) return false

      // Price filters
      if (filters.minPrice && (!pin.price || pin.price < filters.minPrice)) return false
      if (filters.maxPrice && pin.price && pin.price > filters.maxPrice) return false

      // Bedroom filters
      if (filters.minBedrooms !== undefined && (!pin.maxBeds || pin.maxBeds < filters.minBedrooms)) return false
      if (filters.maxBedrooms !== undefined && (!pin.minBeds || pin.minBeds > filters.maxBedrooms)) return false

      // Status filter
      if (filters.status && pin.status !== filters.status) return false

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = pin.name.toLowerCase().includes(query)
        const matchesDeveloper = pin.developer?.toLowerCase().includes(query)
        const matchesArea = pin.area?.toLowerCase().includes(query)
        if (!matchesName && !matchesDeveloper && !matchesArea) return false
      }

      return true
    })
  }, [mapPins, filters, searchQuery])

  const handleMapBoundsChange = useCallback((bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, _zoom: number) => {
    setMapBounds(bounds)
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

  // Handle project pin click - navigate directly to project detail
  const handleProjectClick = useCallback((project: MapPinProject) => {
    navigate(`/project/${project.id}`)
  }, [navigate])

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
      // Filter map pins by area name to get projects in this area
      const areaProjectIds = mapPins
        .filter(pin => pin.area === area.name)
        .map(pin => pin.id)

      if (areaProjectIds.length === 0) {
        setAreaProjects([])
        setIsLoadingAreaProjects(false)
        return
      }

      // Fetch full project details (batch supports max 20)
      const projectDetails = await fetchResidentialProjectsBatch(areaProjectIds.slice(0, 20))
      setAreaProjects(projectDetails)
    } catch (error) {
      console.error('Error fetching area projects:', error)
    } finally {
      setIsLoadingAreaProjects(false)
    }
  }, [isMobile, mapPins])

  // Handle area search with debounce
  const handleAreaSearch = useCallback((query: string) => {
    setAreaSearchQuery(query)

    if (areaSearchTimeoutRef.current) {
      clearTimeout(areaSearchTimeoutRef.current)
    }

    if (query.length < 2) {
      setAreaSearchResults([])
      setShowAreaSearchResults(false)
      return
    }

    areaSearchTimeoutRef.current = setTimeout(async () => {
      const results = await searchDubaiAreas(query)
      setAreaSearchResults(results)
      setShowAreaSearchResults(results.length > 0)
    }, 300)
  }, [])

  // Handle area selection from search results
  const handleAreaSelect = useCallback((area: AreaSearchResult) => {
    setFlyToLocation({
      lat: area.centroid.lat,
      lng: area.centroid.lng,
      zoom: 12
    })
    setAreaSearchQuery(area.name)
    setShowAreaSearchResults(false)

    // Clear flyTo after animation
    setTimeout(() => setFlyToLocation(null), 2000)
  }, [])

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

  return (
    <div className="flex flex-col h-full bg-white">
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
          <MapViewMapLibre
            projects={filteredMapPins}
            onBoundsChange={handleMapBoundsChange}
            onProjectClick={handleProjectClick}
            onAreaClick={handleAreaClick}
            areaMetric={areaMetric}
            dubaiAreas={dubaiAreas}
            dubaiLandmarks={dubaiLandmarks}
            showDubaiLayer
            pois={pois}
            showPois={showPois}
            onPoiClick={setSelectedPoi}
            onStationClick={setSelectedStation}
            flyToLocation={flyToLocation}
            transportGeoJSON={transportGeoJSON}
            showTransport={showTransport}
          />

          {/* Mobile: Top left - Current metric indicator */}
          {areaMetric !== 'none' && (
            <div className="absolute top-3 left-3 z-[1000] md:hidden">
              <div className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white shadow-lg rounded-xl text-xs font-medium">
                {(() => {
                  const option = METRIC_OPTIONS.find(o => o.value === areaMetric)
                  if (!option) return null
                  const Icon = option.Icon
                  return (
                    <>
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t(option.labelKey as any)}</span>
                    </>
                  )
                })()}
              </div>
            </div>
          )}

          {/* Mobile: Right side controls (metrics + POI combined) */}
          <div className="absolute top-3 right-3 z-[1000] md:hidden">
            <div className="bg-white shadow-lg rounded-xl overflow-hidden">
              {/* Metrics row */}
              <div className="flex border-b border-slate-100">
                {METRIC_OPTIONS.map((option, idx) => {
                  const isActive = areaMetric === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleMetricToggle(option.value)}
                      className={`flex items-center justify-center w-8 h-8 transition-colors ${
                        isActive ? 'bg-primary text-white' : 'text-slate-500'
                      } ${idx > 0 ? 'border-l border-slate-100' : ''}`}
                      title={t(option.labelKey as any)}
                    >
                      <option.Icon className="w-3.5 h-3.5" />
                    </button>
                  )
                })}
              </div>
              {/* POI row with transit toggle */}
              <div className="flex">
                {/* Single Transit toggle (Metro/Tram/Monorail) */}
                <button
                  onClick={toggleTransit}
                  className="flex items-center justify-center w-8 h-8 transition-colors"
                  style={showTransit ? { backgroundColor: '#0891b2', color: 'white' } : { color: '#64748b' }}
                  title={t('map:transit')}
                >
                  <TrainFront className="w-3.5 h-3.5" />
                </button>
                <div className="w-px bg-slate-200" />
                {QUICK_BUTTONS.map((btn) => {
                  const enabled = enabledPoiCategories.includes(btn.id)
                  return (
                    <button
                      key={btn.id}
                      onClick={() => togglePoiCategory(btn.id)}
                      className="flex items-center justify-center w-8 h-8 transition-colors border-l border-slate-100"
                      style={enabled ? { backgroundColor: btn.color, color: 'white' } : { color: '#64748b' }}
                      title={t(btn.labelKey as any)}
                    >
                      <btn.Icon className="w-3.5 h-3.5" />
                    </button>
                  )
                })}
                <button
                  onClick={() => setShowPoiPanel(true)}
                  className={`flex items-center justify-center w-8 h-8 border-l border-slate-100 transition-colors ${
                    showPoiPanel ? 'bg-slate-700 text-white' : 'text-slate-500'
                  }`}
                  title={t('map:poi.more')}
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Area Search - Floating on Map */}
          <div className="absolute bottom-16 left-4 z-[1000] hidden md:block">
            <div className="relative">
              <div className="flex items-center bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-1.5 pl-3 pr-2 text-slate-500">
                  <Navigation className="w-4 h-4" />
                  <span className="text-xs font-medium">{t('map:flyTo')}</span>
                </div>
                <div className="w-px h-5 bg-slate-200" />
                <input
                  type="text"
                  value={areaSearchQuery}
                  onChange={(e) => handleAreaSearch(e.target.value)}
                  onFocus={() => areaSearchResults.length > 0 && setShowAreaSearchResults(true)}
                  placeholder={t('map:searchArea')}
                  className="w-48 px-2 py-2 text-sm bg-transparent outline-none placeholder:text-slate-400"
                />
                {areaSearchQuery && (
                  <button
                    onClick={() => {
                      setAreaSearchQuery('')
                      setAreaSearchResults([])
                      setShowAreaSearchResults(false)
                    }}
                    className="p-2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Search Results Dropdown */}
              {showAreaSearchResults && areaSearchResults.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {areaSearchResults.map((area) => (
                      <button
                        key={area.id}
                        onClick={() => handleAreaSelect(area)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <MapPin className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">{area.name}</div>
                          {area.transactionCount && (
                            <div className="text-xs text-slate-500">
                              {area.transactionCount.toLocaleString()} transactions
                              {area.avgPriceSqm && ` · ${Math.round(area.avgPriceSqm).toLocaleString()} AED/sqm`}
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile: Bottom-left fly-to button */}
          <div className="absolute bottom-20 left-3 z-[1000] md:hidden">
            {!showMobileSearch ? (
              <button
                onClick={() => setShowMobileSearch(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-white shadow-lg rounded-full text-slate-700"
              >
                <Navigation className="w-4 h-4" />
                <span className="text-sm font-medium">{t('map:flyTo')}</span>
              </button>
            ) : (
              <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden w-72">
                {/* Search input */}
                <div className="flex items-center border-b border-slate-100">
                  <MapPin className="w-4 h-4 text-slate-400 ml-3 flex-shrink-0" />
                  <input
                    type="text"
                    value={areaSearchQuery}
                    onChange={(e) => handleAreaSearch(e.target.value)}
                    onFocus={() => areaSearchResults.length > 0 && setShowAreaSearchResults(true)}
                    placeholder={t('map:searchArea')}
                    className="flex-1 px-2 py-3 text-sm bg-transparent outline-none placeholder:text-slate-400"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      setShowMobileSearch(false)
                      setAreaSearchQuery('')
                      setAreaSearchResults([])
                      setShowAreaSearchResults(false)
                    }}
                    className="p-3 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {/* Search results */}
                {areaSearchResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto">
                    {areaSearchResults.map((area) => (
                      <button
                        key={area.id}
                        onClick={() => {
                          handleAreaSelect(area)
                          setShowMobileSearch(false)
                        }}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-100 last:border-0"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Navigation className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate text-sm">{area.name}</div>
                          {area.transactionCount && (
                            <div className="text-xs text-slate-500">
                              {area.transactionCount.toLocaleString()} transactions
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {areaSearchQuery && areaSearchResults.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    {t('common:noResults')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Floating Metric Panel - top-right */}
          <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 z-[1000] hidden md:block">
            <div className="flex items-center gap-0.5 p-1">
              {METRIC_OPTIONS.map((option) => {
                const isActive = areaMetric === option.value
                return (
                  <button
                    key={option.value}
                    onClick={() => handleMetricToggle(option.value)}
                    className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <option.Icon className="w-3.5 h-3.5" />
                    <span>{t(option.labelKey as any)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Floating POI Panel - below metrics */}
          <div className="absolute top-16 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 z-[1000] hidden md:block">
            <div className="flex items-center gap-1.5 p-1.5">
              {/* Single Transit toggle */}
              <button
                onClick={toggleTransit}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  showTransit
                    ? 'text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
                style={showTransit ? { backgroundColor: '#0891b2' } : undefined}
              >
                <TrainFront className="w-3.5 h-3.5" />
                <span>{t('map:transit')}</span>
              </button>
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
              {QUICK_BUTTONS.map(btn => {
                const enabled = enabledPoiCategories.includes(btn.id)
                return (
                  <button
                    key={btn.id}
                    onClick={() => togglePoiCategory(btn.id)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                      enabled
                        ? 'text-white shadow-sm'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    style={enabled ? { backgroundColor: btn.color } : undefined}
                  >
                    <btn.Icon className="w-3.5 h-3.5" />
                    <span>{t(btn.labelKey as any)}</span>
                  </button>
                )
              })}
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
              <button
                onClick={() => setShowPoiPanel(!showPoiPanel)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  showPoiPanel ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{t('map:poi.more')}</span>
              </button>
            </div>
          </div>

          {/* POI Full Panel - appears when "More" clicked */}
          {showPoiPanel && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="fixed inset-0 z-[1000]"
                onClick={() => setShowPoiPanel(false)}
              />
              <div className="absolute top-4 left-4 md:top-28 md:right-4 md:left-auto bg-white rounded-xl shadow-xl border border-slate-200/80 z-[1001] w-[280px] max-h-[400px] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">{t('map:poi.title')}</span>
                </div>
                <button
                  onClick={() => setShowPoiPanel(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Quick actions bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAllPoiCategories(true)}
                    className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                  >
                    {t('map:poi.selectAll')}
                  </button>
                  <button
                    onClick={() => toggleAllPoiCategories(false)}
                    className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                  >
                    {t('map:poi.clear')}
                  </button>
                </div>
              </div>

              {/* Category list */}
              <div className="overflow-y-auto max-h-[280px] p-3">
                {POI_GROUPS.map(group => {
                  const groupCategories = POI_CATEGORIES.filter(c => c.group === group.id)
                  if (groupCategories.length === 0) return null

                  return (
                    <div key={group.id} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          {t(`map:poi.groups.${group.id}` as any)}
                        </div>
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {groupCategories.map(cat => {
                          const isEnabled = enabledPoiCategories.includes(cat.id)
                          return (
                            <button
                              key={cat.id}
                              onClick={() => togglePoiCategory(cat.id)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                isEnabled
                                  ? 'text-white shadow-sm ring-1 ring-white/20'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                              style={isEnabled ? { backgroundColor: cat.color } : undefined}
                            >
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${isEnabled ? 'ring-1 ring-white/30' : ''}`}
                                style={{ backgroundColor: isEnabled ? 'rgba(255,255,255,0.9)' : cat.color }}
                              />
                              <span>{t(`map:poi.categories.${cat.id}` as any)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            </>
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

      {/* Desktop: Area Detail Dialog */}
      <AreaDetailDialog
        isOpen={showAreaDialog}
        onClose={() => setShowAreaDialog(false)}
        area={selectedArea}
        projects={areaProjects}
        isLoading={isLoadingAreaProjects}
      />

      {/* POI Info Popup - Mobile: Bottom Sheet, Desktop: Centered Modal */}
      {selectedPoi && (() => {
        const catInfo = getCategoryInfo(selectedPoi.category)
        const color = catInfo?.color || '#6b7280'

        return (
          <div className="fixed inset-0 z-[2000]" onClick={() => setSelectedPoi(null)}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

            {/* Mobile: Bottom Sheet */}
            <div className="md:hidden absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom duration-200">
              <div
                className="bg-white rounded-t-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle bar */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="w-10 h-1 bg-slate-300 rounded-full" />
                </div>

                {/* Icon + Category */}
                <div className="flex items-center gap-3 px-5 pb-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                    style={{ backgroundColor: color }}
                  >
                    <MapPin className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: color }}
                    >
                      {catInfo?.label || selectedPoi.category}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="px-5 pb-4">
                  <h3 className="text-xl font-bold text-slate-900 mb-1">
                    {selectedPoi.name}
                  </h3>
                  {selectedPoi.name_ar && (
                    <p className="text-base text-slate-500 mb-3" dir="rtl">
                      {selectedPoi.name_ar}
                    </p>
                  )}
                  {selectedPoi.address && (
                    <p className="text-sm text-slate-600 mb-4">
                      {selectedPoi.address}
                    </p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-3 gap-px bg-slate-200 border-t border-slate-200">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.lat},${selectedPoi.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                  >
                    <Navigation className="w-5 h-5 text-blue-600" />
                    <span className="text-xs font-medium text-slate-700">Directions</span>
                  </a>
                  {selectedPoi.phone ? (
                    <a
                      href={`tel:${selectedPoi.phone}`}
                      className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                    >
                      <Phone className="w-5 h-5 text-green-600" />
                      <span className="text-xs font-medium text-slate-700">Call</span>
                    </a>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-4 bg-white opacity-40">
                      <Phone className="w-5 h-5 text-slate-400" />
                      <span className="text-xs font-medium text-slate-400">Call</span>
                    </div>
                  )}
                  {selectedPoi.website ? (
                    <a
                      href={selectedPoi.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                    >
                      <Globe className="w-5 h-5 text-purple-600" />
                      <span className="text-xs font-medium text-slate-700">Website</span>
                    </a>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-4 bg-white opacity-40">
                      <Globe className="w-5 h-5 text-slate-400" />
                      <span className="text-xs font-medium text-slate-400">Website</span>
                    </div>
                  )}
                </div>

                {/* Safe area padding for iOS */}
                <div className="h-safe-area-inset-bottom bg-white" />
              </div>
            </div>

            {/* Desktop: Centered Modal */}
            <div className="hidden md:flex absolute inset-0 items-center justify-center p-4">
              <div
                className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-md animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="relative p-5 pb-4">
                  <button
                    onClick={() => setSelectedPoi(null)}
                    className="absolute top-3 right-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="flex items-start gap-4">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center shadow-md flex-shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      <MapPin className="w-7 h-7 text-white" />
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      <span
                        className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white mb-2"
                        style={{ backgroundColor: color }}
                      >
                        {catInfo?.label || selectedPoi.category}
                      </span>
                      <h3 className="text-xl font-bold text-slate-900 leading-tight">
                        {selectedPoi.name}
                      </h3>
                      {selectedPoi.name_ar && (
                        <p className="text-sm text-slate-500 mt-1" dir="rtl">
                          {selectedPoi.name_ar}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Details */}
                {(selectedPoi.address || selectedPoi.phone || selectedPoi.website) && (
                  <div className="px-5 pb-4 space-y-3">
                    {selectedPoi.address && (
                      <div className="flex items-start gap-3">
                        <MapPin className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
                        <span className="text-sm text-slate-600">{selectedPoi.address}</span>
                      </div>
                    )}
                    {selectedPoi.phone && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <a href={`tel:${selectedPoi.phone}`} className="text-sm text-blue-600 hover:underline">
                          {selectedPoi.phone}
                        </a>
                      </div>
                    )}
                    {selectedPoi.website && (
                      <div className="flex items-center gap-3">
                        <Globe className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <a
                          href={selectedPoi.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline truncate"
                        >
                          {selectedPoi.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 p-5 pt-2 border-t border-slate-100">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.lat},${selectedPoi.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors"
                  >
                    <Navigation className="w-4 h-4" />
                    Get Directions
                  </a>
                  <button
                    onClick={() => setSelectedPoi(null)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Transport Station Popup */}
      {selectedStation && (
        <div className="fixed inset-0 z-[2000]" onClick={() => setSelectedStation(null)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

          {/* Mobile: Bottom Sheet */}
          <div className="md:hidden absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom duration-200">
            <div
              className="bg-white rounded-t-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 bg-slate-300 rounded-full" />
              </div>

              {/* Icon + Category */}
              <div className="flex items-center gap-3 px-5 pb-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                  style={{ backgroundColor: selectedStation.color }}
                >
                  <TrainFront className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: selectedStation.color }}
                  >
                    {selectedStation.category === 'metro_stations' ? 'Metro Station' :
                     selectedStation.category === 'tram_stations' ? 'Tram Station' : 'Monorail Station'}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="px-5 pb-4">
                <h3 className="text-xl font-bold text-slate-900 mb-1">
                  {selectedStation.name}
                </h3>
                {selectedStation.nameAr && (
                  <p className="text-base text-slate-500 mb-3" dir="rtl">
                    {selectedStation.nameAr}
                  </p>
                )}
                {selectedStation.line && (
                  <p className="text-sm text-slate-600">
                    Line: {selectedStation.line}
                  </p>
                )}
              </div>

              {/* Action Button */}
              <div className="grid grid-cols-1 gap-px bg-slate-200 border-t border-slate-200">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.lat},${selectedStation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                >
                  <Navigation className="w-5 h-5 text-blue-600" />
                  <span className="text-xs font-medium text-slate-700">Directions</span>
                </a>
              </div>

              {/* Safe area padding for iOS */}
              <div className="h-safe-area-inset-bottom bg-white" />
            </div>
          </div>

          {/* Desktop: Centered Modal */}
          <div className="hidden md:flex absolute inset-0 items-center justify-center p-4">
            <div
              className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="relative p-5 pb-4">
                <button
                  onClick={() => setSelectedStation(null)}
                  className="absolute top-3 right-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="flex items-start gap-4">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shadow-md flex-shrink-0"
                    style={{ backgroundColor: selectedStation.color }}
                  >
                    <TrainFront className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <span
                      className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white mb-2"
                      style={{ backgroundColor: selectedStation.color }}
                    >
                      {selectedStation.category === 'metro_stations' ? 'Metro Station' :
                       selectedStation.category === 'tram_stations' ? 'Tram Station' : 'Monorail Station'}
                    </span>
                    <h3 className="text-xl font-bold text-slate-900 leading-tight">
                      {selectedStation.name}
                    </h3>
                    {selectedStation.nameAr && (
                      <p className="text-sm text-slate-500 mt-1" dir="rtl">
                        {selectedStation.nameAr}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Details */}
              {selectedStation.line && (
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-3">
                    <TrainFront className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-slate-600">Line: {selectedStation.line}</span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 p-5 pt-2 border-t border-slate-100">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.lat},${selectedStation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  Get Directions
                </a>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile: Area Bottom Sheet */}
      <MobileBottomSheet
        isOpen={showAreaSheet}
        onClose={() => setShowAreaSheet(false)}
        title={selectedArea?.name || ''}
        subtitle={!i18n.language?.startsWith('en') ? selectedArea?.translations?.[i18n.language?.split('-')[0] ?? '']?.name : undefined}
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
                {selectedArea.averagePrice !== undefined && selectedArea.averagePrice !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.avgPrice')}</div>
                    <div className="text-base font-bold text-slate-900">{formatValue(selectedArea.averagePrice, 'price')}</div>
                  </div>
                )}
                {selectedArea.transactionCount !== undefined && selectedArea.transactionCount !== null && (
                  <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="text-xs text-slate-500 font-medium mb-1">{t('map:areaDialog.transactionCount')}</div>
                    <div className="text-base font-bold text-slate-900">{selectedArea.transactionCount.toLocaleString()}</div>
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
