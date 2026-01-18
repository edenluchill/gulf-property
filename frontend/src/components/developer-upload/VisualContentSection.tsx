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
          <h3 className="text-xl font-bold text-gray-900">🖼️ 视觉内容</h3>
          <p className="text-sm text-gray-600">项目图片和效果图</p>
        </div>
      </div>

      {/* Project Images with Carousel */}
      {hasProjectImages && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-green-700">
              ✅ 项目图片 ({projectImages.length} 张)
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
            ℹ️ AI 检测到 PDF 中包含以下视觉内容（无法直接提取）：
          </p>
          <div className="space-y-3 text-sm">
            {visualContent.hasRenderings && (
              <div className="bg-white rounded p-3">
                <p className="font-medium text-blue-700 mb-1">📐 效果图渲染</p>
                {visualContent.renderingDescriptions && visualContent.renderingDescriptions.length > 0 ? (
                  <ul className="list-disc list-inside ml-2 text-gray-700 space-y-1">
                    {visualContent.renderingDescriptions.map((desc, idx) => (
                      <li key={idx}>{desc}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-2 text-gray-600">已检测到项目效果图</p>
                )}
              </div>
            )}
            {visualContent.hasLocationMaps && (
              <div className="bg-white rounded p-3">
                <p className="font-medium text-blue-700 mb-1">🗺️ 位置地图</p>
                <p className="ml-2 text-gray-600">已检测到位置/区域地图</p>
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
              <p className="font-medium">正在分析视觉内容...</p>
              <p className="text-sm text-gray-500 mt-2">提取图片中</p>
            </div>
          ) : (
            <p className="text-gray-500">暂无图片或视觉内容</p>
          )}
        </div>
      )}
    </div>
  )
}
