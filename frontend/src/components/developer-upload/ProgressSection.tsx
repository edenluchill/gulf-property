import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pause, Play, X, Check, Clock, Image as ImageIcon, Home, Sparkles } from 'lucide-react'
import { useTaskStore } from '../../stores/taskStore'

export interface LiveExtractionData {
  images: string[]        // 已提取的图片 URL（流式增长）
  unitsCount: number      // 已发现的户型数
  amenitiesCount: number  // 已发现的配套数
}

interface ProgressEvent {
  stage: string
  code?: string
  message: string
  progress: number
  data?: {
    queuePosition?: number
    processing?: number
    maxConcurrent?: number
    [key: string]: any
  }
  timestamp: number
}

/**
 * 后端的 `message` 是**英文**(`'Checking PDF cache...'`),以前直接渲染 → 上传页
 * 其余部分都翻好了,唯独进度条一路英文。后端同时发结构化的 `code` + `data`,
 * 认 code 查 `upload:progress.<code>` 才对。
 *
 * ⚠️ **必须留 `e.message` 兜底**:后端随时可能加新 code(现有 11 个里就有 3 个
 * 是老的 progress-i18n 表从没跟上的),没配译文时显示英文原文,
 * 总好过显示 `PROCESSING_STARTED` 这种裸 code 或一片空白。
 */
function progressText(t: (k: string, o?: Record<string, unknown>) => string, e: ProgressEvent): string {
  if (!e.code) return e.message
  const key = `progress.${e.code}`
  const s = t(key, { ...(e.data || {}), defaultValue: '' })
  return s || e.message
}

interface ProgressSectionProps {
  isProcessing: boolean
  progress: number
  currentStage: string
  progressEvents: ProgressEvent[]
  error: string | null
  isUploading?: boolean
  jobId?: string | null
  onCancelled?: () => void
  liveData?: LiveExtractionData  // ⭐ 实时提取数据（每个 chunk 完成即更新）
}

export function ProgressSection({
  isProcessing,
  progress,
  currentStage,
  progressEvents,
  error,
  isUploading = false,
  jobId = null,
  onCancelled,
  liveData,
}: ProgressSectionProps) {
  const { t } = useTranslation('upload')
  // progress.<CODE> 是运行时拼的 → 必须 cast
  const tk = t as (k: string, o?: Record<string, unknown>) => string
  const [isPausing, setIsPausing] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)

  const pauseTask = useTaskStore((state: any) => state.pauseTask)
  const resumeTask = useTaskStore((state: any) => state.resumeTask)
  const cancelTask = useTaskStore((state: any) => state.cancelTask)
  const task = useTaskStore((state: any) => jobId ? state.getTask(jobId) : undefined)

  const isPaused = task?.status === 'paused'
  const isQueued = task?.status === 'queued' || currentStage === 'queued'

  // Get queue position from latest event
  const queueInfo = progressEvents.find(e => e.stage === 'queued')?.data

  const handlePause = async () => {
    if (!jobId) return
    setIsPausing(true)
    try {
      await pauseTask(jobId)
    } catch (err) {
      console.error('Failed to pause task:', err)
    } finally {
      setIsPausing(false)
    }
  }

  const handleResume = async () => {
    if (!jobId) return
    setIsPausing(true)
    try {
      await resumeTask(jobId)
    } catch (err) {
      console.error('Failed to resume task:', err)
    } finally {
      setIsPausing(false)
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    if (!confirm('Are you sure you want to cancel this task?')) return

    setIsCancelling(true)
    try {
      await cancelTask(jobId)
      onCancelled?.()
    } catch (err) {
      console.error('Failed to cancel task:', err)
    } finally {
      setIsCancelling(false)
    }
  }

  if (!isProcessing && !error && progress < 100) return null

  return (
    <div className="space-y-3">
      {/* Queue Status Banner */}
      {isQueued && queueInfo && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <Clock className="h-6 w-6 text-amber-500 animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="font-medium">排队等待中...</p>
              <p className="text-amber-600 mt-1">
                前面还有 <span className="font-bold">{queueInfo.queuePosition}</span> 个任务
                {queueInfo.processing !== undefined && (
                  <span className="text-amber-500 ms-2">
                    (正在处理 {queueInfo.processing}/{queueInfo.maxConcurrent})
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {(isProcessing || isPaused) && !isQueued && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700 font-medium">
              {isPaused ? (
                <span className="inline-flex items-center gap-1 text-orange-600">
                  <Pause className="h-3 w-3" />
                  Paused
                </span>
              ) : isUploading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {currentStage}
                </span>
              ) : (
                currentStage
              )}
            </span>
            <span className="text-teal-600 font-bold">{progress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
            <div
              className={`h-3 rounded-full transition-all duration-300 ease-out relative overflow-hidden ${
                isUploading 
                  ? 'bg-gradient-to-r from-blue-500 via-blue-600 to-cyan-600' 
                  : 'bg-gradient-to-r from-teal-500 via-teal-600 to-emerald-600'
              }`}
              style={{ width: `${progress}%` }}
            >
              {/* Shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" 
                   style={{ 
                     backgroundSize: '200% 100%',
                     animation: 'shimmer 2s infinite'
                   }} 
              />
            </div>
          </div>
          {/* ⭐ Live Extraction Preview — chunks stream results as they finish */}
          {!isUploading && liveData && (liveData.images.length > 0 || liveData.unitsCount > 0) && (
            <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2.5 shadow-sm">
              <div className="flex items-center gap-4 text-xs font-medium text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5 text-teal-600" />
                  <span className="tabular-nums font-semibold text-gray-900">{liveData.images.length}</span>
                  {t('live.images')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Home className="h-3.5 w-3.5 text-teal-600" />
                  <span className="tabular-nums font-semibold text-gray-900">{liveData.unitsCount}</span>
                  {t('live.units')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-teal-600" />
                  <span className="tabular-nums font-semibold text-gray-900">{liveData.amenitiesCount}</span>
                  {t('live.amenities')}
                </span>
              </div>
              {liveData.images.length > 0 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {liveData.images.slice(-8).map((url, i) => (
                    <div key={url} className="aspect-video rounded-md overflow-hidden bg-gray-100 ring-1 ring-gray-200">
                      <img
                        src={url}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover animate-in fade-in duration-500"
                        style={{ animationDelay: `${i * 40}ms` }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent Events */}
          {!isUploading && progressEvents.length > 0 && (
            <div className="text-xs text-gray-600 max-h-32 overflow-y-auto space-y-1 bg-gray-50 rounded p-3 border">
              {progressEvents.slice(-5).map((e, i, arr) => {
                // Last item is still in progress, others are completed
                const isLastItem = i === arr.length - 1
                return (
                  <div key={i} className="flex items-start gap-2">
                    {isLastItem ? (
                      <Loader2 className="h-3 w-3 mt-0.5 flex-shrink-0 animate-spin text-teal-600" />
                    ) : (
                      <Check className="h-3 w-3 mt-0.5 flex-shrink-0 text-green-600" />
                    )}
                    <span className={isLastItem ? 'text-gray-700' : 'text-gray-500'}>{progressText(tk, e)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pause/Cancel Controls */}
          {jobId && !isUploading && (
            <div className="flex items-center gap-2 pt-2">
              {isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  disabled={isPausing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPausing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePause}
                  disabled={isPausing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isPausing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                  Pause
                </button>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={isCancelling}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700 flex items-start gap-2">
          <span className="text-lg">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Success Message */}
      {!isProcessing && progress === 100 && !error && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 flex items-start gap-2">
          <span className="text-lg">✅</span>
          <span className="font-medium">{t('processing.extractComplete')}</span>
        </div>
      )}
    </div>
  )
}
