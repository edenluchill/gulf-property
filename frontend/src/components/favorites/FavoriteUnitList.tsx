import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Trash2, Bed, Square, Loader2, Bath, Eye, X, ExternalLink, Compass } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { UnitType } from '../../types'
import { formatPrice } from '../../lib/utils'

interface FavoriteUnitListProps {
  projectId: string
  unitTypeIds: string[]
  units?: UnitType[]
  onClose?: () => void // To close the drawer when navigating
}

export function FavoriteUnitList({ projectId, unitTypeIds, units, onClose }: FavoriteUnitListProps) {
  const { t } = useTranslation('favorites')
  const { toggleUnitTypeFavorite } = useFavorites()
  const [unitDetails, setUnitDetails] = useState<UnitType[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    // If units are provided (from project detail), use them directly
    if (units && units.length > 0) {
      const filtered = units.filter(u => unitTypeIds.includes(u.id))
      setUnitDetails(filtered)
      return
    }

    // Otherwise, fetch from API
    if (unitTypeIds.length === 0) {
      setUnitDetails([])
      return
    }

    setLoading(true)
    // Fetch project details to get unit types
    fetch(`/api/residential-projects/${projectId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.project?.units) {
          const filtered = data.project.units.filter((u: UnitType) => unitTypeIds.includes(u.id))
          setUnitDetails(filtered)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId, unitTypeIds, units])

  const handleUnitClick = (unit: UnitType) => {
    if (isMobile) {
      // On mobile, close drawer and let the link navigate
      return
    }
    // On desktop, show preview popup
    setSelectedUnit(unit)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </div>
    )
  }

  if (unitDetails.length === 0 && unitTypeIds.length > 0) {
    // Show IDs if we couldn't load details
    return (
      <div className="space-y-2 pl-4 border-l-2 border-slate-200">
        {unitTypeIds.map(id => (
          <div
            key={id}
            className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg"
          >
            <span className="text-sm text-slate-600 truncate">{id}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-400 hover:text-red-500"
              onClick={() => toggleUnitTypeFavorite(projectId, id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2 pl-4 border-l-2 border-teal-200">
        {unitDetails.map(unit => (
          <div
            key={unit.id}
            className="group flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
            onClick={() => handleUnitClick(unit)}
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-slate-900 truncate">
                {unit.unit_type_name}
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                <span className="flex items-center gap-1">
                  <Bed className="h-3 w-3" />
                  {unit.bedrooms}
                </span>
                <span className="flex items-center gap-1">
                  <Square className="h-3 w-3" />
                  {parseFloat(unit.area).toLocaleString()} sqft
                </span>
                {unit.price && (
                  <span className="text-teal-600 font-medium">
                    {formatPrice(unit.price)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* View detail button - desktop only */}
              {!isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-400 hover:text-teal-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedUnit(unit)
                  }}
                  title={t('unitType.viewDetails', 'View details')}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
              {/* Mobile: Link to project page */}
              {isMobile && (
                <Link
                  to={`/project/${projectId}?unit=${unit.id}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose?.()
                  }}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-teal-600"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-red-500 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleUnitTypeFavorite(projectId, unit.id)
                }}
                title={t('unitType.remove')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Unit Detail Popup - Desktop only */}
      <AnimatePresence>
        {selectedUnit && !isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
            onClick={() => setSelectedUnit(null)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30" />

            {/* Popup */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header with image or gradient */}
              <div className="relative h-40 bg-gradient-to-br from-teal-500 to-emerald-600">
                {selectedUnit.floor_plan_image && (
                  <img
                    src={selectedUnit.floor_plan_image}
                    alt={selectedUnit.unit_type_name}
                    className="w-full h-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <button
                  onClick={() => setSelectedUnit(null)}
                  className="absolute top-3 right-3 bg-white/20 backdrop-blur-sm rounded-full p-2 text-white hover:bg-white/30 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
                <div className="absolute bottom-4 left-4 right-4">
                  <h3 className="text-xl font-bold text-white">
                    {selectedUnit.unit_type_name}
                  </h3>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Key stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-600 mb-1">
                      <Bed className="h-4 w-4" />
                      <span className="text-sm">{t('unitType.bedrooms', 'Bedrooms')}</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-900">{selectedUnit.bedrooms}</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-3 text-center">
                    <div className="flex items-center justify-center gap-2 text-slate-600 mb-1">
                      <Bath className="h-4 w-4" />
                      <span className="text-sm">{t('unitType.bathrooms', 'Bathrooms')}</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-900">{selectedUnit.bathrooms || '-'}</div>
                  </div>
                </div>

                {/* Area */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-600">
                      <Square className="h-4 w-4" />
                      <span>{t('unitType.area', 'Total Area')}</span>
                    </div>
                    <div className="font-semibold text-slate-900">
                      {parseFloat(selectedUnit.area).toLocaleString()} sqft
                    </div>
                  </div>
                  {selectedUnit.suite_area && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
                      <span className="text-slate-500 text-sm">{t('unitType.suiteArea', 'Suite Area')}</span>
                      <span className="text-slate-700">{parseFloat(selectedUnit.suite_area).toLocaleString()} sqft</span>
                    </div>
                  )}
                  {selectedUnit.balcony_area && (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-slate-500 text-sm">{t('unitType.balconyArea', 'Balcony Area')}</span>
                      <span className="text-slate-700">{parseFloat(selectedUnit.balcony_area).toLocaleString()} sqft</span>
                    </div>
                  )}
                </div>

                {/* Orientation */}
                {selectedUnit.orientation && (
                  <div className="flex items-center gap-3 text-slate-600">
                    <Compass className="h-4 w-4" />
                    <span>{t('unitType.orientation', 'Orientation')}:</span>
                    <span className="font-medium text-slate-900">{selectedUnit.orientation}</span>
                  </div>
                )}

                {/* Price */}
                {selectedUnit.price && (
                  <div className="bg-teal-50 rounded-xl p-4 text-center">
                    <div className="text-sm text-teal-700 mb-1">{t('unitType.startingPrice', 'Starting Price')}</div>
                    <div className="text-2xl font-bold text-teal-600">
                      {formatPrice(selectedUnit.price)}
                    </div>
                    {selectedUnit.price_per_sqft && (
                      <div className="text-sm text-teal-600/70 mt-1">
                        AED {parseFloat(selectedUnit.price_per_sqft).toLocaleString()}/sqft
                      </div>
                    )}
                  </div>
                )}

                {/* View project button */}
                <Link
                  to={`/project/${projectId}?unit=${selectedUnit.id}`}
                  onClick={() => {
                    setSelectedUnit(null)
                    onClose?.()
                  }}
                >
                  <Button className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t('actions.viewInProject', 'View in Project')}
                  </Button>
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
