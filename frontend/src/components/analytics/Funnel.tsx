import { cn } from '../../lib/utils'

export interface FunnelStep {
  step: string
  visitors: number
}

/**
 * Simple step funnel: each step as a bar relative to the first step, with a
 * drop-off %. Used for the tutorial funnel (and any ordered step series).
 */
export default function Funnel({
  title,
  steps,
  className,
}: {
  title: string
  steps: FunnelStep[]
  className?: string
}) {
  const top = steps[0]?.visitors || 1
  return (
    <div className={cn('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]', className)}>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {steps.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">暂无数据（尚未埋 tutorial_step）</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {steps.map((s, i) => {
            const pct = (s.visitors / top) * 100
            return (
              <li key={s.step ?? i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-700">{s.step}</span>
                  <span className="tabular-nums text-slate-500">
                    {s.visitors}
                    {i > 0 && <span className="ml-1 text-xs text-slate-400">({pct.toFixed(0)}%)</span>}
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500" style={{ width: `${pct}%` }} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
