import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Bed, Bath, Square, MapPin, Calendar, Building2, TrendingUp, Check, Minus } from 'lucide-react'
import { Button } from '../ui/button'
import { UnitType, ResidentialProject } from '../../types'
import { formatPrice } from '../../lib/utils'

interface CompareItem {
  unit: UnitType
  project: ResidentialProject
}

interface UnitComparePanelProps {
  items: CompareItem[]
  isOpen: boolean
  onClose: () => void
  onRemoveItem?: (unitId: string) => void
}

export function UnitComparePanel({ items, isOpen, onClose, onRemoveItem }: UnitComparePanelProps) {
  const { t } = useTranslation('favorites')

  if (!isOpen || items.length === 0) return null

  const columnLabels = ['A', 'B', 'C', 'D'].slice(0, items.length)

  // Get all unique amenities from all projects
  const allAmenities = [...new Set(items.flatMap(item => item.project.amenities || []))]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10001] flex items-center justify-center p-4 md:p-6"
        onClick={onClose}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

        {/* Panel */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-teal-50 to-emerald-50">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {t('compare.title', 'Compare Properties')}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {t('compare.subtitle', 'Comparing {{count}} unit types', { count: items.length })}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full hover:bg-white/80"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-auto">
            <div className="min-w-[600px]">
              {/* Column Headers with Floor Plans */}
              <div className="grid border-b bg-slate-50" style={{ gridTemplateColumns: `200px repeat(${items.length}, 1fr)` }}>
                <div className="p-4 font-semibold text-slate-700 border-r bg-slate-100">
                  {/* Empty header cell */}
                </div>
                {items.map((item, idx) => (
                  <div key={item.unit.id} className="p-4 border-r last:border-r-0">
                    {/* Column Label Badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                        idx === 0 ? 'bg-teal-500 text-white' : 'bg-emerald-500 text-white'
                      }`}>
                        {columnLabels[idx]}
                      </span>
                      {onRemoveItem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-slate-400 hover:text-red-500"
                          onClick={() => onRemoveItem(item.unit.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {/* Floor Plan Image */}
                    {item.unit.floor_plan_image && (
                      <div className="w-full h-32 mb-3 rounded-lg overflow-hidden bg-white border">
                        <img
                          src={item.unit.floor_plan_image}
                          alt={item.unit.unit_type_name}
                          className="w-full h-full object-contain"
                        />
                      </div>
                    )}

                    {/* Unit Name */}
                    <h3 className="font-bold text-slate-900 text-lg">
                      {item.unit.unit_type_name}
                    </h3>
                    <p className="text-sm text-slate-500 truncate">
                      {item.project.project_name}
                    </p>
                  </div>
                ))}
              </div>

              {/* Comparison Rows */}
              <div className="divide-y">
                {/* Price Row */}
                <CompareRow
                  icon={<TrendingUp className="h-4 w-4" />}
                  label={t('compare.price', 'Price')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="font-semibold text-teal-600 text-lg">
                      {item.unit.price ? formatPrice(item.unit.price) : 'AED 0'}
                    </div>
                  ))}
                </CompareRow>

                {/* Area Row */}
                <CompareRow
                  icon={<Square className="h-4 w-4" />}
                  label={t('compare.area', 'Area')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900">
                      {parseFloat(item.unit.area).toLocaleString()} sqft
                    </div>
                  ))}
                </CompareRow>

                {/* Bedrooms Row */}
                <CompareRow
                  icon={<Bed className="h-4 w-4" />}
                  label={t('compare.bedrooms', 'Bedrooms')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900">
                      {item.unit.bedrooms}
                    </div>
                  ))}
                </CompareRow>

                {/* Bathrooms Row */}
                <CompareRow
                  icon={<Bath className="h-4 w-4" />}
                  label={t('compare.bathrooms', 'Bathrooms')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900">
                      {item.unit.bathrooms || '-'}
                    </div>
                  ))}
                </CompareRow>

                {/* Location Row */}
                <CompareRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={t('compare.location', 'Location')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900 text-sm">
                      {item.project.area || '-'}
                    </div>
                  ))}
                </CompareRow>

                {/* Completion Row */}
                <CompareRow
                  icon={<Calendar className="h-4 w-4" />}
                  label={t('compare.completion', 'Completion')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900 text-sm">
                      {item.project.completion_date
                        ? new Date(item.project.completion_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : t('compare.upcoming', 'upcoming')
                      }
                    </div>
                  ))}
                </CompareRow>

                {/* Progress Row */}
                <CompareRow
                  icon={<TrendingUp className="h-4 w-4" />}
                  label={t('compare.progress', 'Progress')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full"
                          style={{ width: `${item.project.construction_progress || 0}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-600">
                        {item.project.construction_progress || 0}%
                      </span>
                    </div>
                  ))}
                </CompareRow>

                {/* Developer Row */}
                <CompareRow
                  icon={<Building2 className="h-4 w-4" />}
                  label={t('compare.developer', 'Developer')}
                  itemCount={items.length}
                >
                  {items.map((item) => (
                    <div key={item.unit.id} className="text-slate-900 font-medium">
                      {item.project.developer || '-'}
                    </div>
                  ))}
                </CompareRow>

                {/* Amenities Section */}
                {allAmenities.length > 0 && (
                  <>
                    <div className="grid bg-slate-50 border-t" style={{ gridTemplateColumns: `200px repeat(${items.length}, 1fr)` }}>
                      <div className="p-4 font-semibold text-slate-700 border-r flex items-center gap-2">
                        <span className="text-lg">Amenities</span>
                      </div>
                      {items.map((item) => (
                        <div key={item.unit.id} className="p-4 border-r last:border-r-0">
                          {/* Empty cell for header */}
                        </div>
                      ))}
                    </div>
                    {allAmenities.slice(0, 8).map((amenity) => (
                      <CompareRow
                        key={amenity}
                        icon={null}
                        label={amenity}
                        itemCount={items.length}
                        isAmenity
                      >
                        {items.map((item) => {
                          const hasAmenity = item.project.amenities?.includes(amenity)
                          return (
                            <div key={item.unit.id} className="flex justify-center">
                              {hasAmenity ? (
                                <Check className="h-5 w-5 text-teal-500" />
                              ) : (
                                <Minus className="h-5 w-5 text-slate-300" />
                              )}
                            </div>
                          )
                        })}
                      </CompareRow>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

interface CompareRowProps {
  icon: React.ReactNode | null
  label: string
  children: React.ReactNode
  itemCount: number
  isAmenity?: boolean
}

function CompareRow({ icon, label, children, itemCount, isAmenity }: CompareRowProps) {
  const childArray = Array.isArray(children) ? children : [children]

  return (
    <div
      className="grid hover:bg-slate-50 transition-colors"
      style={{ gridTemplateColumns: `200px repeat(${itemCount}, 1fr)` }}
    >
      {/* Label Cell */}
      <div className={`p-4 border-r flex items-center gap-2 ${isAmenity ? 'ps-8 text-sm' : ''} bg-slate-50`}>
        {icon && <span className="text-slate-400">{icon}</span>}
        <span className="font-medium text-slate-700">{label}</span>
      </div>

      {/* Value Cells */}
      {childArray.map((child, idx) => (
        <div key={idx} className="p-4 border-r last:border-r-0 flex items-center">
          {child}
        </div>
      ))}
    </div>
  )
}
