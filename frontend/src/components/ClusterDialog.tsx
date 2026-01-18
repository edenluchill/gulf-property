import { useState, useEffect } from 'react'
import { X, MapPin, Home, Building2, Bed, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { OffPlanProperty } from '../types'
import { formatPrice } from '../lib/utils'
import { getImageUrl, getImageSrcSet } from '../lib/image-utils'
import { Link } from 'react-router-dom'
import PropertyCard from './PropertyCard'

interface ClusterDialogProps {
  isOpen: boolean
  onClose: () => void
  properties: OffPlanProperty[]
  position: { x: number; y: number }
  isLoading?: boolean
}

export default function ClusterDialog({ isOpen, onClose, properties, position, isLoading = false }: ClusterDialogProps) {
  const [selectedProperty, setSelectedProperty] = useState<OffPlanProperty | null>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // Update selected property when properties load
  useEffect(() => {
    if (properties.length > 0) {
      setSelectedProperty(properties[0])
      setCurrentImageIndex(0)
    }
  }, [properties])

  // Reset image index when property changes
  useEffect(() => {
    setCurrentImageIndex(0)
  }, [selectedProperty])

  if (!isOpen) return null

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const images = selectedProperty?.images || []
  const hasMultipleImages = images.length > 1

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % images.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length)
  }

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[10000]"
        onClick={onClose}
      />
      
      {/* Dialog */}
      <div 
        className="fixed z-[10001] bg-white rounded-lg shadow-2xl w-[1200px] h-[85vh] overflow-hidden flex"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translate(-50%, -50%)'
        }}
      >
        {/* Close Button - Top Right */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-[10002] p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
        >
          <X className="w-5 h-5 text-gray-700" />
        </button>

        {/* Left Side - Main Image & Details */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mb-4"></div>
                <p className="text-gray-600 text-lg">Loading property details...</p>
              </div>
            </div>
          ) : selectedProperty ? (
            <>
              {/* Image Gallery - With padding and border */}
              <div className="p-6 pb-0">
                <div className="relative w-full h-[380px] bg-white rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                  {images.length > 0 ? (
                    <>
                      <img
                        src={getImageUrl(images[currentImageIndex], 'large')}
                        srcSet={getImageSrcSet(images[currentImageIndex])}
                        sizes="(max-width: 640px) 400px, (max-width: 1024px) 800px, 1280px"
                        alt={selectedProperty.buildingName}
                        className="w-full h-full object-contain"
                        loading="lazy"
                      />
                    
                      {/* Image Counter */}
                      <div className="absolute bottom-4 right-4 bg-black/70 text-white px-3 py-1 rounded-full text-sm font-medium">
                        {currentImageIndex + 1}/{images.length}
                      </div>

                      {/* Navigation Arrows */}
                      {hasMultipleImages && (
                        <>
                          <button
                            onClick={prevImage}
                            className="absolute left-4 top-1/2 -translate-y-1/2 p-2 bg-white/90 hover:bg-white rounded-full shadow-lg transition-all"
                          >
                            <ChevronLeft className="w-6 h-6 text-gray-800" />
                          </button>
                          <button
                            onClick={nextImage}
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-2 bg-white/90 hover:bg-white rounded-full shadow-lg transition-all"
                          >
                            <ChevronRight className="w-6 h-6 text-gray-800" />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Building2 className="h-32 w-32 text-gray-300" />
                    </div>
                  )}
                </div>
              </div>

              {/* Property Details */}
              <div className="p-6">
                {/* Building Name - Most Prominent */}
                <h2 className="text-3xl font-bold text-slate-800 mb-2 leading-tight">
                  {selectedProperty.buildingName}
                </h2>

                {/* Price - Secondary but prominent */}
                <div className="text-2xl font-bold text-blue-700 mb-3">
                  {selectedProperty.startingPrice 
                    ? formatPrice(selectedProperty.startingPrice)
                    : 'Price on Application'}
                </div>

                {/* Developer */}
                <div className="flex items-center gap-2 mb-2">
                  {selectedProperty.developerLogoUrl && (
                    <img 
                      src={selectedProperty.developerLogoUrl} 
                      alt={selectedProperty.developer}
                      className="w-5 h-5 object-contain"
                    />
                  )}
                  <span className="font-medium text-slate-700">{selectedProperty.developer}</span>
                </div>

                {/* Address */}
                <div className="flex items-center gap-2 text-slate-600 mb-6">
                  <MapPin className="w-4 h-4" />
                  <span>{selectedProperty.areaName}</span>
                </div>

                {/* Key Stats - Vertical cards with deep blue tone */}
                <div className="flex flex-wrap gap-3 mb-6">
                  <div className="flex flex-col items-center px-3 py-2 bg-slate-100 rounded-md text-slate-700 min-w-[80px]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Bed className="w-4 h-4 text-slate-600" />
                      <div className="font-semibold text-sm text-slate-800">
                        {selectedProperty.minBedrooms === selectedProperty.maxBedrooms 
                          ? selectedProperty.minBedrooms
                          : `${selectedProperty.minBedrooms}-${selectedProperty.maxBedrooms}`}
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">Bedrooms</div>
                  </div>

                  {selectedProperty.minSize && (
                    <div className="flex flex-col items-center px-3 py-2 bg-slate-100 rounded-md text-slate-700 min-w-[90px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Home className="w-4 h-4 text-slate-600" />
                        <div className="font-semibold text-sm text-slate-800">
                          {selectedProperty.minSize.toLocaleString()} ft²
                        </div>
                      </div>
                      <div className="text-xs text-slate-600">Size</div>
                    </div>
                  )}

                  {selectedProperty.medianPriceSqft && (
                    <div className="flex flex-col items-center px-3 py-2 bg-slate-100 rounded-md text-slate-700 min-w-[100px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="font-semibold text-sm text-slate-800">
                          {formatPrice(selectedProperty.medianPriceSqft).replace('AED ', '')}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600">Price/sqft</div>
                    </div>
                  )}

                  {selectedProperty.unitCount && (
                    <div className="flex flex-col items-center px-3 py-2 bg-slate-100 rounded-md text-slate-700 min-w-[80px]">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="font-semibold text-sm text-slate-800">
                          {selectedProperty.unitCount}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600">Units</div>
                    </div>
                  )}
                </div>

                {/* Progress Bar - Show for upcoming and under-construction */}
                {selectedProperty.status !== 'completed' && selectedProperty.completionPercent !== undefined && selectedProperty.completionPercent >= 0 && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-700">Construction Progress</span>
                      <span className="text-lg font-bold text-blue-700">{selectedProperty.completionPercent}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-3">
                      <div 
                        className="bg-blue-700 h-3 rounded-full transition-all"
                        style={{ width: `${selectedProperty.completionPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Dates */}
                {(selectedProperty.launchDate || selectedProperty.completionDate) && (
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    {selectedProperty.launchDate && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Launch Date</div>
                        <div className="font-medium text-slate-800">{formatDate(selectedProperty.launchDate)}</div>
                      </div>
                    )}
                    {selectedProperty.completionDate && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Completion Date</div>
                        <div className="font-medium text-slate-800">{formatDate(selectedProperty.completionDate)}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* View Details Button */}
                <Link 
                  to={`/project/${selectedProperty.id}`}
                  className="flex items-center justify-center gap-2 w-full bg-blue-700 hover:bg-blue-800 text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  View Full Details
                  <ExternalLink className="w-5 h-5" />
                </Link>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <Building2 className="h-20 w-20 mx-auto mb-4" />
                <p>Select a property to view details</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Side - Property List (Fixed width ~25%) */}
        <div className="w-80 bg-gray-50 flex flex-col border-l">
          {/* Header - Very subtle */}
          <div className="p-3 border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {isLoading ? 'Loading...' : `${properties.length} properties nearby`}
              </span>
            </div>
          </div>

          {/* Property List - Compact */}
          <div className="flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center p-4">
                  <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-blue-600 mb-3"></div>
                  <p className="text-sm text-gray-600">Loading properties...</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {properties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={property}
                    isSelected={selectedProperty?.id === property.id}
                    onClick={() => setSelectedProperty(property)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
