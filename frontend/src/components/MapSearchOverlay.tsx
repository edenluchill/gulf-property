/**
 * 浮在地图上的搜索胶囊（替代原 header 下白条）。
 * - 玻璃拟态圆角，绝对定位于地图左上（桌面 md+；避开右上指标/POI 控件）
 * - 输入时区域 autocomplete（防抖），选中 → 飞到该区域
 * - 自由文本仍驱动既有 pin 过滤（searchQuery）
 * - Filters / 刷新 按钮内嵌
 */
import { useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal, RefreshCw, X, MapPin, Building2, Briefcase } from 'lucide-react'
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
  developers: string[]
  projects: { project_name: string; developer: string }[]
  applyFilter: (patch: { developer?: string; project?: string }) => void
}

type Sugg =
  | { kind: 'area'; label: string; area: AreaSearchResult }
  | { kind: 'developer'; label: string }
  | { kind: 'project'; label: string; developer: string }

export default function MapSearchOverlay({
  searchQuery, setSearchQuery, onFly, onToggleFilters,
  hasActiveFilters, onRefresh, isRefreshing, filtersLabel,
  developers, projects, applyFilter
}: Props) {
  const [suggestions, setSuggestions] = useState<Sugg[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 防抖：区域(API) + 开发商/项目(客户端已加载数据) 合并建议
  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current)
    const q = searchQuery.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const ql = q.toLowerCase()
    setLoading(true)
    tRef.current = setTimeout(async () => {
      const areas = await searchDubaiAreas(q)
      const devs = developers
        .filter(d => d.toLowerCase().includes(ql)).slice(0, 4)
      const projs = projects
        .filter(p => p.project_name.toLowerCase().includes(ql)).slice(0, 5)
      const merged: Sugg[] = [
        ...areas.slice(0, 5).map(a => ({ kind: 'area' as const, label: a.name, area: a })),
        ...devs.map(d => ({ kind: 'developer' as const, label: d })),
        ...projs.map(p => ({ kind: 'project' as const, label: p.project_name, developer: p.developer })),
      ]
      setSuggestions(merged)
      setLoading(false)
      setOpen(true)
    }, 250)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [searchQuery, developers, projects])

  // 点击外部关闭下拉
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (s: Sugg) => {
    if (s.kind === 'area') {
      if (s.area.centroid) onFly(s.area.centroid.lat, s.area.centroid.lng)
      setSearchQuery(s.area.name)
    } else if (s.kind === 'developer') {
      applyFilter({ developer: s.label })
      setSearchQuery('')
    } else {
      applyFilter({ project: s.label })
      setSearchQuery('')
    }
    setOpen(false)
  }
  const ICON = {
    area: MapPin, developer: Briefcase, project: Building2
  }
  const TAG = { area: '区域', developer: '开发商', project: '项目' }

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
          {suggestions.map((s, i) => {
            const Ico = ICON[s.kind]
            return (
              <button
                key={`${s.kind}-${s.label}-${i}`}
                onClick={() => pick(s)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50 transition-colors"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Ico className="h-4 w-4" />
                </span>
                <span className="flex-1 truncate text-slate-800">{s.label}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                  {TAG[s.kind]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
