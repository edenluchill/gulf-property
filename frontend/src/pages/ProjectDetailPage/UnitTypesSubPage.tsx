import { useEffect } from 'react'
import { Button } from '../../components/ui/button'
import { ArrowLeft, Bed, Bath, Maximize } from 'lucide-react'
import { formatPrice } from '../../lib/utils'
import { UnitType } from '../../types'
import { UnitTypeFavoriteButton } from '../../components/favorites'
import { cn } from '../../lib/utils'

interface UnitTypesSubPageProps {
  unitTypes: UnitType[]
  selectedUnitId: string | null
  projectId: string
  projectName: string
  onUnitSelect: (unitId: string) => void
  onBack: () => void
}

export function UnitTypesSubPage({
  unitTypes,
  selectedUnitId,
  projectId,
  projectName,
  onUnitSelect,
  onBack
}: UnitTypesSubPageProps) {
  const selectedUnit = unitTypes.find(u => u.id === selectedUnitId) || unitTypes[0]

  useEffect(() => {
    if (!selectedUnitId && unitTypes.length > 0) {
      onUnitSelect(unitTypes[0].id)
    }
  }, [selectedUnitId, unitTypes, onUnitSelect])

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header - Clean */}
      <div className="bg-white border-b px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ml-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="h-5 w-px bg-slate-200" />
        <span className="font-medium text-slate-900 truncate">{projectName}</span>
        <span className="text-xs text-slate-400">{unitTypes.length} units</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Minimal */}
        <div className="w-64 bg-white border-r flex-shrink-0 overflow-y-auto">
          {unitTypes.map((unit) => (
            <button
              key={unit.id}
              onClick={() => onUnitSelect(unit.id)}
              className={cn(
                'w-full text-left px-4 py-3 border-l-2 transition-all hover:bg-slate-50',
                unit.id === selectedUnitId
                  ? 'border-l-primary bg-primary/5'
                  : 'border-l-transparent'
              )}
            >
              <div className="font-medium text-sm truncate">{unit.unit_type_name}</div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                <span className="flex items-center gap-0.5">
                  <Bed className="h-3 w-3" />
                  {unit.bedrooms}
                </span>
                <span className="flex items-center gap-0.5">
                  <Bath className="h-3 w-3" />
                  {unit.bathrooms}
                </span>
                <span>{parseFloat(unit.area).toLocaleString()} ft²</span>
              </div>
              {unit.price && (
                <div className="mt-1 text-sm font-semibold text-primary">
                  {formatPrice(unit.price)}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Right Panel - Clean Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedUnit ? (
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header Row */}
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    {selectedUnit.unit_type_name}
                  </h2>
                  <div className="flex items-center gap-4 text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Bed className="h-4 w-4" />
                      {selectedUnit.bedrooms}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Bath className="h-4 w-4" />
                      {selectedUnit.bathrooms}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Maximize className="h-4 w-4" />
                      {parseFloat(selectedUnit.area).toLocaleString()} ft²
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {selectedUnit.price && (
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {formatPrice(selectedUnit.price)}
                      </div>
                      {selectedUnit.price_per_sqft && (
                        <div className="text-xs text-slate-400">
                          {formatPrice(selectedUnit.price_per_sqft)}/ft²
                        </div>
                      )}
                    </div>
                  )}
                  <UnitTypeFavoriteButton projectId={projectId} unitTypeId={selectedUnit.id} />
                </div>
              </div>

              {/* Floor Plan - Hero style */}
              {selectedUnit.floor_plan_image && (
                <div className="bg-white rounded-2xl overflow-hidden shadow-sm border mb-8">
                  <img
                    src={selectedUnit.floor_plan_image}
                    alt={selectedUnit.unit_type_name}
                    className="w-full h-auto max-h-[450px] object-contain"
                  />
                </div>
              )}

              {/* Description - if exists */}
              {selectedUnit.description && (
                <p className="text-slate-600 leading-relaxed mb-8">
                  {selectedUnit.description}
                </p>
              )}

              {/* Features - Minimal pills */}
              {selectedUnit.features && selectedUnit.features.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedUnit.features.map((feature, index) => (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-sm"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              Select a unit
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
