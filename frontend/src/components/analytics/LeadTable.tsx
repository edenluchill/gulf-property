import { Lead } from '../../lib/analyticsApi'
import { cn } from '../../lib/utils'

function scoreColor(score: number): string {
  if (score >= 40) return 'bg-rose-100 text-rose-700'
  if (score >= 20) return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function intentSummary(intent: Record<string, unknown>): string {
  const parts: string[] = []
  const pv = Number(intent?.property_views || 0)
  if (pv) parts.push(`看了 ${pv} 个项目`)
  if (intent?.opened_luna) parts.push('用过 Luna')
  const areas = Array.isArray(intent?.areas) ? (intent.areas as string[]) : []
  if (areas.length) parts.push(`关注 ${areas.slice(0, 3).join('/')}`)
  return parts.join(' · ') || '—'
}

/** Leads sorted hottest-first. Pure table; data comes from the dashboard page. */
export default function LeadTable({ leads }: { leads: Lead[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">Leads（按热度排序）</h3>
      </div>
      {leads.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400">还没有 lead — 客户在 Luna 里留联系方式后会出现在这里。</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {leads.map((l) => (
            <div key={l.id} className="flex items-start gap-3 px-4 py-3">
              <span className={cn('mt-0.5 shrink-0 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums', scoreColor(l.lead_score))}>
                {l.lead_score}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{l.name || '匿名访客'}</span>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{l.source || '—'}</span>
                  {l.status !== 'new' && (
                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-600">{l.status}</span>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                  {l.whatsapp && <span>WhatsApp: {l.whatsapp}</span>}
                  {l.phone && l.phone !== l.whatsapp && <span>电话: {l.phone}</span>}
                  {l.email && <span>{l.email}</span>}
                </div>
                <div className="mt-0.5 text-xs text-slate-400">{intentSummary(l.intent)}</div>
              </div>
              <span className="shrink-0 text-[10px] text-slate-400">{l.created_at.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
