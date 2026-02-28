import { Bed, Bath, Maximize } from 'lucide-react'
import MobileBottomSheet from '../../components/MobileBottomSheet'
import { formatPrice } from '../../lib/utils'
import { UnitType } from '../../types'
import { UnitTypeFavoriteButton } from '../../components/favorites'

interface UnitTypeDetailSheetProps {
  unit: UnitType | null
  projectId?: string
  isOpen: boolean
  onClose: () => void
}

export function UnitTypeDetailSheet({ unit, projectId, isOpen, onClose }: UnitTypeDetailSheetProps) {
  if (!unit) return null

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={unit.unit_type_name}
      height="80vh"
    >
      <div className="px-4 pb-6 space-y-5">
        {/* Header: Price + Specs + Like */}
        <div className="flex items-start justify-between">
          <div>
            {unit.price && (
              <div className="text-2xl font-bold text-primary mb-1">
                {formatPrice(unit.price)}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="flex items-center gap-1">
                <Bed className="h-4 w-4" />
                {unit.bedrooms}
              </span>
              <span className="flex items-center gap-1">
                <Bath className="h-4 w-4" />
                {unit.bathrooms}
              </span>
              <span className="flex items-center gap-1">
                <Maximize className="h-4 w-4" />
                {parseFloat(unit.area).toLocaleString()} ft²
              </span>
            </div>
          </div>
          {projectId && (
            <UnitTypeFavoriteButton projectId={projectId} unitTypeId={unit.id} />
          )}
        </div>

        {/* Floor Plan */}
        {unit.floor_plan_image && (
          <div className="bg-white rounded-2xl overflow-hidden border">
            <img
              src={unit.floor_plan_image}
              alt={unit.unit_type_name}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Description */}
        {unit.description && (
          <p className="text-sm text-slate-600 leading-relaxed">
            {unit.description}
          </p>
        )}

        {/* Features */}
        {unit.features && unit.features.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unit.features.map((feature, index) => (
              <span
                key={index}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-xs"
              >
                {feature}
              </span>
            ))}
          </div>
        )}
      </div>
    </MobileBottomSheet>
  )
}
