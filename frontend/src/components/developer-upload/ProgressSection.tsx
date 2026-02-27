import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pause, Play, X, Check, Clock } from 'lucide-react'
import { useTaskStore } from '../../stores/taskStore'

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

interface ProgressSectionProps {
  isProcessing: boolean
  progress: number
  currentStage: string
  progressEvents: ProgressEvent[]
  error: string | null
  isUploading?: boolean
  jobId?: string | null
  onCancelled?: () => void
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
}: ProgressSectionProps) {
  const { t } = useTranslation('upload')
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
                  <span className="text-amber-500 ml-2">
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
                    <span className={isLastItem ? 'text-gray-700' : 'text-gray-500'}>{e.message}</span>
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
