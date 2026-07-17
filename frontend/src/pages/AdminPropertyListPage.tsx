/**
 * Admin Property List Page - 管理员项目列表
 *
 * 紧凑表格视图:一次加载全部项目(不再默认 limit=20 只出一页),带
 * 状态 / 开发商 / 区域 筛选 + 文字搜索。一屏能看十几到二十个项目。
 *
 * WHY 重写:旧版走后端默认 `limit=20` 且从不翻页 → 数据库里 40+ 个项目
 * 只显示最新 20 个,"地图上有、管理页里没有" 就是这么来的;底部 "20 projects
 * total" 数的还是已加载行数,不是后端真实 total。现在拉全量 + 显示真 total。
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Building2, Edit, Search, Loader2, Trash2, X } from 'lucide-react'
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

// 状态五档 —— 与 DB 约束及地图 pin 一致
const STATUS_OPTIONS = ['selling', 'under-construction', 'completed', 'upcoming', 'sold-out'] as const

export default function AdminPropertyListPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [developerFilter, setDeveloperFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const navigate = useNavigate()
  const { t, i18n } = useTranslation(['admin', 'common'])
  const { session } = useAuth()

  useEffect(() => {
    fetchProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const fetchProjects = async () => {
    try {
      setLoading(true)
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`

      // 拉全量:limit 拉高 + verified=all(admin 应能看到未验证项目)
      const url = `${API_ENDPOINTS.residentialProjects}?limit=1000&verified=all`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

      const data = await response.json()
      if (data.projects) {
        setProjects(data.projects)
        setTotal(typeof data.total === 'number' ? data.total : data.projects.length)
      }
    } catch (error) {
      console.error('❌ Failed to fetch projects:', error)
    } finally {
      setLoading(false)
    }
  }

  const developers = useMemo(
    () => Array.from(new Set(projects.map(p => p.developer).filter(Boolean))).sort() as string[],
    [projects]
  )
  const areas = useMemo(
    () => Array.from(new Set(projects.map(p => p.area).filter(Boolean))).sort() as string[],
    [projects]
  )

  const filteredProjects = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    return projects.filter(p => {
      if (statusFilter && p.status !== statusFilter) return false
      if (developerFilter && p.developer !== developerFilter) return false
      if (areaFilter && p.area !== areaFilter) return false
      if (term) {
        const hay = `${p.project_name || ''} ${p.developer || ''} ${p.area || ''} ${p.address || ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [projects, searchTerm, statusFilter, developerFilter, areaFilter])

  const hasFilter = !!(searchTerm || statusFilter || developerFilter || areaFilter)
  const clearFilters = () => {
    setSearchTerm('')
    setStatusFilter('')
    setDeveloperFilter('')
    setAreaFilter('')
  }

  const deleteProject = async (projectId: number, projectName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm(t('list.deleteConfirm', { name: projectName }))) return
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const response = await fetch(API_ENDPOINTS.residentialProject(projectId.toString()), {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete project')
      }
      setProjects(prev => prev.filter(p => p.id !== projectId))
      setTotal(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('❌ Failed to delete project:', error)
      alert(t('list.deleteFailed'))
    }
  }

  const dateLocale = i18n.language === 'zh-CN' ? 'zh-CN' : i18n.language?.split('-')[0] || 'en-US'

  const statusLabel = (status?: string) =>
    status === 'sold-out' ? t('common:status.soldOut')
      : status === 'selling' ? t('common:status.selling')
      : status === 'completed' ? t('common:status.completed')
      : status === 'under-construction' ? t('common:status.underConstruction')
      : t('common:status.upcoming')

  const statusClass = (status?: string) =>
    status === 'sold-out' ? 'bg-red-100 text-red-700'
      : status === 'selling' ? 'bg-green-100 text-green-700'
      : status === 'completed' ? 'bg-emerald-100 text-emerald-700'
      : status === 'under-construction' ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-700'

  const priceCell = (p: Project) => {
    if (!p.min_price || !p.max_price) return <span className="text-gray-400">—</span>
    const lo = (p.min_price / 1_000_000).toFixed(1)
    const hi = (p.max_price / 1_000_000).toFixed(1)
    return <span className="font-medium text-green-700 tabular-nums">{lo === hi ? lo : `${lo}–${hi}`}</span>
  }

  const selectCls =
    'h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-700 shadow-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent'

  return (
    <div className="flex-1 bg-gray-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate leading-tight">
                {t('list.title')}
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {t('list.showing', { shown: filteredProjects.length, total })}
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/developer/upload')}
            className="shrink-0 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
          >
            + {t('list.newProject')}
          </Button>
        </div>

        {/* Filter bar */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4 pointer-events-none" />
            <Input
              type="text"
              placeholder={t('list.searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-8 h-9"
            />
          </div>
          <select className={selectCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('list.allStatuses')}</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
          <select className={selectCls} value={developerFilter} onChange={(e) => setDeveloperFilter(e.target.value)}>
            <option value="">{t('list.allDevelopers')}</option>
            {developers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select className={selectCls} value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
            <option value="">{t('list.allAreas')}</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilter && (
            <button
              onClick={clearFilters}
              className="h-9 px-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
            >
              <X className="h-3.5 w-3.5" /> {t('list.clearFilters')}
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="text-center py-20">
            <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-blue-600" />
            <p className="text-gray-500">{t('list.loading')}</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-2xl border border-gray-100">
            <Building2 className="h-14 w-14 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 text-lg">
              {hasFilter ? t('list.noMatch') : t('list.noProjects')}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="text-start font-semibold px-3 py-2.5">{t('list.colProject')}</th>
                    <th className="text-start font-semibold px-3 py-2.5 hidden md:table-cell">{t('list.colDeveloper')}</th>
                    <th className="text-start font-semibold px-3 py-2.5 hidden lg:table-cell">{t('list.colArea')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('list.colUnits')}</th>
                    <th className="text-end font-semibold px-3 py-2.5 hidden sm:table-cell">{t('list.colPrice')}</th>
                    <th className="text-start font-semibold px-3 py-2.5">{t('list.colStatus')}</th>
                    <th className="text-start font-semibold px-3 py-2.5 hidden lg:table-cell">{t('list.colCompletion')}</th>
                    <th className="text-end font-semibold px-3 py-2.5">{t('list.colActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredProjects.map((p) => {
                    const thumb = p.project_images?.[0]
                    return (
                      <tr
                        key={p.id}
                        onClick={() => navigate(`/admin/property/edit/${p.id}`)}
                        className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                      >
                        {/* Project (thumb + name) */}
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                              {thumb ? (
                                <img src={thumb} alt="" className="w-full h-full object-cover"
                                  onError={(e) => { e.currentTarget.style.display = 'none' }} />
                              ) : (
                                <Building2 className="h-5 w-5 text-gray-300" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-gray-900 truncate max-w-[220px] flex items-center gap-1.5">
                                {p.project_name}
                                <Edit className="h-3.5 w-3.5 text-blue-500 opacity-0 group-hover:opacity-100 shrink-0" />
                              </div>
                              <div className="text-xs text-gray-400 truncate max-w-[220px] md:hidden">{p.developer}</div>
                            </div>
                          </div>
                        </td>
                        {/* Developer */}
                        <td className="px-3 py-2 text-gray-600 hidden md:table-cell">
                          <span className="truncate block max-w-[160px]">{p.developer || '—'}</span>
                        </td>
                        {/* Area */}
                        <td className="px-3 py-2 text-gray-600 hidden lg:table-cell">
                          <span className="truncate block max-w-[160px]">{p.area || t('list.notSet')}</span>
                        </td>
                        {/* Units */}
                        <td className="px-3 py-2 text-end tabular-nums text-gray-700">{p.unit_count || 0}</td>
                        {/* Price */}
                        <td className="px-3 py-2 text-end hidden sm:table-cell">{priceCell(p)}</td>
                        {/* Status */}
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${statusClass(p.status)}`}>
                            {statusLabel(p.status)}
                          </span>
                        </td>
                        {/* Completion */}
                        <td className="px-3 py-2 text-gray-600 hidden lg:table-cell whitespace-nowrap">
                          {p.completion_date
                            ? new Date(p.completion_date).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short' })
                            : '—'}
                        </td>
                        {/* Actions */}
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/admin/property/edit/${p.id}`) }}
                              className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                              title={t('list.editProject')}
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => deleteProject(p.id, p.project_name, e)}
                              className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                              title={t('list.deleteProject')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
