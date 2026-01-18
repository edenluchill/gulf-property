import { useState, useEffect, useCallback } from 'react'
import MapViewClustered from '../components/MapViewClustered'
import FilterDialog from '../components/FilterDialog'
import ClusterDialog from '../components/ClusterDialog'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Search, SlidersHorizontal, Layers } from 'lucide-react'
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
import { useDebounce } from '../hooks/useDebounce'

// Residential Project interface (matching backend schema)
interface ResidentialProject {
  id: string
  project_name: string
  developer: string
  address: string
  area: string
  description?: string
  latitude?: number
  longitude?: number
  launch_date?: string
  completion_date?: string
  handover_date?: string
  construction_progress?: number  // Percentage: 0-100
  status: 'upcoming' | 'under-construction' | 'completed' | 'handed-over'
  min_price?: number
  max_price?: number
  starting_price?: number
  total_unit_types: number
  total_units: number
  min_bedrooms?: number
  max_bedrooms?: number
  project_images: string[]
  floor_plan_images: string[]
  brochure_url?: string
  has_renderings: boolean
  has_floor_plans: boolean
  has_location_maps: boolean
  rendering_descriptions: string[]
  floor_plan_descriptions: string[]
  amenities: string[]
  verified: boolean
  featured: boolean
  views_count: number
  created_at: string
  updated_at: string
}

/**
 * Convert ResidentialProject to OffPlanProperty format for component compatibility
 */
function convertResidentialProjectToProperty(project: ResidentialProject): any {
  // construction_progress is now a direct number (0-100)
  const completionPercent = project.construction_progress || 0
  
  // Normalize status to match old schema
  let normalizedStatus: 'upcoming' | 'under-construction' | 'completed' = 'upcoming'
  if (project.status === 'under-construction') {
    normalizedStatus = 'under-construction'
  } else if (project.status === 'completed' || project.status === 'handed-over') {
    normalizedStatus = 'completed'
  }
  
  return {
    id: project.id,
    buildingId: undefined,
    buildingName: project.project_name,
    projectName: project.project_name,
    buildingDescription: project.description,
    developer: project.developer,
    developerId: undefined,
    developerLogoUrl: undefined,
    location: {
      lat: project.latitude || 0,
      lng: project.longitude || 0,
    },
    areaName: project.area,
    areaId: undefined,
    dldLocationId: undefined,
    minBedrooms: project.min_bedrooms || 0,
    maxBedrooms: project.max_bedrooms || 0,
    bedsDescription: project.min_bedrooms && project.max_bedrooms 
      ? `${project.min_bedrooms}-${project.max_bedrooms} BR`
      : undefined,
    minSize: undefined,
    maxSize: undefined,
    startingPrice: project.starting_price,
    medianPriceSqft: undefined,
    medianPricePerUnit: project.starting_price,
    medianRentPerUnit: undefined,
    launchDate: project.launch_date,
    completionDate: project.completion_date,
    completionPercent: completionPercent,
    status: normalizedStatus,
    unitCount: project.total_units,
    buildingUnitCount: project.total_units,
    salesVolume: undefined,
    propSalesVolume: undefined,
    images: project.project_images || [],
    logoUrl: undefined,
    brochureUrl: project.brochure_url,
    amenities: project.amenities || [],
    displayAs: 'project',
    verified: project.verified,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  }
}

export default function MapPage() {
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
  const [showDubaiLayer, setShowDubaiLayer] = useState(false)
  
  // Cluster dialog state (using any[] to match old OffPlanProperty format after conversion)
  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [selectedClusterProperties, setSelectedClusterProperties] = useState<any[]>([])
  const [clusterDialogPosition, setClusterDialogPosition] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const [isLoadingClusterProperties, setIsLoadingClusterProperties] = useState(false)

  // Debounce filters and bounds to reduce API calls
  const debouncedFilters = useDebounce(filters, 300)
  const debouncedMapBounds = useDebounce(mapBounds, 500) // Longer delay for map movement to reduce frequent updates

  // Load initial metadata (only once, with caching)
  useEffect(() => {
    const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours
    
    // Load developers with cache (NEW RESIDENTIAL API)
    const cachedDevelopers = localStorage.getItem('gulf_residential_developers')
    const cachedDevTimestamp = localStorage.getItem('gulf_residential_developers_timestamp')
    
    if (cachedDevelopers && cachedDevTimestamp && 
        Date.now() - parseInt(cachedDevTimestamp) < CACHE_DURATION) {
      setDevelopers(JSON.parse(cachedDevelopers))
    } else {
      fetchResidentialDevelopers().then((data) => {
        const sorted = data.map(d => d.developer).sort()
        setDevelopers(sorted)
        localStorage.setItem('gulf_residential_developers', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_developers_timestamp', Date.now().toString())
      })
    }
    
    // Load areas with cache (NEW RESIDENTIAL API)
    const cachedAreas = localStorage.getItem('gulf_residential_areas')
    const cachedAreasTimestamp = localStorage.getItem('gulf_residential_areas_timestamp')
    
    if (cachedAreas && cachedAreasTimestamp && 
        Date.now() - parseInt(cachedAreasTimestamp) < CACHE_DURATION) {
      setAreas(JSON.parse(cachedAreas))
    } else {
      fetchResidentialAreas().then((data) => {
        const sorted = data.map(a => a.area_name).sort()
        setAreas(sorted)
        localStorage.setItem('gulf_residential_areas', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_areas_timestamp', Date.now().toString())
      })
    }
    
    // Load projects with cache (NEW RESIDENTIAL API)
    const cachedProjects = localStorage.getItem('gulf_residential_projects')
    const cachedProjectsTimestamp = localStorage.getItem('gulf_residential_projects_timestamp')
    
    if (cachedProjects && cachedProjectsTimestamp && 
        Date.now() - parseInt(cachedProjectsTimestamp) < CACHE_DURATION) {
      setProjects(JSON.parse(cachedProjects))
    } else {
      fetchResidentialProjects().then((data) => {
        const sorted = data.sort((a, b) => a.project_name.localeCompare(b.project_name))
        setProjects(sorted)
        localStorage.setItem('gulf_residential_projects', JSON.stringify(sorted))
        localStorage.setItem('gulf_residential_projects_timestamp', Date.now().toString())
      })
    }
    
    // Load Dubai areas and landmarks with cache
    const cachedDubaiAreas = localStorage.getItem('gulf_dubai_areas')
    const cachedDubaiAreasTimestamp = localStorage.getItem('gulf_dubai_areas_timestamp')
    
    if (cachedDubaiAreas && cachedDubaiAreasTimestamp && 
        Date.now() - parseInt(cachedDubaiAreasTimestamp) < CACHE_DURATION) {
      setDubaiAreas(JSON.parse(cachedDubaiAreas))
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
        Date.now() - parseInt(cachedDubaiLandmarksTimestamp) < CACHE_DURATION) {
      setDubaiLandmarks(JSON.parse(cachedDubaiLandmarks))
    } else {
      fetchDubaiLandmarks().then((data) => {
        setDubaiLandmarks(data)
        localStorage.setItem('gulf_dubai_landmarks', JSON.stringify(data))
        localStorage.setItem('gulf_dubai_landmarks_timestamp', Date.now().toString())
      })
    }
  }, [])

  // Load clusters based on debounced filters AND map bounds (NEW RESIDENTIAL API)
  useEffect(() => {
    // Only load if we have bounds (after map initializes)
    if (!debouncedMapBounds) return
    
    const loadClusters = async () => {
      // Convert bounds to MapBounds type
      const bounds = {
        minLng: debouncedMapBounds.minLng,
        minLat: debouncedMapBounds.minLat,
        maxLng: debouncedMapBounds.maxLng,
        maxLat: debouncedMapBounds.maxLat,
      }

      const data = await fetchResidentialProjectClusters(mapZoom, bounds, {
        developer: debouncedFilters.developer,
        project: debouncedFilters.project,
        area: debouncedFilters.area,
        minPrice: debouncedFilters.minPrice,
        maxPrice: debouncedFilters.maxPrice,
        minBedrooms: debouncedFilters.minBedrooms,
        maxBedrooms: debouncedFilters.maxBedrooms,
        minSize: debouncedFilters.minSize,
        maxSize: debouncedFilters.maxSize,
        status: debouncedFilters.status,
      })
      
      console.log('Fetched residential project clusters:', data.length, 'clusters')
      
      // Transform backend data format to match MapViewClustered expectations
      const transformedClusters = data.map((cluster: any) => ({
        ...cluster,
        count: parseInt(cluster.count), // Convert string to number
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
    }
    
    loadClusters()
  }, [debouncedFilters, debouncedMapBounds, mapZoom])

  // Handle map bounds and zoom change (memoized to prevent unnecessary re-renders)
  const handleMapBoundsChange = useCallback((bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => {
    setMapBounds(bounds)
    setMapZoom(zoom)
  }, [])

  // Handle cluster click to show properties in dialog (memoized) - NEW RESIDENTIAL API
  const handleClusterClick = useCallback(async (cluster: any) => {
    console.log('Cluster clicked:', cluster)
    
    // Fetch full property data using property_ids
    if (!cluster.property_ids || cluster.property_ids.length === 0) {
      console.warn('No property IDs in cluster')
      return
    }

    // Immediately show dialog with loading state
    setSelectedClusterProperties([])
    setClusterDialogPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    setIsLoadingClusterProperties(true)
    setShowClusterDialog(true)

    try {
      // Fetch full residential project details in background
      const projects = await fetchResidentialProjectsBatch(cluster.property_ids)
      
      console.log('Fetched residential projects:', projects)
      
      // Convert residential projects to old property format for component compatibility
      const convertedProperties = projects.map(convertResidentialProjectToProperty)
      
      setSelectedClusterProperties(convertedProperties)
      setIsLoadingClusterProperties(false)
    } catch (error) {
      console.error('Error fetching cluster projects:', error)
      setIsLoadingClusterProperties(false)
    }
  }, [])

  const formatLastUpdated = (date: Date) => {
    const now = new Date()
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
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
                  placeholder="Address, MLS Number, or anything!"
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
                Filters
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
                Areas & Landmarks
              </Button>
            </div>

            {/* Active Filters Summary */}
            {hasActiveFilters && !showFilters && (
              <div className="flex flex-wrap gap-2 text-sm">
                {filters.developer && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    Developer: {filters.developer}
                  </span>
                )}
                {filters.project && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    Project: {filters.project}
                  </span>
                )}
                {filters.area && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    Area: {filters.area}
                  </span>
                )}
                {(filters.minPrice || filters.maxPrice) && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    Price: {filters.minPrice ? formatPrice(filters.minPrice) : '0'} - {filters.maxPrice ? formatPrice(filters.maxPrice) : '∞'}
                  </span>
                )}
                {filters.minBedrooms !== undefined && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.minBedrooms === 0 ? 'Studio' : `${filters.minBedrooms}+ Beds`}
                  </span>
                )}
                {filters.status && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.status === 'under-construction' ? 'Under Construction' : 
                     filters.status === 'upcoming' ? 'Upcoming' : 'Completed'}
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
            dubaiAreas={dubaiAreas}
            dubaiLandmarks={dubaiLandmarks}
            showDubaiLayer={showDubaiLayer}
          />
          
          {/* Last Updated Badge - Floating on Map */}
          <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-slate-200 z-[1000]">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-slate-600">
                Last updated: <span className="font-medium text-slate-900">{formatLastUpdated(lastUpdated)}</span>
              </span>
            </div>
          </div>
          
          {/* Cluster Count Badge - Floating on Map */}
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg border border-slate-200 z-[1000]">
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-slate-600">Clusters:</span>
                <span className="ml-2 font-bold text-primary">{clusters.length}</span>
              </div>
              <div>
                <span className="text-slate-600">Properties:</span>
                <span className="ml-2 font-bold text-primary">
                  {clusters.reduce((sum, c) => sum + c.count, 0)}
                </span>
              </div>
            </div>
          </div>
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
    </div>
  )
}
