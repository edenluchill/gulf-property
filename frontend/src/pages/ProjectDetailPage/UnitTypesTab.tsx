import { useState, useEffect, useMemo } from 'react'
import { Button } from '../../components/ui/button'
import { Bed, Bath, Maximize, Waves, Building2 } from 'lucide-react'
import { formatPrice } from '../../lib/utils'
import { formatMoneyFull } from '../../lib/money'
import DirhamSymbol from '../../components/DirhamSymbol'
import { UnitTypeDetailSheet } from './UnitTypeDetailSheet'
import { UnitType, PaymentPlan } from '../../types'
import { useTranslation } from 'react-i18next'
import { UnitTypeFavoriteButton } from '../../components/favorites'

interface UnitTypesTabProps {
  unitTypes: UnitType[]
  projectId?: string
  onUnitSelect?: (unitId: string) => void
  yieldPct?: number | null
  growthPct?: number | null
  paymentPlan?: PaymentPlan[]
}

type SortKey = 'price' | 'area' | 'beds'
const isSeaView = (v?: string) => !!v && /sea|marina|water|ocean|海|beach|lagoon/i.test(v)

export function UnitTypesTab({ unitTypes, projectId, onUnitSelect, yieldPct, growthPct, paymentPlan }: UnitTypesTabProps) {
  const { t, i18n } = useTranslation(['project', 'common'])
  const zh = i18n.language?.startsWith('zh')
  const [selectedUnit, setSelectedUnit] = useState<UnitType | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [bedFilter, setBedFilter] = useState<number | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('price')

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Available bedroom counts for the filter chips.
  const bedOptions = useMemo(
    () => [...new Set(unitTypes.map((u) => u.bedrooms))].sort((a, b) => a - b),
    [unitTypes]
  )

  const shown = useMemo(() => {
    let list = unitTypes
    if (bedFilter !== 'all') list = list.filter((u) => u.bedrooms === bedFilter)
    const num = (v: unknown) => parseFloat(String(v)) || 0
    return [...list].sort((a, b) => {
      if (sortKey === 'price') return num(a.price) - num(b.price)
      if (sortKey === 'area') return num(a.area) - num(b.area)
      return a.bedrooms - b.bedrooms
    })
  }, [unitTypes, bedFilter, sortKey])

  const handleUnitClick = (unit: UnitType) => {
    if (onUnitSelect && !isMobile) {
      onUnitSelect(unit.id)
      return
    }
    setSelectedUnit(unit)
    setIsModalOpen(true)
  }

  if (unitTypes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="mb-4">{t('project:unitTypesTab.emptyMessage')}</p>
        <Button>{t('common:buttons.requestUnitInfo')}</Button>
      </div>
    )
  }

  const bedLabel = (n: number) => (n === 0 ? (zh ? '工作室' : 'Studio') : `${n}${zh ? '室' : 'BR'}`)
  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  )

  return (
    <>
      {/* Toolbar: bedroom filter + sort + count */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={bedFilter === 'all'} onClick={() => setBedFilter('all')}>
            {zh ? '全部' : 'All'}
          </Chip>
          {bedOptions.map((n) => (
            <Chip key={n} active={bedFilter === n} onClick={() => setBedFilter(n)}>
              {bedLabel(n)}
            </Chip>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 focus:outline-none"
          >
            <option value="price">{zh ? '价格 ↑' : 'Price ↑'}</option>
            <option value="area">{zh ? '面积 ↑' : 'Size ↑'}</option>
            <option value="beds">{zh ? '卧室 ↑' : 'Beds ↑'}</option>
          </select>
          <span className="text-xs text-slate-400">{shown.length}{zh ? ' 种' : ''}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {shown.map((unit) => {
          const ppsf = unit.price_per_sqft || (unit.price && parseFloat(unit.area) ? unit.price / parseFloat(unit.area) : 0)
          return (
            <div
              key={unit.id}
              onClick={() => handleUnitClick(unit)}
              className="group relative bg-white border rounded-xl overflow-hidden hover:shadow-md hover:border-slate-300 transition-all cursor-pointer"
            >
              {/* Floor Plan Image + badges */}
              {unit.floor_plan_image && (
                <div className="relative aspect-square bg-slate-50 overflow-hidden">
                  <img
                    src={unit.floor_plan_image}
                    alt={unit.unit_type_name}
                    className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                  />
                  {/* view / floor badges */}
                  <div className="absolute bottom-1.5 left-1.5 flex flex-wrap gap-1">
                    {unit.view_type && (
                      <span className="flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
                        {isSeaView(unit.view_type) ? <Waves className="h-2.5 w-2.5 text-sky-500" /> : <Building2 className="h-2.5 w-2.5 text-slate-400" />}
                        {unit.view_type}
                      </span>
                    )}
                    {unit.floor_level && (
                      <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm backdrop-blur">
                        {unit.floor_level}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {projectId && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <UnitTypeFavoriteButton projectId={projectId} unitTypeId={unit.id} size="sm" />
                </div>
              )}

              <div className="p-3">
                <div className="font-medium text-sm text-slate-900 truncate mb-1.5">{unit.unit_type_name}</div>

                <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                  <span className="flex items-center gap-1" title={`${unit.bedrooms} Bedrooms`}>
                    <Bed className="h-3.5 w-3.5" />
                    {unit.bedrooms}
                  </span>
                  <span className="flex items-center gap-1" title={`${unit.bathrooms} Bathrooms`}>
                    <Bath className="h-3.5 w-3.5" />
                    {unit.bathrooms}
                  </span>
                  {(() => {
                    // Chinese buyers think in m²; show their unit first, the other in tooltip.
                    const sqft = parseFloat(unit.area)
                    const sqftStr = Number.isFinite(sqft) ? sqft.toLocaleString() : '—'
                    const sqm = Number.isFinite(sqft) ? Math.round(sqft * 0.092903) : null
                    return (
                      <span className="flex items-center gap-1" title={zh ? `${sqftStr} sqft` : (sqm != null ? `${sqm} m²` : '')}>
                        <Maximize className="h-3.5 w-3.5" />
                        {zh ? (sqm != null ? `${sqm}㎡` : sqftStr) : sqftStr}
                      </span>
                    )
                  })()}
                </div>

                {unit.price ? (
                  <div className="flex items-baseline justify-between gap-1">
                    <div className="font-semibold text-primary text-sm">{formatPrice(unit.price)}</div>
                    {ppsf > 0 && (
                      <div className="text-[10px] text-slate-400 whitespace-nowrap">
                        <DirhamSymbol size="0.8em" className="mr-0.5" />
                        {formatMoneyFull(ppsf)}/sqft
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {isMobile && (
        <UnitTypeDetailSheet
          unit={selectedUnit}
          projectId={projectId}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          yieldPct={yieldPct}
          growthPct={growthPct}
          paymentPlan={paymentPlan}
        />
      )}
    </>
  )
}
