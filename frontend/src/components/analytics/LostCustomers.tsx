/**
 * "Lost customers" panel: visitors who once showed intent but have gone silent
 * for ≥7 days, ranked by recoverable value. The /lost endpoint is lifetime
 * (not windowed) — the `days` prop is kept only for a uniform tab-component
 * signature. Clicking a row reuses the per-visitor VisitorDrawer drill-down.
 */
import { useEffect, useState } from 'react'
import { Loader2, Eye, Heart, Phone } from 'lucide-react'
import { fetchLostCustomers, LostCustomer } from '../../lib/analyticsApi'
import { VisitorDrawer, shortId } from './Visitors'

const REASON: Record<string, { label: string; cls: string }> = {
  bug_hit: { label: '⚠️ 因故障流失', cls: 'bg-red-50 text-red-600 ring-red-200' },
  no_contact: { label: '差临门一脚', cls: 'bg-amber-50 text-amber-600 ring-amber-200' },
  cooling: { label: '已冷却', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

export default function LostCustomers({ days: _days }: { days: number }) {
  const [rows, setRows] = useState<LostCustomer[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    fetchLostCustomers().then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">流失客户</h3>
          <p className="text-xs text-slate-400">曾有意向但已沉默 ≥7 天的客户——按可挽回价值排序</p>
        </div>
        <span className="shrink-0 text-xs text-slate-400">{rows ? `${rows.length} 位` : ''}</span>
      </div>
      {!rows ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400">目前没有正在流失的高意向客户。</p>
      ) : (
        <div className="max-h-[460px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">客户</th>
                <th className="px-2 py-2 text-right font-medium">评分</th>
                <th className="px-2 py-2 text-right font-medium">沉默</th>
                <th className="px-2 py-2 text-left font-medium">原因</th>
                <th className="px-4 py-2 text-right font-medium">行为</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.identity} onClick={() => setSelected(r.identity)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-700">
                      {r.user_email || <span className="font-mono text-slate-500">#{shortId(r.visitor_id)}</span>}
                    </div>
                    {r.user_email && <div className="font-mono text-[10px] text-slate-400">#{shortId(r.visitor_id)}</div>}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold text-slate-700">{r.score}</td>
                  <td className="px-2 py-2.5 text-right text-slate-500">{r.days_silent} 天</td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.reasons.map((rs) => {
                        const m = REASON[rs] || { label: rs, cls: 'bg-slate-100 text-slate-500 ring-slate-200' }
                        return (
                          <span key={rs} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${m.cls}`}>
                            {m.label}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2.5 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3.5 w-3.5" />{r.views}</span>
                      <span className="inline-flex items-center gap-0.5"><Heart className="h-3.5 w-3.5" />{r.favorites}</span>
                      <span className="inline-flex items-center gap-0.5"><Phone className="h-3.5 w-3.5" />{r.contacts}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <VisitorDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
