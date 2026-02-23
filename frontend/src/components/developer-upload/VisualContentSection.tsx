import { useTranslation } from 'react-i18next'
import { ImageCarousel } from './ImageCarousel'
import { Loader2, Star, Check } from 'lucide-react'

interface VisualContent {
  hasRenderings?: boolean
  hasFloorPlans?: boolean
  hasLocationMaps?: boolean
  renderingDescriptions?: string[]
  floorPlanDescriptions?: string[]
}

interface VisualContentSectionProps {
  projectImages?: string[]
  floorPlanImages?: string[]
  visualContent?: VisualContent
  isProcessing: boolean
  primaryImage?: string
  onPrimaryImageChange?: (imageUrl: string | undefined) => void
}

export function VisualContentSection({
  projectImages,
  floorPlanImages,
  visualContent,
  isProcessing,
  primaryImage,
  onPrimaryImageChange,
}: VisualContentSectionProps) {
  const { t } = useTranslation('upload')

  const hasProjectImages = projectImages && projectImages.length > 0
  const hasFloorPlanImages = floorPlanImages && floorPlanImages.length > 0
  const hasVisualContent = visualContent && (
    visualContent.hasRenderings || 
    visualContent.hasFloorPlans || 
    visualContent.hasLocationMaps
  )

  return (
    <div className="space-y-4 pt-6 border-t-2 border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-purple-500 to-pink-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900">{t('visualContent.title')}</h3>
          <p className="text-sm text-gray-600">{t('visualContent.subtitle')}</p>
        </div>
      </div>

      {/* Project Images with Carousel */}
      {hasProjectImages && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-green-700">
              {t('visualContent.projectImages')} ({t('visualContent.imageCount', { count: projectImages.length })})
            </p>
          </div>
          <ImageCarousel
            images={projectImages}
            aspectRatio="video"
            showThumbnails={projectImages.length > 1}
            maxHeight="280px"
          />

          {/* Primary Image Selection */}
          {onPrimaryImageChange && projectImages.length > 0 && (
            <div className="mt-4 p-4 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl border border-amber-200">
              <div className="flex items-center gap-2 mb-3">
                <Star className="h-5 w-5 text-amber-500" />
                <span className="font-semibold text-amber-800">
                  {t('visualContent.selectPrimaryImage', '选择主图 (地图Pin显示)')}
                </span>
              </div>
              <p className="text-xs text-amber-700 mb-3">
                {t('visualContent.primaryImageHint', '点击选择一张图片作为地图上显示的缩略图，不选则默认使用第一张')}
              </p>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {projectImages.map((img, idx) => {
                  const isSelected = primaryImage === img
                  const isDefault = !primaryImage && idx === 0
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          onPrimaryImageChange(undefined) // Deselect
                        } else {
                          onPrimaryImageChange(img)
                        }
                      }}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                        isSelected
                          ? 'border-amber-500 ring-2 ring-amber-300 shadow-lg'
                          : isDefault
                          ? 'border-gray-300 ring-1 ring-gray-200'
                          : 'border-transparent hover:border-gray-300'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`Image ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                          <div className="bg-amber-500 rounded-full p-1">
                            <Check className="h-4 w-4 text-white" />
                          </div>
                        </div>
                      )}
                      {isDefault && !primaryImage && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gray-800/70 text-white text-[10px] text-center py-0.5">
                          {t('visualContent.default', '默认')}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visual Content Detection (when images not extracted) */}
      {!hasProjectImages && !hasFloorPlanImages && hasVisualContent && (
        <div className="space-y-3 bg-blue-50 p-4 rounded-lg border border-blue-200">
          <p className="text-sm font-medium text-blue-800">
            {t('visualContent.aiDetectedContent')}
          </p>
          <div className="space-y-3 text-sm">
            {visualContent.hasRenderings && (
              <div className="bg-white rounded p-3">
                <p className="font-medium text-blue-700 mb-1">{t('visualContent.renderImages')}</p>
                {visualContent.renderingDescriptions && visualContent.renderingDescriptions.length > 0 ? (
                  <ul className="list-disc list-inside ml-2 text-gray-700 space-y-1">
                    {visualContent.renderingDescriptions.map((desc, idx) => (
                      <li key={idx}>{desc}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-2 text-gray-600">{t('visualContent.renderDetected')}</p>
                )}
              </div>
            )}
            {visualContent.hasLocationMaps && (
              <div className="bg-white rounded p-3">
                <p className="font-medium text-blue-700 mb-1">{t('visualContent.locationMap')}</p>
                <p className="ml-2 text-gray-600">{t('visualContent.locationMapDetected')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!hasProjectImages && !hasFloorPlanImages && !hasVisualContent && (
        <div className="text-center py-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-300">
          {isProcessing ? (
            <div className="text-gray-600">
              <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-purple-600" />
              <p className="font-medium">{t('visualContent.analyzingVisual')}</p>
              <p className="text-sm text-gray-500 mt-2">{t('visualContent.extractingImages')}</p>
            </div>
          ) : (
            <p className="text-gray-500">{t('visualContent.noImagesOrContent')}</p>
          )}
        </div>
      )}
    </div>
  )
}
