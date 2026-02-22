/**
 * Review Checklist - Pre-submit validation checklist
 */

import { useTranslation } from 'react-i18next'
import { PropertyFormData } from './types'

interface ReviewChecklistProps {
  formData: PropertyFormData
  hasReviewed: boolean
  setHasReviewed: (value: boolean) => void
  translationNamespace?: string
}

export function ReviewChecklist({
  formData,
  hasReviewed,
  setHasReviewed,
  translationNamespace = 'upload',
}: ReviewChecklistProps) {
  const { t } = useTranslation(translationNamespace as any)

  return (
    <div className="bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-100 border-2 border-blue-300 rounded-xl p-8 space-y-6 shadow-lg mt-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-1 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></div>
        <div>
          <h3 className="font-bold text-blue-900 text-xl">
            {t('checklist.title')}
          </h3>
          <p className="text-sm text-blue-700 mt-1">
            {t('checklist.subtitle')}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Basic Info Check */}
        <div
          className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
            formData.projectName
              ? 'bg-white border-green-300'
              : 'bg-yellow-50 border-yellow-300'
          }`}
        >
          <div className="text-3xl pt-1">{formData.projectName ? '✅' : '⚠️'}</div>
          <div className="flex-1">
            <div className="font-bold text-gray-900 text-base mb-1">
              {t('checklist.basicInfo')}
            </div>
            <div className="text-sm text-gray-600">{t('checklist.basicInfoDesc')}</div>
          </div>
        </div>

        {/* Map Coordinates Check */}
        <div
          className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
            formData.latitude && formData.longitude
              ? 'bg-white border-green-300'
              : 'bg-yellow-50 border-yellow-300'
          }`}
        >
          <div className="text-3xl pt-1">
            {formData.latitude && formData.longitude ? '✅' : '⚠️'}
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-900 text-base mb-1">
              {t('checklist.mapCoordinates')}{' '}
              {formData.latitude && formData.longitude
                ? t('checklist.mapSet')
                : t('checklist.mapNotSet')}
            </div>
            <div className="text-sm text-gray-600">
              {formData.latitude && formData.longitude
                ? t('checklist.latLng', {
                    lat: formData.latitude.toFixed(6),
                    lng: formData.longitude.toFixed(6),
                  })
                : t('checklist.mapSetHint')}
            </div>
          </div>
        </div>

        {/* Unit Types Check */}
        <div
          className={`flex items-start gap-4 p-5 rounded-xl shadow-md border-2 transition-all ${
            formData.unitTypes.length > 0
              ? 'bg-white border-green-300'
              : 'bg-yellow-50 border-yellow-300'
          }`}
        >
          <div className="text-3xl pt-1">
            {formData.unitTypes.length > 0 ? '✅' : '⚠️'}
          </div>
          <div className="flex-1">
            <div className="font-bold text-gray-900 text-base mb-1">
              {t('checklist.unitTypes', { count: formData.unitTypes.length })}
            </div>
            <div className="text-sm text-gray-600">{t('checklist.unitTypesDesc')}</div>
          </div>
        </div>
      </div>

      {/* Confirm Checkbox */}
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
  )
}
