import { useEffect, useState } from 'react'
import { Loader2, Check, X, Clock } from 'lucide-react'
import { listAgents, approveAgent, rejectAgent, setAgentPlan, AgentRow } from '../../lib/agentApi'

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-slate-100 text-slate-500',
}
const STATUS_LABEL: Record<string, string> = { approved: '已开通', pending: '待审核', rejected: '已拒绝' }
const PLAN_LABEL: Record<string, string> = { explore: '探索(免费)', agent: '经纪版', founder: '创始会员' }
const SUB_LABEL: Record<string, string> = { none: '未订阅', trialing: '试用中', active: '生效', past_due: '欠费', canceled: '已取消' }

/** 一个经纪的套餐 + 本月用量 + 手动授予下拉。 */
function PlanCell({ a, busy, onSet }: { a: AgentRow; busy: boolean; onSet: (plan: 'explore' | 'agent' | 'founder' | 'revoke') => void }) {
  const plan = a.plan_id || 'explore'
  const sub = a.sub_status || 'none'
  const paid = a.paid
  const isPaidPlan = plan !== 'explore' && sub !== 'none'
  return (
    <div className="flex items-center gap-2">
      <div className="text-right">
        <div className={`text-[11px] font-semibold ${isPaidPlan ? 'text-emerald-700' : 'text-slate-400'}`}>
          {PLAN_LABEL[plan]} {isPaidPlan && <span className="font-normal text-slate-400">· {SUB_LABEL[sub]}{paid ? '' : '(赠)'}</span>}
        </div>
        {isPaidPlan && (
          <div className="text-[10px] text-slate-400">积分 {(a.credits_used ?? 0).toLocaleString()} / {(a.credits_month ?? 0).toLocaleString()}</div>
        )}
      </div>
      <select
        disabled={busy}
        value=""
        onChange={(e) => { const v = e.target.value as 'explore' | 'agent' | 'founder' | 'revoke'; if (v) onSet(v) }}
        className="rounded-lg border border-slate-200 px-1.5 py-1 text-[11px] text-slate-600 disabled:opacity-50"
        title="手动授予/撤销套餐(不走 Stripe)"
      >
        <option value="">授予…</option>
        <option value="agent">赠 经纪版</option>
        <option value="founder">赠 创始会员</option>
        <option value="revoke">撤销赠送</option>
      </select>
    </div>
  )
}

/** Owner-only: approve/reject agents who requested access to the 经纪台. */
export default function AgentApprovals() {
  const [rows, setRows] = useState<AgentRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => listAgents().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])

  const act = async (email: string, fn: (e: string) => Promise<void>) => {
    setBusy(email)
    try { await fn(email); await load() } finally { setBusy(null) }
  }

  if (!rows) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const pending = rows.filter((r) => r.status === 'pending')
  const decided = rows.filter((r) => r.status !== 'pending')

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Clock className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-slate-800">待审核 ({pending.length})</h3>
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">没有待审核的经纪申请。</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {pending.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">{a.email}</div>
                  <div className="text-xs text-slate-400">{a.requested_at.slice(0, 16).replace('T', ' ')} 申请</div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={busy === a.email}
                    onClick={() => act(a.email, approveAgent)}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> 批准
                  </button>
                  <button
                    disabled={busy === a.email}
                    onClick={() => act(a.email, rejectAgent)}
                    className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> 拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">全部经纪 ({rows.length})</h3>
        </div>
        {decided.length === 0 && pending.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">还没有经纪账号。</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1 truncate text-sm text-slate-600">{a.email}</div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.status === 'approved' && (
                    <PlanCell a={a} busy={busy === a.email} onSet={(plan) => act(a.email, (e) => setAgentPlan(e, plan))} />
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                  {a.status === 'approved' && (
                    <button disabled={busy === a.email} onClick={() => act(a.email, rejectAgent)} className="text-[11px] text-slate-400 hover:text-rose-500 disabled:opacity-50">撤销</button>
                  )}
                  {a.status === 'rejected' && (
                    <button disabled={busy === a.email} onClick={() => act(a.email, approveAgent)} className="text-[11px] text-slate-400 hover:text-emerald-600 disabled:opacity-50">开通</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
