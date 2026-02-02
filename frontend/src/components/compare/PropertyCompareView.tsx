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

  const [propA, propB] = properties

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

  return (
    <div className="space-y-6">
      {/* Property Cards Side by Side */}
      <div className="grid grid-cols-2 gap-4">
        {[propA, propB].map((prop, idx) => (
          <div key={prop.id} className="border rounded-lg overflow-hidden">
            {/* Image */}
            <div className="h-32 bg-slate-100 relative">
              {prop.imageUrl ? (
                <img
                  src={prop.imageUrl}
                  alt={prop.projectName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Building2 className="h-12 w-12 text-slate-300" />
                </div>
              )}
              <div className="absolute top-2 left-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                  idx === 0 ? 'bg-teal-500 text-white' : 'bg-emerald-500 text-white'
                }`}>
                  {idx === 0 ? 'A' : 'B'}
                </span>
              </div>
            </div>

            {/* Info */}
            <div className="p-3 space-y-2">
              <h3 className="font-semibold text-slate-800 truncate">
                {prop.unitTypeName || prop.projectName}
              </h3>
              {prop.unitTypeName && (
                <p className="text-xs text-slate-500 truncate">{prop.projectName}</p>
              )}
              <p className="text-xs text-slate-500 truncate">{prop.developer}</p>

              <div className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{prop.area}</span>
              </div>

              <span className={`inline-block px-2 py-0.5 text-xs rounded ${getStatusColor(prop.status)}`}>
                {prop.status.replace('-', ' ')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-slate-600 font-medium w-1/3"></th>
              <th className="px-4 py-2 text-center text-teal-600 font-semibold">A</th>
              <th className="px-4 py-2 text-center text-emerald-600 font-semibold">B</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {/* Price */}
            <tr>
              <td className="px-4 py-3 text-slate-600 font-medium">Price</td>
              <td className="px-4 py-3 text-center font-semibold text-slate-800">
                {formatPrice(propA.price)}
              </td>
              <td className="px-4 py-3 text-center font-semibold text-slate-800">
                {formatPrice(propB.price)}
              </td>
            </tr>

            {/* Size */}
            {(propA.size > 0 || propB.size > 0) && (
              <tr className="bg-slate-50/50">
                <td className="px-4 py-3 text-slate-600 font-medium flex items-center gap-2">
                  <Ruler className="h-4 w-4" />
                  Area
                </td>
                <td className="px-4 py-3 text-center text-slate-700">
                  {propA.size > 0 ? `${propA.size.toLocaleString()} sqft` : '-'}
                </td>
                <td className="px-4 py-3 text-center text-slate-700">
                  {propB.size > 0 ? `${propB.size.toLocaleString()} sqft` : '-'}
                </td>
              </tr>
            )}

            {/* Price per sqft */}
            {(propA.pricePerSqft || propB.pricePerSqft) && (
              <tr>
                <td className="px-4 py-3 text-slate-600 font-medium">Price/sqft</td>
                <td className="px-4 py-3 text-center text-slate-700">
                  {propA.pricePerSqft ? `AED ${propA.pricePerSqft.toLocaleString()}` : '-'}
                </td>
                <td className="px-4 py-3 text-center text-slate-700">
                  {propB.pricePerSqft ? `AED ${propB.pricePerSqft.toLocaleString()}` : '-'}
                </td>
              </tr>
            )}

            {/* Bedrooms */}
            <tr className="bg-slate-50/50">
              <td className="px-4 py-3 text-slate-600 font-medium flex items-center gap-2">
                <Bed className="h-4 w-4" />
                Bedrooms
              </td>
              <td className="px-4 py-3 text-center text-slate-700">
                {propA.bedrooms === 0 ? 'Studio' : propA.bedrooms}
              </td>
              <td className="px-4 py-3 text-center text-slate-700">
                {propB.bedrooms === 0 ? 'Studio' : propB.bedrooms}
              </td>
            </tr>

            {/* Location */}
            <tr>
              <td className="px-4 py-3 text-slate-600 font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location
              </td>
              <td className="px-4 py-3 text-center text-slate-700">{propA.area}</td>
              <td className="px-4 py-3 text-center text-slate-700">{propB.area}</td>
            </tr>

            {/* Completion */}
            <tr className="bg-slate-50/50">
              <td className="px-4 py-3 text-slate-600 font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Completion
              </td>
              <td className="px-4 py-3 text-center text-slate-700">
                {formatDate(propA.completionDate)}
              </td>
              <td className="px-4 py-3 text-center text-slate-700">
                {formatDate(propB.completionDate)}
              </td>
            </tr>

            {/* Progress */}
            {(propA.constructionProgress || propB.constructionProgress) && (
              <tr>
                <td className="px-4 py-3 text-slate-600 font-medium">Progress</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full"
                        style={{ width: `${propA.constructionProgress || 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600">{propA.constructionProgress || 0}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${propB.constructionProgress || 0}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-600">{propB.constructionProgress || 0}%</span>
                  </div>
                </td>
              </tr>
            )}

            {/* Developer */}
            <tr className="bg-slate-50/50">
              <td className="px-4 py-3 text-slate-600 font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Developer
              </td>
              <td className="px-4 py-3 text-center text-slate-700">{propA.developer}</td>
              <td className="px-4 py-3 text-center text-slate-700">{propB.developer}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Amenities Comparison */}
      {(propA.amenities.length > 0 || propB.amenities.length > 0) && (
        <div className="border rounded-lg p-4">
          <h4 className="font-medium text-slate-700 mb-3">Amenities</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              {propA.amenities.slice(0, 6).map((amenity, i) => (
                <div key={i} className="text-xs text-slate-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                  {amenity}
                </div>
              ))}
              {propA.amenities.length > 6 && (
                <div className="text-xs text-slate-400">
                  +{propA.amenities.length - 6} more
                </div>
              )}
            </div>
            <div className="space-y-1">
              {propB.amenities.slice(0, 6).map((amenity, i) => (
                <div key={i} className="text-xs text-slate-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {amenity}
                </div>
              ))}
              {propB.amenities.length > 6 && (
                <div className="text-xs text-slate-400">
                  +{propB.amenities.length - 6} more
                </div>
              )}
            </div>
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
