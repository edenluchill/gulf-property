import { useEffect, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'

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
}

interface MapControllerProps {
  clusters: any[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
}

function MapController({ clusters, onBoundsChange }: MapControllerProps) {
  const map = useMap()

  // Listen for map movement to update bounds with throttling
  useEffect(() => {
    if (!onBoundsChange) return

    let timeoutId: NodeJS.Timeout | null = null

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

function MapViewClustered({ clusters, onBoundsChange, onClusterClick }: MapViewClusteredProps) {
  // Memoize cluster markers to prevent unnecessary re-renders
  const clusterMarkers = useMemo(() => {
    return clusters.map((cluster) => ({
      cluster,
      icon: createClusterIcon(cluster),
      position: [cluster.center.lat, cluster.center.lng] as [number, number]
    }))
  }, [clusters])

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
