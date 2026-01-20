import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { formatPrice } from '../../lib/utils'
import { UnitTypeDetailModal } from './UnitTypeDetailModal'

interface UnitType {
  id: string
  unit_type_name: string
  bedrooms: number
  bathrooms: number
  area: string
  balcony_area?: string
  price?: number
  price_per_sqft?: number
  floor_plan_image?: string
  category?: string
  description?: string
  features?: string[]
}

interface UnitTypesTabProps {
  unitTypes: UnitType[]
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

export function UnitTypesTab({ unitTypes }: UnitTypesTabProps) {
  const groupedUnits = groupUnitTypes(unitTypes)
  const sortedGroupKeys = Object.keys(groupedUnits).sort()
  
  // Initialize with all groups expanded by default
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(sortedGroupKeys))
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

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
    setSelectedUnit(unit)
    setIsModalOpen(true)
  }

  if (unitTypes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unit Types & Floor Plans</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-600">
            <p>Unit type information will be available soon.</p>
            <Button className="mt-4">Request Unit Information</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Unit Types & Floor Plans ({unitTypes.length} configurations)</CardTitle>
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
                  
                  {/* Group Content */}
                  {isExpanded && (
                    <div className="p-6 space-y-4 bg-white">
                      {units.map((unit) => (
                        <div
                          key={unit.id}
                          onClick={() => handleUnitClick(unit)}
                          className="border-2 rounded-xl p-6 hover:shadow-lg hover:border-primary/50 transition-all cursor-pointer bg-white"
                        >
                          <div className="flex flex-col lg:flex-row gap-6">
                            {/* Floor Plan Image - Much Larger */}
                            {unit.floor_plan_image && (
                              <div className="w-full lg:w-80 h-64 flex-shrink-0">
                                <img 
                                  src={unit.floor_plan_image}
                                  alt={`${unit.unit_type_name} floor plan`}
                                  className="w-full h-full object-contain rounded-lg border-2 border-slate-200 bg-white"
                                />
                              </div>
                            )}
                            
                            {/* Unit Info */}
                            <div className="flex-1 flex flex-col justify-between">
                              <div>
                                <div className="flex items-start justify-between mb-3">
                                  <div>
                                    <h4 className="font-bold text-primary text-2xl mb-2">
                                      {unit.unit_type_name}
                                    </h4>
                                    <div className="flex items-center gap-2">
                                      {unit.category && (
                                        <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                                          {unit.category}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  {unit.price && (
                                    <div className="text-right">
                                      <div className="text-2xl font-bold text-primary">
                                        {formatPrice(unit.price)}
                                      </div>
                                      {unit.price_per_sqft && (
                                        <div className="text-sm text-slate-600 mt-1">
                                          {formatPrice(unit.price_per_sqft)}/sq ft
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                                
                                {/* Specs Grid */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                                  <div className="bg-slate-50 p-4 rounded-lg">
                                    <div className="text-sm text-slate-600 mb-1">Bedrooms</div>
                                    <div className="text-xl font-bold text-slate-900">{unit.bedrooms}</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 rounded-lg">
                                    <div className="text-sm text-slate-600 mb-1">Bathrooms</div>
                                    <div className="text-xl font-bold text-slate-900">{unit.bathrooms}</div>
                                  </div>
                                  <div className="bg-slate-50 p-4 rounded-lg">
                                    <div className="text-sm text-slate-600 mb-1">Area</div>
                                    <div className="text-xl font-bold text-slate-900">
                                      {parseFloat(unit.area).toLocaleString()}
                                    </div>
                                    <div className="text-xs text-slate-500">sq ft</div>
                                  </div>
                                  {unit.balcony_area && (
                                    <div className="bg-slate-50 p-4 rounded-lg">
                                      <div className="text-sm text-slate-600 mb-1">Balcony</div>
                                      <div className="text-xl font-bold text-slate-900">
                                        {parseFloat(unit.balcony_area).toLocaleString()}
                                      </div>
                                      <div className="text-xs text-slate-500">sq ft</div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Click hint */}
                              <div className="mt-4 text-sm text-slate-500 italic">
                                Click to view full details →
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <UnitTypeDetailModal 
        unit={selectedUnit}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  )
}
