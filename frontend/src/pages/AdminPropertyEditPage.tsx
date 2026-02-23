/**
 * Admin Property Edit Page - 管理员项目编辑页面
 *
 * Uses shared PropertyEditorForm component.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, Loader2, ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { API_ENDPOINTS } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'
import {
  PropertyFormData,
  PropertyEditorForm,
  SuccessCard,
  initialFormData,
} from '../components/property-editor'

export default function AdminPropertyEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('admin')
  const { session } = useAuth()

  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
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
      })
    } catch (err) {
      console.error('Failed to load project:', err)
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isSubmitting) return

    const confirmSubmit = window.confirm(
      t('edit.confirm.message', {
        name: formData.projectName,
        developer: formData.developer,
        unitCount: formData.unitTypes.length,
        coordStatus:
          formData.latitude && formData.longitude
            ? t('edit.confirm.coordSet')
            : t('edit.confirm.coordNotSet'),
      })
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
        status: formData.status || 'upcoming',
        projectImages: formData.projectImages || [],
        floorPlanImages: formData.floorPlanImages || [],
        primaryImage: formData.primaryImage || null,
        amenities: formData.amenities || [],
        visualContent: formData.visualContent,
        unitTypes: formData.unitTypes.map(unit => ({
          id: unit.id,
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
    }
  }

  if (loading) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-16 w-16 mx-auto mb-4 animate-spin text-blue-600" />
          <p className="text-gray-600 text-lg">{t('edit.loadingData')}</p>
        </div>
      </div>
    )
  }

  if (error && !formData.projectName) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center">
        <Card className="max-w-md mx-4 shadow-2xl border-2 border-red-200">
          <CardContent className="pt-6 text-center">
            <div className="text-6xl mb-4">❌</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('edit.loadFailed')}</h2>
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
    <div className="flex-1 bg-white overflow-auto">
      {/* Page Title Section */}
      <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-b border-blue-200">
        <div className="container mx-auto px-6 py-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-4 mb-4">
              <Button
                variant="ghost"
                onClick={() => navigate('/admin/properties')}
                className="p-2"
              >
                <ArrowLeft className="h-6 w-6" />
              </Button>
              <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{t('edit.title')}</h1>
                <p className="text-sm text-gray-700 mt-1">{t('edit.subtitle')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          {submitted ? (
            <SuccessCard
              title={t('edit.updateSuccess')}
              subtitle={t('edit.redirecting')}
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
              translationNamespace="upload"
              error={error}
              submitButtonText={t('edit.submitBtn.pleaseCheck')}
              submitButtonTextConfirmed={t('edit.submitBtn.confirmed')}
              overlayTitle={t('edit.overlay.updatingProject')}
              overlaySubtitle={t('edit.overlay.savingToDb')}
              overlayAccentColor="blue"
            />
          )}
        </div>
      </div>
    </div>
  )
}
