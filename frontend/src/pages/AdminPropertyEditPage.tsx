/**
 * Admin Property Edit Page - 管理员项目编辑页面
 *
 * Loads an existing project into the shared PropertyWorkspace
 * (same sectioned layout as /developer/upload) and PUTs updates.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { API_ENDPOINTS } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'
import { PropertyWorkspace } from '../components/property-workspace/PropertyWorkspace'
import {
  PropertyFormData,
  initialFormData,
  buildSubmitPayload,
} from '../components/property-editor/types'
import { SuccessCard } from '../components/property-editor'

export default function AdminPropertyEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('admin')
  const { session } = useAuth()

  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [formData, setFormData] = useState<PropertyFormData>(initialFormData)

  // Load existing project data
  useEffect(() => {
    if (id && session) {
      fetchProjectData(id)
    }
  }, [id, session])

  const fetchProjectData = async (projectId: string) => {
    try {
      setLoading(true)
      setError(null)

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      }

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(API_ENDPOINTS.residentialProject(projectId), {
        headers,
      })
      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || data.message || 'Failed to load project')
      }

      const project = data.project

      // Transform backend data to form data format
      setFormData({
        projectName: project.project_name || '',
        developer: project.developer || '',
        address: project.address || '',
        area: project.area || '',
        completionDate: project.completion_date || '',
        launchDate: project.launch_date || '',
        handoverDate: project.handover_date || '',
        constructionProgress: project.construction_progress || 0,
        status: project.status || 'upcoming',
        description: project.description || '',
        latitude: project.latitude,
        longitude: project.longitude,
        amenities: project.amenities || [],
        unitTypes: (project.units || []).map((unit: any) => ({
          id: unit.id?.toString() || Date.now().toString(),
          name: unit.unit_type_name || unit.name || unit.unit_name,
          category: unit.category,
          typeName: unit.type_code || unit.type_name || unit.typeName,
          unitNumbers: unit.unit_numbers,
          unitCount: unit.unit_count,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          area: unit.area,
          suiteArea: unit.built_up_area || unit.suite_area,
          balconyArea: unit.balcony_area,
          price: unit.price,
          pricePerSqft: unit.price_per_sqft,
          orientation: unit.orientation,
          features: unit.features || [],
          description: unit.description,
          floorPlanImage: unit.floor_plan_image,
          floorPlanImages:
            unit.unit_images ||
            unit.floor_plan_images ||
            (unit.floor_plan_image ? [unit.floor_plan_image] : []),
          parkingSpaces: unit.parking_spaces ?? undefined,
        })),
        paymentPlan: (project.payment_plan || []).map((milestone: any) => ({
          milestone: milestone.milestone_name || milestone.milestone,
          percentage: milestone.percentage,
          date: milestone.milestone_date || milestone.date,
          intervalMonths: milestone.interval_months,
          intervalDescription: milestone.interval_description,
        })),
        projectImages: project.project_images || [],
        floorPlanImages: project.floor_plan_images || [],
        primaryImage: project.primary_image || undefined,
        visualContent: project.visual_content,
        serviceCharge: project.service_charge_per_sqft ?? undefined,
        landmarks: project.landmark_distances || undefined,
      })
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  // PropertyWorkspace dialog 确认后更新项目
  const doUpdate = async () => {
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

      const response = await fetch(API_ENDPOINTS.residentialProject(id!), {
        method: 'PUT',
        headers,
        body: JSON.stringify(submitData),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to update property')
      }

      alert(t('edit.confirm.successAlert'))

      setSubmitted(true)
      setTimeout(() => navigate('/admin/properties'), 2000)
    } catch (err) {
      console.error('Update error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to update'
      setError(errorMessage)
      alert(t('edit.confirm.failAlert', { error: errorMessage }))
      setIsSubmitting(false)
      throw err
    }
  }

  if (loading) {
    return (
      <div className="flex-1 bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-teal-600" />
          <p className="text-gray-600">{t('edit.loadingData')}</p>
        </div>
      </div>
    )
  }

  if (error && !formData.projectName) {
    return (
      <div className="flex-1 bg-gray-50 flex items-center justify-center">
        <Card className="max-w-md mx-4 border border-red-200">
          <CardContent className="pt-6 text-center">
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">{t('edit.loadFailed')}</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <Button onClick={() => navigate('/admin/properties')}>
              {t('edit.backToList')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-gray-50 overflow-auto flex flex-col">
      {/* Compact header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => navigate('/admin/properties')}
              className="p-2 shrink-0"
            >
              <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
            </Button>
            <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 shadow-md shrink-0">
              <Building2 className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900 truncate">{t('edit.title')}</h1>
              <p className="text-xs text-gray-500 truncate">{formData.projectName || t('edit.subtitle')}</p>
            </div>
          </div>
        </div>
      </div>

      {submitted ? (
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-2xl">
          <SuccessCard
            title={t('edit.updateSuccess')}
            subtitle={t('edit.redirecting')}
          />
        </div>
      ) : (
        <PropertyWorkspace
          formData={formData}
          setFormData={setFormData}
          isSubmitting={isSubmitting}
          hasReviewed={hasReviewed}
          setHasReviewed={setHasReviewed}
          onConfirmSubmit={doUpdate}
          submitLabel={t('edit.submitBtn.confirmed')}
        />
      )}
    </div>
  )
}
