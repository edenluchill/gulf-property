import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { ComparisonItem, ComparisonPropertyData, ComparisonReport, UserProfile } from '../../types/comparison'

interface AIAnalysisPanelProps {
  items: ComparisonItem[]
  properties: ComparisonPropertyData[]
  profile: UserProfile
  onComplete: (report: ComparisonReport) => void
}

type AnalysisStep = 'gathering' | 'analyzing' | 'comparing' | 'generating' | 'complete' | 'error'

export function AIAnalysisPanel({
  items,
  properties,
  profile,
  onComplete,
}: AIAnalysisPanelProps) {
  const { t } = useTranslation('favorites')

  const [currentStep, setCurrentStep] = useState<AnalysisStep>('gathering')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()} - ${message}`])
  }

  useEffect(() => {
    const runAnalysis = async () => {
      try {
        // Step 1: Gathering data
        setCurrentStep('gathering')
        addLog(t('compare.steps.gathering'))
        setProgress(10)
        await new Promise(r => setTimeout(r, 500))

        // Step 2: Analyzing
        setCurrentStep('analyzing')
        addLog(t('compare.steps.analyzing'))
        setProgress(30)
        await new Promise(r => setTimeout(r, 300))

        // Step 3: Comparing
        setCurrentStep('comparing')
        addLog(t('compare.steps.comparing'))
        setProgress(50)

        // Call API
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
        const response = await fetch(`${apiUrl}/api/compare/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            items,
            properties,
            profile,
          }),
        })

        setProgress(70)

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Analysis failed')
        }

        // Step 4: Generating report
        setCurrentStep('generating')
        addLog(t('compare.steps.generating'))
        setProgress(90)

        const data = await response.json()

        if (!data.success || !data.report) {
          throw new Error(data.error || 'Invalid response')
        }

        // Complete
        setProgress(100)
        setCurrentStep('complete')
        addLog('Analysis complete!')

        await new Promise(r => setTimeout(r, 500))
        onComplete(data.report)
      } catch (err) {
        console.error('Analysis error:', err)
        setCurrentStep('error')
        setError(err instanceof Error ? err.message : 'An error occurred')
        addLog(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    runAnalysis()
  }, [items, properties, profile, onComplete, t])

  const steps: { key: AnalysisStep; label: string }[] = [
    { key: 'gathering', label: t('compare.steps.gathering') },
    { key: 'analyzing', label: t('compare.steps.analyzing') },
    { key: 'comparing', label: t('compare.steps.comparing') },
    { key: 'generating', label: t('compare.steps.generating') },
  ]

  const getStepStatus = (stepKey: AnalysisStep) => {
    const stepOrder = ['gathering', 'analyzing', 'comparing', 'generating']
    const currentIdx = stepOrder.indexOf(currentStep)
    const stepIdx = stepOrder.indexOf(stepKey)

    if (currentStep === 'complete') return 'complete'
    if (currentStep === 'error') {
      return stepIdx <= currentIdx ? 'error' : 'pending'
    }
    if (stepIdx < currentIdx) return 'complete'
    if (stepIdx === currentIdx) return 'active'
    return 'pending'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        {currentStep !== 'error' && currentStep !== 'complete' && (
          <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
        )}
        {currentStep === 'complete' && (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        )}
        {currentStep === 'error' && (
          <AlertCircle className="h-5 w-5 text-red-500" />
        )}
        <span className="font-medium text-slate-800">
          {currentStep === 'error'
            ? 'Analysis failed'
            : currentStep === 'complete'
            ? 'Analysis complete!'
            : t('compare.analyzing')}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              currentStep === 'error'
                ? 'bg-red-500'
                : 'bg-gradient-to-r from-teal-500 to-emerald-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>{progress}%</span>
          <span>{currentStep === 'error' ? 'Error' : 'Processing...'}</span>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step) => {
          const status = getStepStatus(step.key)
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                status === 'active'
                  ? 'bg-teal-50 border border-teal-200'
                  : status === 'complete'
                  ? 'bg-emerald-50 border border-emerald-200'
                  : status === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-slate-50 border border-transparent'
              }`}
            >
              {status === 'active' && (
                <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
              )}
              {status === 'complete' && (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
              {status === 'error' && (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
              {status === 'pending' && (
                <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
              )}
              <span
                className={`text-sm ${
                  status === 'active'
                    ? 'text-teal-700 font-medium'
                    : status === 'complete'
                    ? 'text-emerald-700'
                    : status === 'error'
                    ? 'text-red-700'
                    : 'text-slate-500'
                }`}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Logs */}
      <div className="bg-slate-900 rounded-lg p-4 max-h-32 overflow-y-auto">
        <div className="space-y-1 font-mono text-xs">
          {logs.map((log, i) => (
            <div key={i} className="text-slate-400">
              {log}
            </div>
          ))}
          {currentStep !== 'error' && currentStep !== 'complete' && (
            <div className="text-teal-400 animate-pulse">Processing...</div>
          )}
        </div>
      </div>
    </div>
  )
}
