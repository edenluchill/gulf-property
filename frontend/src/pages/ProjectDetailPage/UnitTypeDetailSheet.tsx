import { Bed, Bath, Maximize, LineChart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMyRole } from '../../hooks/useMyRole'
import MobileBottomSheet from '../../components/MobileBottomSheet'
import { formatPrice } from '../../lib/utils'
import { UnitType, PaymentPlan } from '../../types'
import { UnitTypeFavoriteButton } from '../../components/favorites'
import UnitEconomics from '../../components/project/UnitEconomics'

interface UnitTypeDetailSheetProps {
  unit: UnitType | null
  projectId?: string
  isOpen: boolean
  onClose: () => void
  yieldPct?: number | null
  growthPct?: number | null
  paymentPlan?: PaymentPlan[]
}

export function UnitTypeDetailSheet({ unit, projectId, isOpen, onClose, yieldPct, growthPct, paymentPlan }: UnitTypeDetailSheetProps) {
  const { i18n } = useTranslation()
  const { t: tRoi } = useTranslation('roi')
  const role = useMyRole()
  const isAgent = role === 'agent' || role === 'agency' || role === 'developer'
  if (!unit) return null

  return (
    <MobileBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={unit.unit_type_name}
      height="80vh"
    >
      <div className="px-4 pb-6 space-y-5">
        {/* Header: Price + Specs + Like */}
        <div className="flex items-start justify-between">
          <div>
            {unit.price && (
              <div className="text-2xl font-bold text-primary mb-1">
                {formatPrice(unit.price)}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="flex items-center gap-1">
                <Bed className="h-4 w-4" />
                {unit.bedrooms}
              </span>
              <span className="flex items-center gap-1">
                <Bath className="h-4 w-4" />
                {unit.bathrooms}
              </span>
              <span className="flex items-center gap-1">
                <Maximize className="h-4 w-4" />
                {parseFloat(unit.area).toLocaleString()} ft²
              </span>
            </div>
          </div>
          {projectId && (
            <UnitTypeFavoriteButton projectId={projectId} unitTypeId={unit.id} />
          )}
        </div>

        {/* Floor Plan */}
        {unit.floor_plan_image && (
          <div className="bg-white rounded-2xl overflow-hidden border">
            <img
              src={unit.floor_plan_image}
              alt={unit.unit_type_name}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Description */}
        {unit.description && (
          <p className="text-sm text-slate-600 leading-relaxed">
            {unit.description}
          </p>
        )}

        {/* Features */}
        {unit.features && unit.features.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unit.features.map((feature, index) => (
              <span
                key={index}
                className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-xs"
              >
                {feature}
              </span>
            ))}
          </div>
        )}

        {/* Per-unit economics: ROI + payment breakdown */}
        <UnitEconomics
          price={unit.price}
          yieldPct={yieldPct}
          growthPct={growthPct}
          paymentPlan={paymentPlan}
          lang={i18n.language}
        />

        {/* 收益模拟器 —— **手机上原来根本没有这个入口**。
            桌面的两栏版(UnitTypesSubPage)有,手机走的是这张底部卡片,
            两边是两套完全独立的 markup。把模拟器开放给买家却只开在桌面,
            等于对大多数买家没开(他们都在手机上)。
            ⚠️ 以后往户型详情加东西:**这里和 UnitTypesSubPage 都要加**。 */}
        {projectId && (
          <Link
            to={`${isAgent ? '/agent/roi' : '/roi'}?project=${encodeURIComponent(projectId)}&unit=${encodeURIComponent(unit.id)}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-700 transition active:scale-[0.99]"
          >
            <LineChart className="h-4 w-4" />
            {tRoi('entry.simulateUnit')}
          </Link>
        )}
      </div>
    </MobileBottomSheet>
  )
}
