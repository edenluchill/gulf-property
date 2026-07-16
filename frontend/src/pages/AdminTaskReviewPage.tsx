/**
 * Admin Task Review Page
 *
 * Loads a processed PDF task into the shared PropertyWorkspace
 * (same sectioned layout as /developer/upload) and submits it as a project.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, ArrowLeft, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { API_BASE_URL, API_ENDPOINTS } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'
import { PropertyWorkspace } from '../components/property-workspace/PropertyWorkspace'
import {
  PropertyFormData,
  initialFormData,
  buildSubmitPayload,
} from '../components/property-editor/types'
import { SuccessCard } from '../components/property-editor'

interface TaskData {
  id: string
  job_id: string
  task_name: string | null
  status: string
  result_data: any
  errors: string[]
  created_at: string
}

export default function AdminTaskReviewPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('admin')
  const { session } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<TaskData | null>(null)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [serverMessage, setServerMessage] = useState<string | undefined>(undefined)
  const [formData, setFormData] = useState<PropertyFormData>(initialFormData)
  // 源 PDF 下载链接（用于对比 AI 提取结果 vs 原件）。提交成功后会被清理。
  const [pdfLinks, setPdfLinks] = useState<{ name: string; url: string }[]>([])

  // Fetch task data
  useEffect(() => {
    const fetchTask = async () => {
      if (!jobId) return

      try {
        setLoading(true)
        const response = await fetch(`${API_BASE_URL}/api/admin/tasks/${jobId}`, {
          headers: {
            'x-user-id': 'admin',
            'x-admin': 'true',
          },
        })

        if (!response.ok) throw new Error('Failed to fetch task')

        const data = await response.json()
        setTask(data.task)

        // Populate form with task data
        const buildingData = data.task.result_data?.buildingData
        if (buildingData) {
          setFormData({
            projectName: buildingData.name || data.task.task_name || '',
            developer: buildingData.developer || '',
            address: buildingData.address || '',
            area: buildingData.area || '',
            completionDate: buildingData.completionDate || '',
            launchDate: buildingData.launchDate,
            handoverDate: buildingData.handoverDate,
            constructionProgress: buildingData.constructionProgress,
            description: buildingData.description || '',
            latitude: buildingData.latitude,
            longitude: buildingData.longitude,
            amenities: buildingData.amenities || [],
            unitTypes: (buildingData.units || []).map((u: any, idx: number) => ({
              ...u,
              id: u.id || `unit-${idx}`,
            })),
            paymentPlan: buildingData.paymentPlans?.[0]?.milestones || [],
            projectImages: buildingData.images?.projectImages || [],
            floorPlanImages: buildingData.images?.floorPlanImages || [],
            visualContent: buildingData.visualContent,
            extractedPricing: buildingData.extractedPricing,
            serviceCharge: buildingData.serviceCharge ?? undefined,
            landmarks: buildingData.landmarks || undefined,
          })
          // 0户型引导文案（营销画册等）
          if (buildingData.submitReadiness?.message) {
            setServerMessage(buildingData.submitReadiness.message)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task')
      } finally {
        setLoading(false)
      }
    }

    fetchTask()
  }, [jobId])

  // 拉取源 PDF 的临时下载链接（presigned）。处理后 PDF 保留到提交/删除任务为止。
  useEffect(() => {
    if (!jobId) return
    let stale = false
    fetch(`${API_BASE_URL}/api/admin/tasks/${jobId}/pdf-links`, {
      headers: { 'x-user-id': 'admin', 'x-admin': 'true' },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!stale && d?.links) setPdfLinks(d.links) })
      .catch(() => { /* 无 PDF 链接不影响审核 */ })
    return () => { stale = true }
  }, [jobId])

  // Delete task
  const handleDelete = async () => {
    if (!confirm(t('review.deleteConfirm'))) return

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/tasks/${jobId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': 'admin',
          'x-admin': 'true',
        },
      })

      if (!response.ok) throw new Error('Failed to delete task')

      navigate('/admin/tasks')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete task')
    }
  }

  // PropertyWorkspace dialog 确认后提交为项目
  const doSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData = buildSubmitPayload(formData)

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(API_ENDPOINTS.residentialProjectsSubmit, {
        method: 'POST',
        headers,
        body: JSON.stringify(submitData),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to submit property')
      }

      // Clear cache
      localStorage.removeItem('gulf_residential_developers')
      localStorage.removeItem('gulf_residential_developers_timestamp')
      localStorage.removeItem('gulf_residential_areas')
      localStorage.removeItem('gulf_residential_areas_timestamp')
      localStorage.removeItem('gulf_residential_projects')
      localStorage.removeItem('gulf_residential_projects_timestamp')

      // 提交成功 → 释放该任务的源 PDF（"保留到提交为止"）。非致命。
      fetch(`${API_BASE_URL}/api/admin/tasks/${jobId}/pdfs`, {
        method: 'DELETE',
        headers: { 'x-user-id': 'admin', 'x-admin': 'true' },
      }).catch(() => { /* ignore */ })

      setSubmitted(true)
      setTimeout(() => navigate('/admin/tasks'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
      setIsSubmitting(false)
      throw err
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    )
  }

  if (error && !task) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-red-800 mb-2">{t('review.failedToLoadTask')}</h2>
            <p className="text-red-600">{error}</p>
            <Button onClick={() => navigate('/admin/tasks')} className="mt-4">
              {t('review.backToTasks')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 flex flex-col">
      {/* Compact header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin/tasks')}
              className="p-2 shrink-0"
            >
              <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
            </Button>
            <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 shadow-md shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold text-gray-900 truncate">{t('review.title')}</h1>
              <p className="text-xs text-gray-500 truncate">{task?.job_id}</p>
            </div>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="flex items-center gap-2 shrink-0"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('review.deleteTask')}</span>
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="container mx-auto px-4 sm:px-6 pt-4 max-w-7xl w-full">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
        </div>
      )}

      {submitted ? (
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-2xl">
          <SuccessCard
            title={t('review.projectSubmitted')}
            subtitle={t('review.redirecting')}
          />
        </div>
      ) : (
        <PropertyWorkspace
          formData={formData}
          setFormData={setFormData}
          isSubmitting={isSubmitting}
          hasReviewed={hasReviewed}
          setHasReviewed={setHasReviewed}
          onConfirmSubmit={doSubmit}
          emptyUnitsMessage={formData.unitTypes.length === 0 ? serverMessage : undefined}
          submitLabel={t('review.submitAsProject')}
          pdfLinks={pdfLinks}
        />
      )}
    </div>
  )
}
