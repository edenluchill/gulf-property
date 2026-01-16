import { useEffect, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, Polygon, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { DubaiArea, DubaiLandmark } from '../types'

// Helper function to format price in short form (K, M)
const formatPriceShort = (price: number): string => {
  if (price >= 1000000) {
    const millions = price / 1000000
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}M`
  } else if (price >= 1000) {
    const thousands = price / 1000
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`
  }
  return price.toString()
}

// Create custom cluster icon (blue-900 style) with animation
const createClusterIcon = (cluster: any) => {
  const { count, price_range } = cluster
  
  const priceRange = price_range.min && price_range.max 
    ? `${formatPriceShort(price_range.min)} - ${formatPriceShort(price_range.max)}`
    : 'POA'

  return L.divIcon({
    html: `
      <style>
        @keyframes pinDrop {
          0% {
            transform: translateY(-100px) scale(0.5);
            opacity: 0;
          }
          50% {
            transform: translateY(5px) scale(1.05);
          }
          70% {
            transform: translateY(-3px) scale(0.95);
          }
          100% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 0.2;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.3;
          }
        }
        .pin-animate {
          animation: pinDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .pin-pulse {
          animation: pulse 2s ease-in-out infinite;
        }
      </style>
      <div class="relative inline-flex items-center justify-center pin-animate">
        <div class="absolute inset-0 bg-blue-900 opacity-20 rounded-full blur-md pin-pulse"></div>
        <div class="relative hover:scale-110 transition-all">
          <div class="bg-blue-900 text-white rounded-full px-3 py-1.5 shadow-xl border border-blue-700 cursor-pointer">
            <div class="flex items-center gap-1.5 whitespace-nowrap">
              <span class="text-sm font-bold">${count}</span>
              <span class="text-blue-300 text-xs">|</span>
              <span class="text-xs font-medium">${priceRange}</span>
            </div>
          </div>
          <!-- Small arrow pointing down -->
          <div class="absolute left-1/2 -translate-x-1/2" style="
            bottom: -5px;
            width: 0;
            height: 0;
            border-left: 5px solid transparent;
            border-right: 5px solid transparent;
            border-top: 6px solid #1e3a8a;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
          "></div>
        </div>
      </div>
    `,
    className: 'custom-cluster-icon',
    iconSize: L.point(120, 40, true),
    iconAnchor: [60, 40],
  })
}

interface MapViewClusteredProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  onClusterClick?: (cluster: any) => void
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  showDubaiLayer?: boolean
}

interface MapControllerProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
}

function MapController({ onBoundsChange }: MapControllerProps) {
  const map = useMap()

  // Listen for map movement to update bounds with throttling
  useEffect(() => {
    if (!onBoundsChange) return

    let timeoutId: number | null = null

    const handleMoveEnd = () => {
      // Clear any pending timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // Throttle the bounds update to reduce API calls
      timeoutId = setTimeout(() => {
        const bounds = map.getBounds()
        const zoom = map.getZoom()
        onBoundsChange({
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        }, zoom)
      }, 200) // Wait 200ms after user stops moving
    }

    map.on('moveend', handleMoveEnd)
    map.on('zoomend', handleMoveEnd)
    
    // Initial call after event listeners are set up
    setTimeout(() => {
      const bounds = map.getBounds()
      const zoom = map.getZoom()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, zoom)
    }, 100)
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      map.off('moveend', handleMoveEnd)
      map.off('zoomend', handleMoveEnd)
    }
  }, [map]) // Remove onBoundsChange from dependencies to prevent infinite loop

  return null
}

function MapViewClustered({ clusters, onBoundsChange, onClusterClick, dubaiAreas = [], dubaiLandmarks = [], showDubaiLayer = false }: MapViewClusteredProps) {
  // Memoize cluster markers to prevent unnecessary re-renders
  const clusterMarkers = useMemo(() => {
    return clusters.map((cluster) => ({
      cluster,
      icon: createClusterIcon(cluster),
      position: [cluster.center.lat, cluster.center.lng] as [number, number]
    }))
  }, [clusters])

  // Memoize Dubai landmark icons
  const landmarkIcons = useMemo(() => {
    if (!Array.isArray(dubaiLandmarks)) return []
    return dubaiLandmarks.map((landmark) => {
      const sizeMap = { small: [24, 24], medium: [32, 32], large: [40, 40] }
      const size = sizeMap[landmark.size] || [32, 32]
      
      return {
        landmark,
        icon: L.divIcon({
          html: `
            <div class="flex items-center justify-center" style="width: ${size[0]}px; height: ${size[1]}px;">
              <div class="relative">
                <div class="absolute inset-0 rounded-full opacity-30" style="background: ${landmark.color}; filter: blur(4px);"></div>
                <div class="relative w-full h-full rounded-full flex items-center justify-center shadow-lg border-2 border-white" 
                     style="background: ${landmark.color};">
                  <svg class="w-1/2 h-1/2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
          `,
          className: 'custom-landmark-icon',
          iconSize: L.point(size[0], size[1]),
          iconAnchor: [size[0] / 2, size[1]],
        }),
        position: [landmark.location.lat, landmark.location.lng] as [number, number]
      }
    })
  }, [dubaiLandmarks])

  return (
    <MapContainer
      center={[25.0961, 55.1561]}
      zoom={11}
      className="h-full w-full rounded-lg overflow-hidden shadow-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController clusters={clusters} onBoundsChange={onBoundsChange} />
      
      {/* Render Dubai areas as polygons (if layer is enabled) */}
      {showDubaiLayer && Array.isArray(dubaiAreas) && dubaiAreas.map((area) => {
        // Convert GeoJSON coordinates to Leaflet format
        const coordinates = area.boundary.type === 'Polygon' 
          ? (area.boundary as any).coordinates[0].map(([lng, lat]: [number, number]) => [lat, lng] as [number, number])
          : []
        
        return (
          <Polygon
            key={area.id}
            positions={coordinates}
            pathOptions={{
              color: area.color,
              fillColor: area.color,
              fillOpacity: area.opacity,
              weight: 2,
            }}
          >
            <Popup>
              <div className="p-2">
                <h3 className="font-bold text-base mb-1">{area.name}</h3>
                {area.description && <p className="text-sm text-gray-600 mb-2">{area.description}</p>}
                {area.wealthLevel && (
                  <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded mr-1">
                    {area.wealthLevel}
                  </span>
                )}
                {area.culturalAttribute && (
                  <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                    {area.culturalAttribute}
                  </span>
                )}
              </div>
            </Popup>
          </Polygon>
        )
      })}

      {/* Render Dubai landmarks as markers (if layer is enabled) */}
      {showDubaiLayer && landmarkIcons.map(({ landmark, icon, position }) => (
        <Marker
          key={landmark.id}
          position={position}
          icon={icon}
        >
          <Popup>
            <div className="p-2 min-w-[200px]">
              <h3 className="font-bold text-base mb-1">{landmark.name}</h3>
              {landmark.landmarkType && (
                <span className="inline-block bg-purple-100 text-purple-800 text-xs px-2 py-1 rounded mb-2">
                  {landmark.landmarkType}
                </span>
              )}
              {landmark.description && <p className="text-sm text-gray-600 mb-2">{landmark.description}</p>}
              {landmark.yearBuilt && <p className="text-xs text-gray-500">Built: {landmark.yearBuilt}</p>}
            </div>
          </Popup>
        </Marker>
      ))}
      
      {/* Render cluster markers */}
      {clusterMarkers.map(({ cluster, icon, position }) => (
        <Marker
          key={cluster.cluster_id}
          position={position}
          icon={icon}
          eventHandlers={{
            click: (e) => {
              // Prevent popup from opening
              e.target.closePopup()
              if (onClusterClick) {
                onClusterClick(cluster)
              }
            }
          }}
        />
      ))}
    </MapContainer>
  )
}

// Export memoized component to prevent unnecessary re-renders
export default memo(MapViewClustered)
