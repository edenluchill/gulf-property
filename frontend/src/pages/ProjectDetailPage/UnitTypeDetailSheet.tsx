import MobileBottomSheet from '../../components/MobileBottomSheet'
import { formatPrice } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { UnitType } from '../../types'
import { useTranslation } from 'react-i18next'

interface UnitTypeDetailSheetProps {
  unit: UnitType | null
  isOpen: boolean
  onClose: () => void
}

export function UnitTypeDetailSheet({ unit, isOpen, onClose }: UnitTypeDetailSheetProps) {
  const { t } = useTranslation(['project', 'common'])

  if (!unit) return null

  const totalArea = unit.balcony_area 
    ? parseFloat(unit.area) + parseFloat(unit.balcony_area)
    : parseFloat(unit.area)

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={unit.unit_type_name}
      height="85vh"
    >
      <div className="px-4 py-4 space-y-6">
        {/* Category Badge */}
        {unit.category && (
          <div className="flex justify-center">
            <span className="px-4 py-1.5 bg-primary/10 text-primary rounded-full text-sm font-medium">
              {unit.category}
            </span>
          </div>
        )}

        {/* Pricing Section */}
        {unit.price && (
          <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 rounded-2xl border-2 border-primary/20">
            <div className="text-center">
              <div className="text-xs font-medium text-slate-600 mb-2">{t('project:unitDetail.startingPrice')}</div>
              <div className="text-4xl font-bold text-primary mb-2">
                {formatPrice(unit.price)}
              </div>
              {unit.price_per_sqft && (
                <div className="text-base text-slate-600">
                  {formatPrice(unit.price_per_sqft)} {t('project:unitDetail.perSqft')}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Floor Plan Image */}
        {unit.floor_plan_image && (
          <div className="bg-slate-50 p-4 rounded-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">{t('project:unitDetail.floorPlan')}</h3>
            <div className="w-full bg-white rounded-xl overflow-hidden border-2 border-slate-200">
              <img 
                src={unit.floor_plan_image}
                alt={`${unit.unit_type_name} floor plan`}
                className="w-full h-auto"
              />
            </div>
          </div>
        )}
        
        {/* Unit Specifications Grid */}
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-3">{t('project:unitDetail.unitSpecifications')}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 p-4 rounded-xl border border-blue-200">
              <div className="text-xs font-medium text-blue-800 mb-1">{t('common:units.bedrooms')}</div>
              <div className="text-3xl font-bold text-blue-900">{unit.bedrooms}</div>
              <div className="text-[10px] text-blue-700 mt-0.5">{t('project:unitDetail.bedroom', { count: unit.bedrooms })}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 p-4 rounded-xl border border-purple-200">
              <div className="text-xs font-medium text-purple-800 mb-1">{t('common:units.bathrooms')}</div>
              <div className="text-3xl font-bold text-purple-900">{unit.bathrooms}</div>
              <div className="text-[10px] text-purple-700 mt-0.5">{t('project:unitDetail.bathroom', { count: typeof unit.bathrooms === 'string' ? parseInt(unit.bathrooms) : unit.bathrooms })}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100/50 p-4 rounded-xl border border-green-200">
              <div className="text-xs font-medium text-green-800 mb-1">{t('project:unitDetail.builtUpArea')}</div>
              <div className="text-3xl font-bold text-green-900">
                {parseFloat(unit.area).toLocaleString()}
              </div>
              <div className="text-[10px] text-green-700 mt-0.5">{t('common:units.sqft')}</div>
            </div>
            {unit.balcony_area ? (
              <div className="bg-gradient-to-br from-orange-50 to-orange-100/50 p-4 rounded-xl border border-orange-200">
                <div className="text-xs font-medium text-orange-800 mb-1">{t('project:unitDetail.balconyArea')}</div>
                <div className="text-3xl font-bold text-orange-900">
                  {parseFloat(unit.balcony_area).toLocaleString()}
                </div>
                <div className="text-[10px] text-orange-700 mt-0.5">{t('common:units.sqft')}</div>
              </div>
            ) : (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 p-4 rounded-xl border border-slate-200">
                <div className="text-xs font-medium text-slate-800 mb-1">{t('project:unitDetail.totalArea')}</div>
                <div className="text-3xl font-bold text-slate-900">
                  {totalArea.toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-700 mt-0.5">{t('common:units.sqft')}</div>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {unit.description && (
          <div className="bg-slate-50 p-4 rounded-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">{t('common:description')}</h3>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {unit.description}
            </p>
          </div>
        )}

        {/* Features */}
        {unit.features && unit.features.length > 0 && (
          <div className="bg-slate-50 p-4 rounded-2xl">
            <h3 className="text-lg font-bold text-slate-900 mb-3">{t('project:unitDetail.featuresAmenities')}</h3>
            <div className="space-y-2">
              {unit.features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2 p-2 bg-white rounded-lg">
                  <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0"></div>
                  <span className="text-sm text-slate-700">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* CTA Buttons */}
        <div className="flex flex-col gap-3 pt-2 pb-4">
          <Button className="w-full h-12 text-base" size="lg">
            {t('common:buttons.requestInfo')}
          </Button>
          <Button variant="outline" className="w-full h-12 text-base" size="lg">
            {t('common:buttons.scheduleViewing')}
          </Button>
        </div>
      </div>
    </MobileBottomSheet>
  )
}
