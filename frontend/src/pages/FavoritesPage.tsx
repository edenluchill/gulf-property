import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useFavorites } from '../contexts/FavoritesContext'
import { Button } from '../components/ui/button'
import { Heart, MapPin, Building2, Trash2, Bed, Square, GitCompare, ChevronRight } from 'lucide-react'
import { formatPrice } from '../lib/utils'
import { ResidentialProject, UnitType } from '../types'
import { FavoriteProject } from '../lib/favorites'
import { getCachedProject, cacheProject, isCacheStale } from '../lib/projectCache'

interface ProjectWithDetails extends FavoriteProject {
  details?: ResidentialProject
  units?: UnitType[]
}

export default function FavoritesPage() {
  const { t } = useTranslation(['favorites', 'common'])
  const navigate = useNavigate()
  const { favorites, toggleProjectFavorite, toggleUnitTypeFavorite } = useFavorites()
  const [projectsWithDetails, setProjectsWithDetails] = useState<ProjectWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProjectDetails = async () => {
      setLoading(true)
      
      const projectPromises = favorites.projects.map(async (fav) => {
        try {
          // First, try to load from cache for instant display
          const cached = getCachedProject(fav.projectId)
          
          if (cached) {
            // Use cached data immediately
            const result = {
              ...fav,
              details: cached.project,
              units: cached.units
            }
            
            // If cache is stale, refresh in background
            if (isCacheStale(cached.cachedAt)) {
              // Background refresh (don't await)
              fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${fav.projectId}`)
                .then(res => res.json())
                .then(data => {
                  if (data.success && data.project) {
                    cacheProject(fav.projectId, data.project, data.project.units || [])
                  }
                })
                .catch(e => console.warn('Background refresh failed:', fav.projectId, e))
            }
            
            return result
          }
          
          // No cache, must fetch from server
          const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/residential-projects/${fav.projectId}`)
          const data = await res.json()
          if (data.success && data.project) {
            // Cache the result
            cacheProject(fav.projectId, data.project, data.project.units || [])
            
            return {
              ...fav,
              details: data.project,
              units: data.project.units || []
            }
          }
        } catch (e) {
          console.error('Failed to fetch project:', fav.projectId, e)
        }
        return fav
      })

      const results = await Promise.all(projectPromises)
      setProjectsWithDetails(results)
      setLoading(false)
    }

    fetchProjectDetails()
  }, [favorites.projects])

  // Get all favorited unit types for comparison
  const allUnitTypes = projectsWithDetails.flatMap(project =>
    project.unitTypeIds.map(unitTypeId => {
      const unit = project.units?.find(u => u.id === unitTypeId)
      return {
        projectId: project.projectId,
        unitTypeId,
        project: project.details,
        unit,
      }
    })
  )

  return (
    <div className="flex-1 bg-slate-50 pb-20 md:pb-8 overflow-auto">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-8 md:py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 mb-2">
            <Heart className="h-6 w-6 md:h-8 md:w-8 fill-current" />
            <h1 className="text-2xl md:text-4xl font-bold">
              {t('favorites:title')}
            </h1>
          </div>
          <p className="text-sm md:text-lg text-slate-300">
            {t('favorites:subtitle')}
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 md:py-8">
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-slate-600">{t('common:loading')}</p>
          </div>
        ) : favorites.projects.length === 0 ? (
          <div className="text-center py-16">
            <Heart className="h-20 w-20 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-700 mb-2">
              {t('favorites:empty.title')}
            </h2>
            <p className="text-slate-500 mb-6">
              {t('favorites:empty.message')}
            </p>
            <Link to="/map">
              <Button>
                {t('common:buttons.browseProperties')}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Compare Button - Show when 2+ items */}
            {allUnitTypes.length >= 2 && (
              <div className="bg-gradient-to-r from-teal-500 to-emerald-500 rounded-xl p-4 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{t('favorites:compare.ready', 'Ready to Compare!')}</h3>
                    <p className="text-sm text-white/80">
                      {t('favorites:compare.count', { count: allUnitTypes.length })}
                    </p>
                  </div>
                  <Button
                    onClick={() => navigate('/compare')}
                    className="bg-white text-teal-600 hover:bg-white/90"
                  >
                    <GitCompare className="h-4 w-4 mr-2" />
                    {t('nav.compare', 'Compare')}
                  </Button>
                </div>
              </div>
            )}

            {/* Favorites List - Card style for mobile */}
            <div className="space-y-4">
              {projectsWithDetails.map((project) => (
                <div
                  key={project.projectId}
                  className="bg-white rounded-xl border overflow-hidden shadow-sm"
                >
                  {/* Project Header */}
                  <div className="flex gap-3 p-3 border-b bg-slate-50/50">
                    {/* Project Image */}
                    <div className="w-16 h-16 md:w-20 md:h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100">
                      {project.details?.project_images?.[0] ? (
                        <img
                          src={project.details.project_images[0]}
                          alt={project.details.project_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Building2 className="h-6 w-6 text-slate-300" />
                        </div>
                      )}
                    </div>

                    {/* Project Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-800 truncate text-sm md:text-base">
                        {project.details?.project_name || project.projectId}
                      </h3>
                      {project.details && (
                        <>
                          <p className="text-xs text-slate-500 truncate">
                            {project.details.developer}
                          </p>
                          <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                            <MapPin className="h-3 w-3" />
                            <span className="truncate">{project.details.area}</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-start gap-1">
                      <Link to={`/project/${project.projectId}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={() => toggleProjectFavorite(project.projectId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Unit Types */}
                  {project.unitTypeIds.length > 0 && (
                    <div className="divide-y">
                      {project.unitTypeIds.map((unitTypeId) => {
                        const unit = project.units?.find(u => u.id === unitTypeId)
                        return (
                          <div
                            key={unitTypeId}
                            className="flex items-center gap-3 p-3"
                          >
                            {/* Unit Floor Plan */}
                            <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100 border">
                              {unit?.floor_plan_image ? (
                                <img
                                  src={unit.floor_plan_image}
                                  alt={unit.unit_type_name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Square className="h-4 w-4 text-slate-300" />
                                </div>
                              )}
                            </div>

                            {/* Unit Info */}
                            <div className="flex-1 min-w-0">
                              <h4 className="font-medium text-slate-800 text-sm truncate">
                                {unit?.unit_type_name || unitTypeId}
                              </h4>
                              {unit && (
                                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                                  <span className="flex items-center gap-1">
                                    <Bed className="h-3 w-3" />
                                    {unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms}BR`}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Square className="h-3 w-3" />
                                    {parseFloat(unit.area).toLocaleString()} sqft
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Price & Remove */}
                            <div className="flex items-center gap-2">
                              {unit?.price && (
                                <span className="text-sm font-semibold text-teal-600">
                                  {formatPrice(unit.price)}
                                </span>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-slate-400 hover:text-red-500"
                                onClick={() => toggleUnitTypeFavorite(project.projectId, unitTypeId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* No unit types message */}
                  {project.unitTypeIds.length === 0 && (
                    <div className="p-3 text-center text-sm text-slate-500">
                      {t('favorites:project.noUnits', 'No specific unit types saved')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom Stats */}
            <div className="text-center text-sm text-slate-500 pt-4">
              {t('favorites:count', { count: favorites.projects.length })} · {allUnitTypes.length} {t('favorites:units', 'units')}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
