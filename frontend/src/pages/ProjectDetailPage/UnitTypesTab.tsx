import { useState, useEffect } from 'react'
import { Button } from '../../components/ui/button'
import { Bed, Bath, Maximize } from 'lucide-react'
import { formatPrice } from '../../lib/utils'
import { UnitTypeDetailSheet } from './UnitTypeDetailSheet'
import { UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { UnitTypeFavoriteButton } from '../../components/favorites'

interface UnitTypesTabProps {
  unitTypes: UnitType[]
  projectId?: string
  onUnitSelect?: (unitId: string) => void
}

export function UnitTypesTab({ unitTypes, projectId, onUnitSelect }: UnitTypesTabProps) {
  const { t } = useTranslation(['project', 'common'])
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const handleUnitClick = (unit: UnitType) => {
    if (onUnitSelect && !isMobile) {
      onUnitSelect(unit.id)
      return
    }
    setSelectedUnit(unit)
    setIsModalOpen(true)
  }

  if (unitTypes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="mb-4">{t('project:unitTypesTab.emptyMessage')}</p>
        <Button>{t('common:buttons.requestUnitInfo')}</Button>
      </div>
    )
  }

  return (
    <>
      {/* Compact grid - more columns, smaller cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {unitTypes.map((unit) => (
          <div
            key={unit.id}
            onClick={() => handleUnitClick(unit)}
            className="group relative bg-white border rounded-xl overflow-hidden hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
          >
            {/* Floor Plan Image - Compact */}
            {unit.floor_plan_image && (
              <div className="aspect-square bg-slate-50 overflow-hidden">
                <img
                  src={unit.floor_plan_image}
                  alt={unit.unit_type_name}
                  className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            )}

            {/* Favorite button - top right */}
            {projectId && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <UnitTypeFavoriteButton
                  projectId={projectId}
                  unitTypeId={unit.id}
                  size="sm"
                />
              </div>
            )}

            {/* Unit Info - Minimal */}
            <div className="p-3">
              {/* Name */}
              <div className="font-medium text-sm text-slate-900 truncate mb-1.5">
                {unit.unit_type_name}
              </div>

              {/* Specs with icons only */}
              <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                <span className="flex items-center gap-1" title={`${unit.bedrooms} Bedrooms`}>
                  <Bed className="h-3.5 w-3.5" />
                  {unit.bedrooms}
                </span>
                <span className="flex items-center gap-1" title={`${unit.bathrooms} Bathrooms`}>
                  <Bath className="h-3.5 w-3.5" />
                  {unit.bathrooms}
                </span>
                <span className="flex items-center gap-1" title={`${parseFloat(unit.area).toLocaleString()} sqft`}>
                  <Maximize className="h-3.5 w-3.5" />
                  {parseFloat(unit.area).toLocaleString()}
                </span>
              </div>

              {/* Price */}
              {unit.price && (
                <div className="font-semibold text-primary text-sm">
                  {formatPrice(unit.price)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Mobile: Bottom Sheet */}
      {isMobile && (
        <UnitTypeDetailSheet
          unit={selectedUnit}
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  )
}
