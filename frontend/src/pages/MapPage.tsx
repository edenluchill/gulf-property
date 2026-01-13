import { useState, useEffect, useCallback } from 'react'
import MapViewClustered from '../components/MapViewClustered'
import FilterDialog from '../components/FilterDialog'
import ClusterDialog from '../components/ClusterDialog'
import { PropertyFilters, OffPlanProperty } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Search, SlidersHorizontal } from 'lucide-react'
import { formatPrice } from '../lib/utils'
import { fetchPropertyClusters, fetchDevelopers, fetchAreas, fetchProjects, fetchPropertiesBatch } from '../lib/api'
import { useDebounce } from '../hooks/useDebounce'

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
  const [mapZoom, setMapZoom] = useState<number>(11)
  
  // Cluster dialog state
  const [showClusterDialog, setShowClusterDialog] = useState(false)
  const [selectedClusterProperties, setSelectedClusterProperties] = useState<OffPlanProperty[]>([])
  const [clusterDialogPosition, setClusterDialogPosition] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const [isLoadingClusterProperties, setIsLoadingClusterProperties] = useState(false)

  // Debounce filters and bounds to reduce API calls
  const debouncedFilters = useDebounce(filters, 300)
  const debouncedMapBounds = useDebounce(mapBounds, 500) // Longer delay for map movement to reduce frequent updates

  // Load initial metadata (only once, with caching)
  useEffect(() => {
    const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours
    
    // Load developers with cache
    const cachedDevelopers = localStorage.getItem('gulf_developers')
    const cachedDevTimestamp = localStorage.getItem('gulf_developers_timestamp')
    
    if (cachedDevelopers && cachedDevTimestamp && 
        Date.now() - parseInt(cachedDevTimestamp) < CACHE_DURATION) {
      setDevelopers(JSON.parse(cachedDevelopers))
    } else {
      fetchDevelopers().then((data) => {
        const sorted = data.map(d => d.developer).sort()
        setDevelopers(sorted)
        localStorage.setItem('gulf_developers', JSON.stringify(sorted))
        localStorage.setItem('gulf_developers_timestamp', Date.now().toString())
      })
    }
    
    // Load areas with cache
    const cachedAreas = localStorage.getItem('gulf_areas')
    const cachedAreasTimestamp = localStorage.getItem('gulf_areas_timestamp')
    
    if (cachedAreas && cachedAreasTimestamp && 
        Date.now() - parseInt(cachedAreasTimestamp) < CACHE_DURATION) {
      setAreas(JSON.parse(cachedAreas))
    } else {
      fetchAreas().then((data) => {
        const sorted = data.map(a => a.area_name).sort()
        setAreas(sorted)
        localStorage.setItem('gulf_areas', JSON.stringify(sorted))
        localStorage.setItem('gulf_areas_timestamp', Date.now().toString())
      })
    }
    
    // Load projects with cache
    const cachedProjects = localStorage.getItem('gulf_projects')
    const cachedProjectsTimestamp = localStorage.getItem('gulf_projects_timestamp')
    
    if (cachedProjects && cachedProjectsTimestamp && 
        Date.now() - parseInt(cachedProjectsTimestamp) < CACHE_DURATION) {
      setProjects(JSON.parse(cachedProjects))
    } else {
      fetchProjects().then((data) => {
        const sorted = data.sort((a, b) => a.project_name.localeCompare(b.project_name))
        setProjects(sorted)
        localStorage.setItem('gulf_projects', JSON.stringify(sorted))
        localStorage.setItem('gulf_projects_timestamp', Date.now().toString())
      })
    }
  }, [])

  // Load clusters based on debounced filters AND map bounds
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

      const data = await fetchPropertyClusters(mapZoom, bounds, {
        developer: debouncedFilters.developer,
        project: debouncedFilters.project,
        area: debouncedFilters.area,
        minPrice: debouncedFilters.minPrice,
        maxPrice: debouncedFilters.maxPrice,
        minPriceSqft: debouncedFilters.minPriceSqft,
        maxPriceSqft: debouncedFilters.maxPriceSqft,
        minBedrooms: debouncedFilters.minBedrooms,
        maxBedrooms: debouncedFilters.maxBedrooms,
        minSize: debouncedFilters.minSize,
        maxSize: debouncedFilters.maxSize,
        launchDateStart: debouncedFilters.launchDateStart,
        launchDateEnd: debouncedFilters.launchDateEnd,
        completionDateStart: debouncedFilters.completionDateStart,
        completionDateEnd: debouncedFilters.completionDateEnd,
        minCompletionPercent: debouncedFilters.minCompletionPercent,
        maxCompletionPercent: debouncedFilters.maxCompletionPercent,
        status: debouncedFilters.status,
      })
      
      console.log('Fetched clusters:', data.length, 'clusters')
      
      setClusters(data)
      setLastUpdated(new Date())
    }
    
    loadClusters()
  }, [debouncedFilters, debouncedMapBounds, mapZoom])

  // Handle map bounds and zoom change (memoized to prevent unnecessary re-renders)
  const handleMapBoundsChange = useCallback((bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => {
    setMapBounds(bounds)
    setMapZoom(zoom)
  }, [])

  // Handle cluster click to show properties in dialog (memoized)
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
      // Fetch full property details in background
      const properties = await fetchPropertiesBatch(cluster.property_ids)
      
      console.log('Fetched properties:', properties)
      
      setSelectedClusterProperties(properties)
      setIsLoadingClusterProperties(false)
    } catch (error) {
      console.error('Error fetching cluster properties:', error)
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
