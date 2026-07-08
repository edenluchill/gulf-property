/**
 * 地图筛选。
 * - 桌面(md+):内联 chips + 小 popover,即点即用。
 * - 移动端:单个「筛选」按钮 → 底部抽屉(bottom sheet),大按钮、可滚、不与右侧控件抢位。
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X, SlidersHorizontal, Wallet, BedDouble, Hammer, Building2, Check, CalendarClock } from 'lucide-react'
import { PropertyFilters } from '../types'
import { trackEvent } from '../lib/track'

// 按开发商名生成稳定的彩色头像配色（让长列表一眼可区分）
const AVATAR_PALETTE = [
  'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700', 'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700', 'bg-fuchsia-100 text-fuchsia-700',
  'bg-teal-100 text-teal-700', 'bg-orange-100 text-orange-700',
]
const avatarColor = (name: string) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

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
  const [open, setOpen] = useState<string | null>(null)   // 桌面 popover
  const [sheet, setSheet] = useState(false)                // 移动端抽屉
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

  // ---- 桌面构件 ----
  const Chip = ({ id, base, active }: { id: string; base: string; active: string | null }) => (
    <button
      onClick={() => setOpen(open === id ? null : id)}
      className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium shadow-lg ring-1 backdrop-blur-sm transition-colors ${
        active
          ? 'bg-primary text-white ring-primary'
          : 'bg-white/95 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
      }`}
    >
      {active || base}
      <ChevronDown className="h-3 w-3 opacity-70" />
    </button>
  )
  const Pop = ({ children }: { children: React.ReactNode }) => (
    <div className="absolute left-0 top-9 z-[1001] w-44 overflow-hidden rounded-xl bg-white/95 p-1 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl">
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

  // ---- 移动端抽屉构件 ----
  // 选项排:真选项选中→实心 primary;"不限"=重置,选中时只做淡描边(不抢视线)
  const SheetRow = ({ label, sel, isDefault, on }: { label: string; sel: boolean; isDefault?: boolean; on: () => void }) => (
    <button
      onClick={on}
      className={`rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors ${
        sel && !isDefault ? 'bg-primary text-white ring-primary shadow-sm'
          : sel && isDefault ? 'bg-primary/5 text-primary ring-primary/30'
          : 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  )
  const Section = ({ icon: Icon, title, hint, children }: {
    icon: typeof Wallet; title: string; hint?: string; children: React.ReactNode
  }) => (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      {children}
    </section>
  )

  return (
    <div ref={ref} className="contents">
      {/* ===== 桌面:内联 chips ===== */}
      <div className="hidden md:flex flex-wrap items-center gap-1.5">
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
            <div className="absolute left-0 top-9 z-[1001] w-60 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl">
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

      {/* ===== 移动端:单按钮 ===== */}
      <button
        onClick={() => setSheet(true)}
        className={`md:hidden flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-semibold shadow-lg ring-1 backdrop-blur-sm transition-all active:scale-95 ${
          anyActive ? 'bg-primary text-white ring-primary' : 'bg-white/95 text-slate-600 ring-slate-900/[0.06]'
        }`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {t('chips.filter')}
        {anyActive && (
          <span className="ml-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-primary">
            {activeCount}
          </span>
        )}
      </button>

      {/* ===== 移动端:底部抽屉 ===== */}
      {sheet && (
        <div className="md:hidden fixed inset-0 z-[2000]">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{t('chips.filterListings')}</h3>
              <button onClick={() => setSheet(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6">
              <Section icon={Wallet} title={t('chips.price')} hint={t('chips.aed')}>
                <div className="flex flex-wrap gap-2">
                  {PRICE_RANGES.map(r => (
                    <SheetRow key={r.key} label={priceText(r.key)}
                      isDefault={r.key === 'price0'}
                      sel={r.min === filters.minPrice && r.max === filters.maxPrice}
                      on={() => applyPrice(r)} />
                  ))}
                </div>
              </Section>

              <Section icon={BedDouble} title={t('chips.beds')}>
                <div className="flex flex-wrap gap-2">
                  {BEDS.map(b => (
                    <SheetRow key={b.key} label={bedText(b)}
                      isDefault={b.v === undefined}
                      sel={filters.minBedrooms === b.v}
                      on={() => applyBeds(b)} />
                  ))}
                </div>
              </Section>

              <Section icon={Hammer} title={t('chips.status')} hint={t('chips.constructionProgress')}>
                <div className="flex flex-wrap gap-2">
                  {STATUS.map(s => (
                    <SheetRow key={s.key} label={statusText(s.key)}
                      isDefault={!s.v}
                      sel={s.v ? filters.status === s.v : !filters.status}
                      on={() => applyStatus(s)} />
                  ))}
                </div>
              </Section>

              <Section icon={CalendarClock} title={t('chips.handover')} hint={t('chips.handoverHint')}>
                <div className="flex flex-wrap gap-2">
                  {HANDOVER_OPTS.map(o => (
                    <SheetRow key={o.year ?? 'any'} label={handoverOptLabel(o)}
                      isDefault={o.year === null}
                      sel={handoverSel(o.year, o.plus)}
                      on={() => applyHandover(o.year, o.plus)} />
                  ))}
                </div>
              </Section>

              {paymentPlans.length > 0 && (
                <Section icon={Wallet} title={t('chips.payment')} hint={t('chips.paymentHint')}>
                  <div className="flex flex-wrap gap-2">
                    <SheetRow label={t('chips.any')} isDefault
                      sel={!filters.paymentPlan}
                      on={() => applyPayment(undefined)} />
                    {paymentPlans.map(p => (
                      <SheetRow key={p} label={p}
                        sel={filters.paymentPlan === p}
                        on={() => applyPayment(p)} />
                    ))}
                  </div>
                </Section>
              )}

              <Section icon={Building2} title={t('chips.developer')}
                hint={filters.developer ? t('chips.selected', { name: filters.developer }) : undefined}>
                <div className="relative mb-2">
                  <input
                    value={devQuery} onChange={e => setDevQuery(e.target.value)}
                    placeholder={t('chips.searchDeveloper')}
                    className="w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto pr-0.5">
                  <button
                    onClick={() => { setFilters(f => ({ ...f, developer: undefined })); setDevQuery('') }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors ${
                      !filters.developer ? 'bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <X className="h-4 w-4" />
                    </span>
                    <span className={`flex-1 ${!filters.developer ? 'font-semibold text-primary' : 'text-slate-700'}`}>
                      {t('chips.anyAllDevelopers')}
                    </span>
                  </button>
                  {developers
                    .filter(d => d.toLowerCase().includes(devQuery.toLowerCase()))
                    .slice(0, 60)
                    .map(d => {
                      const on = filters.developer === d
                      return (
                        <button key={d}
                          onClick={() => applyDeveloper(d)}
                          className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-sm transition-colors ${
                            on ? 'bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-slate-50'
                          }`}
                        >
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarColor(d)}`}>
                            {d.trim().charAt(0).toUpperCase()}
                          </span>
                          <span className={`flex-1 truncate ${on ? 'font-semibold text-primary' : 'text-slate-700'}`}>
                            {d}
                          </span>
                          {on && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </button>
                      )
                    })}
                </div>
              </Section>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={clearAll}
                disabled={!anyActive}
                className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-medium text-slate-600 disabled:opacity-40"
              >
                {t('chips.clearAll')}
              </button>
              <button
                onClick={() => setSheet(false)}
                className="flex-[2] rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
              >
                {t('chips.viewResults')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
