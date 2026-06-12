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
import { Building2, CheckCircle, Loader2, AlertTriangle, MapPin, LayoutGrid, ClipboardCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import { UnitTypeCard } from '../components/developer-upload/UnitTypeCard'
import { DocumentUploadSection } from '../components/developer-upload/DocumentUploadSection'
import { ProgressSection } from '../components/developer-upload/ProgressSection'
import { ProjectBasicInfoSection } from '../components/developer-upload/ProjectBasicInfoSection'
import { DateTimeProgressSection } from '../components/developer-upload/DateTimeProgressSection'
import { VisualContentSection } from '../components/developer-upload/VisualContentSection'
import { PaymentPlanSection } from '../components/developer-upload/PaymentPlanSection'
import { AmenitiesSection } from '../components/developer-upload/AmenitiesSection'
import { ExtractedPricingSection } from '../components/developer-upload/ExtractedPricingSection'
import { SubmitReviewDialog, type ClientReadiness } from '../components/developer-upload/SubmitReviewDialog'
import LocationMapPickerModal from '../components/LocationMapPicker'
import { API_ENDPOINTS, API_BASE_URL } from '../lib/config'
import { fetchDubaiAreas } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

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
  parkingSpaces?: number    // ⭐ 车位配比（来自楼书文本层库存表）
}

interface Landmark {
  name: string
  distanceKm: number
}

interface ServerReadiness {
  submittable: boolean
  missingProjectFields: string[]
  unitsCount: number
  blockedUnits: { name: string; category?: string; blockers: string[]; warnings: string[] }[]
  warningUnits: { name: string; category?: string; blockers: string[]; warnings: string[] }[]
  message?: string
}

interface Document {
  id: string
  file: File
  label: string
}

interface ExtractedPricingEntry {
  unitTypeName?: string
  unitCategory?: string
  building?: string
  price: number
  pricePerSqft?: number
  area?: number
  isStartingFrom?: boolean
  sourcePageNumber: number
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
  status?: string  // 'upcoming' | 'under-construction' | 'completed' | 'handed-over' | 'sold-out'
  description: string
  latitude?: number
  longitude?: number
  amenities: string[]
  unitTypes: UnitType[]
  paymentPlan: any[]
  projectImages?: string[]
  floorPlanImages?: string[]
  hiddenProjectImages?: string[]  // Images hidden by user (not deleted, can restore)
  hiddenFloorPlanImages?: string[]  // Floor plan images hidden by user
  primaryImage?: string  // User-selected featured image for map pin display
  visualContent?: {
    hasRenderings?: boolean
    hasFloorPlans?: boolean
    hasLocationMaps?: boolean
    renderingDescriptions?: string[]
    floorPlanDescriptions?: string[]
  }
  extractedPricing?: ExtractedPricingEntry[]
  serviceCharge?: number       // ⭐ 服务费 AED/sqft/年（文本层提取）
  landmarks?: Landmark[]       // ⭐ 周边地标距离（文本层提取）
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
  const { session } = useAuth()
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
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [serverReadiness, setServerReadiness] = useState<ServerReadiness | null>(null)
  const [showReviewDialog, setShowReviewDialog] = useState(false)
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])

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
        // Add user authentication headers
        if (session?.access_token) {
          xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
        }
        if (session?.user?.id) {
          xhr.setRequestHeader('x-user-id', session.user.id)
        }
        if (session?.user?.email) {
          xhr.setRequestHeader('x-user-email', session.user.email)
        }
        xhr.send(formDataToSend)
      })

      console.log('✅ Backend response:', data)

      if (!data.success) {
        throw new Error(data.error || 'Failed to start processing')
      }

      const jobId = data.jobId
      setCurrentJobId(jobId)
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
              latitude: buildingData.latitude || prev.latitude,
              longitude: buildingData.longitude || prev.longitude,
              amenities: buildingData.amenities || prev.amenities,
              unitTypes: buildingData.units || prev.unitTypes,
              paymentPlan: buildingData.paymentPlans?.[0]?.milestones || prev.paymentPlan,
              projectImages: buildingData.images?.projectImages || prev.projectImages,
              floorPlanImages: buildingData.images?.floorPlanImages || prev.floorPlanImages,
              visualContent: buildingData.visualContent || prev.visualContent,
              extractedPricing: buildingData.extractedPricing || prev.extractedPricing,
              serviceCharge: buildingData.serviceCharge ?? prev.serviceCharge,
              landmarks: buildingData.landmarks || prev.landmarks,
            }
          })

          // ⭐ 结构化提交就绪检查（后端计算，含修复后的最终状态）
          if (buildingData.submitReadiness) {
            setServerReadiness(buildingData.submitReadiness)
          }
        }

        if (progressEvent.stage === 'complete') {
          console.log('✅ Processing complete!')
          setIsProcessing(false)
          setIsUploading(false)
          setHasReviewed(false) // 重置review状态
          eventSource.close()
          // ⭐ 查重：与库里已有项目按名称比对
          const extractedName = progressEvent.data?.buildingData?.name
          if (extractedName) {
            checkDuplicateProjects(extractedName)
          }
          // ⭐ area 缺失时从 address 自动回填
          const bd = progressEvent.data?.buildingData
          if (bd && !bd.area && bd.address) {
            autoFillAreaFromAddress(bd.address)
          }
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

  // ⭐ area 兜底：提取没拿到区域时，从 address 文本里匹配已知 Dubai 区域名回填
  const autoFillAreaFromAddress = async (address: string) => {
    try {
      const areas = await fetchDubaiAreas()
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
      const addr = norm(address)
      // 选 address 中出现的最长区域名（"Dubai Islands" 优先于 "Dubai"）
      const match = areas
        .map(a => a.name)
        .filter(name => name && addr.includes(norm(name)))
        .sort((a, b) => b.length - a.length)[0]
      if (match) {
        console.log(`📍 Area auto-filled from address: ${match}`)
        setFormData(prev => prev.area ? prev : { ...prev, area: match })
      }
    } catch (err) {
      console.warn('Area auto-fill failed (non-fatal):', err)
    }
  }

  // ⭐ 查重：拉取项目名列表，归一化比对
  const checkDuplicateProjects = async (projectName: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/residential-projects/meta/projects`)
      if (!res.ok) return
      const json = await res.json()
      const existing: { project_name: string }[] = json.projects || json.data || json || []
      const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
      const target = norm(projectName)
      if (!target) return
      const matches = existing
        .map(p => p.project_name)
        .filter(name => {
          const n = norm(name || '')
          return n && (n.includes(target) || target.includes(n))
        })
      if (matches.length > 0) {
        console.warn('⚠️ Possible duplicate projects:', matches)
        setDuplicateNames([...new Set(matches)])
      }
    } catch (err) {
      console.warn('Duplicate check failed (non-fatal):', err)
    }
  }

  // ⭐ 客户端实时计算提交就绪状态（随表单编辑更新，规则与后端一致）
  const computeClientReadiness = (): ClientReadiness => {
    const missingProjectFields: string[] = []
    if (!formData.projectName) missingProjectFields.push(t('readiness.fieldName'))
    if (!formData.developer) missingProjectFields.push(t('readiness.fieldDeveloper'))
    if (!formData.address) missingProjectFields.push(t('readiness.fieldAddress'))
    if (!formData.area) missingProjectFields.push(t('readiness.fieldArea'))

    const blockedUnits: { name: string; issues: string[] }[] = []
    const warningUnits: { name: string; issues: string[] }[] = []
    for (const u of formData.unitTypes) {
      const blockers: string[] = []
      const warnings: string[] = []
      if (!u.area || u.area <= 0) blockers.push(t('readiness.issueArea'))
      if (u.bedrooms == null) blockers.push(t('readiness.issueBedrooms'))
      if (!u.price) warnings.push(t('readiness.issuePrice'))
      if (!u.floorPlanImage && (!u.floorPlanImages || u.floorPlanImages.length === 0)) {
        warnings.push(t('readiness.issueFloorPlan'))
      }
      const name = u.name || u.typeName || 'Unknown'
      if (blockers.length > 0) blockedUnits.push({ name, issues: blockers })
      else if (warnings.length > 0) warningUnits.push({ name, issues: warnings })
    }

    return {
      missingProjectFields,
      blockedUnits,
      warningUnits,
      unitsCount: formData.unitTypes.length,
      submittable: missingProjectFields.length === 0
        && formData.unitTypes.length > 0
        && blockedUnits.length === 0,
    }
  }

  // 表单提交 → 打开 review dialog（替代 window.confirm）
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isProcessing || isSubmitting) {
      console.log('⚠️ Still processing, blocking submit')
      return
    }
    setShowReviewDialog(true)
  }

  // Dialog 确认后真正提交
  const doSubmit = async () => {
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

      // Filter out hidden images before submitting
      const visibleProjectImages = (formData.projectImages || []).filter(
        img => !(formData.hiddenProjectImages || []).includes(img)
      )
      const visibleFloorPlanImages = (formData.floorPlanImages || []).filter(
        img => !(formData.hiddenFloorPlanImages || []).includes(img)
      )

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
        status: formData.status || 'upcoming',
        projectImages: visibleProjectImages,
        floorPlanImages: visibleFloorPlanImages,
        primaryImage: formData.primaryImage || null,
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
          parkingSpaces: unit.parkingSpaces,  // ⭐ 车位配比
        })),
        paymentPlan: formData.paymentPlan || [],
        serviceCharge: formData.serviceCharge ?? null,   // ⭐ 服务费
        landmarks: formData.landmarks || [],             // ⭐ 地标距离
      }

      console.log('📤 Submitting project:', submitData)

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
      
      setShowReviewDialog(false)
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
    <div className="flex-1 bg-white overflow-auto">
      {/* Page Title Section */}
      <div className="bg-gradient-to-br from-teal-50 via-emerald-50 to-teal-100 border-b border-teal-200">
        <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 shadow-xl">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
                <p className="text-sm text-gray-700 mt-1">
                  {t('subtitle')}
                </p>
              </div>
            </div>
            
            {/* Process Flow Indicator — 高亮当前所处步骤 */}
            {(() => {
              const currentStep = submitted ? 4 : (isProcessing || isUploading) ? 2 : hasStarted ? 3 : 1
              const steps = [t('steps.upload'), t('steps.extract'), t('steps.review'), t('steps.submit')]
              return (
                <div className="flex items-center gap-2 text-sm mt-6 overflow-x-auto pb-1 -mx-1 px-1">
                  {steps.map((label, i) => {
                    const n = i + 1
                    const state = n < currentStep ? 'done' : n === currentStep ? 'active' : 'todo'
                    return (
                      <div key={label} className="flex items-center gap-2 shrink-0">
                        {i > 0 && <div className={`h-px w-6 ${n <= currentStep ? 'bg-teal-400' : 'bg-gray-300'}`} />}
                        <div className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition-all ${
                          state === 'active'
                            ? 'bg-teal-600 border-teal-600 text-white shadow-md'
                            : state === 'done'
                              ? 'bg-white border-teal-300 text-teal-700'
                              : 'bg-white/60 border-gray-200 text-gray-400'
                        }`}>
                          {state === 'done' ? (
                            <CheckCircle className="h-3.5 w-3.5" />
                          ) : (
                            <span className={`flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-bold ${
                              state === 'active' ? 'bg-white/25' : 'bg-gray-200 text-gray-500'
                            }`}>{n}</span>
                          )}
                          <span className="font-medium">{label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="max-w-7xl mx-auto">
          {submitted ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <Card className="text-center py-16 shadow-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
                <CardContent>
                  <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
                  <h2 className="text-3xl font-bold mb-2 text-gray-900">{t('success.title')}</h2>
                  <p className="text-gray-600">{t('success.redirecting')}</p>
                  <Loader2 className="h-6 w-6 mx-auto mt-4 animate-spin text-teal-600" />
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
                  jobId={currentJobId}
                  liveData={{
                    // 缩略图变体，省流量；chunk 完成即流入
                    images: (formData.projectImages || []).map(u => u.replace(/_(large|medium)\.jpg/, '_thumbnail.jpg')),
                    unitsCount: formData.unitTypes.length,
                    amenitiesCount: formData.amenities.length,
                  }}
                  onCancelled={() => {
                    setIsProcessing(false)
                    setIsUploading(false)
                    setError('Task cancelled')
                    if (eventSourceRef.current) {
                      eventSourceRef.current.close()
                    }
                  }}
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
                      <CardContent className="pt-6 px-4 sm:px-8">
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
                                status: formData.status,
                              }}
                              isProcessing={isProcessing}
                              onChange={handleFormChange}
                            />
                          </div>

                          {/* Visual Content - Project images only, floor plans are in unit types */}
                          <VisualContentSection
                            projectImages={formData.projectImages}
                            hiddenProjectImages={formData.hiddenProjectImages}
                            visualContent={formData.visualContent}
                            isProcessing={isProcessing}
                            primaryImage={formData.primaryImage}
                            onPrimaryImageChange={(img) => handleFormChange('primaryImage', img)}
                            onProjectImagesChange={(imgs) => handleFormChange('projectImages', imgs)}
                            onHiddenProjectImagesChange={(hidden) => handleFormChange('hiddenProjectImages', hidden)}
                          />

                          {/* Unit Types - Grouped by Tower/Building */}
                          <div className="space-y-4 pt-6 border-t-2 border-gray-100">
                            <div className="flex items-center gap-3 mb-4">
                              <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
                              <div>
                                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                  {t('unitTypesList')}
                                </h3>
                                <p className="text-sm text-gray-600">
                                  {t('totalUnitTypes', { count: formData.unitTypes.length })}
                                </p>
                              </div>
                            </div>

                            {isProcessing && formData.unitTypes.length === 0 && (
                              <div className="text-center py-16 bg-gradient-to-br from-teal-50 to-emerald-50 rounded-xl border-2 border-dashed border-teal-300 shadow-inner">
                                <Loader2 className="h-12 w-12 mx-auto mb-4 animate-spin text-teal-600" />
                                <p className="text-base text-gray-700 font-semibold">{t('aiAnalyzing')}</p>
                                <p className="text-sm text-gray-500 mt-2">{t('extractingUnitTypes')}</p>
                              </div>
                            )}

                            {/* ⭐ 0户型空态：营销画册引导（处理完成但没有提取到任何户型） */}
                            {!isProcessing && !isUploading && hasStarted && formData.unitTypes.length === 0 && serverReadiness && (
                              <div className="py-10 px-8 bg-amber-50 rounded-xl border-2 border-amber-300 shadow-inner text-center">
                                <div className="text-4xl mb-3">📖</div>
                                <h4 className="text-lg font-bold text-amber-900 mb-2">{t('readiness.noUnits.title')}</h4>
                                <p className="text-sm text-amber-800 max-w-xl mx-auto">
                                  {serverReadiness.message || t('readiness.noUnits.desc')}
                                </p>
                                <p className="text-xs text-amber-700 mt-3">{t('readiness.noUnits.hint')}</p>
                              </div>
                            )}

                            {/* Grouped Units */}
                            {Object.entries(groupedUnits).map(([groupKey, units]) => {
                              const isUncategorized = groupKey === 'Uncategorized';
                              return (
                                <div key={groupKey} className="space-y-4">
                                  {/* Only show group header for categorized units */}
                                  {!isUncategorized && (
                                    <div className="px-5 py-4 rounded-xl shadow-md border-l-4 bg-gradient-to-r from-blue-50 via-blue-50 to-indigo-50 border-blue-500">
                                      <div className="flex items-center gap-3">
                                        <span className="text-2xl">🏢</span>
                                        <div>
                                          <div className="font-bold text-blue-900">
                                            {t('series', { key: groupKey })}
                                          </div>
                                          <div className="text-sm text-gray-600 mt-0.5">
                                            {t('unitTypeCount', { count: units.length })}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  <div className={`space-y-3 ${!isUncategorized ? 'pl-4' : ''}`}>
                                    {units.map((unit, idx) => (
                                      <UnitTypeCard
                                        key={unit.id}
                                        unit={unit}
                                        index={idx}
                                        isProcessing={isProcessing}
                                        onChange={(field, value) => {
                                          setFormData(prev => {
                                            const globalIdx = prev.unitTypes.findIndex(u => u.id === unit.id);
                                            if (globalIdx === -1) return prev;
                                            const updated = [...prev.unitTypes];
                                            updated[globalIdx] = { ...updated[globalIdx], [field]: value };
                                            return { ...prev, unitTypes: updated };
                                          });
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

                          {/* ⭐ 文本层附加信息：服务费 + 地标距离 */}
                          {(formData.serviceCharge != null || (formData.landmarks && formData.landmarks.length > 0)) && (
                            <div className="space-y-4 pt-6 border-t-2 border-gray-100">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
                                <h3 className="text-lg font-bold text-gray-900">{t('readiness.extraInfoTitle')}</h3>
                              </div>
                              {formData.serviceCharge != null && (
                                <div className="flex items-center gap-3 text-sm">
                                  <span className="font-semibold text-gray-700">{t('readiness.serviceCharge')}:</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={formData.serviceCharge}
                                    onChange={(e) => handleFormChange('serviceCharge', e.target.value ? parseFloat(e.target.value) : undefined)}
                                    disabled={isProcessing}
                                    className="w-28 px-3 py-1.5 border rounded-lg text-sm"
                                  />
                                  <span className="text-gray-500">AED/sqft</span>
                                </div>
                              )}
                              {formData.landmarks && formData.landmarks.length > 0 && (
                                <div>
                                  <div className="text-sm font-semibold text-gray-700 mb-2">{t('readiness.landmarks')}:</div>
                                  <div className="flex flex-wrap gap-2">
                                    {formData.landmarks.map((lm, i) => (
                                      <span key={i} className="inline-flex items-center gap-1 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-900">
                                        📍 {lm.name} · {lm.distanceKm} km
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Payment Plan */}
                          <PaymentPlanSection
                            paymentPlan={formData.paymentPlan}
                            isProcessing={isProcessing}
                          />

                          {/* Extracted Pricing (for verification) */}
                          <ExtractedPricingSection
                            pricing={formData.extractedPricing}
                            isProcessing={isProcessing}
                          />

                          {/* ⭐ 查重提示 */}
                          {!isProcessing && duplicateNames.length > 0 && (
                            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-5 flex items-start gap-3">
                              <span className="text-2xl">⚠️</span>
                              <div>
                                <h4 className="font-bold text-amber-900">{t('readiness.duplicate.title')}</h4>
                                <p className="text-sm text-amber-800 mt-1">
                                  {t('readiness.duplicate.desc', { names: duplicateNames.slice(0, 3).join('、') })}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Review Checklist */}
                          {!isProcessing && formData.unitTypes.length > 0 && (
                            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-5 mt-8">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-1 bg-teal-500 rounded-full"></div>
                                <div>
                                  <h3 className="font-bold text-gray-900 text-lg">
                                    {t('checklist.title')}
                                  </h3>
                                  <p className="text-sm text-gray-500 mt-0.5">
                                    {t('checklist.subtitle')}
                                  </p>
                                </div>
                              </div>
                              
                              {/* Invalid Units Warning */}
                              {(() => {
                                // 与后端提交过滤规则一致：area<=0 或 bedrooms 缺失都会被过滤
                                const invalidUnits = formData.unitTypes.filter(u => !u.area || u.area <= 0 || u.bedrooms == null);
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
                              
                              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                                {(() => {
                                  const basicOk = !!(formData.projectName && formData.developer && formData.area)
                                  const coordOk = !!(formData.latitude && formData.longitude)
                                  const unitsOk = formData.unitTypes.length > 0
                                  const rows = [
                                    {
                                      ok: basicOk,
                                      icon: ClipboardCheck,
                                      title: t('checklist.basicInfo'),
                                      desc: basicOk
                                        ? t('checklist.basicInfoDesc')
                                        : t('readiness.missingFields', {
                                            fields: [
                                              !formData.projectName && t('readiness.fieldName'),
                                              !formData.developer && t('readiness.fieldDeveloper'),
                                              !formData.area && t('readiness.fieldArea'),
                                            ].filter(Boolean).join(', '),
                                          }),
                                    },
                                    {
                                      ok: coordOk,
                                      icon: MapPin,
                                      title: `${t('checklist.mapCoordinates')} ${coordOk ? t('checklist.mapSet') : t('checklist.mapNotSet')}`,
                                      desc: coordOk
                                        ? t('checklist.latLng', { lat: formData.latitude!.toFixed(6), lng: formData.longitude!.toFixed(6) })
                                        : t('checklist.mapSetHint'),
                                    },
                                    {
                                      ok: unitsOk,
                                      icon: LayoutGrid,
                                      title: t('checklist.unitTypes', { count: formData.unitTypes.length }),
                                      desc: t('checklist.unitTypesDesc'),
                                    },
                                  ]
                                  return rows.map(({ ok, icon: Icon, title, desc }) => (
                                    <div key={title} className="flex items-center gap-3 px-4 py-3">
                                      <div className={`flex items-center justify-center h-8 w-8 rounded-lg shrink-0 ${
                                        ok ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                                      }`}>
                                        <Icon className="h-4 w-4" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-gray-900 text-sm">{title}</div>
                                        <div className="text-xs text-gray-500 truncate">{desc}</div>
                                      </div>
                                      {ok ? (
                                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                                      ) : (
                                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                                      )}
                                    </div>
                                  ))
                                })()}
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
        address={formData.address}
      />

      {/* ⭐ Submit Review Dialog（替代 window.confirm） */}
      <SubmitReviewDialog
        open={showReviewDialog}
        onOpenChange={setShowReviewDialog}
        onConfirm={doSubmit}
        isSubmitting={isSubmitting}
        projectName={formData.projectName}
        developer={formData.developer}
        readiness={computeClientReadiness()}
        hasCoordinates={!!(formData.latitude && formData.longitude)}
        duplicateNames={duplicateNames}
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
