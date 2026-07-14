/**
 * Developer Property Upload Page V2 — sectioned review workspace
 *
 * Page owns: document upload, processing kickoff, SSE live updates,
 * duplicate check and submission. The review/edit workspace itself
 * (section nav, panels, submit bar, dialog) is the shared
 * PropertyWorkspace component, also used by the admin review/edit pages.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { API_ENDPOINTS, API_BASE_URL, USE_DIRECT_UPLOAD } from '../lib/config'
import { uploadFilesToR2 } from '../lib/r2-upload'
import { useAuth } from '../contexts/AuthContext'
import {
  UploadFileMeta,
  readDraft,
  writeDraft,
  clearDraft,
  pruneDrafts,
} from '../lib/upload-draft'

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
  const { session, loading: authLoading } = useAuth()
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
  // 顶部横幅上的文件名/大小。File 对象刷新后拿不回来,所以展示层单独存一份可序列化的元信息。
  const [fileMeta, setFileMeta] = useState<UploadFileMeta[]>([])
  const [restoring, setRestoring] = useState(false)

  const [searchParams, setSearchParams] = useSearchParams()
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

  // ⭐ 订阅一个 job 的进度流。上传后首次连接、以及刷新后重连,走的是同一段代码。
  // worker 模式下 /stream 是轮询 DB 的：任务早已跑完也会立刻补发一条带 buildingData
  // 的 complete 事件 —— 这就是刷新后能把 AI 结果原样拿回来的原因。
  const connectStream = useCallback((jobId: string) => {
    eventSourceRef.current?.close()

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

    eventSource.onerror = (err) => {
      console.error('❌ SSE error:', err)
      if (eventSource.readyState === EventSource.CLOSED) {
        setError('Connection closed unexpectedly. Please try again.')
        setIsProcessing(false)
        setIsUploading(false)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  // Process all documents
  const handleProcessPdfs = async () => {
    if (documents.length === 0) return

    setHasStarted(true)
    setFileMeta(documents.map(d => ({ name: d.file.name, size: d.file.size })))
    setShowUploadPanel(false)
    setIsUploading(true)
    setUploadProgress(0)
    setProgress(0)
    setCurrentStage(t('processing.uploading'))
    setProgressEvents([])
    setError(null)

    try {
      // Auth headers shared by both upload paths
      const authHeaders: Record<string, string> = {}
      if (session?.access_token) authHeaders['Authorization'] = `Bearer ${session.access_token}`
      if (session?.user?.id) authHeaders['x-user-id'] = session.user.id
      if (session?.user?.email) authHeaders['x-user-email'] = session.user.email

      let data: any

      if (USE_DIRECT_UPLOAD) {
        // ⭐ Direct-to-R2 chunked upload with per-part retry (fixes Dubai drops)
        console.log('📤 Direct-to-R2 chunked upload...')
        const result = await uploadFilesToR2(documents.map(doc => doc.file), {
          headers: authHeaders,
          onProgress: (percent) => {
            setUploadProgress(percent)
            setCurrentStage(t('processing.uploadingPercent', { percent }))
          },
        })
        setIsUploading(false)
        setCurrentStage(t('processing.uploadComplete'))
        data = { success: true, jobId: result.jobId }
      } else {
        // Legacy single-request upload (local dev / fallback)
        const formDataToSend = new FormData()
        documents.forEach(doc => {
          formDataToSend.append('files', doc.file)
        })

        console.log('📤 Sending files to backend...')

        // Use XMLHttpRequest to track upload progress
        data = await new Promise<any>((resolve, reject) => {
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
              // 把后端的友好提示(如"需订阅"402)透出来,而不是裸状态码
              let msg = `Upload failed: ${xhr.status}`
              try { const r = JSON.parse(xhr.responseText); if (r?.error) msg = r.error } catch { /* keep default */ }
              reject(new Error(msg))
            }
          })

          xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'))
          })

          xhr.open('POST', API_ENDPOINTS.langgraphProgressStart)
          Object.entries(authHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v))
          xhr.send(formDataToSend)
        })
      }

      console.log('✅ Backend response:', data)

      if (!data.success) {
        throw new Error(data.error || 'Failed to start processing')
      }

      const jobId = data.jobId
      setCurrentJobId(jobId)
      console.log(`🆔 Job ID received: ${jobId}`)

      // ⭐ 任务一落地就把 jobId 钉进 URL —— 从这一刻起,刷新/误关标签页都能原样回到这个任务
      setSearchParams({ job: jobId }, { replace: true })

      setIsProcessing(true)
      setCurrentStage(t('processing.connecting'))
      connectStream(jobId)

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

      // 提交成功 = 这次上传的生命周期结束,草稿和 URL 上的 job 都该收走,
      // 否则回到 /developer/upload 还会被"恢复"进一个已经提交过的任务。
      if (currentJobId) clearDraft(currentJobId)
      setSearchParams({}, { replace: true })

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

  // ⭐ 刷新 / 误关标签页后的恢复：URL 上的 ?job= 就是这次上传的身份证。
  // 草稿(本地)负责文件名和经纪手改过的字段;任务状态和 AI 结果以后端为准。
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || authLoading) return
    const jobId = searchParams.get('job')
    if (!jobId) return
    restoredRef.current = true

    pruneDrafts()
    setHasStarted(true)
    setCurrentJobId(jobId)
    setRestoring(true)

    const draft = readDraft(jobId)
    if (draft) {
      setFileMeta(draft.fileMeta || [])
      setFormData(draft.formData)
      setServerReadiness((draft.serverReadiness as ServerReadiness) ?? null)
      setDuplicateNames(draft.duplicateNames || [])
    }

    ;(async () => {
      let status: string | undefined
      try {
        const headers: Record<string, string> = {}
        if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
        if (session?.user?.id) headers['x-user-id'] = session.user.id
        if (session?.user?.email) headers['x-user-email'] = session.user.email

        const res = await fetch(API_ENDPOINTS.task(jobId), { headers })
        if (res.status === 404) {
          // 任务不存在(过期/被删)——别把人晾在一个永远不会有数据的空工作台里
          clearDraft(jobId)
          setSearchParams({}, { replace: true })
          setHasStarted(false)
          setCurrentJobId(null)
          setRestoring(false)
          return
        }
        if (res.ok) {
          const task = (await res.json())?.task
          status = task?.status
          const names: string[] = task?.pdf_names || []
          if (!draft?.fileMeta?.length && names.length) {
            setFileMeta(names.map((name: string) => ({ name, size: 0 })))
          }
        }
      } catch {
        /* 后端问不到就退回草稿 + SSE */
      }

      // 已出结果且本地有完整草稿 → 直接用草稿。绝不重连 SSE:
      // 完成事件会把 buildingData 灌回表单,那会覆盖经纪刷新前手改过的字段。
      if (draft?.status === 'done' && (status === 'completed' || !status)) {
        setCurrentStage(t('processing.extractionComplete'))
        setRestoring(false)
        return
      }

      if (status === 'failed' || status === 'cancelled') {
        setError(t('processing.taskFailed'))
        setRestoring(false)
        return
      }

      // 还在跑(或跑完但本地没草稿)→ 重连进度流。worker 模式下 /stream 轮询 DB,
      // 任务已完成会立刻补发带 buildingData 的 complete 事件,结果一样拿得回来。
      setIsProcessing(true)
      setCurrentStage(t('processing.reconnecting'))
      connectStream(jobId)
      setRestoring(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading])

  // ⭐ 草稿落盘(含审核工作台里的手动编辑)。防抖,别每敲一个字都写 localStorage。
  useEffect(() => {
    if (!currentJobId || submitted || restoring) return
    const timer = setTimeout(() => {
      writeDraft({
        jobId: currentJobId,
        status: isProcessing || isUploading ? 'running' : 'done',
        fileMeta,
        formData,
        serverReadiness,
        duplicateNames,
      })
    }, 600)
    return () => clearTimeout(timer)
  }, [currentJobId, formData, fileMeta, serverReadiness, duplicateNames, isProcessing, isUploading, submitted, restoring])

  // 上传中是唯一救不回来的窗口:文件还在浏览器里,jobId 也还没落库。这时才拦。
  useEffect(() => {
    if (!isUploading) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isUploading])

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
                  {fileMeta.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 max-w-[260px]">
                      <FileText className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                      <span className="truncate font-medium">{f.name}</span>
                      {f.size > 0 && (
                        <span className="text-xs text-gray-400 shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                      )}
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
