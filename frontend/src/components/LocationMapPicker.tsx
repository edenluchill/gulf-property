import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Button } from './ui/button'
import { MapPin, X, Check } from 'lucide-react'

// Custom marker icon (red pin for better visibility)
const customIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

interface MapEventsProps {
  onLocationSelect: (lat: number, lng: number) => void
}

// Handle map click events
function MapClickHandler({ onLocationSelect }: MapEventsProps) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Navigate map to position when it changes
function MapNavigator({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap()

  useEffect(() => {
    if (position) {
      map.flyTo([position.lat, position.lng], 15, {
        duration: 1.5
      })
    }
  }, [position, map])

  return null
}

interface LocationMapPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (lat: number, lng: number) => void
  initialPosition?: { lat: number; lng: number }
  address?: string
}

export default function LocationMapPickerModal({
  isOpen,
  onClose,
  onConfirm,
  initialPosition,
  address
}: LocationMapPickerModalProps) {
  const { t } = useTranslation('upload')
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lng: number } | null>(
    initialPosition || null
  )

  // Sync with initialPosition when it changes
  useEffect(() => {
    if (initialPosition) {
      setSelectedPosition(initialPosition)
    }
  }, [initialPosition])

  const handleLocationSelect = (lat: number, lng: number) => {
    setSelectedPosition({ lat, lng })
  }

  const handleConfirm = () => {
    if (selectedPosition) {
      onConfirm(selectedPosition.lat, selectedPosition.lng)
      onClose()
    }
  }

  if (!isOpen) return null

  // Default center: Dubai, or initialPosition if available
  const mapCenter = initialPosition
    ? [initialPosition.lat, initialPosition.lng] as [number, number]
    : [25.2048, 55.2708] as [number, number]

  const initialZoom = initialPosition ? 15 : 11

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-5xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-500 to-emerald-500 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6" />
            <div>
              <h2 className="text-xl font-bold">{t('locationPicker.title')}</h2>
              <p className="text-sm text-teal-100">{t('locationPicker.subtitle')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Address & Coordinates Display */}
        {(address || selectedPosition) && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
            {address && (
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="h-4 w-4 text-teal-600" />
                <span className="font-medium text-gray-900">{address}</span>
              </div>
            )}
            {selectedPosition && (
              <div className="flex items-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">{t('locationPicker.latitude')}</span>
                  <span className="font-mono font-bold text-blue-700">
                    {selectedPosition.lat.toFixed(6)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-700">{t('locationPicker.longitude')}</span>
                  <span className="font-mono font-bold text-blue-700">
                    {selectedPosition.lng.toFixed(6)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 relative">
          <MapContainer
            center={mapCenter}
            zoom={initialZoom}
            className="h-full w-full"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Handle map clicks */}
            <MapClickHandler onLocationSelect={handleLocationSelect} />

            {/* Navigate to position when selected */}
            <MapNavigator position={selectedPosition} />

            {/* Show marker at selected position */}
            {selectedPosition && (
              <Marker
                position={[selectedPosition.lat, selectedPosition.lng]}
                icon={customIcon}
              />
            )}
          </MapContainer>

          {/* Instructions Overlay - only show if no position selected */}
          {!selectedPosition && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm px-6 py-3 rounded-lg shadow-lg border border-teal-300 z-[1000] animate-pulse">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-teal-600" />
                {t('locationPicker.clickToSelect')}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="bg-gray-50 border-t px-6 py-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {selectedPosition ? (
              <span className="text-green-600 font-medium flex items-center gap-1">
                <Check className="h-4 w-4" />
                {t('locationPicker.locationSelected')}
              </span>
            ) : (
              <span>{t('locationPicker.pleaseClickMap')}</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="px-6"
            >
              {t('locationPicker.cancel')}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedPosition}
              className="bg-gradient-to-r from-green-600 to-emerald-600 px-6"
            >
              <Check className="me-2 h-4 w-4" />
              {t('locationPicker.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
