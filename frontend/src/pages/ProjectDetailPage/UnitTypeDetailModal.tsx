import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { formatPrice } from '../../lib/utils'
import { X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { UnitType } from '../../types'
import { useTranslation } from 'react-i18next'

interface UnitTypeDetailModalProps {
  unit: UnitType | null
  isOpen: boolean
  onClose: () => void
}

export function UnitTypeDetailModal({ unit, isOpen, onClose }: UnitTypeDetailModalProps) {
  const { t } = useTranslation(['project', 'common'])

  if (!unit) return null

  const totalArea = unit.balcony_area 
    ? parseFloat(unit.area) + parseFloat(unit.balcony_area)
    : parseFloat(unit.area)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto p-0">
        {/* Header with gradient background */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-primary to-primary/80 text-white px-8 py-6 rounded-t-lg">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-3xl font-bold mb-2">{unit.unit_type_name}</DialogTitle>
              <div className="flex items-center gap-3">
                {unit.category && (
                  <span className="px-4 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium">
                    {unit.category}
                  </span>
                )}
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onClose}
              className="text-white hover:bg-white/20"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>
        </div>

        <div className="px-8 py-8 space-y-8">
          {/* Pricing Section - Prominent */}
          {unit.price && (
            <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-8 rounded-2xl border-2 border-primary/20">
              <div className="flex items-end justify-between flex-wrap gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-600 mb-2">{t('project:unitDetail.startingPrice')}</div>
                  <div className="text-5xl font-bold text-primary mb-2">
                    {formatPrice(unit.price)}
                  </div>
                  {unit.price_per_sqft && (
                    <div className="text-lg text-slate-600">
                      {formatPrice(unit.price_per_sqft)} {t('project:unitDetail.perSqft')}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm text-slate-600 mb-1">{t('project:unitDetail.totalValue')}</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {formatPrice(unit.price)}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Floor Plan Image - Larger */}
          {unit.floor_plan_image && (
            <div className="bg-slate-50 p-6 rounded-2xl">
              <h3 className="text-xl font-bold text-slate-900 mb-4">{t('project:unitDetail.floorPlan')}</h3>
              <div className="w-full bg-white rounded-xl overflow-hidden border-2 border-slate-200">
                <img 
                  src={unit.floor_plan_image}
                  alt={`${unit.unit_type_name} floor plan`}
                  className="w-full h-auto"
                />
              </div>
            </div>
          )}
          
          {/* Unit Specifications - Enhanced Grid */}
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-4">{t('project:unitDetail.unitSpecifications')}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-6 rounded-xl border border-blue-200">
                <div className="text-sm font-medium text-blue-800 mb-2">{t('common:units.bedrooms')}</div>
                <div className="text-4xl font-bold text-blue-900">{unit.bedrooms}</div>
                <div className="text-xs text-blue-700 mt-1">{t('project:unitDetail.bedroom', { count: unit.bedrooms })}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 p-6 rounded-xl border border-purple-200">
                <div className="text-sm font-medium text-purple-800 mb-2">{t('common:units.bathrooms')}</div>
                <div className="text-4xl font-bold text-purple-900">{unit.bathrooms}</div>
                <div className="text-xs text-purple-700 mt-1">{t('project:unitDetail.bathroom', { count: typeof unit.bathrooms === 'string' ? parseInt(unit.bathrooms) : unit.bathrooms })}</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100/50 p-6 rounded-xl border border-green-200">
                <div className="text-sm font-medium text-green-800 mb-2">{t('project:unitDetail.builtUpArea')}</div>
                <div className="text-4xl font-bold text-green-900">
                  {parseFloat(unit.area).toLocaleString()}
                </div>
                <div className="text-xs text-green-700 mt-1">{t('common:units.sqft')}</div>
              </div>
              {unit.balcony_area ? (
                <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 p-6 rounded-xl border border-orange-200">
                  <div className="text-sm font-medium text-orange-800 mb-2">{t('project:unitDetail.balconyArea')}</div>
                  <div className="text-4xl font-bold text-orange-900">
                    {parseFloat(unit.balcony_area).toLocaleString()}
                  </div>
                  <div className="text-xs text-orange-700 mt-1">{t('common:units.sqft')}</div>
                </div>
              ) : (
                <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 p-6 rounded-xl border border-slate-200">
                  <div className="text-sm font-medium text-slate-800 mb-2">{t('project:unitDetail.totalArea')}</div>
                  <div className="text-4xl font-bold text-slate-900">
                    {totalArea.toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-700 mt-1">{t('common:units.sqft')}</div>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {unit.description && (
            <div className="bg-slate-50 p-6 rounded-2xl">
              <h3 className="text-xl font-bold text-slate-900 mb-4">{t('common:description')}</h3>
              <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                {unit.description}
              </p>
            </div>
          )}

          {/* Features */}
          {unit.features && unit.features.length > 0 && (
            <div className="bg-slate-50 p-6 rounded-2xl">
              <h3 className="text-xl font-bold text-slate-900 mb-4">{t('project:unitDetail.featuresAmenities')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {unit.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-white rounded-lg">
                    <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0"></div>
                    <span className="text-slate-700">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* CTA Buttons */}
          <div className="flex gap-4 pt-4">
            <Button className="flex-1 h-14 text-lg" size="lg">
              {t('common:buttons.requestInfo')}
            </Button>
            <Button variant="outline" className="flex-1 h-14 text-lg" size="lg">
              {t('common:buttons.scheduleViewing')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
