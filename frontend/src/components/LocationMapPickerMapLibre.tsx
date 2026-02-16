/**
 * MapLibre 版本的位置选择器
 */

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Map, { Marker, NavigationControl } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Button } from './ui/button'
import { MapPin, X, Check } from 'lucide-react'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

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
  const { t } = useTranslation('upload')
  const [selectedPosition, setSelectedPosition] = useState<{ lat: number; lng: number } | null>(
    initialPosition || null
  )

  const [viewState, setViewState] = useState({
    longitude: initialPosition?.lng || 55.2708,
    latitude: initialPosition?.lat || 25.2048,
    zoom: 13
  })

  useEffect(() => {
    if (initialPosition) {
      setSelectedPosition(initialPosition)
      setViewState(prev => ({
        ...prev,
        longitude: initialPosition.lng,
        latitude: initialPosition.lat
      }))
    }
  }, [initialPosition])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    const { lng, lat } = e.lngLat
    setSelectedPosition({ lat, lng })
  }, [])

  const handleConfirm = () => {
    if (selectedPosition) {
      onConfirm(selectedPosition.lat, selectedPosition.lng)
      onClose()
    }
  }

  if (!isOpen) return null

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

        {/* Coordinates Display */}
        {selectedPosition && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-3">
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
          </div>
        )}

        {/* Map Container */}
        <div className="flex-1 relative">
          <Map
            {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            onClick={handleMapClick}
            style={{ width: '100%', height: '100%' }}
            mapStyle={MAP_STYLE}
            cursor="crosshair"
          >
            <NavigationControl position="top-right" />

            {/* Selected position marker */}
            {selectedPosition && (
              <Marker
                longitude={selectedPosition.lng}
                latitude={selectedPosition.lat}
                anchor="bottom"
              >
                <div className="animate-bounce">
                  <svg width="32" height="42" viewBox="0 0 32 42" className="drop-shadow-lg">
                    <path
                      d="M16 0C7.163 0 0 7.163 0 16c0 8.837 16 26 16 26s16-17.163 16-26C32 7.163 24.837 0 16 0z"
                      fill="#ef4444"
                    />
                    <circle cx="16" cy="16" r="6" fill="white" />
                  </svg>
                </div>
              </Marker>
            )}
          </Map>

          {/* Instructions Overlay */}
          {!selectedPosition && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm px-6 py-3 rounded-lg shadow-lg border border-teal-300 z-10 animate-pulse">
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
              <Check className="mr-2 h-4 w-4" />
              {t('locationPicker.confirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
