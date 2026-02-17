import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { ArrowLeft, Bed, Bath, Maximize, ChevronDown, ChevronUp } from 'lucide-react'
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

interface GroupedUnits {
  [key: string]: UnitType[]
}

function getGroupPrefix(unitTypeName: string): string {
  const match = unitTypeName.match(/^([A-Z]+)-/)
  return match ? match[1] : 'Other'
}

function groupUnitTypes(unitTypes: UnitType[]): GroupedUnits {
  return unitTypes.reduce((groups: GroupedUnits, unit) => {
    const prefix = getGroupPrefix(unit.unit_type_name)
    if (!groups[prefix]) {
      groups[prefix] = []
    }
    groups[prefix].push(unit)
    return groups
  }, {})
}

export function UnitTypesSubPage({
  unitTypes,
  selectedUnitId,
  projectId,
  projectName,
  onUnitSelect,
  onBack
}: UnitTypesSubPageProps) {
  const { t } = useTranslation(['project', 'common'])
  const groupedUnits = groupUnitTypes(unitTypes)
  const sortedGroupKeys = Object.keys(groupedUnits).sort()

  // All groups expanded by default
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(sortedGroupKeys))

  // Find selected unit
  const selectedUnit = unitTypes.find(u => u.id === selectedUnitId) || unitTypes[0]

  // Auto-select first unit if none selected
  useEffect(() => {
    if (!selectedUnitId && unitTypes.length > 0) {
      onUnitSelect(unitTypes[0].id)
    }
  }, [selectedUnitId, unitTypes, onUnitSelect])

  const toggleGroup = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey)
    } else {
      newExpanded.add(groupKey)
    }
    setExpandedGroups(newExpanded)
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          {t('project:unitSubPage.backToProject')}
        </Button>
        <div className="h-6 w-px bg-slate-200" />
        <h1 className="font-semibold text-slate-900 truncate">{projectName}</h1>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Unit List */}
        <div className="w-80 bg-white border-r flex-shrink-0 overflow-y-auto">
          <div className="p-4 border-b bg-slate-50">
            <h2 className="font-bold text-lg">{t('project:tabs.unitTypes')}</h2>
            <p className="text-sm text-slate-600">{unitTypes.length} {t('project:unitSubPage.configurations')}</p>
          </div>

          <div className="divide-y">
            {sortedGroupKeys.map((groupKey) => {
              const units = groupedUnits[groupKey]
              const isExpanded = expandedGroups.has(groupKey)

              return (
                <div key={groupKey}>
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">
                        {groupKey}
                      </div>
                      <span className="font-medium">Group {groupKey}</span>
                      <span className="text-xs text-slate-500">({units.length})</span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </button>

                  {/* Unit Items */}
                  {isExpanded && (
                    <div className="bg-slate-50">
                      {units.map((unit) => (
                        <button
                          key={unit.id}
                          onClick={() => onUnitSelect(unit.id)}
                          className={cn(
                            'w-full text-left p-3 pl-6 border-l-4 transition-all hover:bg-slate-100',
                            unit.id === selectedUnitId
                              ? 'border-l-primary bg-primary/5'
                              : 'border-l-transparent'
                          )}
                        >
                          <div className="font-medium text-sm truncate">{unit.unit_type_name}</div>
                          <div className="flex items-center gap-3 mt-1 text-xs text-slate-600">
                            <span className="flex items-center gap-1">
                              <Bed className="h-3 w-3" />
                              {unit.bedrooms}
                            </span>
                            <span className="flex items-center gap-1">
                              <Bath className="h-3 w-3" />
                              {unit.bathrooms}
                            </span>
                            <span className="flex items-center gap-1">
                              <Maximize className="h-3 w-3" />
                              {parseFloat(unit.area).toLocaleString()} sqft
                            </span>
                          </div>
                          {unit.price && (
                            <div className="mt-1 text-sm font-semibold text-primary">
                              {formatPrice(unit.price)}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Panel - Unit Details */}
        <div className="flex-1 overflow-y-auto">
          {selectedUnit ? (
            <div className="p-6 max-w-4xl mx-auto">
              {/* Unit Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  {/* Title + Price */}
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl font-bold text-slate-900">{selectedUnit.unit_type_name}</h2>
                    {selectedUnit.category && (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                        {selectedUnit.category}
                      </span>
                    )}
                    {selectedUnit.price && (
                      <span className="text-xl font-bold text-primary">
                        {formatPrice(selectedUnit.price)}
                      </span>
                    )}
                    {selectedUnit.price_per_sqft && (
                      <span className="text-sm text-slate-400">
                        {formatPrice(selectedUnit.price_per_sqft)}/{t('common:units.sqft')}
                      </span>
                    )}
                  </div>
                  {/* Subtitle with icons */}
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <Bed className="h-4 w-4" />
                      {selectedUnit.bedrooms} {t('common:units.beds')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Bath className="h-4 w-4" />
                      {selectedUnit.bathrooms} {t('common:units.bathrooms')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Maximize className="h-4 w-4" />
                      {parseFloat(selectedUnit.area).toLocaleString()} {t('common:units.sqft')}
                    </span>
                  </div>
                </div>
                {/* Actions: Schedule + Like */}
                <div className="flex items-center gap-2">
                  <Button size="sm">
                    {t('common:buttons.scheduleViewing')}
                  </Button>
                  <UnitTypeFavoriteButton projectId={projectId} unitTypeId={selectedUnit.id} />
                </div>
              </div>

              {/* Floor Plan - No label needed */}
              {selectedUnit.floor_plan_image && (
                <div className="bg-white border rounded-xl overflow-hidden mb-6">
                  <img
                    src={selectedUnit.floor_plan_image}
                    alt={`${selectedUnit.unit_type_name} floor plan`}
                    className="w-full h-auto max-h-[500px] object-contain"
                  />
                </div>
              )}

              {/* Specifications - Compact */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-3">{t('project:unitDetail.unitSpecifications')}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <div className="text-xs text-slate-500 mb-1">{t('common:units.bedrooms')}</div>
                    <div className="text-xl font-bold text-slate-900">{selectedUnit.bedrooms}</div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <div className="text-xs text-slate-500 mb-1">{t('common:units.bathrooms')}</div>
                    <div className="text-xl font-bold text-slate-900">{selectedUnit.bathrooms}</div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-lg">
                    <div className="text-xs text-slate-500 mb-1">{t('project:unitDetail.builtUpArea')}</div>
                    <div className="text-xl font-bold text-slate-900">
                      {parseFloat(selectedUnit.area).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-400">{t('common:units.sqft')}</div>
                  </div>
                  {selectedUnit.balcony_area && (
                    <div className="bg-slate-50 p-4 rounded-lg">
                      <div className="text-xs text-slate-500 mb-1">{t('project:unitDetail.balconyArea')}</div>
                      <div className="text-xl font-bold text-slate-900">
                        {parseFloat(selectedUnit.balcony_area).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-400">{t('common:units.sqft')}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {selectedUnit.description && (
                <div className="bg-slate-50 p-4 rounded-xl mb-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">{t('common:description')}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                    {selectedUnit.description}
                  </p>
                </div>
              )}

              {/* Features */}
              {selectedUnit.features && selectedUnit.features.length > 0 && (
                <div className="bg-slate-50 p-4 rounded-xl mb-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-3">{t('project:unitDetail.featuresAmenities')}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {selectedUnit.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2 text-sm text-slate-600">
                        <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0"></div>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500">
              {t('project:unitSubPage.selectUnit')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
