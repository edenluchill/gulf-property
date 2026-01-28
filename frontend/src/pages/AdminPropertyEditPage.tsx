/**
 * Admin Property Edit Page - 管理员项目编辑页面
 * 
 * Features:
 * - Load existing project data
 * - Reuse upload page components for editing
 * - Full update of all fields
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import { UnitTypeCard } from '../components/developer-upload/UnitTypeCard'
import { ProjectBasicInfoSection } from '../components/developer-upload/ProjectBasicInfoSection'
import { DateTimeProgressSection } from '../components/developer-upload/DateTimeProgressSection'
import { VisualContentSection } from '../components/developer-upload/VisualContentSection'
import { PaymentPlanSection } from '../components/developer-upload/PaymentPlanSection'
import { AmenitiesSection } from '../components/developer-upload/AmenitiesSection'
import LocationMapPickerModal from '../components/LocationMapPicker'
import { API_ENDPOINTS } from '../lib/config'

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
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
}

export default function AdminPropertyEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation('admin')
  
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)

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

  // Load existing project data
  useEffect(() => {
    if (id) {
      fetchProjectData(id)
    }
  }, [id])

  const fetchProjectData = async (projectId: string) => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch(API_ENDPOINTS.residentialProject(projectId))
      const data = await response.json()

      console.log('📥 API Response:', data)

      if (!data.success) {
        throw new Error(data.error || data.message || 'Failed to load project')
      }

      const project = data.project
      console.log('📦 Project data:', project)
      
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
          floorPlanImages: unit.unit_images || unit.floor_plan_images || (unit.floor_plan_image ? [unit.floor_plan_image] : []),
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
        visualContent: project.visual_content,
      })

      console.log('✅ Project data loaded successfully')
    } catch (err) {
      console.error('❌ Failed to load project:', err)
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isSubmitting) {
      console.log('⚠️ Already submitting, blocking duplicate submit')
      return
    }

    // Confirmation
    const confirmSubmit = window.confirm(
      t('edit.confirm.message', {
        name: formData.projectName,
        developer: formData.developer,
        unitCount: formData.unitTypes.length,
        coordStatus: formData.latitude && formData.longitude ? t('edit.confirm.coordSet') : t('edit.confirm.coordNotSet')
      })
    )

    if (!confirmSubmit) {
      console.log('❌ User cancelled submit')
      return
    }

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
        visualContent: formData.visualContent,
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

      console.log('📤 Updating project:', submitData)

      const response = await fetch(API_ENDPOINTS.residentialProject(id!), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to update property')
      }

      console.log('✅ Project updated successfully')
      
      alert(t('edit.confirm.successAlert'))
      
      setSubmitted(true)
      setTimeout(() => { navigate('/admin/properties') }, 2000)
    } catch (err) {
      console.error('❌ Update error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to update'
      setError(errorMessage)
      
      alert(t('edit.confirm.failAlert', { error: errorMessage }))
      
      setIsSubmitting(false)
    }
  }

  const handleFormChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // Group units by building prefix
  const groupedUnits = formData.unitTypes.reduce((acc, unit) => {
    let buildingGroup = null;
    
    if (unit.typeName) {
      const matchWithHyphen = unit.typeName.match(/^([A-Z]+)-/);
      const matchLettersOnly = unit.typeName.match(/^([A-Z]+)$/);
      const matchBeforeDigits = unit.typeName.match(/^([A-Z]+)[\d\(]/);
      
      if (matchWithHyphen) {
        buildingGroup = matchWithHyphen[1];
      } else if (matchLettersOnly) {
        buildingGroup = matchLettersOnly[1];
      } else if (matchBeforeDigits) {
        buildingGroup = matchBeforeDigits[1];
      }
    }
    
    const groupKey = buildingGroup || 'Uncategorized';
    
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(unit);
    return acc;
  }, {} as Record<string, UnitType[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-16 w-16 mx-auto mb-4 animate-spin text-blue-600" />
          <p className="text-gray-600 text-lg">{t('edit.loadingData')}</p>
        </div>
      </div>
    )
  }

  if (error && !formData.projectName) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
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
    <div className="min-h-screen bg-white">
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
                <p className="text-sm text-gray-700 mt-1">
                  {t('edit.subtitle')}
                </p>
              </div>
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
                  <h2 className="text-3xl font-bold mb-2 text-gray-900">{t('edit.updateSuccess')}</h2>
                  <p className="text-gray-600">{t('edit.redirecting')}</p>
                  <Loader2 className="h-6 w-6 mx-auto mt-4 animate-spin text-blue-600" />
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <Card className="shadow-2xl border-2 border-gray-200 bg-white">
              <CardContent className="pt-8 px-8">
                <form 
                  onSubmit={handleSubmit} 
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                      e.preventDefault()
                    }
                  }}
                  className="space-y-6"
                >
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
                    visualContent={formData.visualContent}
                    isProcessing={false}
                  />

                  {/* Unit Types - Grouped */}
                  <div className="space-y-4 pt-6 border-t-2 border-gray-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-10 w-1 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                          {t('edit.unitTypesList')}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {t('edit.totalUnitTypes', { count: formData.unitTypes.length })}
                        </p>
                      </div>
                    </div>

                    {formData.unitTypes.length === 0 ? (
                      <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
                        <p className="text-base text-gray-700 font-semibold">{t('edit.noUnitTypes')}</p>
                      </div>
                    ) : (
                      Object.entries(groupedUnits).map(([groupKey, units]) => {
                        const isUncategorized = groupKey === 'Uncategorized';
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
                                    {isUncategorized ? t('edit.uncategorized') : t('edit.series', { key: groupKey })}
                                  </div>
                                  <div className="text-sm text-gray-600 mt-0.5">
                                    {t('edit.unitTypeCount', { count: units.length })}
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
                                    const globalIdx = formData.unitTypes.findIndex(u => u.id === unit.id);
                                    const updated = [...formData.unitTypes];
                                    updated[globalIdx] = { ...updated[globalIdx], [field]: value };
                                    setFormData(prev => ({ ...prev, unitTypes: updated }));
                                  }}
                                  onRemove={() => {
                                    setFormData(prev => ({
                                      ...prev,
                                      unitTypes: prev.unitTypes.filter(u => u.id !== unit.id)
                                    }));
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })
                    )}
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
                  <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-2 border-blue-300 rounded-xl p-8 space-y-6 shadow-lg mt-8">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-1 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
                      <div>
                        <h3 className="font-bold text-blue-900 text-xl">
                          {t('edit.checklist.title')}
                        </h3>
                        <p className="text-sm text-blue-700 mt-1">
                          {t('edit.checklist.subtitle')}
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
                          <div className="font-bold text-gray-900 text-base mb-1">{t('edit.checklist.basicInfo')}</div>
                          <div className="text-sm text-gray-600">{t('edit.checklist.basicInfoDesc')}</div>
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
                            {t('edit.checklist.mapCoordinates')} {formData.latitude && formData.longitude ? t('edit.checklist.mapSet') : t('edit.checklist.mapNotSet')}
                          </div>
                          <div className="text-sm text-gray-600">
                            {formData.latitude && formData.longitude
                              ? t('edit.checklist.latLng', { lat: formData.latitude.toFixed(6), lng: formData.longitude.toFixed(6) })
                              : t('edit.checklist.mapSetHint')
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
                            {t('edit.checklist.unitTypes', { count: formData.unitTypes.length })}
                          </div>
                          <div className="text-sm text-gray-600">{t('edit.checklist.unitTypesDesc')}</div>
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
                            {t('edit.checklist.confirmReview')}
                          </span>
                          <span className="text-sm text-gray-600 mt-1 block">
                            {t('edit.checklist.checkToUpdate')}
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-8 border-t-2 border-gray-100">
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-xl hover:shadow-2xl text-lg py-7 transition-all duration-300 transform hover:scale-[1.02] disabled:transform-none disabled:opacity-50"
                      disabled={isSubmitting || !formData.projectName || !hasReviewed}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                          <span className="text-lg">{t('edit.submitBtn.updating')}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle className="mr-2 h-6 w-6" />
                          <span className="text-lg font-bold">
                            {hasReviewed ? t('edit.submitBtn.confirmed') : t('edit.submitBtn.pleaseCheck')}
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
                <Loader2 className="h-20 w-20 mx-auto mb-6 animate-spin text-blue-600" />
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{t('edit.overlay.updatingProject')}</h3>
                <p className="text-gray-600 mb-2">{t('edit.overlay.savingToDb')}</p>
                <p className="text-sm text-gray-500">{t('edit.overlay.pleaseWait')}</p>
                <div className="mt-6 flex items-center justify-center gap-1">
                  <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2 w-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
