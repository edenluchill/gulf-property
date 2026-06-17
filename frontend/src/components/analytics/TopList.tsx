import { cn } from '../../lib/utils'

export interface TopItem {
  label: string
  count: number
  id?: string
}

/**
 * Reusable horizontal-bar ranking. Used for search terms, top projects and any
 * other "label + count" list — one component, many call sites.
 */
export default function TopList({
  title,
  items,
  emptyText = '暂无数据',
  className,
}: {
  title: string
  items: TopItem[]
  emptyText?: string
  className?: string
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0) || 1
  return (
    <div className={cn('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]', className)}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((it, i) => (
            <li key={it.id ?? it.label ?? i} className="relative">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-slate-700">{it.label || '—'}</span>
                <span className="shrink-0 tabular-nums text-slate-500">{it.count}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500"
                  style={{ width: `${(it.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
