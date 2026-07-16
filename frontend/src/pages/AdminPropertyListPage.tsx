/**
 * Admin Property List Page - 管理员项目列表
 *
 * Features:
 * - Display all residential projects
 * - Search and filter projects
 * - Navigate to edit page
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Building2, Edit, Search, Loader2, MapPin, Trash2 } from 'lucide-react'
import { API_ENDPOINTS } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'

interface Project {
  id: number
  project_name: string
  developer: string
  address: string
  area: string
  completion_date?: string
  construction_progress?: number
  unit_count?: number
  min_price?: number
  max_price?: number
  starting_price?: number
  project_images?: string[]
  status?: string
  created_at: string
}

export default function AdminPropertyListPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const navigate = useNavigate()
  const { t, i18n } = useTranslation(['admin', 'common'])
  const { session } = useAuth()

  useEffect(() => {
    fetchProjects()
  }, [session])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      
      // Prepare headers with authentication
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      
      // Add Authorization header if session exists
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      
      const response = await fetch(API_ENDPOINTS.residentialProjects, {
        headers,
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()

      // Backend returns { projects, total, page, limit } without success field
      if (data.projects) {
        setProjects(data.projects)
      }
    } catch (error) {
      console.error('❌ Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = projects.filter(project =>
    project.project_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.developer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.area?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const deleteProject = async (projectId: number, projectName: string, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent navigation to edit page

    const confirmed = window.confirm(t('list.deleteConfirm', { name: projectName }))

    if (!confirmed) return

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(API_ENDPOINTS.residentialProject(projectId.toString()), {
        method: 'DELETE',
        headers,
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete project')
      }

      // Remove from local state
      setProjects(prev => prev.filter(p => p.id !== projectId))

      // Show success message
      alert(t('list.deleteSuccess', { name: projectName }))
    } catch (error) {
      console.error('❌ Failed to delete project:', error)
      alert(t('list.deleteFailed'))
    }
  }

  const dateLocale = i18n.language === 'zh-CN' ? 'zh-CN' : 'en-US'

  return (
    <div className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 overflow-auto">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-b border-blue-200">
        <div className="container mx-auto px-4 py-5 sm:px-6 sm:py-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                <div className="p-2.5 sm:p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shrink-0">
                  <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-3xl font-bold text-gray-900 truncate">{t('list.title')}</h1>
                  <p className="text-xs sm:text-sm text-gray-700 mt-0.5 sm:mt-1">
                    {t('list.subtitle')}
                  </p>
                </div>
              </div>
              <Button
                onClick={() => navigate('/developer/upload')}
                className="w-full sm:w-auto shrink-0 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
              >
                {t('list.newProject')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-5 sm:px-6 sm:py-8">
        <div className="max-w-7xl mx-auto">
          {/* Search Bar */}
          <Card className="mb-4 sm:mb-6 shadow-lg">
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <Input
                  type="text"
                  placeholder={t('list.searchPlaceholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="ps-10 text-base py-6"
                />
              </div>
            </CardContent>
          </Card>

          {/* Projects List */}
          {loading ? (
            <div className="text-center py-16">
              <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-blue-600" />
              <p className="text-gray-600">{t('list.loading')}</p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <Card className="shadow-lg">
              <CardContent className="py-16 text-center">
                <Building2 className="h-16 w-16 mx-auto mb-4 text-gray-300" />
                <p className="text-gray-600 text-lg">
                  {searchTerm ? t('list.noMatch') : t('list.noProjects')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredProjects.map((project) => {
                const thumbnail = project.project_images?.[0]
                const progress = project.construction_progress || 0
                const isSoldOut = project.status === 'sold-out'
                const statusColor = isSoldOut ? 'red' : project.status === 'selling' ? 'green' : project.status === 'completed' ? 'green' : project.status === 'under-construction' ? 'blue' : 'yellow'
                const statusText = isSoldOut ? t('common:status.soldOut') : project.status === 'selling' ? t('common:status.selling') : project.status === 'completed' ? t('common:status.completed') : project.status === 'under-construction' ? t('common:status.underConstruction') : t('common:status.upcoming')

                return (
                  <Card
                    key={project.id}
                    className="shadow-lg hover:shadow-xl transition-all overflow-hidden cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
                    onClick={() => navigate(`/admin/property/edit/${project.id}`)}
                  >
                    <CardContent className="p-0">
                      <div className="flex flex-col md:flex-row md:items-stretch gap-0">
                        {/* Thumbnail — 移动端铺满顶部固定高度, 桌面端左侧 w-80 */}
                        <div className="w-full h-44 md:w-80 md:h-auto flex-shrink-0 bg-gradient-to-br from-gray-100 to-gray-200 relative overflow-hidden flex items-center justify-center p-4">
                          {thumbnail ? (
                            <img
                              src={thumbnail}
                              alt={project.project_name}
                              className="w-full h-full object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none'
                                e.currentTarget.parentElement!.innerHTML = `
                                  <div class="w-full h-full flex items-center justify-center">
                                    <div class="text-gray-400 text-center">
                                      <svg class="h-16 w-16 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                      </svg>
                                      <p class="text-sm">${t('list.noImage')}</p>
                                    </div>
                                  </div>
                                `
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="text-gray-400 text-center">
                                <Building2 className="h-16 w-16 mx-auto mb-2" />
                                <p className="text-sm">{t('list.noProjectImage')}</p>
                              </div>
                            </div>
                          )}

                          {/* Status Badge */}
                          <div className={`absolute top-3 start-3 px-3 py-1 rounded-full text-xs font-semibold shadow-lg
                            ${statusColor === 'red' ? 'bg-red-600 text-white' :
                              statusColor === 'green' ? 'bg-green-500 text-white' :
                              statusColor === 'blue' ? 'bg-blue-500 text-white' :
                              'bg-yellow-500 text-white'}`}>
                            {statusText}
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 p-4 sm:p-6">
                          <div className="mb-4">
                            <h3 className="text-lg sm:text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                              <span className="min-w-0 break-words">{project.project_name}</span>
                              <Edit className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 opacity-70 shrink-0" />
                            </h3>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600 mb-3">
                              <span className="flex items-center gap-1 min-w-0">
                                <span className="font-semibold text-gray-700 shrink-0">{t('list.developerLabel')}</span>
                                <span className="truncate">{project.developer}</span>
                              </span>
                              <span className="hidden sm:inline text-gray-300">|</span>
                              <span className="flex items-center gap-1 min-w-0">
                                <MapPin className="h-4 w-4 shrink-0" />
                                <span className="truncate">{project.area || t('list.notSet')}</span>
                              </span>
                            </div>
                          </div>

                          {/* Info Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 mb-4">
                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">{t('list.unitCount')}</div>
                              <div className="text-xl font-bold text-gray-900">
                                {project.unit_count || 0} <span className="text-sm font-normal text-gray-600">{t('list.unitSuffix')}</span>
                              </div>
                            </div>

                            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200">
                              <div className="text-xs text-gray-600 mb-1">{t('list.priceRange')}</div>
                              <div className="text-sm font-bold text-gray-900">
                                {project.min_price && project.max_price ? (
                                  <>
                                    {project.min_price === project.max_price ? (
                                      <span className="text-green-700">
                                        {(project.min_price / 1000000).toFixed(1)}M AED
                                      </span>
                                    ) : (
                                      <span className="text-green-700">
                                        {(project.min_price / 1000000).toFixed(1)}M - {(project.max_price / 1000000).toFixed(1)}M
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-gray-500">{t('list.notSet')}</span>
                                )}
                              </div>
                            </div>

                            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                              <div className="text-xs text-gray-500 mb-1">{t('list.completionDateLabel')}</div>
                              <div className="text-sm font-semibold text-gray-900">
                                {project.completion_date ?
                                  new Date(project.completion_date).toLocaleDateString(dateLocale, { year: 'numeric', month: 'long' })
                                  : t('list.notSet')}
                              </div>
                            </div>
                          </div>

                          {/* Progress Bar */}
                          {progress > 0 && (
                            <div className="mb-3">
                              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                                <span>{t('list.constructionProgress')}</span>
                                <span className="font-semibold">{progress}%</span>
                              </div>
                              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-300"
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Address */}
                          <div className="text-sm text-gray-600 flex items-start gap-2">
                            <span className="text-gray-400">📍</span>
                            <span className="flex-1">{project.address || t('list.addressNotSet')}</span>
                          </div>

                          {/* Footer */}
                          <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs text-gray-500">
                              {t('list.createdAt')}: {new Date(project.created_at).toLocaleString(dateLocale)}
                            </span>
                            <button
                              onClick={(e) => deleteProject(project.id, project.project_name, e)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-lg transition-all"
                              title={t('list.deleteProject')}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('list.delete')}
                            </button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Results Count */}
          {!loading && filteredProjects.length > 0 && (
            <div className="mt-6 text-center text-sm text-gray-600">
              {t('list.totalProjects', { count: filteredProjects.length })}
              {searchTerm && ` ${t('list.searchResult', { term: searchTerm })}`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
