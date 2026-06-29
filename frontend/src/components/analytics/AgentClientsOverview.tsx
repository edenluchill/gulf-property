/**
 * Owner-only cross-agent client roster. Lists every agent's clients (server
 * enforces owner gating), ranked by heat. Read-only overview — no drill-down.
 */
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { fetchAgentClients, AgentClientRow } from '../../lib/analyticsApi'
import { ago } from './Visitors'

export default function AgentClientsOverview({ days: _days }: { days: number }) {
  const [rows, setRows] = useState<AgentClientRow[] | null>(null)

  useEffect(() => {
    let alive = true
    fetchAgentClients().then((r) => alive && setRows(r)).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">经纪客户</h3>
          <p className="text-xs text-slate-400">所有经纪的客户总览（仅你可见）</p>
        </div>
        <span className="text-xs text-slate-400">{rows ? `${rows.length} 位客户` : ''}</span>
      </div>
      {!rows ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400">还没有任何经纪客户。</p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">经纪</th>
                <th className="px-2 py-2 text-left font-medium">客户</th>
                <th className="px-2 py-2 text-left font-medium">管道阶段</th>
                <th className="px-2 py-2 text-right font-medium">热度</th>
                <th className="px-2 py-2 text-right font-medium">跟进数</th>
                <th className="px-4 py-2 text-right font-medium">最近活跃</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((c) => (
                <tr key={c.client_id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-600">
                    {c.agent_name || c.agent_email || <span className="text-slate-400">未分配</span>}
                  </td>
                  <td className="px-2 py-2.5 font-medium text-slate-700">{c.client_name}</td>
                  <td className="px-2 py-2.5">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {c.pipeline_stage}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={`font-semibold ${c.heat >= 40 ? 'text-rose-600' : 'text-slate-500'}`}>
                      {c.heat}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right text-slate-500">{c.interactions || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-slate-400">
                    {c.last_activity_at ? ago(c.last_activity_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
