/**
 * Compact area search for the map — type an area name, pick it, fly there.
 * Sits next to the filter chips. Uses searchDubaiAreas (returns centroids).
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X, MapPin } from 'lucide-react'
import { searchDubaiAreas, AreaSearchResult } from '../lib/api'

export default function AreaSearch({ onSelect }: { onSelect: (area: AreaSearchResult) => void }) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AreaSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
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
    setQ(a.name)
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1.5 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={zh ? '搜索区域…' : 'Search area…'}
          className="w-32 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none md:w-44"
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
        <div className="absolute left-0 top-full z-[1003] mt-1.5 w-60 overflow-hidden rounded-xl bg-white/95 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">{zh ? '搜索中…' : 'Searching…'}</div>
          )}
          {results.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50"
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
