/**
 * Developer Property Upload Page V2 — sectioned review workspace
 *
 * Page owns: document upload, processing kickoff, SSE live updates,
 * duplicate check and submission. The review/edit workspace itself
 * (section nav, panels, submit bar, dialog) is the shared
 * PropertyWorkspace component, also used by the admin review/edit pages.
 */

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { Card, CardContent } from '../components/ui/card'
import { Building2, CheckCircle, Loader2, FileText, Plus } from 'lucide-react'
import { DocumentUploadSection } from '../components/developer-upload/DocumentUploadSection'
import { ProgressSection } from '../components/developer-upload/ProgressSection'
import { PropertyWorkspace } from '../components/property-workspace/PropertyWorkspace'
import {
  PropertyFormData,
  initialFormData,
  buildSubmitPayload,
} from '../components/property-editor/types'
import { API_ENDPOINTS, API_BASE_URL } from '../lib/config'
import { useAuth } from '../contexts/AuthContext'

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
  const [hasReviewed, setHasReviewed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [serverReadiness, setServerReadiness] = useState<ServerReadiness | null>(null)
  const [duplicateNames, setDuplicateNames] = useState<string[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)

  const eventSourceRef = useRef<EventSource | null>(null)

  const [formData, setFormData] = useState<PropertyFormData>(initialFormData)

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

    const validDatePattern = /^\d{4}-\d{2}-\d{2}$/
    if (validDatePattern.test(dateStr)) {
      return dateStr
    }

    // Incomplete date (e.g., "2030-06" or "2030-Q4") — clear it
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

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(percentComplete)
            setCurrentStage(t('processing.uploadingPercent', { percent: percentComplete }))
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

      const eventSource = new EventSource(API_ENDPOINTS.langgraphProgressStream(jobId))
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setCurrentStage(t('processing.startProcessing'))
      }

      eventSource.onmessage = (event) => {
        const progressEvent: ProgressEvent = JSON.parse(event.data)

        setProgressEvents(prev => [...prev, progressEvent])
        setProgress(progressEvent.progress)
        setCurrentStage(progressEvent.message)

        if (progressEvent.data?.buildingData) {
          const { buildingData } = progressEvent.data

          setFormData(prev => {
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
        if (eventSource.readyState === EventSource.CLOSED) {
          setError('Connection closed unexpectedly. Please try again.')
          setIsProcessing(false)
          setIsUploading(false)
        }
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process PDFs')
      setIsProcessing(false)
      setIsUploading(false)
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

  // Dialog 确认后真正提交
  const doSubmit = async () => {
    setIsSubmitting(true)
    setError(null)

    try {
      const submitData = buildSubmitPayload(formData)
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

      alert(t('confirm.successAlert'))

      setSubmitted(true)
      setTimeout(() => { window.location.href = '/map' }, 2000)
    } catch (err) {
      console.error('❌ Submit error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit'
      setError(errorMessage)
      alert(t('confirm.failAlert', { error: errorMessage }))
      setIsSubmitting(false)
      throw err
    }
  }

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  const processingDone = hasStarted && !isProcessing && !isUploading

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
        /* ============ 工作台：顶部横幅 + 共享 PropertyWorkspace ============ */
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
                    images: (formData.projectImages || []).map(u => u.replace(/_(original|large|medium)\.jpg/, '_thumbnail.jpg')),
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

          <PropertyWorkspace
            formData={formData}
            setFormData={setFormData}
            isProcessing={isProcessing || isUploading}
            isSubmitting={isSubmitting}
            hasReviewed={hasReviewed}
            setHasReviewed={setHasReviewed}
            onConfirmSubmit={doSubmit}
            duplicateNames={duplicateNames}
            emptyUnitsMessage={
              processingDone && formData.unitTypes.length === 0
                ? (serverReadiness?.message || t('readiness.noUnits.desc'))
                : undefined
            }
          />
        </>
      )}
    </div>
  )
}
