/**
 * 地图筛选。
 * - 桌面(md+):内联 chips + 小 popover,即点即用。
 * - 移动端:单个「筛选」按钮 → 底部抽屉(bottom sheet),大按钮、可滚、不与右侧控件抢位。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, SlidersHorizontal } from 'lucide-react'
import { PropertyFilters } from '../types'

interface Props {
  filters: PropertyFilters
  setFilters: (updater: (f: PropertyFilters) => PropertyFilters) => void
  developers: string[]
}

const PRICE_RANGES: { label: string; min?: number; max?: number }[] = [
  { label: '不限' },
  { label: '≤ 50万', max: 500000 },
  { label: '50–100万', min: 500000, max: 1000000 },
  { label: '100–200万', min: 1000000, max: 2000000 },
  { label: '200–500万', min: 2000000, max: 5000000 },
  { label: '500–1000万', min: 5000000, max: 10000000 },
  { label: '1000万+', min: 10000000 },
]
const BEDS = [
  { label: '不限', v: undefined as number | undefined },
  { label: 'Studio', v: 0 }, { label: '1+', v: 1 }, { label: '2+', v: 2 },
  { label: '3+', v: 3 }, { label: '4+', v: 4 },
]
const STATUS: { label: string; v?: PropertyFilters['status'] }[] = [
  { label: '不限', v: undefined },
  { label: '在建', v: 'under-construction' },
  { label: '待开盘', v: 'upcoming' },
  { label: '已完工', v: 'completed' },
]

export default function MapFilterChips({ filters, setFilters, developers }: Props) {
  const [open, setOpen] = useState<string | null>(null)   // 桌面 popover
  const [sheet, setSheet] = useState(false)                // 移动端抽屉
  const [devQuery, setDevQuery] = useState('')
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const priceLabel = (() => {
    const r = PRICE_RANGES.find(r => r.min === filters.minPrice && r.max === filters.maxPrice)
    return r && r.label !== '不限' ? r.label : null
  })()
  const bedLabel = filters.minBedrooms === undefined ? null
    : (filters.minBedrooms === 0 ? 'Studio' : `${filters.minBedrooms}+`)
  const statusLabel = STATUS.find(s => s.v === filters.status && s.v)?.label || null
  const devLabel = filters.developer || null
  const activeCount = [priceLabel, bedLabel, statusLabel, devLabel].filter(Boolean).length
  const anyActive = activeCount > 0

  const clearAll = () => setFilters(f => ({
    ...f, minPrice: undefined, maxPrice: undefined,
    minBedrooms: undefined, status: undefined, developer: undefined,
  }))

  // ---- 桌面构件 ----
  const Chip = ({ id, base, active }: { id: string; base: string; active: string | null }) => (
    <button
      onClick={() => setOpen(open === id ? null : id)}
      className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ring-1 backdrop-blur transition-colors ${
        active
          ? 'bg-primary text-white ring-primary'
          : 'bg-white/85 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
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

  // ---- 移动端抽屉里的选项排 ----
  const SheetRow = ({ label, sel, on }: { label: string; sel: boolean; on: () => void }) => (
    <button
      onClick={on}
      className={`rounded-full px-4 py-2 text-sm font-medium ring-1 transition-colors ${
        sel ? 'bg-primary text-white ring-primary' : 'bg-slate-50 text-slate-700 ring-slate-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div ref={ref} className="contents">
      {/* ===== 桌面:内联 chips ===== */}
      <div className="hidden md:flex flex-wrap items-center gap-1.5">
        <div className="relative shrink-0">
          <Chip id="price" base="价格" active={priceLabel} />
          {open === 'price' && (
            <Pop>
              {PRICE_RANGES.map(r => (
                <Opt key={r.label}
                  sel={r.min === filters.minPrice && r.max === filters.maxPrice}
                  on={() => setFilters(f => ({ ...f, minPrice: r.min, maxPrice: r.max }))}>
                  {r.label}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="beds" base="卧室" active={bedLabel} />
          {open === 'beds' && (
            <Pop>
              {BEDS.map(b => (
                <Opt key={b.label} sel={filters.minBedrooms === b.v}
                  on={() => setFilters(f => ({ ...f, minBedrooms: b.v }))}>
                  {b.label}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="status" base="状态" active={statusLabel} />
          {open === 'status' && (
            <Pop>
              {STATUS.map(s => (
                <Opt key={s.label} sel={filters.status === s.v && !!s.v}
                  on={() => setFilters(f => ({ ...f, status: s.v }))}>
                  {s.label}
                </Opt>
              ))}
            </Pop>
          )}
        </div>
        <div className="relative shrink-0">
          <Chip id="dev" base="开发商" active={devLabel} />
          {open === 'dev' && (
            <div className="absolute left-0 top-9 z-[1001] w-60 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl">
              <input
                autoFocus value={devQuery} onChange={e => setDevQuery(e.target.value)}
                placeholder="搜索开发商…"
                className="w-full border-b border-slate-100 bg-transparent px-3 py-2 text-xs focus:outline-none"
              />
              <div className="max-h-56 overflow-y-auto p-1">
                <Opt sel={!filters.developer}
                  on={() => { setFilters(f => ({ ...f, developer: undefined })); setDevQuery('') }}>
                  不限
                </Opt>
                {developers
                  .filter(d => d.toLowerCase().includes(devQuery.toLowerCase()))
                  .slice(0, 50)
                  .map(d => (
                    <Opt key={d} sel={filters.developer === d}
                      on={() => setFilters(f => ({ ...f, developer: d }))}>
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
            className="flex shrink-0 items-center gap-1 rounded-full bg-white/85 px-2.5 py-1.5 text-xs text-slate-500 ring-1 ring-slate-900/[0.06] hover:bg-white hover:text-slate-700"
          >
            <X className="h-3 w-3" /> 清除
          </button>
        )}
      </div>

      {/* ===== 移动端:单按钮 ===== */}
      <button
        onClick={() => setSheet(true)}
        className={`md:hidden flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur transition-colors ${
          anyActive ? 'bg-primary text-white ring-primary' : 'bg-white/90 text-slate-700 ring-slate-900/[0.06]'
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        筛选
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
              <h3 className="text-base font-semibold text-slate-900">筛选房源</h3>
              <button onClick={() => setSheet(false)} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5">
              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">价格</p>
                <div className="flex flex-wrap gap-2">
                  {PRICE_RANGES.map(r => (
                    <SheetRow key={r.label} label={r.label}
                      sel={r.min === filters.minPrice && r.max === filters.maxPrice}
                      on={() => setFilters(f => ({ ...f, minPrice: r.min, maxPrice: r.max }))} />
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">卧室</p>
                <div className="flex flex-wrap gap-2">
                  {BEDS.map(b => (
                    <SheetRow key={b.label} label={b.label}
                      sel={filters.minBedrooms === b.v}
                      on={() => setFilters(f => ({ ...f, minBedrooms: b.v }))} />
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">状态</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS.map(s => (
                    <SheetRow key={s.label} label={s.label}
                      sel={filters.status === s.v && !!s.v ? true : (!s.v && !filters.status)}
                      on={() => setFilters(f => ({ ...f, status: s.v }))} />
                  ))}
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">开发商</p>
                <input
                  value={devQuery} onChange={e => setDevQuery(e.target.value)}
                  placeholder="搜索开发商…"
                  className="mb-2 w-full rounded-xl bg-slate-50 px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:outline-none focus:ring-primary"
                />
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  <button
                    onClick={() => { setFilters(f => ({ ...f, developer: undefined })); setDevQuery('') }}
                    className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm ${
                      !filters.developer ? 'bg-primary/10 font-medium text-primary' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    不限
                  </button>
                  {developers
                    .filter(d => d.toLowerCase().includes(devQuery.toLowerCase()))
                    .slice(0, 50)
                    .map(d => (
                      <button key={d}
                        onClick={() => setFilters(f => ({ ...f, developer: d }))}
                        className={`block w-full rounded-lg px-3 py-2.5 text-left text-sm ${
                          filters.developer === d ? 'bg-primary/10 font-medium text-primary' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                </div>
              </section>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={clearAll}
                disabled={!anyActive}
                className="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-medium text-slate-600 disabled:opacity-40"
              >
                清除全部
              </button>
              <button
                onClick={() => setSheet(false)}
                className="flex-[2] rounded-2xl bg-primary py-3 text-sm font-semibold text-white"
              >
                查看结果
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
