import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2, Building2, MapPin, ExternalLink, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { FavoriteUnitList } from './FavoriteUnitList'
import { ResidentialProject, UnitType } from '../../types'
import { formatPrice } from '../../lib/utils'
import { FavoriteProject } from '../../lib/favorites'

interface FavoriteProjectCardProps {
  favorite: FavoriteProject
  onClose?: () => void
}

export function FavoriteProjectCard({ favorite, onClose }: FavoriteProjectCardProps) {
  const { t } = useTranslation('favorites')
  const { toggleProjectFavorite } = useFavorites()
  const [isExpanded, setIsExpanded] = useState(false)
  const [project, setProject] = useState<ResidentialProject | null>(null)
  const [units, setUnits] = useState<UnitType[]>([])
  const [loading, setLoading] = useState(true)

  const hasUnitTypes = favorite.unitTypeIds.length > 0

  useEffect(() => {
    setLoading(true)
    fetch(`/api/residential-projects/${favorite.projectId}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.project) {
          setProject(data.project)
          setUnits(data.project.units || [])
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [favorite.projectId])

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    toggleProjectFavorite(favorite.projectId)
  }

  if (loading) {
    return (
      <div className="p-4 bg-white rounded-lg border border-slate-200">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-4 bg-white rounded-lg border border-slate-200">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Project not found</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-slate-400 hover:text-red-500"
            onClick={handleRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Main Card Content */}
      <div className="p-4">
        <div className="flex gap-3">
          {/* Project Image */}
          {project.project_images?.[0] && (
            <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden">
              <img
                src={project.project_images[0]}
                alt={project.project_name}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Project Info */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">
              {project.project_name}
            </h3>
            <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
              <Building2 className="h-3 w-3" />
              <span className="truncate">{project.developer}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{project.area}</span>
            </div>
            {project.starting_price && (
              <div className="text-sm font-semibold text-amber-600 mt-1">
                {formatPrice(project.starting_price)}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-slate-400 hover:text-red-500"
              onClick={handleRemove}
              title={t('project.remove')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Link to={`/project/${favorite.projectId}`} onClick={onClose}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-400 hover:text-amber-600"
                title={t('actions.viewProject')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Unit Types Expand Toggle */}
        {hasUnitTypes && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full mt-3 pt-3 border-t flex items-center justify-between text-sm text-slate-600 hover:text-slate-900"
          >
            <span>
              {t('project.unitTypes', { count: favorite.unitTypeIds.length })}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Expanded Unit Types */}
      <AnimatePresence>
        {isExpanded && hasUnitTypes && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <FavoriteUnitList
                projectId={favorite.projectId}
                unitTypeIds={favorite.unitTypeIds}
                units={units}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
