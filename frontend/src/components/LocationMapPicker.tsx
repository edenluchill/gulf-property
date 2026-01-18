import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
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

interface LocationPickerProps {
  onLocationSelect: (lat: number, lng: number) => void
  initialPosition?: { lat: number; lng: number }
}

function MapClickHandler({ onLocationSelect }: LocationPickerProps) {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null)

  useMapEvents({
    click(e) {
      const newPosition = {
        lat: e.latlng.lat,
        lng: e.latlng.lng
      }
      setPosition(newPosition)
      onLocationSelect(newPosition.lat, newPosition.lng)
    },
  })

  return position ? (
    <Marker position={[position.lat, position.lng]} icon={customIcon} />
  ) : null
}

interface LocationMapPickerModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (lat: number, lng: number) => void
  initialPosition?: { lat: number; lng: number }
}

export default function LocationMapPickerModal({
  isOpen,
  onClose,
  onConfirm,
  initialPosition
}: LocationMapPickerModalProps) {
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lng: number } | null>(
    initialPosition || null
  )

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

  // Default center: Dubai
  const mapCenter = initialPosition 
    ? [initialPosition.lat, initialPosition.lng] as [number, number]
    : [25.2048, 55.2708] as [number, number]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-[90vw] h-[85vh] max-w-5xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 to-orange-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MapPin className="h-6 w-6" />
            <div>
              <h2 className="text-xl font-bold">选择项目位置</h2>
              <p className="text-sm text-amber-100">点击地图上的任意位置来设置坐标</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full p-2 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Coordinates Display */}
        {selectedPosition && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">纬度 (Latitude):</span>
                <span className="font-mono font-bold text-blue-700">
                  {selectedPosition.lat.toFixed(6)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">经度 (Longitude):</span>
                <span className="font-mono font-bold text-blue-700">
                  {selectedPosition.lng.toFixed(6)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 relative">
          <MapContainer
            center={mapCenter}
            zoom={13}
            className="h-full w-full"
            scrollWheelZoom={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapClickHandler
              onLocationSelect={handleLocationSelect}
              initialPosition={initialPosition}
            />
            {/* Show initial position marker if exists */}
            {initialPosition && !selectedPosition && (
              <Marker position={[initialPosition.lat, initialPosition.lng]} icon={customIcon} />
            )}
          </MapContainer>

          {/* Instructions Overlay */}
          {!selectedPosition && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm px-6 py-3 rounded-lg shadow-lg border border-amber-300 z-[1000] animate-pulse">
              <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-amber-600" />
                点击地图选择项目位置
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
                位置已选择
              </span>
            ) : (
              <span>请在地图上点击以选择位置</span>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="px-6"
            >
              取消
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!selectedPosition}
              className="bg-gradient-to-r from-green-600 to-emerald-600 px-6"
            >
              <Check className="mr-2 h-4 w-4" />
              确认位置
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
