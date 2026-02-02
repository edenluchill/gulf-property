import { useTranslation } from 'react-i18next'
import { MapPin, Building2, Bed, Ruler, Calendar, Lock, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '../ui/button'
import { ComparisonPropertyData } from '../../types/comparison'

interface PropertyCompareViewProps {
  properties: ComparisonPropertyData[]
  isLoading: boolean
  isLoggedIn: boolean
  onStartAnalysis: () => void
}

// Color scheme for comparison items A, B, C, D
const ITEM_COLORS = [
  { bg: 'bg-teal-500', light: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  { bg: 'bg-purple-500', light: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
]

const ITEM_LABELS = ['A', 'B', 'C', 'D']

export function PropertyCompareView({
  properties,
  isLoading,
  isLoggedIn,
  onStartAnalysis,
}: PropertyCompareViewProps) {
  const { t } = useTranslation('favorites')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    )
  }

  if (properties.length < 2) {
    return (
      <div className="text-center py-12 text-slate-500">
        Not enough properties to compare
      </div>
    )
  }

  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `AED ${(price / 1000000).toFixed(2)}M`
    }
    return `AED ${price.toLocaleString()}`
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
    } catch {
      return dateStr
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
      case 'handed-over':
        return 'text-emerald-600 bg-emerald-50'
      case 'under-construction':
        return 'text-amber-600 bg-amber-50'
      default:
        return 'text-blue-600 bg-blue-50'
    }
  }

  // Dynamic grid columns based on property count
  const getGridCols = () => {
    switch (properties.length) {
      case 2: return 'grid-cols-2'
      case 3: return 'grid-cols-3'
      case 4: return 'grid-cols-4'
      default: return 'grid-cols-2'
    }
  }

  // Table column width based on property count
  const getColWidth = () => {
    const dataColsPercent = properties.length <= 2 ? 30 : 20
    return `${dataColsPercent}%`
  }

  return (
    <div className="space-y-6">
      {/* Property Cards */}
      <div className={`grid ${getGridCols()} gap-3`}>
        {properties.map((prop, idx) => {
          const color = ITEM_COLORS[idx]
          return (
            <div key={prop.id} className={`border rounded-lg overflow-hidden ${color.border}`}>
              {/* Image */}
              <div className="h-28 bg-slate-100 relative">
                {prop.imageUrl ? (
                  <img
                    src={prop.imageUrl}
                    alt={prop.projectName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Building2 className="h-10 w-10 text-slate-300" />
                  </div>
                )}
                <div className="absolute top-2 left-2">
                  <span className={`px-2 py-0.5 text-xs font-bold rounded ${color.bg} text-white`}>
                    {ITEM_LABELS[idx]}
                  </span>
                </div>
              </div>

              {/* Info */}
              <div className="p-3 space-y-1.5">
                <h3 className="font-semibold text-slate-800 text-sm truncate">
                  {prop.unitTypeName || prop.projectName}
                </h3>
                {prop.unitTypeName && (
                  <p className="text-xs text-slate-500 truncate">{prop.projectName}</p>
                )}
                <p className="text-xs text-slate-500 truncate">{prop.developer}</p>

                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{prop.area}</span>
                </div>

                <span className={`inline-block px-2 py-0.5 text-xs rounded ${getStatusColor(prop.status)}`}>
                  {prop.status.replace('-', ' ')}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Comparison Table */}
      <div className="border rounded-lg overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[500px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-slate-600 font-medium" style={{ width: '25%' }}></th>
              {properties.map((_, idx) => (
                <th
                  key={idx}
                  className={`px-3 py-2 text-center font-semibold ${ITEM_COLORS[idx].text}`}
                  style={{ width: getColWidth() }}
                >
                  {ITEM_LABELS[idx]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {/* Price */}
            <tr>
              <td className="px-3 py-2.5 text-slate-600 font-medium">Price</td>
              {properties.map((prop, idx) => (
                <td key={idx} className="px-3 py-2.5 text-center font-semibold text-slate-800">
                  {formatPrice(prop.price)}
                </td>
              ))}
            </tr>

            {/* Size */}
            {properties.some(p => p.size > 0) && (
              <tr className="bg-slate-50/50">
                <td className="px-3 py-2.5 text-slate-600 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Ruler className="h-3.5 w-3.5" />
                    Area
                  </span>
                </td>
                {properties.map((prop, idx) => (
                  <td key={idx} className="px-3 py-2.5 text-center text-slate-700 text-xs">
                    {prop.size > 0 ? `${prop.size.toLocaleString()} sqft` : '-'}
                  </td>
                ))}
              </tr>
            )}

            {/* Price per sqft */}
            {properties.some(p => p.pricePerSqft) && (
              <tr>
                <td className="px-3 py-2.5 text-slate-600 font-medium">Price/sqft</td>
                {properties.map((prop, idx) => (
                  <td key={idx} className="px-3 py-2.5 text-center text-slate-700 text-xs">
                    {prop.pricePerSqft ? `AED ${prop.pricePerSqft.toLocaleString()}` : '-'}
                  </td>
                ))}
              </tr>
            )}

            {/* Bedrooms */}
            <tr className="bg-slate-50/50">
              <td className="px-3 py-2.5 text-slate-600 font-medium">
                <span className="flex items-center gap-1.5">
                  <Bed className="h-3.5 w-3.5" />
                  Bedrooms
                </span>
              </td>
              {properties.map((prop, idx) => (
                <td key={idx} className="px-3 py-2.5 text-center text-slate-700">
                  {prop.bedrooms === 0 ? 'Studio' : prop.bedrooms}
                </td>
              ))}
            </tr>

            {/* Location */}
            <tr>
              <td className="px-3 py-2.5 text-slate-600 font-medium">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Location
                </span>
              </td>
              {properties.map((prop, idx) => (
                <td key={idx} className="px-3 py-2.5 text-center text-slate-700 text-xs">
                  {prop.area}
                </td>
              ))}
            </tr>

            {/* Completion */}
            <tr className="bg-slate-50/50">
              <td className="px-3 py-2.5 text-slate-600 font-medium">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Completion
                </span>
              </td>
              {properties.map((prop, idx) => (
                <td key={idx} className="px-3 py-2.5 text-center text-slate-700 text-xs">
                  {formatDate(prop.completionDate)}
                </td>
              ))}
            </tr>

            {/* Progress */}
            {properties.some(p => p.constructionProgress) && (
              <tr>
                <td className="px-3 py-2.5 text-slate-600 font-medium">Progress</td>
                {properties.map((prop, idx) => (
                  <td key={idx} className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${ITEM_COLORS[idx].bg} rounded-full`}
                          style={{ width: `${prop.constructionProgress || 0}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-600">{prop.constructionProgress || 0}%</span>
                    </div>
                  </td>
                ))}
              </tr>
            )}

            {/* Developer */}
            <tr className="bg-slate-50/50">
              <td className="px-3 py-2.5 text-slate-600 font-medium">
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Developer
                </span>
              </td>
              {properties.map((prop, idx) => (
                <td key={idx} className="px-3 py-2.5 text-center text-slate-700 text-xs truncate max-w-[120px]">
                  {prop.developer}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Amenities Comparison */}
      {properties.some(p => p.amenities.length > 0) && (
        <div className="border rounded-lg p-4">
          <h4 className="font-medium text-slate-700 mb-3">Amenities</h4>
          <div className={`grid ${getGridCols()} gap-4`}>
            {properties.map((prop, idx) => (
              <div key={idx} className="space-y-1">
                <div className={`text-xs font-semibold ${ITEM_COLORS[idx].text} mb-2`}>
                  {ITEM_LABELS[idx]}
                </div>
                {prop.amenities.slice(0, 5).map((amenity, i) => (
                  <div key={i} className="text-xs text-slate-600 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${ITEM_COLORS[idx].bg}`} />
                    <span className="truncate">{amenity}</span>
                  </div>
                ))}
                {prop.amenities.length > 5 && (
                  <div className="text-xs text-slate-400">
                    +{prop.amenities.length - 5} more
                  </div>
                )}
                {prop.amenities.length === 0 && (
                  <div className="text-xs text-slate-400">No amenities listed</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Analysis Button */}
      <div className="pt-4 border-t">
        {isLoggedIn ? (
          <Button
            onClick={onStartAnalysis}
            className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {t('compare.startAnalysis')}
          </Button>
        ) : (
          <Button
            onClick={onStartAnalysis}
            variant="outline"
            className="w-full border-slate-300"
          >
            <Lock className="h-4 w-4 mr-2" />
            {t('compare.loginRequired')}
          </Button>
        )}
      </div>
    </div>
  )
}
