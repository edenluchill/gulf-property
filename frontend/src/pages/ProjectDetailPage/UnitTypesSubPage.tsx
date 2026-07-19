import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMyRole } from '../../hooks/useMyRole'
import { Button } from '../../components/ui/button'
import { ArrowLeft, Bed, Bath, Maximize, ZoomIn, LineChart } from 'lucide-react'
import { formatPrice } from '../../lib/utils'
import { UnitType, PaymentPlan } from '../../types'
import { UnitTypeFavoriteButton } from '../../components/favorites'
import { cn } from '../../lib/utils'
import { ImageLightbox } from '../../components/ImageLightbox'
import UnitEconomics from '../../components/project/UnitEconomics'

const Spec = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{children}</span>
)

interface UnitTypesSubPageProps {
  unitTypes: UnitType[]
  selectedUnitId: string | null
  projectId: string
  projectName: string
  onUnitSelect: (unitId: string) => void
  onBack: () => void
  yieldPct?: number | null
  growthPct?: number | null
  paymentPlan?: PaymentPlan[]
}

export function UnitTypesSubPage({
  unitTypes,
  selectedUnitId,
  projectId,
  projectName,
  onUnitSelect,
  onBack,
  yieldPct,
  growthPct,
  paymentPlan,
}: UnitTypesSubPageProps) {
  const { i18n } = useTranslation()
  const { t: tRoi } = useTranslation('roi')
  // 与 Header/ProfileShell 同规则:agency/developer 也算经纪侧
  const role = useMyRole()
  const isAgent = role === 'agent' || role === 'agency' || role === 'developer'
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const selectedUnit = unitTypes.find(u => u.id === selectedUnitId) || unitTypes[0]

  useEffect(() => {
    if (!selectedUnitId && unitTypes.length > 0) {
      onUnitSelect(unitTypes[0].id)
    }
  }, [selectedUnitId, unitTypes, onUnitSelect])

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header - Clean */}
      <div className="bg-white border-b px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ms-2">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
          Back
        </Button>
        <div className="h-5 w-px bg-slate-200" />
        <span className="font-medium text-slate-900 truncate">{projectName}</span>
        <span className="text-xs text-slate-400">{unitTypes.length} units</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Minimal */}
        <div className="w-64 bg-white border-e flex-shrink-0 overflow-y-auto">
          {unitTypes.map((unit) => (
            <button
              key={unit.id}
              onClick={() => onUnitSelect(unit.id)}
              className={cn(
                'w-full text-start px-4 py-3 border-s-2 transition-all hover:bg-slate-50',
                unit.id === selectedUnitId
                  ? 'border-s-primary bg-primary/5'
                  : 'border-s-transparent'
              )}
            >
              <div className="font-medium text-sm truncate">{unit.unit_type_name}</div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                <span className="flex items-center gap-0.5">
                  <Bed className="h-3 w-3" />
                  {unit.bedrooms}
                </span>
                <span className="flex items-center gap-0.5">
                  <Bath className="h-3 w-3" />
                  {unit.bathrooms}
                </span>
                <span>{parseFloat(unit.area).toLocaleString()} ft²</span>
              </div>
              {unit.price && (
                <div className="mt-1 text-sm font-semibold text-primary">
                  {formatPrice(unit.price)}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Right Panel - Clean Detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedUnit ? (
            <div className="p-8 max-w-3xl mx-auto">
              {/* Header Row */}
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 mb-2">
                    {selectedUnit.unit_type_name}
                  </h2>
                  <div className="flex items-center gap-4 text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <Bed className="h-4 w-4" />
                      {selectedUnit.bedrooms}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Bath className="h-4 w-4" />
                      {selectedUnit.bathrooms}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Maximize className="h-4 w-4" />
                      {parseFloat(selectedUnit.area).toLocaleString()} ft²
                    </span>
                  </div>
                  {/* Extra specs: view / floor / orientation / balcony / built-up */}
                  {(selectedUnit.view_type || selectedUnit.floor_level || selectedUnit.orientation ||
                    selectedUnit.balcony_area || selectedUnit.built_up_area) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedUnit.view_type && <Spec>{selectedUnit.view_type}</Spec>}
                      {selectedUnit.floor_level && <Spec>{selectedUnit.floor_level}</Spec>}
                      {selectedUnit.orientation && <Spec>{selectedUnit.orientation}</Spec>}
                      {selectedUnit.balcony_area && <Spec>{i18n.language?.startsWith('zh') ? '阳台' : 'Balcony'} {parseFloat(selectedUnit.balcony_area).toLocaleString()} ft²</Spec>}
                      {selectedUnit.built_up_area && <Spec>{i18n.language?.startsWith('zh') ? '建筑面积' : 'Built-up'} {parseFloat(selectedUnit.built_up_area).toLocaleString()} ft²</Spec>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {selectedUnit.price && (
                    <div className="text-end">
                      <div className="text-2xl font-bold text-primary">
                        {formatPrice(selectedUnit.price)}
                      </div>
                      {selectedUnit.price_per_sqft && (
                        <div className="text-xs text-slate-400">
                          {formatPrice(selectedUnit.price_per_sqft)}/ft²
                        </div>
                      )}
                    </div>
                  )}
                  <UnitTypeFavoriteButton projectId={projectId} unitTypeId={selectedUnit.id} />
                </div>
              </div>

              {/* Floor Plan - Hero style, click to enlarge */}
              {selectedUnit.floor_plan_image && (
                <div
                  onClick={() => setLightboxOpen(true)}
                  className="group relative bg-white rounded-2xl overflow-hidden shadow-sm border mb-8 cursor-zoom-in"
                >
                  <img
                    src={selectedUnit.floor_plan_image}
                    alt={selectedUnit.unit_type_name}
                    className="w-full h-auto max-h-[450px] object-contain"
                  />
                  <div className="absolute top-3 end-3 rounded-full bg-white/90 p-1.5 text-slate-600 opacity-0 shadow group-hover:opacity-100 transition-opacity">
                    <ZoomIn className="h-4 w-4" />
                  </div>
                </div>
              )}

              {/* Description - if exists */}
              {selectedUnit.description && (
                <p className="text-slate-600 leading-relaxed mb-8">
                  {selectedUnit.description}
                </p>
              )}

              {/* Features - Minimal pills */}
              {selectedUnit.features && selectedUnit.features.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedUnit.features.map((feature, index) => (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-sm"
                    >
                      {feature}
                    </span>
                  ))}
                </div>
              )}

              {/* Per-unit economics: ROI + payment breakdown */}
              <UnitEconomics
                price={selectedUnit.price}
                yieldPct={yieldPct}
                growthPct={growthPct}
                paymentPlan={paymentPlan}
                lang={i18n.language}
              />

              {/* 收益模拟器入口 —— **只对经纪显示**。
                  合伙人:「感觉客户目前用不到、用不明白」,工具已搬进经纪台。
                  项目详情页是买家也会看的公开页,所以这里必须按角色收起,
                  否则买家点进去会撞经纪审批门(看到一个自己进不去的功能比没有更糟)。 */}
              {isAgent && (
              <Link
                to={`/agent/roi?project=${encodeURIComponent(projectId)}&unit=${encodeURIComponent(selectedUnit.id)}`}
                className="mt-6 inline-flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-700 transition hover:bg-teal-100"
              >
                <LineChart className="h-4 w-4" />
                {tRoi('entry.simulateUnit')}
              </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400">
              Select a unit
            </div>
          )}
        </div>
      </div>

      {/* Floor plan lightbox */}
      <ImageLightbox
        images={selectedUnit?.floor_plan_image ? [selectedUnit.floor_plan_image] : []}
        initialIndex={0}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  )
}
