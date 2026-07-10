/**
 * 经纪工作台共享视觉基元 —— 收敛四处乱掉的卡片/深色块/区块标题样式。
 *
 * 设计基调(2026-07-09 用户定):
 *  - 白底卡为主:rounded-2xl + ring-1 ring-slate-900/[0.06] + shadow-sm。
 *  - 深色面统一「柔和石板深(带青灰)」= ink-800(不再用纯黑 slate-900)。
 *  - 强调色统一站点青 teal/emerald;圆角:容器 2xl、内元素 xl、chip full。
 * 各 agent 页用这些组件替换手写 class,保证一致。
 */
import { type ReactNode } from 'react'

/** 标准白底卡(内容容器)。 */
export function Panel({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06] ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** 深色面卡(柔和石板深)—— 用于 hero/强调块。 */
export function InkPanel({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-2xl bg-ink-800 text-white shadow-md ring-1 ring-black/20 ${className}`} {...rest}>
      {children}
    </div>
  )
}

/** 区块标题(左标题 + 可选右操作)。 */
export function SectionHeader({ title, action, muted = false }: { title: ReactNode; action?: ReactNode; muted?: boolean }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className={muted ? 'text-sm font-semibold text-slate-500' : 'font-semibold text-slate-900'}>{title}</h2>
      {action}
    </div>
  )
}

/** 统计小卡(KPI)。 */
export function StatCard({ label, value, accent = false }: { label: ReactNode; value: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className={`text-2xl font-bold ${accent ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  )
}
