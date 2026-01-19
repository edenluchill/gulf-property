/**
 * Amenities Section Component
 * 
 * 显示和编辑项目配套设施
 */

import { useState } from 'react'
import { Card } from '../ui/card'
import { Building2, Dumbbell, Waves, Trees, Users, Car, Shield, Briefcase, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  amenities: string[]
  isProcessing: boolean
}

// Amenity图标映射
const amenityIcons: Record<string, React.ReactNode> = {
  'swimming pool': <Waves className="h-4 w-4" />,
  'pool': <Waves className="h-4 w-4" />,
  'gym': <Dumbbell className="h-4 w-4" />,
  'fitness': <Dumbbell className="h-4 w-4" />,
  'garden': <Trees className="h-4 w-4" />,
  'park': <Trees className="h-4 w-4" />,
  'playground': <Users className="h-4 w-4" />,
  'children': <Users className="h-4 w-4" />,
  'parking': <Car className="h-4 w-4" />,
  'security': <Shield className="h-4 w-4" />,
  'business': <Briefcase className="h-4 w-4" />,
  'default': <Building2 className="h-4 w-4" />,
}

function getAmenityIcon(amenity: string): React.ReactNode {
  const lowerAmenity = amenity.toLowerCase()
  
  for (const [key, icon] of Object.entries(amenityIcons)) {
    if (lowerAmenity.includes(key)) {
      return icon
    }
  }
  
  return amenityIcons['default']
}

export function AmenitiesSection({ amenities, isProcessing }: Props) {
  const [isExpanded, setIsExpanded] = useState(false)
  const INITIAL_DISPLAY_COUNT = 6 // 默认显示的配套设施数量

  if (isProcessing && amenities.length === 0) {
    return null // 处理中且没有数据，不显示
  }

  if (amenities.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-1 bg-gradient-to-b from-green-500 to-emerald-500 rounded-full"></div>
          <div>
            <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              🏊 配套设施
            </h3>
            <p className="text-sm text-gray-600">项目提供的设施和服务</p>
          </div>
        </div>

        <Card className="p-6 bg-gray-50 border-2 border-dashed border-gray-300">
          <p className="text-center text-gray-500">
            未提取到配套设施信息
          </p>
        </Card>
      </div>
    )
  }

  // 决定显示哪些配套设施
  const displayedAmenities = isExpanded 
    ? amenities 
    : amenities.slice(0, INITIAL_DISPLAY_COUNT)
  
  const hasMore = amenities.length > INITIAL_DISPLAY_COUNT

  return (
    <div className="space-y-4 pt-6 border-t-2 border-gray-100">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-1 bg-gradient-to-b from-green-500 to-emerald-500 rounded-full"></div>
        <div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            🏊 配套设施
          </h3>
          <p className="text-sm text-gray-600">
            {amenities.length} 项设施
          </p>
        </div>
      </div>

      <Card className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200">
        <div className="flex flex-wrap gap-2">
          {displayedAmenities.map((amenity, idx) => (
            <div
              key={idx}
              className="px-4 py-2 bg-white hover:bg-green-100 border border-green-300 shadow-sm text-gray-800 flex items-center gap-2 rounded-full transition-colors"
            >
              {getAmenityIcon(amenity)}
              <span className="font-medium">{amenity}</span>
            </div>
          ))}
        </div>

        {/* 展开/收起按钮 */}
        {hasMore && (
          <div className="flex justify-center mt-4 pt-4 border-t border-green-200">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 hover:text-green-900 hover:bg-green-100 rounded-lg transition-colors"
            >
              {isExpanded ? (
                <>
                  <span>收起</span>
                  <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  <span>查看全部 ({amenities.length - INITIAL_DISPLAY_COUNT} 项更多)</span>
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        )}
      </Card>

      {/* 分类显示（可选，仅在展开且设施较多时显示） */}
      {isExpanded && amenities.length >= 8 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
          {[
            { category: '运动健身', keywords: ['gym', 'fitness', 'pool', 'swimming', 'sports'], icon: '🏃' },
            { category: '休闲娱乐', keywords: ['garden', 'park', 'playground', 'children', 'play'], icon: '🌳' },
            { category: '安全保障', keywords: ['security', 'guard', '24/7', 'surveillance'], icon: '🛡️' },
            { category: '便利设施', keywords: ['parking', 'elevator', 'lobby', 'reception'], icon: '🚗' },
          ].map(({ category, keywords, icon }) => {
            const matchedAmenities = amenities.filter(a => 
              keywords.some(kw => a.toLowerCase().includes(kw))
            )
            
            if (matchedAmenities.length === 0) return null
            
            return (
              <div
                key={category}
                className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{icon}</span>
                  <span className="font-semibold text-gray-900 text-sm">{category}</span>
                </div>
                <ul className="text-xs text-gray-600 space-y-1">
                  {matchedAmenities.map((a, i) => (
                    <li key={i}>• {a}</li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
