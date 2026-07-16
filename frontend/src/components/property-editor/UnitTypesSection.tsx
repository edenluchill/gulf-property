/**
 * Unit Types Section - Sortable list with edit/remove capabilities
 */

import { useState, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { UnitTypeCard } from '../developer-upload/UnitTypeCard'
import { PropertyFormData, groupUnitsByBuilding } from './types'

interface UnitTypesSectionProps {
  formData: PropertyFormData
  setFormData: React.Dispatch<React.SetStateAction<PropertyFormData>>
  isProcessing?: boolean
  translationNamespace?: string
}

// Sortable wrapper for UnitTypeCard
interface SortableUnitCardProps {
  unit: PropertyFormData['unitTypes'][0]
  index: number
  isProcessing: boolean
  onChange: (field: string, value: any) => void
  onRemove: () => void
}

const SortableUnitCard = memo(function SortableUnitCard({
  unit,
  index,
  isProcessing,
  onChange,
  onRemove,
}: SortableUnitCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: unit.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full pe-2 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <div className="p-1.5 bg-gray-100 rounded hover:bg-gray-200">
          <GripVertical className="h-4 w-4 text-gray-500" />
        </div>
      </div>
      <UnitTypeCard
        unit={unit}
        index={index}
        isProcessing={isProcessing}
        onChange={onChange}
        onRemove={onRemove}
      />
    </div>
  )
})

// Drag overlay preview
const DragOverlayCard = memo(function DragOverlayCard({
  unit,
}: {
  unit: PropertyFormData['unitTypes'][0]
}) {
  return (
    <div className="bg-white rounded-lg shadow-2xl border-2 border-blue-500 p-4 max-w-md">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center">
          <span className="text-lg">🏠</span>
        </div>
        <div>
          <div className="font-semibold text-gray-900">
            {unit.typeName || unit.name || `${unit.bedrooms}BR`}
          </div>
          <div className="text-sm text-gray-600">
            {unit.area} sqft • {unit.bedrooms}BR
          </div>
        </div>
      </div>
    </div>
  )
})

export function UnitTypesSection({
  formData,
  setFormData,
  isProcessing = false,
  translationNamespace = 'upload',
}: UnitTypesSectionProps) {
  const { t } = useTranslation(translationNamespace as any)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 10,
      },
    })
  )

  const groupedUnits = groupUnitsByBuilding(formData.unitTypes)
  const activeUnit = activeId ? formData.unitTypes.find(u => u.id === activeId) : null

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event

    if (over && active.id !== over.id) {
      setFormData(prev => {
        const oldIndex = prev.unitTypes.findIndex(u => u.id === active.id)
        const newIndex = prev.unitTypes.findIndex(u => u.id === over.id)
        if (oldIndex !== -1 && newIndex !== -1) {
          return {
            ...prev,
            unitTypes: arrayMove(prev.unitTypes, oldIndex, newIndex),
          }
        }
        return prev
      })
    }
  }, [setFormData])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
  }, [])

  const handleUnitChange = useCallback((unitId: string, field: string, value: any) => {
    setFormData(prev => {
      const globalIdx = prev.unitTypes.findIndex(u => u.id === unitId)
      if (globalIdx === -1) return prev
      const updated = [...prev.unitTypes]
      updated[globalIdx] = { ...updated[globalIdx], [field]: value }
      return { ...prev, unitTypes: updated }
    })
  }, [setFormData])

  const handleUnitRemove = useCallback((unitId: string) => {
    setFormData(prev => ({
      ...prev,
      unitTypes: prev.unitTypes.filter(u => u.id !== unitId),
    }))
  }, [setFormData])

  // Flat list of all unit IDs for sortable context
  const unitIds = formData.unitTypes.map(u => u.id)

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

      {/* Drag hint */}
      {formData.unitTypes.length > 1 && (
        <p className="text-xs text-gray-500 flex items-center gap-1">
          <GripVertical className="h-3 w-3" />
          {t('unitTypesSection.dragHint', '拖拽左侧手柄调整户型顺序')}
        </p>
      )}

      {formData.unitTypes.length === 0 ? (
        <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
          <p className="text-base text-gray-700 font-semibold">No unit types yet</p>
          <p className="text-sm text-gray-500 mt-2">Upload documents to extract unit information</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={unitIds} strategy={verticalListSortingStrategy}>
            {Object.entries(groupedUnits).map(([groupKey, units]) => {
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
                  <div className={`space-y-3 ${!isUncategorized ? 'ps-4' : ''} ms-6`}>
                    {units.map((unit, idx) => (
                      <SortableUnitCard
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
            })}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeUnit ? <DragOverlayCard unit={activeUnit} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
