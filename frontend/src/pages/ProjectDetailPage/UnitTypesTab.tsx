import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
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

interface GroupedUnits {
  [key: string]: UnitType[]
}

// Extract group prefix from unit type name (e.g., "A-1B-A.1" -> "A")
function getGroupPrefix(unitTypeName: string): string {
  const match = unitTypeName.match(/^([A-Z]+)-/)
  return match ? match[1] : 'Other'
}

// Group unit types by prefix
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

export function UnitTypesTab({ unitTypes, projectId, onUnitSelect }: UnitTypesTabProps) {
  const { t } = useTranslation(['project', 'common'])
  const groupedUnits = groupUnitTypes(unitTypes)
  const sortedGroupKeys = Object.keys(groupedUnits).sort()

  // Initialize with all groups expanded by default
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(sortedGroupKeys))
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

  const toggleGroup = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey)
    } else {
      newExpanded.add(groupKey)
    }
    setExpandedGroups(newExpanded)
  }

  const handleUnitClick = (unit: UnitType) => {
    // Desktop: Use sub-page navigation if callback provided
    if (onUnitSelect && !isMobile) {
      onUnitSelect(unit.id)
      return
    }
    // Mobile: Use bottom sheet
    setSelectedUnit(unit)
    setIsModalOpen(true)
  }

  if (unitTypes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('project:unitTypesTab.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-600">
            <p>{t('project:unitTypesTab.emptyMessage')}</p>
            <Button className="mt-4">{t('common:buttons.requestUnitInfo')}</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('project:unitTypesTab.title')} ({unitTypes.length} configurations)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sortedGroupKeys.map((groupKey) => {
              const units = groupedUnits[groupKey]
              const isExpanded = expandedGroups.has(groupKey)
              
              return (
                <div key={groupKey} className="border rounded-lg overflow-hidden">
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-10 h-10 bg-primary text-white rounded-full font-bold text-lg">
                        {groupKey}
                      </div>
                      <div className="text-left">
                        <div className="font-bold text-lg">Group {groupKey}</div>
                        <div className="text-sm text-slate-600">
                          {units.length} configuration{units.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-slate-600" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-slate-600" />
                      )}
                    </div>
                  </button>
                  
                  {/* Group Content - Card Grid */}
                  {isExpanded && (
                    <div className="p-4 bg-white">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {units.map((unit) => (
                          <div
                            key={unit.id}
                            onClick={() => handleUnitClick(unit)}
                            className="border rounded-lg overflow-hidden hover:shadow-md hover:border-primary/50 transition-all cursor-pointer bg-white group"
                          >
                            {/* Floor Plan Image - Compact */}
                            {unit.floor_plan_image && (
                              <div className="aspect-[4/3] bg-slate-50 overflow-hidden">
                                <img
                                  src={unit.floor_plan_image}
                                  alt={`${unit.unit_type_name} floor plan`}
                                  className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                                />
                              </div>
                            )}

                            {/* Unit Info - Compact */}
                            <div className="p-3">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <h4 className="font-semibold text-slate-900 text-sm leading-tight">
                                  {unit.unit_type_name}
                                </h4>
                                {projectId && (
                                  <UnitTypeFavoriteButton
                                    projectId={projectId}
                                    unitTypeId={unit.id}
                                    size="sm"
                                  />
                                )}
                              </div>

                              {/* Category Badge */}
                              {unit.category && (
                                <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium mb-2">
                                  {unit.category}
                                </span>
                              )}

                              {/* Quick Specs */}
                              <div className="flex items-center gap-3 text-xs text-slate-600 mb-2">
                                <span>{unit.bedrooms} {t('common:units.beds')}</span>
                                <span className="text-slate-300">|</span>
                                <span>{unit.bathrooms} {t('common:units.bathrooms')}</span>
                                <span className="text-slate-300">|</span>
                                <span>{parseFloat(unit.area).toLocaleString()} {t('common:units.sqft')}</span>
                              </div>

                              {/* Price */}
                              {unit.price && (
                                <div className="pt-2 border-t">
                                  <div className="font-bold text-primary">
                                    {formatPrice(unit.price)}
                                  </div>
                                  {unit.price_per_sqft && (
                                    <div className="text-xs text-slate-500">
                                      {formatPrice(unit.price_per_sqft)}/{t('common:units.sqft')}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Mobile: Bottom Sheet (Desktop uses sub-page now) */}
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
