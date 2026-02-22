/**
 * Unit Types Section - Grouped display with edit/remove capabilities
 */

import { useTranslation } from 'react-i18next'
import { UnitTypeCard } from '../developer-upload/UnitTypeCard'
import { PropertyFormData, groupUnitsByBuilding } from './types'

interface UnitTypesSectionProps {
  formData: PropertyFormData
  setFormData: React.Dispatch<React.SetStateAction<PropertyFormData>>
  isProcessing?: boolean
  translationNamespace?: string
}

export function UnitTypesSection({
  formData,
  setFormData,
  isProcessing = false,
  translationNamespace = 'upload',
}: UnitTypesSectionProps) {
  const { t } = useTranslation(translationNamespace as any)

  const groupedUnits = groupUnitsByBuilding(formData.unitTypes)

  const handleUnitChange = (unitId: string, field: string, value: any) => {
    setFormData(prev => {
      const globalIdx = prev.unitTypes.findIndex(u => u.id === unitId)
      if (globalIdx === -1) return prev
      const updated = [...prev.unitTypes]
      updated[globalIdx] = { ...updated[globalIdx], [field]: value }
      return { ...prev, unitTypes: updated }
    })
  }

  const handleUnitRemove = (unitId: string) => {
    setFormData(prev => ({
      ...prev,
      unitTypes: prev.unitTypes.filter(u => u.id !== unitId),
    }))
  }

  return (
    <div className="space-y-4 pt-6 border-t-2 border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-teal-500 to-emerald-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            {t('unitTypesList')}
          </h3>
          <p className="text-sm text-gray-600">
            {t('totalUnitTypes', { count: formData.unitTypes.length })}
          </p>
        </div>
      </div>

      {formData.unitTypes.length === 0 ? (
        <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
          <p className="text-base text-gray-700 font-semibold">No unit types yet</p>
          <p className="text-sm text-gray-500 mt-2">Upload documents to extract unit information</p>
        </div>
      ) : (
        Object.entries(groupedUnits).map(([groupKey, units]) => {
          const isUncategorized = groupKey === 'Uncategorized'
          return (
            <div key={groupKey} className="space-y-4">
              {/* Only show group header for categorized units */}
              {!isUncategorized && (
                <div className="px-5 py-4 rounded-xl shadow-md border-l-4 bg-gradient-to-r from-blue-50 via-blue-50 to-indigo-50 border-blue-500">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🏢</span>
                    <div>
                      <div className="font-bold text-blue-900">
                        {t('series', { key: groupKey })}
                      </div>
                      <div className="text-sm text-gray-600 mt-0.5">
                        {t('unitTypeCount', { count: units.length })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className={`space-y-3 ${!isUncategorized ? 'pl-4' : ''}`}>
                {units.map((unit, idx) => (
                  <UnitTypeCard
                    key={unit.id}
                    unit={unit}
                    index={idx}
                    isProcessing={isProcessing}
                    onChange={(field, value) => handleUnitChange(unit.id, field, value)}
                    onRemove={() => handleUnitRemove(unit.id)}
                  />
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
