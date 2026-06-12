/**
 * Developer Property Upload Page V2 — sectioned review workspace
 *
 * Layout (方案1, 2026-06-12):
 * - Before upload: centered upload card
 * - After processing starts: slim top banner (files + progress + live counts)
 *   + left section nav (status dots, live badges) + single active section panel
 *   + sticky bottom submit bar (readiness chips + reviewed checkbox + submit)
 * - Section contents reuse the existing developer-upload section components
 */

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Loader2, AlertTriangle, FileText, Plus } from 'lucide-react'
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
import { SectionNav, type SectionItem } from '../components/developer-upload/SectionNav'
import { SubmitBar, type ReadinessChip } from '../components/developer-upload/SubmitBar'
import LocationMapPickerModal from '../components/LocationMapPicker'
import { API_ENDPOINTS, API_BASE_URL } from '../lib/config'
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

type SectionId = 'basic' | 'dates' | 'images' | 'units' | 'amenities' | 'payment' | 'pricing'

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
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [showUploadPanel, setShowUploadPanel] = useState(false)

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
    setShowUploadPanel(false)
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

  // ⭐ area 由坐标自动解析（区域是手动维护的图层：坐标落在某区域内就带上，
  // 不在任何区域内则置空——空值是合法状态，不阻塞提交）
  const resolveAreaFromCoords = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/residential-projects/meta/resolve-area?lat=${lat}&lng=${lng}`)
      if (!res.ok) return
      const json = await res.json()
      console.log(`📍 Area resolved from coords: ${json.area ?? '(outside all areas)'}`)
      setFormData(prev => ({ ...prev, area: json.area || '' }))
    } catch (err) {
      console.warn('Area resolve failed (non-fatal):', err)
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
    // area 不是必填：手动维护的图层，坐标在区域外时合法留空

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

  // Dialog 确认后真正提交
  const doSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      // Clean date formats before submitting (convert empty strings to null for backend)
      const cleanedLaunchDate = formData.launchDate || null
      const cleanedCompletionDate = formData.completionDate || null
      const cleanedHandoverDate = formData.handoverDate || null

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

  // ============================================================
  // Workspace derivations (sections, statuses, readiness chips)
  // ============================================================
  const readiness = computeClientReadiness()
  const extracting = isProcessing || isUploading
  const visibleImageCount = (formData.projectImages || []).filter(
    img => !(formData.hiddenProjectImages || []).includes(img)
  ).length
  const paymentTotal = (formData.paymentPlan || []).reduce(
    (sum, m) => sum + (parseFloat(String(m.percentage)) || 0), 0
  )
  const hasExtraInfo = formData.serviceCharge != null || (formData.landmarks?.length || 0) > 0

  const sections: SectionItem[] = [
    {
      id: 'basic',
      label: t('basicInfo.title'),
      status: readiness.missingProjectFields.length > 0
        ? (extracting ? 'loading' : 'error')
        : duplicateNames.length > 0 ? 'warn' : 'ok',
    },
    {
      id: 'dates',
      label: t('dateProgress.title'),
      status: formData.completionDate || formData.handoverDate ? 'ok' : extracting ? 'loading' : 'warn',
    },
    {
      id: 'images',
      label: t('visualContent.title'),
      badge: visibleImageCount,
      status: visibleImageCount > 0 ? 'ok' : extracting ? 'loading' : 'muted',
    },
    {
      id: 'units',
      label: t('unitTypesList'),
      badge: formData.unitTypes.length,
      status: extracting && formData.unitTypes.length === 0
        ? 'loading'
        : readiness.blockedUnits.length > 0 || (!extracting && formData.unitTypes.length === 0)
          ? 'error'
          : readiness.warningUnits.length > 0 ? 'warn' : 'ok',
    },
    {
      id: 'amenities',
      label: t('amenities.title'),
      badge: formData.amenities.length,
      status: formData.amenities.length > 0 ? 'ok' : extracting ? 'loading' : 'muted',
    },
    {
      id: 'payment',
      label: t('paymentPlan.title'),
      status: formData.paymentPlan.length === 0
        ? (extracting ? 'loading' : 'muted')
        : Math.abs(paymentTotal - 100) < 0.01 ? 'ok' : 'warn',
    },
    {
      id: 'pricing',
      label: t('workspace.sectionPricing'),
      badge: formData.extractedPricing?.length || 0,
      status: (formData.extractedPricing?.length || 0) > 0 ? 'ok' : 'muted',
    },
  ]

  const submitChips: ReadinessChip[] = [
    ...readiness.missingProjectFields.map(f => ({ label: f, tone: 'error' as const })),
    {
      label: formData.latitude && formData.longitude ? t('reviewDialog.coordSet') : t('reviewDialog.coordNotSet'),
      tone: formData.latitude && formData.longitude ? 'ok' as const : 'warn' as const,
    },
    readiness.blockedUnits.length > 0
      ? { label: t('readiness.blockedUnits', { count: readiness.blockedUnits.length }), tone: 'error' as const }
      : { label: t('reviewDialog.unitCount', { count: readiness.unitsCount }), tone: readiness.unitsCount > 0 ? 'ok' as const : 'error' as const },
    ...(readiness.warningUnits.length > 0
      ? [{ label: t('readiness.warningUnits', { count: readiness.warningUnits.length }), tone: 'warn' as const }]
      : []),
    ...(duplicateNames.length > 0
      ? [{ label: t('readiness.duplicate.title'), tone: 'warn' as const }]
      : []),
  ]

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'basic':
        return (
          <div className="space-y-5">
            {duplicateNames.length > 0 && !isProcessing && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm">
                  <span className="font-semibold text-amber-900">{t('readiness.duplicate.title')}</span>
                  <p className="text-amber-800 mt-0.5">
                    {t('readiness.duplicate.desc', { names: duplicateNames.slice(0, 3).join('、') })}
                  </p>
                </div>
              </div>
            )}
            <ProjectBasicInfoSection
              formData={formData}
              isProcessing={isProcessing}
              onChange={handleFormChange}
              onOpenMapPicker={() => setShowMapPicker(true)}
            />
            {/* ⭐ 文本层附加信息：服务费 + 地标距离 */}
            {hasExtraInfo && (
              <div className="space-y-3 pt-5 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-gray-700">{t('readiness.extraInfoTitle')}</h4>
                {formData.serviceCharge != null && (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-600">{t('readiness.serviceCharge')}:</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.serviceCharge}
                      onChange={(e) => handleFormChange('serviceCharge', e.target.value ? parseFloat(e.target.value) : undefined)}
                      disabled={isProcessing}
                      className="w-28 px-3 py-1.5 border rounded-lg text-sm"
                    />
                    <span className="text-gray-400">AED/sqft</span>
                  </div>
                )}
                {formData.landmarks && formData.landmarks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {formData.landmarks.map((lm, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-700">
                        📍 {lm.name} · {lm.distanceKm} km
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      case 'dates':
        return (
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
        )
      case 'images':
        return (
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
        )
      case 'units':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">{t('unitTypesList')}</h3>
              <span className="text-sm text-gray-500">{t('totalUnitTypes', { count: formData.unitTypes.length })}</span>
            </div>

            {/* 会被过滤的户型警示（与后端提交规则一致） */}
            {!isProcessing && readiness.blockedUnits.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm">
                <div className="flex items-center gap-2 font-semibold text-red-900 mb-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  {t('workspace.blockedBanner')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {readiness.blockedUnits.map(u => (
                    <span key={u.name} className="px-2 py-0.5 bg-white border border-red-200 rounded text-xs text-red-700">
                      {u.name} — {u.issues.join('、')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {isProcessing && formData.unitTypes.length === 0 && (
              <div className="text-center py-14 bg-teal-50/60 rounded-xl border border-dashed border-teal-200">
                <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-teal-600" />
                <p className="text-sm text-gray-700 font-semibold">{t('aiAnalyzing')}</p>
                <p className="text-xs text-gray-500 mt-1">{t('extractingUnitTypes')}</p>
              </div>
            )}

            {/* ⭐ 0户型空态：营销画册引导（处理完成但没有提取到任何户型） */}
            {!isProcessing && !isUploading && hasStarted && formData.unitTypes.length === 0 && serverReadiness && (
              <div className="py-10 px-8 bg-amber-50 rounded-xl border border-amber-200 text-center">
                <div className="text-3xl mb-2">📖</div>
                <h4 className="text-base font-bold text-amber-900 mb-1.5">{t('readiness.noUnits.title')}</h4>
                <p className="text-sm text-amber-800 max-w-xl mx-auto">
                  {serverReadiness.message || t('readiness.noUnits.desc')}
                </p>
                <p className="text-xs text-amber-700 mt-2">{t('readiness.noUnits.hint')}</p>
              </div>
            )}

            {/* Grouped Units */}
            {Object.entries(groupedUnits).map(([groupKey, units]) => {
              const isUncategorized = groupKey === 'Uncategorized';
              return (
                <div key={groupKey} className="space-y-3">
                  {!isUncategorized && (
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                      <span className="h-5 w-1 bg-teal-400 rounded-full" />
                      {t('series', { key: groupKey })}
                      <span className="text-xs font-normal text-gray-400">{t('unitTypeCount', { count: units.length })}</span>
                    </div>
                  )}
                  <div className="space-y-3">
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
        )
      case 'amenities':
        return (
          <AmenitiesSection
            amenities={formData.amenities}
            isProcessing={isProcessing}
          />
        )
      case 'payment':
        return (
          <PaymentPlanSection
            paymentPlan={formData.paymentPlan}
            isProcessing={isProcessing}
          />
        )
      case 'pricing':
        return (
          <ExtractedPricingSection
            pricing={formData.extractedPricing}
            isProcessing={isProcessing}
          />
        )
    }
  }

  return (
    <div className="flex-1 bg-gray-50 overflow-auto flex flex-col">
      {/* Compact header: title + dynamic stepper on one band */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-500 shadow-md shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-gray-900 truncate">{t('title')}</h1>
                <p className="text-xs text-gray-500 truncate">{t('subtitle')}</p>
              </div>
            </div>
            <div className="flex-1" />
            {/* Stepper — 高亮当前所处步骤 */}
            {(() => {
              const currentStep = submitted ? 4 : (isProcessing || isUploading) ? 2 : hasStarted ? 3 : 1
              const steps = [t('steps.upload'), t('steps.extract'), t('steps.review'), t('steps.submit')]
              return (
                <div className="flex items-center gap-1.5 text-xs overflow-x-auto pb-0.5">
                  {steps.map((label, i) => {
                    const n = i + 1
                    const state = n < currentStep ? 'done' : n === currentStep ? 'active' : 'todo'
                    return (
                      <div key={label} className="flex items-center gap-1.5 shrink-0">
                        {i > 0 && <div className={`h-px w-4 ${n <= currentStep ? 'bg-teal-400' : 'bg-gray-200'}`} />}
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all ${
                          state === 'active'
                            ? 'bg-teal-600 border-teal-600 text-white'
                            : state === 'done'
                              ? 'bg-white border-teal-200 text-teal-700'
                              : 'bg-white border-gray-200 text-gray-400'
                        }`}>
                          {state === 'done'
                            ? <CheckCircle className="h-3 w-3" />
                            : <span className="font-bold">{n}</span>}
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

      {submitted ? (
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-2xl">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="text-center py-14 border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
              <CardContent>
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                <h2 className="text-2xl font-bold mb-2 text-gray-900">{t('success.title')}</h2>
                <p className="text-gray-600">{t('success.redirecting')}</p>
                <Loader2 className="h-5 w-5 mx-auto mt-4 animate-spin text-teal-600" />
              </CardContent>
            </Card>
          </motion.div>
        </div>
      ) : !hasStarted ? (
        /* ============ 上传前：居中上传卡片 ============ */
        <div className="container mx-auto px-4 sm:px-6 py-10 max-w-xl">
          <DocumentUploadSection
            documents={documents}
            isProcessing={isProcessing}
            onAddDocuments={handleAddDocuments}
            onRemoveDocument={handleRemoveDocument}
            onStartProcessing={handleProcessPdfs}
          />
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      ) : (
        /* ============ 工作台：顶部横幅 + 分区导航 + 单区块面板 + 底部提交栏 ============ */
        <>
          <div className="container mx-auto px-4 sm:px-6 pt-4 max-w-7xl w-full">
            {/* Top banner: files + status + progress + live counters */}
            <Card className="border border-gray-200 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {documents.map(doc => (
                    <span key={doc.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 max-w-[260px]">
                      <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                      <span className="truncate font-medium">{doc.file.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">{(doc.file.size / 1024 / 1024).toFixed(1)}MB</span>
                    </span>
                  ))}
                  {/* Status chip */}
                  {isUploading ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('workspace.uploadingChip', { percent: uploadProgress })}
                    </span>
                  ) : isProcessing ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('workspace.processingChip', { percent: progress.toFixed(0) })}
                    </span>
                  ) : error ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                      {t('workspace.errorChip')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                      <CheckCircle className="h-3 w-3" />
                      {t('workspace.doneChip')}
                    </span>
                  )}
                  <div className="flex-1" />
                  {!isProcessing && !isUploading && (
                    <button
                      type="button"
                      onClick={() => setShowUploadPanel(v => !v)}
                      className="inline-flex items-center gap-1 text-sm text-teal-600 hover:text-teal-800 font-medium"
                    >
                      <Plus className="h-4 w-4" />
                      {t('workspace.addFiles')}
                    </button>
                  )}
                </div>

                {/* Re-upload / add-files panel (collapsed by default) */}
                {showUploadPanel && !isProcessing && !isUploading && (
                  <div className="pt-2 border-t border-gray-100">
                    <DocumentUploadSection
                      documents={documents}
                      isProcessing={isProcessing}
                      onAddDocuments={handleAddDocuments}
                      onRemoveDocument={handleRemoveDocument}
                      onStartProcessing={handleProcessPdfs}
                    />
                  </div>
                )}

                {/* Progress + live extraction preview (only while running / on error) */}
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
              </CardContent>
            </Card>
          </div>

          {/* Nav + active section panel */}
          <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl w-full flex-1">
            <div className="flex flex-col md:flex-row gap-4 md:gap-5">
              <SectionNav
                sections={sections}
                activeId={activeSection}
                onSelect={(id) => setActiveSection(id as SectionId)}
              />
              <div className="flex-1 min-w-0">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeSection}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Card className="border border-gray-200 shadow-sm">
                      <CardContent className="p-4 sm:p-6">
                        {renderActiveSection()}
                      </CardContent>
                    </Card>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Sticky bottom submit bar */}
          <SubmitBar
            chips={submitChips}
            hasReviewed={hasReviewed}
            onReviewedChange={setHasReviewed}
            canSubmit={!!formData.projectName}
            isProcessing={isProcessing || isUploading}
            isSubmitting={isSubmitting}
            onSubmit={() => {
              if (!isProcessing && !isSubmitting) setShowReviewDialog(true)
            }}
          />
        </>
      )}

      {/* Location Map Picker Modal */}
      <LocationMapPickerModal
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng) => {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }))
          // ⭐ 坐标变更 → 自动重算区域（可能为空）
          resolveAreaFromCoords(lat, lng)
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
        readiness={readiness}
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
