import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import { OffPlanProperty } from '../types'
import { formatPrice } from '../lib/utils'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import { Heart, Building2 } from 'lucide-react'
import { Button } from './ui/button'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'
import ClusterDialog from './ClusterDialog'

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

// Create custom marker icon with price (single property - deep blue-900)
const createPriceMarkerIcon = (property: OffPlanProperty) => {
  const price = property.startingPrice ? formatPriceShort(property.startingPrice) : 'POA'
  
  return L.divIcon({
    className: 'custom-price-marker',
    html: `
      <div class="relative inline-flex items-center justify-center">
        <div class="absolute inset-0 bg-blue-900 opacity-20 rounded-full blur-lg"></div>
        <div class="relative hover:scale-110 transition-all">
          <div class="bg-blue-900 text-white rounded-full px-4 py-2 shadow-2xl border border-blue-700 cursor-pointer">
            <div class="flex items-center gap-2 whitespace-nowrap">
              <span class="text-xs font-medium">${price}</span>
            </div>
          </div>
          <!-- Small arrow pointing down, tight to the bubble -->
          <div class="absolute left-1/2 -translate-x-1/2" style="
            bottom: -7px;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid #1e3a8a;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
          "></div>
        </div>
      </div>
    `,
    iconSize: [100, 40],
    iconAnchor: [50, 40]
  })
}

interface MapViewProps {
  properties: OffPlanProperty[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void
}

interface MapControllerProps {
  properties: OffPlanProperty[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void
}

function MapController({ properties, onBoundsChange }: MapControllerProps) {
  const map = useMap()

  // 注释掉自动fitBounds，保持用户设置的zoom和center
  // useEffect(() => {
  //   if (properties.length > 0) {
  //     const bounds = L.latLngBounds(
  //       properties.map(p => [p.location.lat, p.location.lng])
  //     )
  //     map.fitBounds(bounds, { padding: [50, 50] })
  //   }
  // }, [properties, map])

  // Listen for map movement to update bounds
  useEffect(() => {
    if (!onBoundsChange) return

    const handleMoveEnd = () => {
      const bounds = map.getBounds()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      })
    }

    map.on('moveend', handleMoveEnd)
    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [map, onBoundsChange])

  return null
}

export default function MapView({ properties, onBoundsChange }: MapViewProps) {
  const [favorites, setFavorites] = useState<string[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogProperties, setDialogProperties] = useState<OffPlanProperty[]>([])
  const [dialogPosition, setDialogPosition] = useState({ x: 0, y: 0 })

  useEffect(() => {
    const updateFavorites = () => {
      setFavorites(
        properties.map(p => p.id).filter(id => isFavorite(id))
      )
    }
    updateFavorites()
    
    // Listen for storage changes
    window.addEventListener('storage', updateFavorites)
    return () => window.removeEventListener('storage', updateFavorites)
  }, [properties])

  const handleToggleFavorite = (propertyId: string, e: React.MouseEvent) => {
    e.preventDefault()
    if (isFavorite(propertyId)) {
      removeFavorite(propertyId)
    } else {
      addFavorite(propertyId)
    }
    setFavorites(prev =>
      isFavorite(propertyId)
        ? prev.filter(id => id !== propertyId)
        : [...prev, propertyId]
    )
  }

  const handleClusterClick = (cluster: any) => {
    const data = getClusterData(cluster.layer)
    
    // Set dialog position to center of screen
    setDialogPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    })
    
    setDialogProperties(data.properties)
    setDialogOpen(true)
  }

  // Get cluster summary data
  const getClusterData = (cluster: any) => {
    const markers = cluster.getAllChildMarkers()
    const props = markers.map((m: any) => {
      // Find the property data from the marker
      const propId = m.options.alt // We'll set this as property id
      return properties.find(p => p.id === propId)
    }).filter(Boolean)

    const prices = props
      .map((p: any) => p.startingPrice)
      .filter((p: any) => p != null)
    
    const developers = Array.from(new Set(props.map((p: any) => p.developer)))
    
    return {
      count: markers.length,
      minPrice: prices.length > 0 ? Math.min(...prices) : null,
      maxPrice: prices.length > 0 ? Math.max(...prices) : null,
      developers: developers.slice(0, 3), // Top 3 developers
      properties: props
    }
  }

  // Custom cluster icon with price range (blue-900, same style as single marker)
  const createClusterCustomIcon = (cluster: any) => {
    const data = getClusterData(cluster)
    const { count, minPrice, maxPrice } = data
    
    // Format price range
    const formatPriceShort = (price: number) => {
      if (price >= 1000000) {
        return `${(price / 1000000).toFixed(1)}M`
      }
      return `${(price / 1000).toFixed(0)}K`
    }
    
    const priceRange = minPrice && maxPrice 
      ? `${formatPriceShort(minPrice)} - ${formatPriceShort(maxPrice)}`
      : 'POA'

    return L.divIcon({
      html: `
        <div class="relative inline-flex items-center justify-center">
          <div class="absolute inset-0 bg-blue-900 opacity-20 rounded-full blur-lg"></div>
          <div class="relative hover:scale-110 transition-all">
            <div class="bg-blue-900 text-white rounded-full px-4 py-2 shadow-2xl border border-blue-700 cursor-pointer">
              <div class="flex items-center gap-2 whitespace-nowrap">
                <span class="text-base font-bold">${count}</span>
                <span class="text-blue-300">|</span>
                <span class="text-xs font-medium">${priceRange}</span>
              </div>
            </div>
            <!-- Small arrow pointing down, tight to the bubble -->
            <div class="absolute left-1/2 -translate-x-1/2" style="
              bottom: -7px;
              width: 0;
              height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 8px solid #1e3a8a;
              filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
            "></div>
          </div>
        </div>
      `,
      className: 'custom-cluster-icon',
      iconSize: L.point(140, 48, true),
      iconAnchor: [70, 48],
    })
  }

  return (
    <>
      <ClusterDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        properties={dialogProperties}
        position={dialogPosition}
      />
      
      <MapContainer
        center={[25.0961, 55.1561]}
        zoom={13}
        className="h-full w-full rounded-lg overflow-hidden shadow-lg"
      >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController properties={properties} onBoundsChange={onBoundsChange} />
      
      {/* MarkerClusterGroup wraps all markers for automatic clustering */}
      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterCustomIcon}
        maxClusterRadius={60}
        spiderfyOnMaxZoom={false}
        showCoverageOnHover={false}
        zoomToBoundsOnClick={false}
        onClick={handleClusterClick}
      >
        {properties.map((property) => (
          <Marker
            key={property.id}
            position={[property.location.lat, property.location.lng]}
            icon={createPriceMarkerIcon(property)}
            alt={property.id}
          >
            <Popup>
              <div className="w-64 p-2">
                {property.images.length > 0 ? (
                  <img
                    src={property.images[0]}
                    alt={property.buildingName}
                    className="w-full h-32 object-cover rounded-md mb-2"
                  />
                ) : (
                  <div className="w-full h-32 bg-slate-200 rounded-md mb-2 flex items-center justify-center">
                    <Building2 className="h-12 w-12 text-slate-400" />
                  </div>
                )}
                <h3 className="font-semibold text-lg mb-1">{property.buildingName}</h3>
                <div className="flex items-center gap-1 mb-1">
                  {property.developerLogoUrl && (
                    <img 
                      src={property.developerLogoUrl} 
                      alt={property.developer}
                      className="h-4 w-4 object-contain"
                    />
                  )}
                  <p className="text-sm text-gray-600">{property.developer}</p>
                </div>
                <p className="text-sm text-gray-600 mb-2">{property.areaName}</p>
                <div className="mb-2">
                  <p className="font-bold text-primary">
                    {property.startingPrice ? formatPrice(property.startingPrice) : 'Price on Request'}
                  </p>
                  {property.medianPriceSqft && (
                    <p className="text-xs text-gray-500">
                      {formatPrice(property.medianPriceSqft)}/sqft
                    </p>
                  )}
                  <p className="text-xs text-gray-500">
                    {property.minBedrooms === property.maxBedrooms 
                      ? `${property.minBedrooms} BR`
                      : `${property.minBedrooms}-${property.maxBedrooms} BR`}
                    {property.unitCount && ` • ${property.unitCount} units`}
                  </p>
                  {property.completionPercent !== undefined && property.status !== 'completed' && (
                    <p className="text-xs text-blue-600 font-medium mt-1">
                      {property.completionPercent}% complete
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link to={`/project/${property.id}`} className="flex-1">
                    <Button size="sm" className="w-full">
                      View Details
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    variant={favorites.includes(property.id) ? "default" : "outline"}
                    onClick={(e) => handleToggleFavorite(property.id, e)}
                  >
                    <Heart
                      className={`h-4 w-4 ${
                        favorites.includes(property.id) ? 'fill-current' : ''
                      }`}
                    />
                  </Button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
    </>
  )
}
