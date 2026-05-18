/**
 * 内联筛选 chips + 小 popover —— 替代浓重的 FilterDialog 大模态。
 * 价格 / 卧室 / 状态 / 开发商,各自独立小浮层,即点即用。
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
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
  const [open, setOpen] = useState<string | null>(null)
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
  const anyActive = !!(priceLabel || bedLabel || statusLabel || devLabel)

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

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-1.5">
      {/* 价格 */}
      <div className="relative">
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

      {/* 卧室 */}
      <div className="relative">
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

      {/* 状态 */}
      <div className="relative">
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

      {/* 开发商(可搜索) */}
      <div className="relative">
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
          onClick={() => setFilters(f => ({
            ...f, minPrice: undefined, maxPrice: undefined,
            minBedrooms: undefined, status: undefined, developer: undefined
          }))}
          className="flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-1.5 text-xs text-slate-500 ring-1 ring-slate-900/[0.06] hover:bg-white hover:text-slate-700"
        >
          <X className="h-3 w-3" /> 清除
        </button>
      )}
    </div>
  )
}
