/**
 * Admin Task Review Page
 *
 * Full editor for reviewing and editing extracted PDF data before submitting.
 * Uses shared PropertyEditorForm component.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, ArrowLeft, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { API_BASE_URL, API_ENDPOINTS } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'
import {
  PropertyFormData,
  PropertyEditorForm,
  SuccessCard,
  initialFormData,
} from '../components/property-editor'

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
  const { t: _t } = useTranslation('upload')
  void _t // suppress unused warning
  const { session } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<TaskData | null>(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formData, setFormData] = useState<PropertyFormData>(initialFormData)

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
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load task')
      } finally {
        setLoading(false)
      }
    }

    fetchTask()
  }, [jobId])

  // Delete task
  const handleDelete = async () => {
    if (!confirm('Delete this task? This cannot be undone.')) return

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

  // Submit as project
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isSubmitting) return

    const confirmSubmit = window.confirm(
      `Submit "${formData.projectName}" with ${formData.unitTypes.length} unit types?`
    )

    if (!confirmSubmit) return

    setIsSubmitting(true)
    setError(null)

    try {
      const submitData = {
        projectName: formData.projectName,
        developer: formData.developer,
        address: formData.address,
        area: formData.area,
        description: formData.description,
        latitude: formData.latitude,
        longitude: formData.longitude,
        launchDate: formData.launchDate || null,
        completionDate: formData.completionDate || null,
        handoverDate: formData.handoverDate || null,
        constructionProgress: formData.constructionProgress,
        projectImages: formData.projectImages || [],
        floorPlanImages: formData.floorPlanImages || [],
        amenities: formData.amenities || [],
        unitTypes: formData.unitTypes.map(unit => ({
          name: unit.name,
          typeName: unit.typeName,
          category: unit.category,
          unitNumbers: unit.unitNumbers,
          unitCount: unit.unitCount || 1,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          area: unit.area,
          suiteArea: unit.suiteArea,
          balconyArea: unit.balconyArea,
          price: unit.price,
          pricePerSqft: unit.pricePerSqft,
          orientation: unit.orientation,
          features: unit.features,
          description: unit.description,
          floorPlanImage: unit.floorPlanImage,
          floorPlanImages: unit.floorPlanImages,
        })),
        paymentPlan: formData.paymentPlan || [],
      }

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

      setSubmitted(true)
      setTimeout(() => navigate('/admin/tasks'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
      setIsSubmitting(false)
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
            <h2 className="text-xl font-bold text-red-800 mb-2">Failed to Load Task</h2>
            <p className="text-red-600">{error}</p>
            <Button onClick={() => navigate('/admin/tasks')} className="mt-4">
              Back to Tasks
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-b border-blue-200">
        <div className="container mx-auto px-6 py-6">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  onClick={() => navigate('/admin/tasks')}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Tasks
                </Button>
                <div className="h-8 w-px bg-gray-300" />
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 shadow-lg">
                    <Building2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-xl font-bold text-gray-900">Review & Edit Task</h1>
                    <p className="text-sm text-gray-600">{task?.job_id}</p>
                  </div>
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete Task
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {submitted ? (
            <SuccessCard
              title="Project Submitted!"
              subtitle="Redirecting to task list..."
            />
          ) : (
            <PropertyEditorForm
              formData={formData}
              setFormData={setFormData}
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              hasReviewed={hasReviewed}
              setHasReviewed={setHasReviewed}
              showMapPicker={showMapPicker}
              setShowMapPicker={setShowMapPicker}
              error={error}
              submitButtonTextConfirmed="Submit as Project"
              overlayTitle="Submitting Project"
              overlaySubtitle="Saving to database..."
              overlayAccentColor="green"
            />
          )}
        </div>
      </div>
    </div>
  )
}
