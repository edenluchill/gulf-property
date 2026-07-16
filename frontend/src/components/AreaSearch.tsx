/**
 * Compact area search for the map — type an area name, pick it, fly there.
 * Sits next to the filter chips. Uses searchDubaiAreas (returns centroids).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, MapPin } from 'lucide-react'
import { searchDubaiAreas, AreaSearchResult } from '../lib/api'

export default function AreaSearch({ onSelect, autoFocus }: { onSelect: (area: AreaSearchResult) => void; autoFocus?: boolean }) {
  const { t: tRaw } = useTranslation('misc')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AreaSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 选中某个区域后会把区域名回填进输入框,那次 q 变化不该再触发一轮搜索——
  // 否则结果回来又把刚关掉的下拉重新弹开(选完还杵着一个列表,很怪)。
  const skipNextRef = useRef(false)

  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return }
    if (tRef.current) clearTimeout(tRef.current)
    const query = q.trim()
    if (query.length < 2) { setResults([]); return }
    setLoading(true)
    tRef.current = setTimeout(async () => {
      const r = await searchDubaiAreas(query)
      setResults(r)
      setLoading(false)
      setOpen(true)
    }, 250)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (a: AreaSearchResult) => {
    onSelect(a)
    skipNextRef.current = true
    setQ(a.name)
    setOpen(false)
    if (tRef.current) clearTimeout(tRef.current)   // debounce 里可能还压着一轮请求
  }

  return (
    // 手机:铺满底部 dock(MapPage 把它放在底栏上方);md+:左上角紧凑框。
    <div ref={boxRef} className="relative w-full md:w-auto">
      {/* 与地图右上控制卡同一套视觉语言:rounded-2xl / bg-white/95 / ring / shadow */}
      <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-3.5 py-2.5 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm md:gap-1.5 md:px-3 md:py-2">
        <Search className="h-4 w-4 shrink-0 text-slate-400 md:h-3.5 md:w-3.5" />
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={t('misc:searchArea2')}
          className="w-full min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none md:w-44 md:flex-none md:text-xs"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); setResults([]); setOpen(false) }}
            className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (loading || results.length > 0) && (
        // 手机在底部 → 结果向上展开;md+ 在顶部 → 向下展开
        <div className="absolute start-0 bottom-full z-[1003] mb-1.5 max-h-64 w-full overflow-y-auto rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur md:bottom-auto md:top-full md:mb-0 md:mt-1.5 md:w-60">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">{t('misc:searching')}</div>
          )}
          {results.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a)}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors hover:bg-slate-50"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="flex-1 truncate text-slate-800">{a.name}</span>
              {a.transactionCount != null && (
                <span className="shrink-0 text-[10px] text-slate-400">{a.transactionCount.toLocaleString()}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
