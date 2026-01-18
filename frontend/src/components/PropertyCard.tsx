import { Building2, Bed, Calendar, Home } from 'lucide-react'
import { OffPlanProperty } from '../types'
import { formatPrice } from '../lib/utils'
import { getImageUrl, getImageSrcSet } from '../lib/image-utils'

interface PropertyCardProps {
  property: OffPlanProperty
  isSelected: boolean
  onClick: () => void
}

export default function PropertyCard({ property, isSelected, onClick }: PropertyCardProps) {
  // Format date to readable format
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-lg cursor-pointer transition-all border w-[260px] flex-shrink-0
        ${isSelected 
          ? 'ring-2 ring-blue-500 border-blue-500 shadow-md' 
          : 'border-gray-200 hover:bg-gray-50'
        }
      `}
    >
      {/* Image Thumbnail - More prominent */}
      <div className="relative h-36 bg-white rounded-t-lg overflow-hidden">
        {property.images && property.images.length > 0 ? (
          <img
            src={getImageUrl(property.images[0], 'thumbnail')}
            srcSet={getImageSrcSet(property.images[0])}
            sizes="(max-width: 640px) 400px, 800px"
            alt={property.buildingName}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 className="h-10 w-10 text-gray-300" />
          </div>
        )}
        
        {/* Status Badge */}
        {property.status === 'under-construction' && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 bg-yellow-500 text-white text-xs font-semibold rounded">
              Under Construction
            </span>
          </div>
        )}
        {property.status === 'upcoming' && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 bg-blue-500 text-white text-xs font-semibold rounded">
              Upcoming
            </span>
          </div>
        )}
        {property.status === 'completed' && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 bg-green-500 text-white text-xs font-semibold rounded">
              Completed
            </span>
          </div>
        )}
      </div>

      {/* Content - Compact padding */}
      <div className="p-2 flex flex-col gap-1">
        {/* Property Name - Most Prominent */}
        <h4 className="text-sm font-semibold text-slate-800 line-clamp-1">
          {property.buildingName}
        </h4>

        {/* Price - Secondary */}
        <div className="text-sm font-semibold text-blue-700">
          {property.startingPrice 
            ? formatPrice(property.startingPrice).replace('AED ', '').replace(' AED', '')
            : 'POA'}
        </div>

        {/* Key Stats - Pill badges with deep blue tone */}
        <div className="flex flex-wrap gap-1 mt-1">
          <div className="flex items-center gap-0.5 px-1.5 py-0.5 border border-slate-300 rounded-full text-[10px] text-slate-700">
            <Bed className="w-3 h-3" />
            <span>
              {property.minBedrooms === property.maxBedrooms 
                ? property.minBedrooms
                : `${property.minBedrooms}-${property.maxBedrooms}`}
            </span>
          </div>
          
          {property.minSize && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 border border-slate-300 rounded-full text-[10px] text-slate-700">
              <Home className="w-3 h-3" />
              <span>{property.minSize.toLocaleString()} ft²</span>
            </div>
          )}

          {property.unitCount && (
            <div className="flex items-center gap-0.5 px-1.5 py-0.5 border border-slate-300 rounded-full text-[10px] text-slate-700">
              <span>{property.unitCount} units</span>
            </div>
          )}
        </div>

        {/* Progress Bar - Show for upcoming and under-construction */}
        {property.status !== 'completed' && property.completionPercent !== undefined && property.completionPercent >= 0 && (
          <div className="mt-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-slate-500">Progress</span>
              <span className="text-[10px] font-semibold text-blue-700">{property.completionPercent}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1">
              <div 
                className="bg-blue-700 h-1 rounded-full transition-all"
                style={{ width: `${property.completionPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Completion Date - Very small */}
        {property.completionDate && (
          <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
            <Calendar className="w-3 h-3" />
            <span>Completion {formatDate(property.completionDate)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
