/**
 * Section navigation for the review workspace.
 *
 * Desktop: sticky vertical list on the left — a "map" of the review with a
 * status dot + count badge per section. Mobile: a sticky segmented bar that
 * stays visible while scrolling (was easy-to-miss loose chips), with an edge
 * fade hinting horizontal scroll and auto-centering of the active section.
 */
import { useEffect, useRef } from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react'

export type SectionStatus = 'ok' | 'warn' | 'error' | 'muted' | 'loading'

export interface SectionItem {
  id: string
  label: string
  badge?: number | string
  status: SectionStatus
}

interface SectionNavProps {
  sections: SectionItem[]
  activeId: string
  onSelect: (id: string) => void
}

function StatusIcon({ status }: { status: SectionStatus }) {
  switch (status) {
    case 'ok':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    case 'warn':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />
    case 'loading':
      return <Loader2 className="h-3.5 w-3.5 text-teal-500 animate-spin" />
    default:
      return <span className="h-1.5 w-1.5 rounded-full bg-gray-300 mx-1" />
  }
}

export function SectionNav({ sections, activeId, onSelect }: SectionNavProps) {
  // 手机:激活的分区自动滚进视野中间(点最右半露的 chip 后不至于"消失")
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId])

  return (
    <>
      {/* Mobile: sticky segmented bar — always visible while the page scrolls */}
      <div className="md:hidden sticky top-0 z-30 -mx-4 px-4 py-2 bg-gray-50/90 backdrop-blur">
        <div className="relative">
          <div
            ref={scrollerRef}
            className="flex gap-1 overflow-x-auto scrollbar-hide rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-gray-200"
          >
            {sections.map(s => (
              <button
                key={s.id}
                type="button"
                data-active={s.id === activeId}
                onClick={() => onSelect(s.id)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  s.id === activeId
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-600/25'
                    : 'text-gray-600 active:bg-gray-100'
                }`}
              >
                {s.label}
                {s.badge !== undefined && (
                  <span className={`text-xs tabular-nums ${s.id === activeId ? 'text-teal-100' : 'text-gray-400'}`}>
                    {s.badge}
                  </span>
                )}
                {s.id !== activeId && <StatusIcon status={s.status} />}
              </button>
            ))}
          </div>
          {/* 右缘渐隐:提示还能横滑 */}
          <div className="pointer-events-none absolute inset-y-1.5 right-1.5 w-10 rounded-r-2xl bg-gradient-to-l from-white via-white/70 to-transparent" />
        </div>
      </div>

      {/* Desktop: sticky vertical nav */}
      <nav className="hidden md:block w-52 shrink-0">
        <div className="sticky top-4 space-y-0.5">
          {sections.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${
                s.id === activeId
                  ? 'bg-white text-gray-900 font-semibold shadow-sm ring-1 ring-gray-200'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
              }`}
            >
              <StatusIcon status={s.status} />
              <span className="flex-1 truncate">{s.label}</span>
              {s.badge !== undefined && (
                <span className={`text-xs tabular-nums px-1.5 py-0.5 rounded-md ${
                  s.id === activeId ? 'bg-teal-50 text-teal-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {s.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </>
  )
}
