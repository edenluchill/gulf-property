/**
 * Developer Property Upload Page V2 - Enhanced & Refactored
 * 
 * Features:
 * - Multi-document upload support
 * - Expandable unit type cards with image carousels
 * - Clean component structure
 * - Beautiful image galleries with shadcn carousel
 */

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { UnitTypeCard } from '../components/developer-upload/UnitTypeCard'
import { DocumentUploadSection } from '../components/developer-upload/DocumentUploadSection'
import { ProgressSection } from '../components/developer-upload/ProgressSection'
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
  suiteArea?: number        // ⭐ 室内面积 (Suite Area / Internal Area)
  balconyArea?: number      // 阳台面积
  price?: number
  pricePerSqft?: number
  orientation?: string
  features?: string[]
  description?: string      // ⭐ 户型描述 (AI-generated or manual)
  floorPlanImage?: string
  floorPlanImages?: string[]
}

interface Document {
  id: string
  file: File
  label: string
}

interface FormData {
  projectName: string
  developer: string
  address: string
  area: string
  completionDate: string
  launchDate?: string
  handoverDate?: string
  constructionProgress?: number  // Percentage: 0-100
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

interface ProgressEvent {
  stage: string
  message: string
  progress: number
  data?: any
  timestamp: number
}

export default function DeveloperPropertyUploadPageV2() {
  const { t } = useTranslation('upload')
  const [documents, setDocuments] = useState<Document[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentStage, setCurrentStage] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [showMapPicker, setShowMapPicker] = useState(false)
  const [hasReviewed, setHasReviewed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const eventSourceRef = useRef<EventSource | null>(null)

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

  // Add documents
  const handleAddDocuments = (files: File[]) => {
    files.forEach((file, idx) => {
      setDocuments(prev => [...prev, {
        id: Date.now().toString() + idx,
        file,
        label: idx === 0 ? t('processing.mainBrochure') : t('processing.documentN', { n: prev.length + idx + 1 }),
      }])
    })
    setError(null)
  }

  // Remove document
  const handleRemoveDocument = (id: string) => {
    setDocuments(prev => prev.filter(d => d.id !== id))
  }

  // Validate and clean date format (must be YYYY-MM-DD or empty string)
  const cleanDateFormat = (dateStr: string | undefined): string => {
    if (!dateStr) return ''
    
    // Check if it's already a valid YYYY-MM-DD format
    const validDatePattern = /^\d{4}-\d{2}-\d{2}$/
    if (validDatePattern.test(dateStr)) {
      return dateStr
    }
    
    // If it's an incomplete date (e.g., "2030-06" or "2030-Q4"), return empty
    console.warn(`⚠️ Invalid date format detected: "${dateStr}", clearing it`)
    return ''
  }

  // Process all documents
  const handleProcessPdfs = async () => {
    if (documents.length === 0) return

    setHasStarted(true)
    setIsUploading(true)
    setUploadProgress(0)
    setProgress(0)
    setCurrentStage(t('processing.uploading'))
    setProgressEvents([])
    setError(null)

    try {
      const formDataToSend = new FormData()
      documents.forEach(doc => {
        formDataToSend.append('files', doc.file)
      })

      console.log('📤 Sending files to backend...')
      
      // Use XMLHttpRequest to track upload progress
      const data = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        // Track upload progress
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(percentComplete)
            setCurrentStage(t('processing.uploadingPercent', { percent: percentComplete }))
            console.log(`📤 Upload progress: ${percentComplete}%`)
          }
        })
        
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText)
              setIsUploading(false)
              setCurrentStage(t('processing.uploadComplete'))
              resolve(response)
            } catch (err) {
              reject(new Error('Invalid response format'))
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`))
          }
        })
        
        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'))
        })
        
        xhr.open('POST', API_ENDPOINTS.langgraphProgressStart)
        xhr.send(formDataToSend)
      })

      console.log('✅ Backend response:', data)

      if (!data.success) {
        throw new Error(data.error || 'Failed to start processing')
      }

      const jobId = data.jobId
      console.log(`🆔 Job ID received: ${jobId}`)

      setIsProcessing(true)
      setCurrentStage(t('processing.connecting'))

      console.log('🔌 Connecting to SSE:', API_ENDPOINTS.langgraphProgressStream(jobId))
      
      const eventSource = new EventSource(API_ENDPOINTS.langgraphProgressStream(jobId))
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        console.log('✅ SSE connection opened')
        setCurrentStage(t('processing.startProcessing'))
      }

      eventSource.onmessage = (event) => {
        console.log('📨 SSE message received:', event.data.substring(0, 100))
        const progressEvent: ProgressEvent = JSON.parse(event.data)
        console.log(`   Stage: ${progressEvent.stage}, Progress: ${progressEvent.progress}%`)
        
        setProgressEvents(prev => [...prev, progressEvent])
        setProgress(progressEvent.progress)
        setCurrentStage(progressEvent.message)

        if (progressEvent.data?.buildingData) {
          const { buildingData } = progressEvent.data
          
          // Debug logs
          if (buildingData.images) {
            console.log('📸 Images received:', {
              projectImages: buildingData.images.projectImages?.length || 0,
              floorPlanImages: buildingData.images.floorPlanImages?.length || 0,
            });
          }
          if (buildingData.paymentPlans) {
            console.log('💰 Payment plans received:', buildingData.paymentPlans.length);
            console.log('💰 First payment plan:', buildingData.paymentPlans[0]);
            console.log('💰 Milestones:', buildingData.paymentPlans[0]?.milestones);
          }
          
          setFormData(prev => {
            // Clean date formats before setting form data
            const cleanedLaunchDate = cleanDateFormat(buildingData.launchDate || prev.launchDate)
            const cleanedCompletionDate = cleanDateFormat(buildingData.completionDate || prev.completionDate)
            const cleanedHandoverDate = cleanDateFormat(buildingData.handoverDate || prev.handoverDate)

            return {
              ...prev,
              projectName: buildingData.name || prev.projectName,
              developer: buildingData.developer || prev.developer,
              address: buildingData.address || prev.address,
              area: buildingData.area || prev.area,
              completionDate: cleanedCompletionDate,
              launchDate: cleanedLaunchDate,
              handoverDate: cleanedHandoverDate,
              constructionProgress: buildingData.constructionProgress || prev.constructionProgress,
              description: buildingData.description || prev.description,
              amenities: buildingData.amenities || prev.amenities,
              unitTypes: buildingData.units || prev.unitTypes,
              paymentPlan: buildingData.paymentPlans?.[0]?.milestones || prev.paymentPlan,
              projectImages: buildingData.images?.projectImages || prev.projectImages,
              floorPlanImages: buildingData.images?.floorPlanImages || prev.floorPlanImages,
              visualContent: buildingData.visualContent || prev.visualContent,
            }
          })
        }

        if (progressEvent.stage === 'complete') {
          console.log('✅ Processing complete!')
          setIsProcessing(false)
          setIsUploading(false)
          setHasReviewed(false) // 重置review状态
          eventSource.close()
        }

        if (progressEvent.stage === 'error') {
          console.error('❌ Processing error:', progressEvent.message)
          setError(progressEvent.message)
          setIsProcessing(false)
          setIsUploading(false)
          eventSource.close()
        }
      }

      eventSource.onerror = (error) => {
        console.error('❌ SSE error:', error)
        console.log('SSE readyState:', eventSource.readyState)
        // ReadyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        
        if (eventSource.readyState === EventSource.CLOSED) {
          setError('Connection closed unexpectedly. Please try again.')
          setIsProcessing(false)
          setIsUploading(false)
        } else {
          console.log('🔄 SSE reconnecting...')
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process PDFs')
      setIsProcessing(false)
      setIsUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 防止意外提交：必须明确点击按钮
    if (isProcessing || isSubmitting) {
      console.log('⚠️ Still processing, blocking submit')
      return
    }

    // 二次确认
    const confirmSubmit = window.confirm(
      t('confirm.message', {
        name: formData.projectName,
        developer: formData.developer,
        unitCount: formData.unitTypes.length,
        coordStatus: formData.latitude && formData.longitude ? t('confirm.coordSet') : t('confirm.coordNotSet'),
      })
    )

    if (!confirmSubmit) {
      console.log('❌ User cancelled submit')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      // Clean date formats before submitting (convert empty strings to null for backend)
      const cleanedLaunchDate = formData.launchDate || null
      const cleanedCompletionDate = formData.completionDate || null
      const cleanedHandoverDate = formData.handoverDate || null

      console.log('🔍 FormData before submit:', {
        paymentPlanLength: formData.paymentPlan?.length || 0,
        paymentPlan: formData.paymentPlan,
      })

      const submitData = {
        projectName: formData.projectName,
        developer: formData.developer,
        address: formData.address,
        area: formData.area,
        description: formData.description,
        latitude: formData.latitude,
        longitude: formData.longitude,
        launchDate: cleanedLaunchDate,
        completionDate: cleanedCompletionDate,
        handoverDate: cleanedHandoverDate,
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
          suiteArea: unit.suiteArea,          // ⭐ 室内面积
          balconyArea: unit.balconyArea,
          price: unit.price,
          pricePerSqft: unit.pricePerSqft,
          orientation: unit.orientation,
          features: unit.features,
          description: unit.description,      // ⭐ 户型描述
          floorPlanImage: unit.floorPlanImage,
          floorPlanImages: unit.floorPlanImages,
        })),
        paymentPlan: formData.paymentPlan || [],
      }

      console.log('📤 Submitting project:', submitData)

      const response = await fetch(API_ENDPOINTS.residentialProjectsSubmit, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to submit property')
      }

      console.log('✅ Project submitted successfully:', result.projectId)
      
      // Clear metadata cache so MapPage will fetch fresh data
      localStorage.removeItem('gulf_residential_developers')
      localStorage.removeItem('gulf_residential_developers_timestamp')
      localStorage.removeItem('gulf_residential_areas')
      localStorage.removeItem('gulf_residential_areas_timestamp')
      localStorage.removeItem('gulf_residential_projects')
      localStorage.removeItem('gulf_residential_projects_timestamp')
      console.log('🗑️ Cleared metadata cache to ensure fresh data on map')
      
      // Show success notification
      alert(t('confirm.successAlert'))
      
      setSubmitted(true)
      setTimeout(() => { window.location.href = '/map' }, 2000)
    } catch (err) {
      console.error('❌ Submit error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit'
      setError(errorMessage)
      
      // Show error notification to user
      alert(t('confirm.failAlert', { error: errorMessage }))
      
      setIsSubmitting(false)
    }
  }

  // Form field change handler
  const handleFormChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // Group units by building prefix (extracted from typeName)
  const groupedUnits = formData.unitTypes.reduce((acc, unit) => {
    let buildingGroup = null;
    
    // Extract prefix from typeName for consistent grouping
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

  return (
    <div className="min-h-screen bg-white">
      {/* Page Title Section */}
      <div className="bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 border-b border-amber-200">
        <div className="container mx-auto px-6 py-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-xl">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
                <p className="text-sm text-gray-700 mt-1">
                  {t('subtitle')}
                </p>
              </div>
            </div>
            
            {/* Process Flow Indicator */}
            <div className="flex items-center gap-3 text-sm mt-6">
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-amber-200">
                <span className="font-semibold text-amber-700">{`1️⃣ ${t('steps.upload')}`}</span>
              </div>
              <div className="text-amber-400">→</div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-amber-200">
                <span className="font-semibold text-amber-700">{`2️⃣ ${t('steps.extract')}`}</span>
              </div>
              <div className="text-amber-400">→</div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-amber-200">
                <span className="font-semibold text-amber-700">{`3️⃣ ${t('steps.review')}`}</span>
              </div>
              <div className="text-amber-400">→</div>
              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-amber-200">
                <span className="font-semibold text-green-700">{`4️⃣ ${t('steps.submit')}`}</span>
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
                  <h2 className="text-3xl font-bold mb-2 text-gray-900">{t('success.title')}</h2>
                  <p className="text-gray-600">{t('success.redirecting')}</p>
                  <Loader2 className="h-6 w-6 mx-auto mt-4 animate-spin text-amber-600" />
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column - Upload & Progress */}
              <div className="space-y-6">
                <DocumentUploadSection
                  documents={documents}
                  isProcessing={isProcessing}
                  onAddDocuments={handleAddDocuments}
                  onRemoveDocument={handleRemoveDocument}
                  onStartProcessing={handleProcessPdfs}
                />
                
                <ProgressSection
                  isProcessing={isProcessing || isUploading}
                  progress={isUploading ? uploadProgress : progress}
                  currentStage={currentStage}
                  progressEvents={progressEvents}
                  error={error}
                  isUploading={isUploading}
                />
              </div>

              {/* Right Column - Form (shows after processing starts) */}
              <AnimatePresence>
                {hasStarted && (
                  <motion.div
                    className="lg:col-span-2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Card className="shadow-2xl border-2 border-gray-200 bg-white">
                      <CardContent className="pt-8 px-8">
                        <form 
                          onSubmit={handleSubmit} 
                          onKeyDown={(e) => {
                            // 阻止Enter键意外提交表单
                            if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                              e.preventDefault()
                              console.log('⚠️ Enter key blocked to prevent accidental submit')
                            }
                          }}
                          className="space-y-6"
                        >
                          {/* Basic Info */}
                          <ProjectBasicInfoSection
                            formData={formData}
                            isProcessing={isProcessing}
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
                              isProcessing={isProcessing}
                              onChange={handleFormChange}
                            />
                          </div>

                          {/* Visual Content */}
                          <VisualContentSection
                            projectImages={formData.projectImages}
                            floorPlanImages={formData.floorPlanImages}
                            visualContent={formData.visualContent}
                            isProcessing={isProcessing}
                          />

                          {/* Unit Types - Grouped by Tower/Building */}
                          <div className="space-y-4 pt-6 border-t-2 border-gray-100">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="h-10 w-1 bg-gradient-to-b from-amber-500 to-orange-500 rounded-full"></div>
                              <div>
                                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                                  {t('unitTypesList')}
                                </h3>
                                <p className="text-sm text-gray-600">
                                  {t('totalUnitTypes', { count: formData.unitTypes.length })}
                                </p>
                              </div>
                            </div>

                            {isProcessing && formData.unitTypes.length === 0 && (
                              <div className="text-center py-16 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border-2 border-dashed border-amber-300 shadow-inner">
                                <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-amber-600" />
                                <p className="text-base text-gray-700 font-semibold">{t('aiAnalyzing')}</p>
                                <p className="text-sm text-gray-500 mt-2">{t('extractingUnitTypes')}</p>
                              </div>
                            )}

                            {/* Grouped Units */}
                            {Object.entries(groupedUnits).map(([groupKey, units]) => {
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
                                        isProcessing={isProcessing}
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
                            })}
                          </div>

                          {/* Amenities */}
                          <AmenitiesSection
                            amenities={formData.amenities}
                            isProcessing={isProcessing}
                          />

                          {/* Payment Plan */}
                          <PaymentPlanSection
                            paymentPlan={formData.paymentPlan}
                            isProcessing={isProcessing}
                          />

                          {/* Review Checklist */}
                          {!isProcessing && formData.unitTypes.length > 0 && (
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
                              
                              {/* Invalid Units Warning */}
                              {(() => {
                                const invalidUnits = formData.unitTypes.filter(u => !u.area || u.area <= 0);
                                if (invalidUnits.length > 0) {
                                  return (
                                    <div className="bg-red-50 border-2 border-red-300 rounded-xl p-6 space-y-3">
                                      <div className="flex items-center gap-3">
                                        <span className="text-2xl">⚠️</span>
                                        <div>
                                          <h4 className="font-bold text-red-900">
                                            {t('checklist.invalidUnits.title', { count: invalidUnits.length })}
                                          </h4>
                                          <p className="text-sm text-red-700 mt-1">
                                            {t('checklist.invalidUnits.desc')}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="bg-white rounded-lg p-4 space-y-2">
                                        {invalidUnits.map(unit => (
                                          <div key={unit.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                                            <span className="font-medium text-gray-900">{unit.name || unit.typeName}</span>
                                            <span className="text-red-600 text-xs bg-red-100 px-2 py-1 rounded">
                                              {t('checklist.invalidUnits.areaZero')}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      <p className="text-xs text-red-600">
                                        {t('checklist.invalidUnits.hint')}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                              
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
                              disabled={isProcessing || isSubmitting || !formData.projectName || !hasReviewed}
                            >
                              {isSubmitting ? (
                                <>
                                  <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                                  <span className="text-lg">{t('submitBtn.submitting')}</span>
                                </>
                              ) : isProcessing ? (
                                <>
                                  <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                                  <span className="text-lg">{t('submitBtn.aiProcessing')}</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="mr-2 h-6 w-6" />
                                  <span className="text-lg font-bold">
                                    {hasReviewed ? t('submitBtn.confirmed') : t('submitBtn.pleaseCheck')}
                                  </span>
                                </>
                              )}
                            </Button>
                          </div>
                        </form>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
                <h3 className="text-2xl font-bold text-gray-900 mb-3">{t('overlay.submittingProject')}</h3>
                <p className="text-gray-600 mb-2">{t('overlay.savingToDb')}</p>
                <p className="text-sm text-gray-500">{t('overlay.pleaseWait')}</p>
                <div className="mt-6 flex items-center justify-center gap-1">
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="h-2 w-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
