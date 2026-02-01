import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Bed, Square, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { UnitType } from '../../types'
import { formatPrice } from '../../lib/utils'

interface FavoriteUnitListProps {
  projectId: string
  unitTypeIds: string[]
  units?: UnitType[]
}

export function FavoriteUnitList({ projectId, unitTypeIds, units }: FavoriteUnitListProps) {
  const { t } = useTranslation('favorites')
  const { toggleUnitTypeFavorite } = useFavorites()
  const [unitDetails, setUnitDetails] = useState<UnitType[]>([])
  const [loading, setLoading] = useState(false)

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
    <div className="space-y-2 pl-4 border-l-2 border-amber-200">
      {unitDetails.map(unit => (
        <div
          key={unit.id}
          className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
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
                <span className="text-amber-600 font-medium">
                  {formatPrice(unit.price)}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400 hover:text-red-500 flex-shrink-0"
            onClick={() => toggleUnitTypeFavorite(projectId, unit.id)}
            title={t('unitType.remove')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}
