import { Loader2 } from 'lucide-react'

interface ProgressEvent {
  stage: string
  message: string
  progress: number
  data?: any
  timestamp: number
}

interface ProgressSectionProps {
  isProcessing: boolean
  progress: number
  currentStage: string
  progressEvents: ProgressEvent[]
  error: string | null
}

export function ProgressSection({
  isProcessing,
  progress,
  currentStage,
  progressEvents,
  error
}: ProgressSectionProps) {
  if (!isProcessing && !error && progress < 100) return null

  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700 font-medium">{currentStage}</span>
            <span className="text-amber-600 font-bold">{progress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden shadow-inner">
            <div
              className="bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 h-3 rounded-full transition-all duration-300 ease-out relative overflow-hidden"
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
          <div className="text-xs text-gray-600 max-h-32 overflow-y-auto space-y-1 bg-gray-50 rounded p-3 border">
            {progressEvents.slice(-5).map((e, i) => (
              <div key={i} className="flex items-start gap-2">
                <Loader2 className="h-3 w-3 mt-0.5 flex-shrink-0 animate-spin text-amber-600" />
                <span>{e.message}</span>
              </div>
            ))}
          </div>
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
          <span className="font-medium">提取完成！请检查并编辑下方表单</span>
        </div>
      )}
    </div>
  )
}
