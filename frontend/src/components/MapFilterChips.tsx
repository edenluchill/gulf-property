/**
 * 地图筛选 —— 全断点都是「即点即用」的 chips + popover,没有藏起来的抽屉。
 * - 桌面(md+):横排 chips,popover 往下开。
 * - 移动端:同一批 chips 竖排贴左边缘(2026-07-11 用户要求:手机也要像桌面一样
 *   直接看到/点到每个筛选项,不再是一个「筛选」按钮开底部抽屉),popover 往右飞出,
 *   不压地图中间。搜索框此时在底部 dock(见 MapPage)。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X } from 'lucide-react'
import { PropertyFilters } from '../types'
import { trackEvent } from '../lib/track'

interface Props {
  filters: PropertyFilters
  setFilters: (updater: (f: PropertyFilters) => PropertyFilters) => void
  developers: string[]
  /** 付款结构档位(如 "80/20"),由 MapPage 从 pins 去重而来;空数组则不显示该筛选 */
  paymentPlans?: string[]
}

type PriceKey = 'price0' | 'price1' | 'price2' | 'price3' | 'price4' | 'price5' | 'price6'
type StatusKey = 'any' | 'statusUnderConstruction' | 'statusUpcoming' | 'statusCompleted'

const PRICE_RANGES: { key: PriceKey; min?: number; max?: number }[] = [
  { key: 'price0' },
  { key: 'price1', max: 500000 },
  { key: 'price2', min: 500000, max: 1000000 },
  { key: 'price3', min: 1000000, max: 2000000 },
  { key: 'price4', min: 2000000, max: 5000000 },
  { key: 'price5', min: 5000000, max: 10000000 },
  { key: 'price6', min: 10000000 },
]
const BEDS: { key: string; v: number | undefined }[] = [
  { key: 'any', v: undefined },
  { key: 'studio', v: 0 }, { key: '1', v: 1 }, { key: '2', v: 2 },
  { key: '3', v: 3 }, { key: '4', v: 4 },
]
const STATUS: { key: StatusKey; v?: PropertyFilters['status'] }[] = [
  { key: 'any', v: undefined },
  { key: 'statusUnderConstruction', v: 'under-construction' },
  { key: 'statusUpcoming', v: 'upcoming' },
  { key: 'statusCompleted', v: 'completed' },
]

// 交房年份:当前年起 5 个具体年 + 一个「及以后」桶。用现有 completionDate* 字段表达,
// 一套过滤逻辑同时驱动 FilterDialog 的日期区间。
const HANDOVER_BASE = new Date().getFullYear()
const HANDOVER_OPTS: { year: number | null; plus?: boolean }[] = [
  { year: null },
  ...[0, 1, 2, 3, 4].map(i => ({ year: HANDOVER_BASE + i })),
  { year: HANDOVER_BASE + 5, plus: true },
]

export default function MapFilterChips({ filters, setFilters, developers, paymentPlans = [] }: Props) {
  const { t } = useTranslation('filter')
  const [open, setOpen] = useState<string | null>(null)   // 当前展开的 chip popover
  const [devQuery, setDevQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  const priceText = (key: PriceKey) => t(`chips.${key}`)
  const bedText = (b: { key: string; v: number | undefined }) =>
    b.v === undefined ? t('chips.any')
      : b.v === 0 ? t('chips.studio')
      : t('chips.bedsPlus', { n: b.v })
  const statusText = (key: StatusKey) => t(`chips.${key}`)
  const handoverOptLabel = (o: { year: number | null; plus?: boolean }) =>
    o.year === null ? t('chips.any') : o.plus ? t('chips.yearPlus', { y: o.year }) : String(o.year)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const priceLabel = (() => {
    const r = PRICE_RANGES.find(r => r.min === filters.minPrice && r.max === filters.maxPrice)
    return r && r.key !== 'price0' ? priceText(r.key) : null
  })()
  const bedLabel = filters.minBedrooms === undefined ? null
    : (filters.minBedrooms === 0 ? t('chips.studio') : t('chips.bedsPlus', { n: filters.minBedrooms }))
  const statusLabel = (() => {
    const s = STATUS.find(s => s.v === filters.status && s.v)
    return s ? statusText(s.key) : null
  })()
  const devLabel = filters.developer || null
  const payLabel = filters.paymentPlan || null
  // 交房年份当前选中态:从 completionDateStart/End 反推。具体年两端都设,「及以后」仅 start。
  const handoverLabel = (() => {
    const s = filters.completionDateStart
    if (!s) return null
    const y = s.slice(0, 4)
    return filters.completionDateEnd ? y : `${y}+`
  })()
  const handoverSel = (year: number | null, plus?: boolean) => {
    const s = filters.completionDateStart
    const e = filters.completionDateEnd
    if (year === null) return !s && !e
    if (plus) return s === `${year}-01-01` && !e
    return s === `${year}-01-01` && e === `${year}-12-31`
  }
  const activeCount = [priceLabel, bedLabel, statusLabel, devLabel, handoverLabel, payLabel].filter(Boolean).length
  const anyActive = activeCount > 0

  const clearAll = () => setFilters(f => ({
    ...f, minPrice: undefined, maxPrice: undefined,
    minBedrooms: undefined, status: undefined, developer: undefined,
    completionDateStart: undefined, completionDateEnd: undefined,
    paymentPlan: undefined,
  }))

  // ---- 筛选 = 主应用真正的"搜索"。下面四个 handler 既改 filter 又埋点,
  //      桌面/移动端共用。选「不限」(重置)不算一次搜索。 ----
  const applyPrice = (r: { key: PriceKey; min?: number; max?: number }) => {
    setFilters(f => ({ ...f, minPrice: r.min, maxPrice: r.max }))
    if (r.key !== 'price0') trackEvent('search', { query: priceText(r.key), kind: 'price' })
  }
  const applyBeds = (b: { key: string; v: number | undefined }) => {
    setFilters(f => ({ ...f, minBedrooms: b.v }))
    if (b.v !== undefined) trackEvent('search', { query: bedText(b), kind: 'beds' })
  }
  const applyStatus = (s: { key: StatusKey; v?: PropertyFilters['status'] }) => {
    setFilters(f => ({ ...f, status: s.v }))
    if (s.v) trackEvent('search', { query: statusText(s.key), kind: 'status' })
  }
  const applyDeveloper = (d: string) => {
    setFilters(f => ({ ...f, developer: d }))
    trackEvent('search', { query: d, kind: 'developer' })
  }
  const applyPayment = (label: string | undefined) => {
    setFilters(f => ({ ...f, paymentPlan: label }))
    if (label) trackEvent('search', { query: label, kind: 'payment' })
  }
  const applyHandover = (year: number | null, plus?: boolean) => {
    if (year === null) {
      setFilters(f => ({ ...f, completionDateStart: undefined, completionDateEnd: undefined }))
      return
    }
    setFilters(f => ({
      ...f,
      completionDateStart: `${year}-01-01`,
      completionDateEnd: plus ? undefined : `${year}-12-31`,
    }))
    trackEvent('search', { query: plus ? `${year}+` : String(year), kind: 'handover' })
  }

  // ---- chips 构件(全断点共用) ----
  // 手机竖排时标签可能很长(如价格区间),截断收窄,保证左侧只占一条窄带。
  const Chip = ({ id, base, active }: { id: string; base: string; active: string | null }) => (
    <button
      onClick={() => setOpen(open === id ? null : id)}
      className={`flex max-w-[42vw] items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur-sm transition-colors md:max-w-none md:py-1.5 ${
        active
          ? 'bg-primary text-white ring-primary'
          : 'bg-white/95 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
      }`}
    >
      <span className="truncate">{active || base}</span>
      <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
    </button>
  )
  // 手机:从 chip 右侧飞出(竖排 chips 在左边缘,往下开会盖住其它 chip);桌面:往下开。
  const POP_POS = 'absolute z-[1001] left-full top-0 ml-1.5 md:left-0 md:top-9 md:ml-0'
  const Pop = ({ children }: { children: React.ReactNode }) => (
    <div className={`${POP_POS} w-44 overflow-hidden rounded-xl bg-white/95 p-1 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl`}>
      {children}
    </div>
  )
  const Opt = ({ on, sel, children }: { on: () => void; sel: boolean; children: React.ReactNode }) => (
    <button
      onClick={() => { on(); setOpen(null) }}
      className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-xs transition-colors ${
        sel ? 'bg-primary/10 text-primary font-medium' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div ref={ref} className="contents">
      {/* ===== chips:手机竖排贴左,md+ 横排 ===== */}
      <div className="flex flex-col items-start gap-1.5 md:flex-row md:flex-wrap md:items-center">
        <div className="relative shrink-0">
          <Chip id="price" base={t('chips.price')} active={priceLabel} />
          {open === 'price' && (
            <Pop>
              {PRICE_RANGES.map(r => (
                <Opt key={r.key}
                  sel={r.min === filters.minPrice && r.max === filters.maxPrice}
                  on={() => applyPrice(r)}>
                  {priceText(r.key)}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="beds" base={t('chips.beds')} active={bedLabel} />
          {open === 'beds' && (
            <Pop>
              {BEDS.map(b => (
                <Opt key={b.key} sel={filters.minBedrooms === b.v}
                  on={() => applyBeds(b)}>
                  {bedText(b)}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="status" base={t('chips.status')} active={statusLabel} />
          {open === 'status' && (
            <Pop>
              {STATUS.map(s => (
                <Opt key={s.key} sel={filters.status === s.v && !!s.v}
                  on={() => applyStatus(s)}>
                  {statusText(s.key)}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="handover" base={t('chips.handover')} active={handoverLabel} />
          {open === 'handover' && (
            <Pop>
              {HANDOVER_OPTS.map(o => (
                <Opt key={o.year ?? 'any'} sel={handoverSel(o.year, o.plus)}
                  on={() => applyHandover(o.year, o.plus)}>
                  {handoverOptLabel(o)}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        {paymentPlans.length > 0 && (
          <div className="relative shrink-0">
            <Chip id="payment" base={t('chips.payment')} active={payLabel} />
            {open === 'payment' && (
              <Pop>
                <Opt sel={!filters.paymentPlan} on={() => applyPayment(undefined)}>
                  {t('chips.any')}
                </Opt>
                {paymentPlans.map(p => (
                  <Opt key={p} sel={filters.paymentPlan === p} on={() => applyPayment(p)}>
                    {p}
                  </Opt>
                ))}
              </Pop>
            )}
          </div>
        )}
        <div className="relative shrink-0">
          <Chip id="dev" base={t('chips.developer')} active={devLabel} />
          {open === 'dev' && (
            <div className={`${POP_POS} w-60 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl`}>
              <input
                autoFocus value={devQuery} onChange={e => setDevQuery(e.target.value)}
                placeholder={t('chips.searchDeveloper')}
                className="w-full border-b border-slate-100 bg-transparent px-3 py-2 text-xs focus:outline-none"
              />
              <div className="max-h-56 overflow-y-auto p-1">
                <Opt sel={!filters.developer}
                  on={() => { setFilters(f => ({ ...f, developer: undefined })); setDevQuery('') }}>
                  {t('chips.any')}
                </Opt>
                {developers
                  .filter(d => d.toLowerCase().includes(devQuery.toLowerCase()))
                  .slice(0, 50)
                  .map(d => (
                    <Opt key={d} sel={filters.developer === d}
                      on={() => applyDeveloper(d)}>
                      {d}
                    </Opt>
                  ))}
              </div>
            </div>
          )}
        </div>
        {anyActive && (
          <button
            onClick={clearAll}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-white/95 px-2.5 py-1.5 text-xs text-slate-500 shadow-lg ring-1 ring-slate-900/[0.06] hover:bg-white hover:text-slate-700"
          >
            <X className="h-3 w-3" /> {t('chips.clear')}
          </button>
        )}
      </div>
    </div>
  )
}
