/**
 * 地图筛选 —— 全断点都是「即点即用」的 chips + popover,没有藏起来的抽屉。
 * - 桌面(md+):横排 chips,popover 往下开。
 * - 移动端:同一批 chips 竖排贴左边缘(2026-07-11 用户要求:手机也要像桌面一样
 *   直接看到/点到每个筛选项,不再是一个「筛选」按钮开底部抽屉),popover 往右飞出,
 *   不压地图中间。搜索框此时在底部 dock(见 MapPage)。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, X, Tag, BedDouble, Hammer, CalendarClock, Building2 } from 'lucide-react'
import { PropertyFilters } from '../types'
import { trackEvent } from '../lib/track'

interface Props {
  filters: PropertyFilters
  setFilters: (updater: (f: PropertyFilters) => PropertyFilters) => void
  developers: string[]
  /** 卡内最上面的额外按钮(指北针)——手机上和筛选融成一张卡 */
  leading?: React.ReactNode
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

export default function MapFilterChips({ filters, setFilters, developers, leading }: Props) {
  const { t } = useTranslation('filter')
  const [open, setOpen] = useState<string | null>(null)   // 当前展开的 chip popover
  const [devQuery, setDevQuery] = useState('')

  const priceText = (key: PriceKey) => t(`chips.${key}`)
  const bedText = (b: { key: string; v: number | undefined }) =>
    b.v === undefined ? t('chips.any')
      : b.v === 0 ? t('chips.studio')
      : t('chips.bedsPlus', { n: b.v })
  const statusText = (key: StatusKey) => t(`chips.${key}`)
  const handoverOptLabel = (o: { year: number | null; plus?: boolean }) =>
    o.year === null ? t('chips.any') : o.plus ? t('chips.yearPlus', { y: o.year }) : String(o.year)

  // 关掉下拉靠下面那层遮罩(见 render),不要再挂 window mousedown:
  // 它会在 mousedown 阶段就 setOpen(null) → 遮罩当场消失 → 紧接着的 click 落到地图上,
  // 把区域给选中了(弹出区域面板盖住底部搜索)。点地图只应该关下拉。
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
  const activeCount = [priceLabel, bedLabel, statusLabel, devLabel, handoverLabel].filter(Boolean).length
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

  // ---- chips 构件 ----
  // 手机:**纯图标方块,固定 44×44**。文字进按钮 → 中英文宽度不一样,整列参差不齐
  // (2026-07-11 用户反馈:中文还行,英文很难看)。名字在点开后的下拉标题里给,
  // 选中态 = 主色填充 + 右上角小圆点。
  // md+:仍是带文字的 chip(横排一行,宽度不敏感)。
  // 手机:卡内无边框图标按钮(卡本身出阴影,不再各自浮起);选中=主色填充(和右上
  // panel 内按钮同款),不用再挂小圆点。md+:仍是带文字、自带阴影的独立 chip。
  const Chip = ({ id, base, active, Icon }: { id: string; base: string; active: string | null; Icon: typeof Tag }) => (
    <button
      onClick={() => setOpen(open === id ? null : id)}
      aria-label={active ? `${base}: ${active}` : base}
      title={active ? `${base}: ${active}` : base}
      className={`relative flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 md:h-auto md:w-auto md:gap-1 md:rounded-xl md:px-3 md:py-1.5 md:text-xs md:font-medium md:shadow-lg md:ring-1 md:backdrop-blur-sm ${
        active
          // 有筛选值 → 主色填充(和右上 panel 里的选中态同款)
          ? 'bg-primary text-white shadow-sm shadow-primary/40 md:ring-primary'
          : open === id
            // 正在展开这颗的下拉 → 浅底,让人看得出在编辑哪一项
            ? 'bg-slate-200 text-slate-900 md:bg-white md:text-slate-900 md:ring-slate-300'
            : 'text-slate-600 hover:bg-slate-100 md:bg-white/95 md:text-slate-700 md:ring-slate-900/[0.06] md:hover:bg-white'
      }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 md:hidden" />
      <span className="hidden md:inline">{active || base}</span>
      <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-70 md:block" />
    </button>
  )
  // 手机:从 chip 右侧飞出(竖排 chips 在左边缘,往下开会盖住其它 chip);桌面:往下开。
  const POP_POS = 'absolute z-[1001] left-full top-0 ms-1.5 md:left-0 md:top-9 md:ms-0'
  // 手机是纯图标按钮,所以下拉必须自报家门:顶部一行标题(桌面 chip 上已有文字,不重复)。
  const Pop = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className={`${POP_POS} animate-filter-pop w-44 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl`}>
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 md:hidden">
        {title}
      </div>
      <div className="filter-pop-list p-1">{children}</div>
    </div>
  )
  const Opt = ({ on, sel, children }: { on: () => void; sel: boolean; children: React.ReactNode }) => (
    <button
      onClick={() => { on(); setOpen(null) }}
      className={`flex w-full items-center rounded-lg px-3 py-2 text-start text-xs transition-colors ${
        sel ? 'bg-primary/10 text-primary font-medium' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )

  return (
    <div className="contents">
      {/* 下拉打开时的透明遮罩:点地图只关下拉,不会顺手把区域给选中了(会弹出区域面板,
          盖住底部搜索)。chips(父层 z-1002)和 popover(z-1001)都在它之上,照常可点。 */}
      {open && (
        <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(null)} />
      )}

      {/* ===== chips:手机竖排收进「一张整合卡」(和右上指标卡/工具卡同款
           rounded-2xl+白95+柔和 ring+阴影),内部按钮无边框;md+ 化整为零,恢复
           透明横排、每个 chip 自带阴影。 ===== */}
      {/* ⚠️ relative z-[1001] 不能删:这张卡有 backdrop-blur → 自成层叠上下文,卡本身
          若不给 z-index(=auto),就会整体排在遮罩(z-1000)下面 —— 连带里面弹出的
          下拉一起被遮罩吃掉点击,真机上「筛选选项点了没反应」(2026-07-11 实测)。 */}
      <div className="relative z-[1001] flex w-9 flex-col items-center gap-1 rounded-2xl bg-white/95 p-1 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm md:w-auto md:flex-row md:flex-wrap md:items-center md:gap-1.5 md:rounded-none md:bg-transparent md:p-0 md:shadow-none md:ring-0 md:backdrop-blur-none">
        {/* 指北针(手机上并进这张卡,和筛选融为一体);md+ 也一起排进 chip 行 */}
        {leading}
        {leading && <span className="h-px w-4 shrink-0 bg-slate-200/80 md:hidden" />}
        <div className="relative shrink-0">
          <Chip id="price" base={t('chips.price')} active={priceLabel} Icon={Tag} />
          {open === 'price' && (
            <Pop title={t('chips.price')}>
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
          <Chip id="beds" base={t('chips.beds')} active={bedLabel} Icon={BedDouble} />
          {open === 'beds' && (
            <Pop title={t('chips.beds')}>
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
          <Chip id="status" base={t('chips.status')} active={statusLabel} Icon={Hammer} />
          {open === 'status' && (
            <Pop title={t('chips.status')}>
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
          <Chip id="handover" base={t('chips.handover')} active={handoverLabel} Icon={CalendarClock} />
          {open === 'handover' && (
            <Pop title={t('chips.handover')}>
              {HANDOVER_OPTS.map(o => (
                <Opt key={o.year ?? 'any'} sel={handoverSel(o.year, o.plus)}
                  on={() => applyHandover(o.year, o.plus)}>
                  {handoverOptLabel(o)}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        {/* 付款计划筛选已移除(2026-07-11 用户要求):付款结构仍在项目详情里看得到,
            只是不再作为地图筛选项——少一颗按钮,左侧更短。 */}
        <div className="relative shrink-0">
          <Chip id="dev" base={t('chips.developer')} active={devLabel} Icon={Building2} />
          {open === 'dev' && (
            <div className={`${POP_POS} animate-filter-pop w-60 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl`}>
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 md:hidden">
                {t('chips.developer')}
              </div>
              {/* autoFocus 只在桌面:手机上一点开就弹键盘,把下拉挤没了 */}
              <input
                autoFocus={typeof window !== 'undefined' && window.innerWidth >= 768}
                value={devQuery} onChange={e => setDevQuery(e.target.value)}
                placeholder={t('chips.searchDeveloper')}
                className="w-full border-b border-slate-100 bg-transparent px-3 py-2 text-xs focus:outline-none"
              />
              <div className="filter-pop-list max-h-56 overflow-y-auto p-1">
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
            aria-label={t('chips.clear')}
            title={t('chips.clear')}
            className="hidden shrink-0 items-center gap-1 rounded-xl bg-white/95 px-2.5 py-1.5 text-xs text-slate-500 shadow-lg ring-1 ring-slate-900/[0.06] hover:bg-white hover:text-slate-700 md:flex"
          >
            <X className="h-3 w-3" /> {t('chips.clear')}
          </button>
        )}
      </div>

      {/* 手机:按钮缩到 32px 后塞不下值了 → 卡下方挂一条「已选」摘要,
          写明当前筛了什么(2居+ · 100–200万),点 ✕ 一键清空。宽度固定、超长截断,
          不会因为中英文/长开发商名把布局撑坏。 */}
      {anyActive && (
        <div className="mt-1 flex w-[132px] items-center gap-1 rounded-xl bg-primary/95 px-2 py-1 shadow-lg ring-1 ring-primary/30 backdrop-blur-sm md:hidden">
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold leading-tight text-white">
            {[bedLabel, priceLabel, statusLabel, handoverLabel, devLabel].filter(Boolean).join(' · ')}
          </span>
          <button
            onClick={clearAll}
            aria-label={t('chips.clear')}
            className="shrink-0 rounded-full p-0.5 text-white/80 transition-transform active:scale-90 hover:bg-white/20 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
