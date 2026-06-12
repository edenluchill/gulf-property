/**
 * Sticky bottom submit bar — readiness summary chips, the reviewed checkbox
 * and the submit button stay visible no matter which section is open.
 */
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { CheckCircle, Loader2 } from 'lucide-react'

export interface ReadinessChip {
  label: string
  tone: 'ok' | 'warn' | 'error'
}

interface SubmitBarProps {
  chips: ReadinessChip[]
  hasReviewed: boolean
  onReviewedChange: (value: boolean) => void
  canSubmit: boolean
  isProcessing: boolean
  isSubmitting: boolean
  onSubmit: () => void
}

const TONE_CLASSES: Record<ReadinessChip['tone'], string> = {
  ok: 'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  error: 'bg-red-50 text-red-700 border-red-200',
}

export function SubmitBar({
  chips,
  hasReviewed,
  onReviewedChange,
  canSubmit,
  isProcessing,
  isSubmitting,
  onSubmit,
}: SubmitBarProps) {
  const { t } = useTranslation('upload')

  return (
    <div className="sticky bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="container mx-auto px-4 sm:px-6 py-3 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Readiness chips */}
          <div className="flex-1 flex flex-wrap items-center gap-1.5 min-w-0">
            {chips.map((chip, i) => (
              <span
                key={i}
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${TONE_CLASSES[chip.tone]}`}
              >
                {chip.label}
              </span>
            ))}
          </div>

          {/* Reviewed checkbox + submit */}
          <div className="flex items-center gap-4 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasReviewed}
                onChange={(e) => onReviewedChange(e.target.checked)}
                disabled={isProcessing}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
              />
              <span className="text-sm text-gray-700 font-medium whitespace-nowrap">
                {t('checklist.confirmReview')}
              </span>
            </label>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || isProcessing || isSubmitting || !hasReviewed}
              className="bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 shadow-md px-6"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('submitBtn.submitting')}
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  {t('submitBtn.confirmed')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
