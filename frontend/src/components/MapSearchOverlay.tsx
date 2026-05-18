/**
 * 浮在地图上的搜索胶囊（替代原 header 下白条）。
 * - 玻璃拟态圆角，绝对定位于地图左上（桌面 md+；避开右上指标/POI 控件）
 * - 输入时区域 autocomplete（防抖），选中 → 飞到该区域
 * - 自由文本仍驱动既有 pin 过滤（searchQuery）
 * - Filters / 刷新 按钮内嵌
 */
import { useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal, RefreshCw, X, MapPin } from 'lucide-react'
import { searchDubaiAreas, AreaSearchResult } from '../lib/api'

interface Props {
  searchQuery: string
  setSearchQuery: (v: string) => void
  onFly: (lat: number, lng: number) => void
  onToggleFilters: () => void
  hasActiveFilters: boolean
  onRefresh: () => void
  isRefreshing: boolean
  filtersLabel: string
}

export default function MapSearchOverlay({
  searchQuery, setSearchQuery, onFly, onToggleFilters,
  hasActiveFilters, onRefresh, isRefreshing, filtersLabel
}: Props) {
  const [suggestions, setSuggestions] = useState<AreaSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 防抖区域搜索
  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current)
    const q = searchQuery.trim()
    if (q.length < 2) { setSuggestions([]); return }
    setLoading(true)
    tRef.current = setTimeout(async () => {
      const res = await searchDubaiAreas(q)
      setSuggestions(res.slice(0, 6))
      setLoading(false)
      setOpen(true)
    }, 250)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [searchQuery])

  // 点击外部关闭下拉
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (s: AreaSearchResult) => {
    if (s.centroid) onFly(s.centroid.lat, s.centroid.lng)
    setSearchQuery(s.name)
    setOpen(false)
  }

  return (
    <div
      ref={boxRef}
      className="absolute top-4 left-4 z-[1000] hidden md:flex flex-col gap-2 w-[380px]"
    >
      <div className="flex items-center gap-2 rounded-2xl bg-white/85 px-2 py-2 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length && setOpen(true)}
            placeholder="搜索区域 / 项目 / 关键词"
            className="w-full rounded-xl bg-transparent py-2 pl-9 pr-7 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSuggestions([]); setOpen(false) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="清除"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={onToggleFilters}
          className="relative flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <SlidersHorizontal className="h-4 w-4" />
          {filtersLabel}
          {hasActiveFilters && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white" />
          )}
        </button>
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          title="刷新筛选数据"
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* autocomplete 下拉 */}
      {open && (loading || suggestions.length > 0) && (
        <div className="overflow-hidden rounded-2xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-xl">
          {loading && suggestions.length === 0 && (
            <div className="px-4 py-3 text-xs text-slate-400">搜索中…</div>
          )}
          {suggestions.map(s => (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <MapPin className="h-4 w-4" />
              </span>
              <span className="flex-1 truncate text-slate-800">{s.name}</span>
              {s.avgPriceSqm != null && (
                <span className="text-[11px] text-slate-400">
                  {Math.round(s.avgPriceSqm).toLocaleString()} /m²
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
