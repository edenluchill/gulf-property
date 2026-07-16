/**
 * 看护 tab: a timeline of what the autonomous cx-guardian agent did on each
 * patrol round — fixes it shipped, customers it flagged for follow-up, and
 * anything it needs a human to handle. Read-only.
 */
import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, Wrench, Flame, AlertTriangle, GitCommit, Rocket, CheckCircle2 } from 'lucide-react'
import { fetchAgentRuns, AgentRun } from '../../lib/analyticsApi'
import { ago, VisitorDrawer } from './Visitors'

const STATUS: Record<AgentRun['status'], { label: string; cls: string; dot: string }> = {
  clean: { label: '正常', cls: 'bg-emerald-50 text-emerald-600 ring-emerald-200', dot: 'bg-emerald-500' },
  fixed: { label: '已修复', cls: 'bg-sky-50 text-sky-600 ring-sky-200', dot: 'bg-sky-500' },
  needs_attention: { label: '需关注', cls: 'bg-amber-50 text-amber-600 ring-amber-200', dot: 'bg-amber-500' },
}

function StatusBadge({ status }: { status: AgentRun['status'] }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export default function AgentRuns({ days: _days }: { days: number }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRuns(null)
    fetchAgentRuns().then((r) => alive && setRuns(r)).catch(() => alive && setRuns([]))
    return () => { alive = false }
  }, [])

  if (!runs) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
          <ShieldCheck className="h-7 w-7 text-slate-400" />
        </div>
        <p className="text-sm text-slate-500">cx-guardian 还没跑过巡检。开 /loop 或手动让它巡一轮。</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <div key={run.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.06]">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-teal-500" />
            <span className="text-sm font-semibold text-slate-800">{run.agent}</span>
            <StatusBadge status={run.status} />
            <span className="ms-auto text-xs text-slate-400">{ago(run.created_at)}</span>
          </div>

          {/* Summary */}
          {run.summary && <p className="mt-2 text-sm leading-relaxed text-slate-600">{run.summary}</p>}

          {/* Small stats */}
          <div className="mt-2 text-xs text-slate-400">
            被 block {run.blocked_count} · 流失 {run.lost_count}
          </div>

          {/* Actions */}
          {run.actions.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Wrench className="h-3.5 w-3.5 text-sky-500" />
                动作 ({run.actions.length})
              </div>
              {run.actions.map((a, i) => (
                <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="text-slate-700">
                    <span className="font-medium text-slate-800">{a.type}</span>
                    <span className="text-slate-400"> · </span>
                    {a.detail}
                  </div>
                  {(a.commit || a.deploy_tag || a.verify) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-slate-400">
                      {a.commit && (
                        <span className="inline-flex items-center gap-1">
                          <GitCommit className="h-3 w-3" />{a.commit.slice(0, 7)}
                        </span>
                      )}
                      {a.deploy_tag && (
                        <span className="inline-flex items-center gap-1">
                          <Rocket className="h-3 w-3" />{a.deploy_tag}
                        </span>
                      )}
                      {a.verify && (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />{a.verify}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Flagged → 建议回访 */}
          {run.flagged.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Flame className="h-3.5 w-3.5 text-rose-500" />
                建议回访 ({run.flagged.length})
              </div>
              {run.flagged.map((f, i) => (
                <button
                  key={i}
                  onClick={() => setSelected(f.identity)}
                  className="flex w-full items-start justify-between gap-2 rounded-lg bg-rose-50/60 px-3 py-2 text-start text-sm hover:bg-rose-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-700">{f.identity}</div>
                    <div className="text-xs text-slate-500">{f.reason}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-200">
                    {f.score}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Needs human → 需你处理 */}
          {run.needs_human.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                需你处理 ({run.needs_human.length})
              </div>
              {run.needs_human.map((n, i) => (
                <div key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-sm ring-1 ring-amber-200/70">
                  <div className="text-slate-700">{n.detail}</div>
                  <div className="mt-0.5 text-xs text-amber-700">建议: {n.suggestion}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {selected && <VisitorDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
