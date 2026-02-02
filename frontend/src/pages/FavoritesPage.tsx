import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useFavorites } from '../contexts/FavoritesContext'
import { Card, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Heart, MapPin, Calendar, Building2, ChevronDown, ChevronUp, Trash2, Bed, Square } from 'lucide-react'
import { formatPrice, formatDate } from '../lib/utils'
import { ResidentialProject, UnitType } from '../types'
import { FavoriteProject } from '../lib/favorites'

interface ProjectWithDetails extends FavoriteProject {
  details?: ResidentialProject
  units?: UnitType[]
}

export default function FavoritesPage() {
  const { t } = useTranslation(['favorites', 'common'])
  const { favorites, toggleProjectFavorite, toggleUnitTypeFavorite } = useFavorites()
  const [projectsWithDetails, setProjectsWithDetails] = useState<ProjectWithDetails[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProjectDetails = async () => {
      setLoading(true)
      const projectPromises = favorites.projects.map(async (fav) => {
        try {
          const res = await fetch(`/api/residential-projects/${fav.projectId}`)
          const data = await res.json()
          if (data.success && data.project) {
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

  const toggleExpand = (projectId: string) => {
    const newExpanded = new Set(expandedProjects)
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId)
    } else {
      newExpanded.add(projectId)
    }
    setExpandedProjects(newExpanded)
  }

  return (
    <div className="flex-1 bg-slate-50">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-slate-900 to-slate-800 text-white py-16"
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center space-x-3 mb-4">
            <Heart className="h-8 w-8 fill-current" />
            <h1 className="text-4xl md:text-5xl font-bold">
              {t('favorites:title')}
            </h1>
          </div>
          <p className="text-xl text-slate-300 max-w-3xl">
            {t('favorites:subtitle')}
          </p>
        </div>
      </motion.div>

      <div className="container mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin h-8 w-8 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-slate-600">{t('common:loading')}</p>
          </div>
        ) : favorites.projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center py-16"
          >
            <Heart className="h-24 w-24 text-slate-300 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-slate-700 mb-4">
              {t('favorites:empty.title')}
            </h2>
            <p className="text-slate-600 mb-8">
              {t('favorites:empty.message')}
            </p>
            <Link to="/map">
              <Button size="lg">
                {t('common:buttons.browseProperties')}
              </Button>
            </Link>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {projectsWithDetails.map((project, index) => (
              <motion.div
                key={project.projectId}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
              >
                <Card className="overflow-hidden hover:shadow-lg transition-shadow">
                  <div className="flex flex-col md:flex-row">
                    {/* Project Image */}
                    {project.details?.project_images?.[0] && (
                      <div className="md:w-64 h-48 md:h-auto flex-shrink-0">
                        <img
                          src={project.details.project_images[0]}
                          alt={project.details.project_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* Project Info */}
                    <div className="flex-1 p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <CardTitle className="text-xl mb-2">
                            {project.details?.project_name || project.projectId}
                          </CardTitle>
                          {project.details && (
                            <>
                              <div className="flex items-center text-sm text-slate-600 mt-2">
                                <Building2 className="h-4 w-4 mr-1" />
                                <span>{project.details.developer}</span>
                              </div>
                              <div className="flex items-center text-sm text-slate-600 mt-1">
                                <MapPin className="h-4 w-4 mr-1" />
                                <span>{project.details.area}</span>
                              </div>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleProjectFavorite(project.projectId)}
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-5 w-5" />
                          </Button>
                        </div>
                      </div>

                      {project.details && (
                        <div className="flex flex-wrap items-center gap-4 mb-4">
                          <div>
                            <div className="text-2xl font-bold text-primary">
                              {project.details.starting_price
                                ? formatPrice(project.details.starting_price)
                                : t('common:price.priceOnApplication')}
                            </div>
                            <div className="text-sm text-slate-600">
                              {t('common:price.startingPrice')}
                            </div>
                          </div>
                          {project.details.completion_date && (
                            <div className="flex items-center text-sm text-slate-600">
                              <Calendar className="h-4 w-4 mr-1" />
                              <span>{t('common:dates.completion')}: {formatDate(project.details.completion_date)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-4">
                        <Link to={`/project/${project.projectId}`}>
                          <Button>
                            {t('common:buttons.viewDetails')}
                          </Button>
                        </Link>

                        {project.unitTypeIds.length > 0 && (
                          <Button
                            variant="outline"
                            onClick={() => toggleExpand(project.projectId)}
                            className="flex items-center gap-2"
                          >
                            <span>{t('favorites:project.unitTypes', { count: project.unitTypeIds.length })}</span>
                            {expandedProjects.has(project.projectId) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Unit Types */}
                  {expandedProjects.has(project.projectId) && project.unitTypeIds.length > 0 && (
                    <div className="border-t bg-slate-50 p-6">
                      <h4 className="font-semibold text-slate-700 mb-4">
                        {t('favorites:project.unitTypes', { count: project.unitTypeIds.length })}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {project.unitTypeIds.map((unitTypeId) => {
                          const unit = project.units?.find(u => u.id === unitTypeId)
                          return (
                            <div
                              key={unitTypeId}
                              className="bg-white rounded-lg p-4 border flex items-center justify-between"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-900 truncate">
                                  {unit?.unit_type_name || unitTypeId}
                                </div>
                                {unit && (
                                  <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
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
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-400 hover:text-red-500"
                                onClick={() => toggleUnitTypeFavorite(project.projectId, unitTypeId)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {favorites.projects.length > 0 && (
          <div className="mt-8 text-center">
            <p className="text-slate-600 mb-4">
              {t('favorites:count', { count: favorites.projects.length })}
            </p>
            <Link to="/map">
              <Button variant="outline">
                {t('common:buttons.browseMore')}
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
