import { useTranslation } from 'react-i18next'
import { ImageCarousel } from './ImageCarousel'
import { Loader2 } from 'lucide-react'

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
}

export function VisualContentSection({
  projectImages,
  floorPlanImages,
  visualContent,
  isProcessing
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
