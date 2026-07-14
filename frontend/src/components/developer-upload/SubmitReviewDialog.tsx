/**
 * Submit Review Dialog
 *
 * Replaces window.confirm with a structured pre-submit review:
 * - project field completeness
 * - units that would be FILTERED at submission (blockers)
 * - incomplete-but-submittable units (warnings)
 * - possible duplicate projects already in the database
 */
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Button } from '../ui/button'
import { CheckCircle, AlertTriangle, XCircle, Loader2, MapPin, Tag } from 'lucide-react'

export interface ClientReadiness {
  missingProjectFields: string[]
  blockedUnits: { name: string; issues: string[] }[]
  warningUnits: { name: string; issues: string[] }[]
  unitsCount: number
  submittable: boolean
  /** 有价格的户型数(0 = 一个都没有)。 */
  unitsWithPrice?: number
  /** 🔴「一个价格都没有」的专门提醒 —— 见后端 submit-readiness.ts 的长注释。 */
  priceWarning?: string
}

interface SubmitReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isSubmitting: boolean
  projectName: string
  developer: string
  readiness: ClientReadiness
  hasCoordinates: boolean
  duplicateNames: string[]
}

export function SubmitReviewDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  projectName,
  developer,
  readiness,
  hasCoordinates,
  duplicateNames,
}: SubmitReviewDialogProps) {
  const { t, i18n } = useTranslation('upload')
  const zh = i18n.language?.startsWith('zh')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reviewDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto px-6">
          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
            <div className="font-semibold text-gray-900">{projectName || '—'}</div>
            <div className="text-gray-600">{developer || '—'}</div>
            <div className="text-gray-600">
              {t('reviewDialog.unitCount', { count: readiness.unitsCount })}
            </div>
            <div className={`flex items-center gap-1.5 ${hasCoordinates ? 'text-green-700' : 'text-amber-600'}`}>
              <MapPin className="h-3.5 w-3.5" />
              {hasCoordinates ? t('reviewDialog.coordSet') : t('reviewDialog.coordNotSet')}
            </div>
          </div>

          {/* Duplicate warning */}
          {duplicateNames.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-amber-900 mb-1">
                <AlertTriangle className="h-4 w-4" />
                {t('readiness.duplicate.title')}
              </div>
              <p className="text-amber-800">
                {t('readiness.duplicate.desc', { names: duplicateNames.slice(0, 3).join('、') })}
              </p>
            </div>
          )}

          {/* Missing project fields */}
          {readiness.missingProjectFields.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-4 text-sm space-y-1">
              <div className="flex items-center gap-2 font-semibold text-red-900">
                <XCircle className="h-4 w-4" />
                {t('readiness.missingFields', { fields: readiness.missingProjectFields.join(', ') })}
              </div>
              <p className="text-red-700 pl-6">{t('reviewDialog.missingFieldsHint')}</p>
            </div>
          )}

          {/*
            🔴 一个价格都没有 —— **项目级**的洞,必须单独喊。
            之前「缺少价格」只是每个户型下面一个小 warning:31 个户型全缺时,
            经纪看到的是 31 个小标记,根本意识不到「客户会问价格而我答不上来」。

            实测(2026-07-13,追到永久归档的源 PDF):这**不是抽取器的 bug** ——
            迪拜楼书本来就不印价格,价格是单独一张 price list。所以这里要做的
            不是报错,是**告诉他补传什么**。
          */}
          {readiness.priceWarning && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <Tag className="h-4 w-4" />
                {readiness.unitsWithPrice === 0 ? '这份楼书里没有价格' : '价格不完整'}
              </div>
              <p className="mt-1 whitespace-pre-line pl-6 leading-relaxed text-amber-800">
                {readiness.priceWarning}
              </p>
            </div>
          )}

          {/* Blocked units */}
          {readiness.blockedUnits.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 font-semibold text-red-900">
                <XCircle className="h-4 w-4" />
                {t('readiness.blockedUnits', { count: readiness.blockedUnits.length })}
              </div>
              {readiness.blockedUnits.map(u => (
                <div key={u.name} className="flex items-center justify-between bg-white rounded px-3 py-1.5">
                  <span className="font-medium text-gray-900">{u.name}</span>
                  <span className="text-xs text-red-600">{u.issues.join('、')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Warning units (submittable) */}
          {readiness.warningUnits.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                {t('readiness.warningUnits', { count: readiness.warningUnits.length })}
              </div>
              {readiness.warningUnits.map(u => (
                <div key={u.name} className="flex items-center justify-between bg-white rounded px-3 py-1.5">
                  <span className="font-medium text-gray-900">{u.name}</span>
                  <span className="text-xs text-amber-600">{u.issues.join('、')}</span>
                </div>
              ))}
            </div>
          )}

          {/* No unit types — submittable, but remind the user explicitly. */}
          {readiness.unitsCount === 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold text-amber-900 mb-1">
                <AlertTriangle className="h-4 w-4" />
                {zh ? '暂无户型信息' : 'No unit types'}
              </div>
              <p className="text-amber-800">
                {zh
                  ? '该项目还没有户型信息——仍可提交，之后可在项目编辑页随时补充。'
                  : 'This project has no unit types yet — you can still submit and add them later from the project editor.'}
              </p>
            </div>
          )}

          {/* All clear —— 有价格警告时就不能说"一切就绪"(那是自相矛盾) */}
          {readiness.submittable && readiness.warningUnits.length === 0
            && duplicateNames.length === 0 && !readiness.priceWarning && (
            <div className="bg-green-50 border border-green-300 rounded-lg p-4 text-sm flex items-center gap-2 text-green-800 font-semibold">
              <CheckCircle className="h-4 w-4" />
              {t('readiness.ready')}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pt-4 pb-6">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('reviewDialog.cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            onClick={onConfirm}
            disabled={isSubmitting || !readiness.submittable}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('submitBtn.submitting')}
              </>
            ) : (
              t('reviewDialog.confirm')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
