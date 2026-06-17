import { ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** A single headline metric. Pure presentation — pass it a number + label. */
export default function StatCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}
