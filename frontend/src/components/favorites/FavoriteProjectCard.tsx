import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2, Building2, MapPin, ExternalLink, RefreshCw } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui/button'
import { useFavorites } from '../../contexts/FavoritesContext'
import { FavoriteUnitList } from './FavoriteUnitList'
import { ResidentialProject, UnitType } from '../../types'
import { formatPrice } from '../../lib/utils'
import { FavoriteProject } from '../../lib/favorites'
import { getCachedProject, cacheProject, isCacheStale } from '../../lib/projectCache'

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
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const hasUnitTypes = favorite.unitTypeIds.length > 0

  useEffect(() => {
    // First, try to load from cache for instant display
    const cached = getCachedProject(favorite.projectId)

    if (cached) {
      setProject(cached.project)
      setUnits(cached.units)
      setInitialLoading(false)

      // If cache is stale, refresh in background
      if (isCacheStale(cached.cachedAt)) {
        refreshFromServer()
      }
    } else {
      // No cache, must fetch from server
      fetchFromServer()
    }
  }, [favorite.projectId])

  const fetchFromServer = async () => {
    setInitialLoading(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${favorite.projectId}`)
      const data = await res.json()
      if (data.success && data.project) {
        setProject(data.project)
        setUnits(data.project.units || [])
        // Cache the result
        cacheProject(favorite.projectId, data.project, data.project.units || [])
      }
    } catch (e) {
      console.error('Failed to fetch project:', e)
    } finally {
      setInitialLoading(false)
    }
  }

  const refreshFromServer = async () => {
    setIsRefreshing(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${favorite.projectId}`)
      const data = await res.json()
      if (data.success && data.project) {
        setProject(data.project)
        setUnits(data.project.units || [])
        // Update cache
        cacheProject(favorite.projectId, data.project, data.project.units || [])
      }
    } catch (e) {
      console.error('Failed to refresh project:', e)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    toggleProjectFavorite(favorite.projectId)
  }

  // Initial loading state - show skeleton
  if (initialLoading) {
    return (
      <div className="p-4 bg-white rounded-lg border border-slate-200 animate-pulse">
        <div className="flex gap-3">
          <div className="w-20 h-20 bg-slate-200 rounded-lg" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-slate-200 rounded w-3/4" />
            <div className="h-3 bg-slate-200 rounded w-1/2" />
            <div className="h-3 bg-slate-200 rounded w-1/3" />
          </div>
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
          <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden relative bg-slate-100">
            {project.project_images?.[0] ? (
              <img
                src={project.project_images[0]}
                alt={project.project_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Building2 className="h-8 w-8 text-slate-300" />
              </div>
            )}

            {/* Refresh indicator - small spinning icon in corner */}
            {isRefreshing && (
              <div className="absolute top-1 right-1 bg-white/80 rounded-full p-0.5">
                <RefreshCw className="h-3 w-3 text-teal-500 animate-spin" />
              </div>
            )}
          </div>

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
              <div className="text-sm font-semibold text-teal-600 mt-1">
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
                className="h-8 w-8 text-slate-400 hover:text-teal-600"
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
                onClose={onClose}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
