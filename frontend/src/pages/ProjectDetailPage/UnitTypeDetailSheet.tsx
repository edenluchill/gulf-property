import { Bed, Bath, Maximize } from 'lucide-react'
import MobileBottomSheet from '../../components/MobileBottomSheet'
import { formatPrice } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { UnitType } from '../../types'
import { useTranslation } from 'react-i18next'
import { UnitTypeFavoriteButton } from '../../components/favorites'

interface UnitTypeDetailSheetProps {
  unit: UnitType | null
  projectId?: string
  isOpen: boolean
  onClose: () => void
}

export function UnitTypeDetailSheet({ unit, projectId, isOpen, onClose }: UnitTypeDetailSheetProps) {
  const { t } = useTranslation(['project', 'common'])

  if (!unit) return null

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={unit.unit_type_name}
      height="85vh"
    >
      <div className="px-4 pb-6 space-y-4">
        {/* Header: Title + Price + Like */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {unit.category && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  {unit.category}
                </span>
              )}
            </div>
            {unit.price && (
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-primary">
                  {formatPrice(unit.price)}
                </span>
                {unit.price_per_sqft && (
                  <span className="text-xs text-slate-500">
                    ({formatPrice(unit.price_per_sqft)}/{t('common:units.sqft')})
                  </span>
                )}
              </div>
            )}
          </div>
          {projectId && (
            <UnitTypeFavoriteButton projectId={projectId} unitTypeId={unit.id} />
          )}
        </div>

        {/* Quick Specs Row */}
        <div className="flex items-center gap-4 text-sm text-slate-600 py-2 border-y">
          <span className="flex items-center gap-1.5">
            <Bed className="h-4 w-4" />
            {unit.bedrooms} {t('common:units.beds')}
          </span>
          <span className="flex items-center gap-1.5">
            <Bath className="h-4 w-4" />
            {unit.bathrooms} {t('common:units.bathrooms')}
          </span>
          <span className="flex items-center gap-1.5">
            <Maximize className="h-4 w-4" />
            {parseFloat(unit.area).toLocaleString()} {t('common:units.sqft')}
          </span>
        </div>

        {/* Floor Plan Image - No label */}
        {unit.floor_plan_image && (
          <div className="bg-slate-50 rounded-xl overflow-hidden border">
            <img
              src={unit.floor_plan_image}
              alt={`${unit.unit_type_name} floor plan`}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Specifications Grid - Compact */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-xs text-slate-500">{t('common:units.bedrooms')}</div>
            <div className="text-lg font-bold text-slate-900">{unit.bedrooms}</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-xs text-slate-500">{t('common:units.bathrooms')}</div>
            <div className="text-lg font-bold text-slate-900">{unit.bathrooms}</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg">
            <div className="text-xs text-slate-500">{t('project:unitDetail.builtUpArea')}</div>
            <div className="text-lg font-bold text-slate-900">
              {parseFloat(unit.area).toLocaleString()}
              <span className="text-xs font-normal text-slate-500 ml-1">{t('common:units.sqft')}</span>
            </div>
          </div>
          {unit.balcony_area && (
            <div className="bg-slate-50 p-3 rounded-lg">
              <div className="text-xs text-slate-500">{t('project:unitDetail.balconyArea')}</div>
              <div className="text-lg font-bold text-slate-900">
                {parseFloat(unit.balcony_area).toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">{t('common:units.sqft')}</span>
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        {unit.description && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">{t('common:description')}</h3>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
              {unit.description}
            </p>
          </div>
        )}

        {/* Features */}
        {unit.features && unit.features.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">{t('project:unitDetail.featuresAmenities')}</h3>
            <div className="flex flex-wrap gap-2">
              {unit.features.map((feature, index) => (
                <span key={index} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">
                  {feature}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="flex gap-3 pt-2">
          <Button className="flex-1 h-11" size="default">
            {t('common:buttons.scheduleViewing')}
          </Button>
          <Button variant="outline" className="flex-1 h-11" size="default">
            {t('common:buttons.requestInfo')}
          </Button>
        </div>
      </div>
    </MobileBottomSheet>
  )
}
