import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { OffPlanProperty } from '../types'
import { formatPrice } from '../lib/utils'
import { Link } from 'react-router-dom'
import L from 'leaflet'
import { Heart, Building2 } from 'lucide-react'
import { Button } from './ui/button'
import { isFavorite, addFavorite, removeFavorite } from '../lib/favorites'

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

function MapController({ onBoundsChange }: MapControllerProps) {
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

  return (
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
      
      {/* Render individual property markers - backend already handles clustering */}
      {properties.map((property) => (
        <Marker
          key={property.id}
          position={[property.location.lat, property.location.lng]}
          icon={createPriceMarkerIcon(property)}
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
    </MapContainer>
  )
}
