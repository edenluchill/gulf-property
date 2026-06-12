/**
 * Section navigation for the review workspace.
 *
 * Desktop: sticky vertical list on the left — a "map" of the review with a
 * status dot + count badge per section. Mobile: horizontal scrollable chips.
 */
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
  return (
    <>
      {/* Mobile: horizontal chips */}
      <div className="md:hidden flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {sections.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              s.id === activeId
                ? 'bg-teal-600 border-teal-600 text-white'
                : 'bg-white border-gray-200 text-gray-600'
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
