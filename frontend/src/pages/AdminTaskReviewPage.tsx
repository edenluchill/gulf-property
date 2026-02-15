/**
 * Admin Task Review Page
 *
 * Full editor for reviewing and editing extracted PDF data before submitting.
 * Uses the same components as DeveloperPropertyUploadPageV2 for consistency.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Loader2, ArrowLeft, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { UnitTypeCard } from '../components/developer-upload/UnitTypeCard'
import { ProjectBasicInfoSection } from '../components/developer-upload/ProjectBasicInfoSection'
import { DateTimeProgressSection } from '../components/developer-upload/DateTimeProgressSection'
import { VisualContentSection } from '../components/developer-upload/VisualContentSection'
import { PaymentPlanSection } from '../components/developer-upload/PaymentPlanSection'
import { AmenitiesSection } from '../components/developer-upload/AmenitiesSection'
import LocationMapPickerModal from '../components/LocationMapPicker'
import { API_BASE_URL, API_ENDPOINTS } from '../lib/config'

interface UnitType {
  id: string
  name: string
  category?: string
  typeName?: string
  unitNumbers?: string[]
  unitCount?: number
  bedrooms: number
  bathrooms: number
  area: number
  suiteArea?: number
  balconyArea?: number
  price?: number
  pricePerSqft?: number
  orientation?: string
  features?: string[]
  description?: string
  floorPlanImage?: string
  floorPlanImages?: string[]
}

interface FormData {
  projectName: string
  developer: string
  address: string
  area: string
  completionDate: string
  launchDate?: string
  handoverDate?: string
  constructionProgress?: number
  description: string
  latitude?: number
  longitude?: number
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: any[]
  projectImages?: string[]
  floorPlanImages?: string[]
}

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
  const { t } = useTranslation('upload')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<TaskData | null>(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [formData, setFormData] = useState<FormData>({
    projectName: '',
    developer: '',
    address: '',
    area: '',
    completionDate: '',
    description: '',
    amenities: [],
    unitTypes: [],
    paymentPlan: [],
  })

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

      const response = await fetch(API_ENDPOINTS.residentialProjectsSubmit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // Form field change handler
  const handleFormChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // Group units by building prefix
  const groupedUnits = formData.unitTypes.reduce((acc, unit) => {
    let buildingGroup = null

    if (unit.typeName) {
      const matchWithHyphen = unit.typeName.match(/^([A-Z]+)-/)
      const matchLettersOnly = unit.typeName.match(/^([A-Z]+)$/)
      const matchBeforeDigits = unit.typeName.match(/^([A-Z]+)[\d\(]/)

      if (matchWithHyphen) {
        buildingGroup = matchWithHyphen[1]
      } else if (matchLettersOnly) {
        buildingGroup = matchLettersOnly[1]
      } else if (matchBeforeDigits) {
        buildingGroup = matchBeforeDigits[1]
      }
    }

    const groupKey = buildingGroup || 'Uncategorized'

    if (!acc[groupKey]) acc[groupKey] = []
    acc[groupKey].push(unit)
    return acc
  }, {} as Record<string, UnitType[]>)

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
    <div className="flex-1 bg-white">
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
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="text-center py-16 shadow-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
                <CardContent>
                  <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
                  <h2 className="text-3xl font-bold mb-2 text-gray-900">Project Submitted!</h2>
                  <p className="text-gray-600">Redirecting to task list...</p>
                  <Loader2 className="h-6 w-6 mx-auto mt-4 animate-spin text-teal-600" />
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <Card className="shadow-2xl border-2 border-gray-200 bg-white">
              <CardContent className="pt-8 px-8">
                {error && (
                  <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Basic Info */}
                  <ProjectBasicInfoSection
                    formData={formData}
                    isProcessing={false}
                    onChange={handleFormChange}
                    onOpenMapPicker={() => setShowMapPicker(true)}
                  />

                  {/* Date & Progress */}
                  <div className="pt-6 border-t-2 border-gray-100">
                    <DateTimeProgressSection
                      formData={{
                        launchDate: formData.launchDate,
                        completionDate: formData.completionDate,
                        handoverDate: formData.handoverDate,
                        constructionProgress: formData.constructionProgress,
                      }}
                      isProcessing={false}
                      onChange={handleFormChange}
                    />
                  </div>

                  {/* Visual Content */}
                  <VisualContentSection
                    projectImages={formData.projectImages}
                    floorPlanImages={formData.floorPlanImages}
                    isProcessing={false}
                  />

                  {/* Unit Types */}
                  <div className="space-y-4 pt-6 border-t-2 border-gray-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-10 w-1 bg-gradient-to-b from-teal-500 to-emerald-500 rounded-full"></div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {t('unitTypesList')}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {t('totalUnitTypes', { count: formData.unitTypes.length })}
                        </p>
                      </div>
                    </div>

                    {Object.entries(groupedUnits).map(([groupKey, units]) => {
                      const isUncategorized = groupKey === 'Uncategorized'
                      return (
                        <div key={groupKey} className="space-y-4">
                          <div className={`px-5 py-4 rounded-xl shadow-md border-l-4 ${
                            isUncategorized
                              ? 'bg-gradient-to-r from-gray-50 to-gray-100 border-gray-400'
                              : 'bg-gradient-to-r from-blue-50 via-blue-50 to-indigo-50 border-blue-500'
                          }`}>
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">{isUncategorized ? '📋' : '🏢'}</span>
                              <div>
                                <div className={`font-bold ${isUncategorized ? 'text-gray-800' : 'text-blue-900'}`}>
                                  {isUncategorized ? t('uncategorized') : t('series', { key: groupKey })}
                                </div>
                                <div className="text-sm text-gray-600 mt-0.5">
                                  {t('unitTypeCount', { count: units.length })}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-3 pl-4">
                            {units.map((unit, idx) => (
                              <UnitTypeCard
                                key={unit.id}
                                unit={unit}
                                index={idx}
                                isProcessing={false}
                                onChange={(field, value) => {
                                  const globalIdx = formData.unitTypes.findIndex(u => u.id === unit.id)
                                  const updated = [...formData.unitTypes]
                                  updated[globalIdx] = { ...updated[globalIdx], [field]: value }
                                  setFormData(prev => ({ ...prev, unitTypes: updated }))
                                }}
                                onRemove={() => {
                                  setFormData(prev => ({
                                    ...prev,
                                    unitTypes: prev.unitTypes.filter(u => u.id !== unit.id)
                                  }))
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Amenities */}
                  <AmenitiesSection
                    amenities={formData.amenities}
                    isProcessing={false}
                  />

                  {/* Payment Plan */}
                  <PaymentPlanSection
                    paymentPlan={formData.paymentPlan}
                    isProcessing={false}
                  />

                  {/* Review Checklist */}
                  {formData.unitTypes.length > 0 && (
                    <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-2 border-blue-300 rounded-xl p-8 space-y-6 shadow-lg mt-8">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-1 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
                        <div>
                          <h3 className="font-bold text-blue-900 text-xl">
                            {t('checklist.title')}
                          </h3>
                          <p className="text-sm text-blue-700 mt-1">
                            {t('checklist.subtitle')}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
                          formData.projectName
                            ? 'bg-white border-green-300'
                            : 'bg-yellow-50 border-yellow-300'
                        }`}>
                          <div className="text-3xl pt-1">{formData.projectName ? '✅' : '⚠️'}</div>
                          <div className="flex-1">
                            <div className="font-bold text-gray-900 text-base mb-1">{t('checklist.basicInfo')}</div>
                            <div className="text-sm text-gray-600">{t('checklist.basicInfoDesc')}</div>
                          </div>
                        </div>

                        <div className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
                          formData.latitude && formData.longitude
                            ? 'bg-white border-green-300'
                            : 'bg-yellow-50 border-yellow-300'
                        }`}>
                          <div className="text-3xl pt-1">{formData.latitude && formData.longitude ? '✅' : '⚠️'}</div>
                          <div className="flex-1">
                            <div className="font-bold text-gray-900 text-base mb-1">
                              {t('checklist.mapCoordinates')} {formData.latitude && formData.longitude ? t('checklist.mapSet') : t('checklist.mapNotSet')}
                            </div>
                            <div className="text-sm text-gray-600">
                              {formData.latitude && formData.longitude
                                ? t('checklist.latLng', { lat: formData.latitude.toFixed(6), lng: formData.longitude.toFixed(6) })
                                : t('checklist.mapSetHint')
                              }
                            </div>
                          </div>
                        </div>

                        <div className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
                          formData.unitTypes.length > 0
                            ? 'bg-white border-green-300'
                            : 'bg-yellow-50 border-yellow-300'
                        }`}>
                          <div className="text-3xl pt-1">{formData.unitTypes.length > 0 ? '✅' : '⚠️'}</div>
                          <div className="flex-1">
                            <div className="font-bold text-gray-900 text-base mb-1">
                              {t('checklist.unitTypes', { count: formData.unitTypes.length })}
                            </div>
                            <div className="text-sm text-gray-600">{t('checklist.unitTypesDesc')}</div>
                          </div>
                        </div>
                      </div>

                      <div className="border-t-2 border-blue-200 pt-6 mt-6">
                        <label className="flex items-start gap-4 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={hasReviewed}
                            onChange={(e) => setHasReviewed(e.target.checked)}
                            className="w-6 h-6 mt-1 rounded border-2 border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                          />
                          <div className="flex-1">
                            <span className="font-bold text-gray-900 text-base block group-hover:text-blue-700 transition-colors">
                              {t('checklist.confirmReview')}
                            </span>
                            <span className="text-sm text-gray-600 mt-1 block">
                              {t('checklist.checkToSubmit')}
                            </span>
                          </div>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Submit Button */}
                  <div className="pt-8 border-t-2 border-gray-100">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 shadow-xl hover:shadow-2xl text-lg py-7 transition-all duration-300 transform hover:scale-[1.02] disabled:transform-none disabled:opacity-50"
                      disabled={isSubmitting || !formData.projectName || !hasReviewed}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                          <span className="text-lg">Submitting...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-6 w-6" />
                          <span className="text-lg font-bold">
                            {hasReviewed ? 'Submit as Project' : 'Please review and check the box above'}
                          </span>
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Location Map Picker Modal */}
      <LocationMapPickerModal
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng) => {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }))
        }}
        initialPosition={
          formData.latitude && formData.longitude
            ? { lat: formData.latitude, lng: formData.longitude }
            : undefined
        }
      />

      {/* Submitting Overlay */}
      <AnimatePresence>
        {isSubmitting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl p-12 max-w-md mx-4"
            >
              <div className="text-center">
                <Loader2 className="h-20 w-20 mx-auto mb-6 animate-spin text-green-600" />
                <h3 className="text-2xl font-bold text-gray-900 mb-3">Submitting Project</h3>
                <p className="text-gray-600 mb-2">Saving to database...</p>
                <p className="text-sm text-gray-500">Please wait</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
