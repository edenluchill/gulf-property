/**
 * Property Editor Form - Shared form component for upload, edit, and task review pages
 */

import { Card, CardContent } from '../ui/card'
import { Button } from '../ui/button'
import { CheckCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ProjectBasicInfoSection } from '../developer-upload/ProjectBasicInfoSection'
import { DateTimeProgressSection } from '../developer-upload/DateTimeProgressSection'
import { VisualContentSection } from '../developer-upload/VisualContentSection'
import { PaymentPlanSection } from '../developer-upload/PaymentPlanSection'
import { AmenitiesSection } from '../developer-upload/AmenitiesSection'
import LocationMapPickerModal from '../LocationMapPicker'

import { UnitTypesSection } from './UnitTypesSection'
import { ReviewChecklist } from './ReviewChecklist'
import { SubmitOverlay } from './SubmitOverlay'
import { PropertyFormData } from './types'

interface PropertyEditorFormProps {
  formData: PropertyFormData
  setFormData: React.Dispatch<React.SetStateAction<PropertyFormData>>
  onSubmit: (e: React.FormEvent) => Promise<void>

  // State
  isProcessing?: boolean
  isSubmitting: boolean
  hasReviewed: boolean
  setHasReviewed: (value: boolean) => void
  showMapPicker: boolean
  setShowMapPicker: (value: boolean) => void

  // Customization
  translationNamespace?: string
  submitButtonText?: string
  submitButtonTextConfirmed?: string
  overlayTitle?: string
  overlaySubtitle?: string
  overlayAccentColor?: 'teal' | 'blue' | 'green'

  // Optional error display
  error?: string | null
}

export function PropertyEditorForm({
  formData,
  setFormData,
  onSubmit,
  isProcessing = false,
  isSubmitting,
  hasReviewed,
  setHasReviewed,
  showMapPicker,
  setShowMapPicker,
  translationNamespace = 'upload',
  submitButtonText,
  submitButtonTextConfirmed,
  overlayTitle,
  overlaySubtitle,
  overlayAccentColor = 'teal',
  error,
}: PropertyEditorFormProps) {
  const { t } = useTranslation(translationNamespace as any)

  const handleFormChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const finalSubmitText = submitButtonText || t('submitBtn.pleaseCheck')
  const finalSubmitTextConfirmed = submitButtonTextConfirmed || t('submitBtn.confirmed')

  return (
    <>
      <Card className="shadow-2xl border-2 border-gray-200 bg-white">
        <CardContent className="pt-8 px-8">
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}

          <form
            onSubmit={onSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
                e.preventDefault()
              }
            }}
            className="space-y-6"
          >
            {/* Basic Info */}
            <ProjectBasicInfoSection
              formData={formData}
              isProcessing={isProcessing}
              onChange={handleFormChange}
              onOpenMapPicker={() => setShowMapPicker(true)}
            />

            {/* Date & Progress */}
            <div className="pt-6 border-t-2 border-gray-100">
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
            </div>

            {/* Visual Content */}
            <VisualContentSection
              projectImages={formData.projectImages}
              floorPlanImages={formData.floorPlanImages}
              visualContent={formData.visualContent}
              isProcessing={isProcessing}
              primaryImage={formData.primaryImage}
              onPrimaryImageChange={(img) => handleFormChange('primaryImage', img)}
            />

            {/* Unit Types */}
            <UnitTypesSection
              formData={formData}
              setFormData={setFormData}
              isProcessing={isProcessing}
              translationNamespace={translationNamespace}
            />

            {/* Amenities */}
            <AmenitiesSection
              amenities={formData.amenities}
              isProcessing={isProcessing}
            />

            {/* Payment Plan */}
            <PaymentPlanSection
              paymentPlan={formData.paymentPlan}
              isProcessing={isProcessing}
            />

            {/* Review Checklist */}
            {formData.unitTypes.length > 0 && (
              <ReviewChecklist
                formData={formData}
                hasReviewed={hasReviewed}
                setHasReviewed={setHasReviewed}
                translationNamespace={translationNamespace}
              />
            )}

            {/* Submit Button */}
            <div className="pt-8 border-t-2 border-gray-100">
              <Button
                type="submit"
                size="lg"
                className="w-full bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 shadow-xl hover:shadow-2xl text-lg py-7 transition-all duration-300 transform hover:scale-[1.02] disabled:transform-none disabled:opacity-50"
                disabled={isSubmitting || !formData.projectName || !hasReviewed}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    <span className="text-lg">{t('submitBtn.submitting')}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-6 w-6" />
                    <span className="text-lg font-bold">
                      {hasReviewed ? finalSubmitTextConfirmed : finalSubmitText}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Location Map Picker Modal */}
      <LocationMapPickerModal
        isOpen={showMapPicker}
        onClose={() => setShowMapPicker(false)}
        onConfirm={(lat, lng) => {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }))
        }}
        initialPosition={
          formData.latitude && formData.longitude
            ? { lat: formData.latitude, lng: formData.longitude }
            : undefined
        }
        address={formData.address}
      />

      {/* Submitting Overlay */}
      <SubmitOverlay
        isSubmitting={isSubmitting}
        title={overlayTitle || t('overlay.submittingProject')}
        subtitle={overlaySubtitle || t('overlay.savingToDb')}
        hint={t('overlay.pleaseWait')}
        accentColor={overlayAccentColor}
      />
    </>
  )
}
