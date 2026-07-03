import { useEffect, useState } from 'react'
import { Loader2, Check, X, Clock, History } from 'lucide-react'
import { listAgents, approveAgent, rejectAgent, setAgentPlan, AgentRow } from '../../lib/agentApi'
import { fetchPlanChanges, type PlanChange } from '../../lib/billingApi'

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  rejected: 'bg-slate-100 text-slate-500',
}
const STATUS_LABEL: Record<string, string> = { approved: '已开通', pending: '待审核', rejected: '已拒绝' }
const PLAN_LABEL: Record<string, string> = { explore: '探索(免费)', rookie: '启程版', agent: '专业版', founder: '创始会员' }
const SUB_LABEL: Record<string, string> = { none: '未订阅', trialing: '试用中', active: '生效', past_due: '欠费', canceled: '已取消' }

// 变更审计的动作 → 中文 + 颜色(downgrade/取消类标红,方便一眼扫到该回访的客户)
const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  subscribed: { label: '订阅', cls: 'bg-emerald-100 text-emerald-700' },
  trial_started: { label: '开始试用', cls: 'bg-sky-100 text-sky-700' },
  trial_converted: { label: '试用转正', cls: 'bg-emerald-100 text-emerald-700' },
  upgraded: { label: '升级', cls: 'bg-emerald-100 text-emerald-700' },
  downgraded: { label: '降级', cls: 'bg-rose-100 text-rose-700' },
  cancel_scheduled: { label: '预约取消', cls: 'bg-rose-100 text-rose-700' },
  cancel_reverted: { label: '取消反悔', cls: 'bg-emerald-100 text-emerald-700' },
  canceled: { label: '已取消', cls: 'bg-rose-100 text-rose-700' },
  past_due: { label: '扣款失败', cls: 'bg-amber-100 text-amber-700' },
  recovered: { label: '恢复付款', cls: 'bg-emerald-100 text-emerald-700' },
  seats_changed: { label: '调整席位', cls: 'bg-slate-100 text-slate-600' },
  seat_invited: { label: '邀请席位', cls: 'bg-slate-100 text-slate-600' },
  seat_removed: { label: '移除席位', cls: 'bg-slate-100 text-slate-600' },
  comp_granted: { label: '手动赠送', cls: 'bg-violet-100 text-violet-700' },
  comp_revoked: { label: '撤销赠送', cls: 'bg-slate-100 text-slate-600' },
}

// Stripe cancellation feedback 枚举 → 可读中文(reason 原文保留在后面)
const FEEDBACK_ZH: Record<string, string> = {
  too_expensive: '太贵了',
  missing_features: '缺功能',
  switched_service: '换了别家',
  unused: '用不上',
  too_complex: '太复杂',
  low_quality: '质量不满意',
  customer_service: '客服问题',
  other: '其他原因',
}

/** 套餐变更记录(谁升谁降、为什么取消)—— 数据来自 plan_change_log。 */
function PlanChangeLog() {
  const [rows, setRows] = useState<PlanChange[] | null>(null)
  useEffect(() => { fetchPlanChanges({ limit: 100 }).then(setRows) }, [])
  if (!rows) return null
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <History className="h-4 w-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-800">套餐变更记录</h3>
        <span className="text-xs text-slate-400">降级/取消会带客户留下的原因 —— 主动联系挽回</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-slate-400">还没有变更记录</div>
      ) : (
        <div className="divide-y divide-slate-50">
          {rows.map((c) => {
            const a = ACTION_LABEL[c.action] || { label: c.action, cls: 'bg-slate-100 text-slate-600' }
            const reason = c.reason
              ? c.reason.replace(/^(\w+)/, (m) => FEEDBACK_ZH[m] || m)
              : null
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.cls}`}>{a.label}</span>
                <span className="font-medium text-slate-700">{c.display_name || c.agent_email || c.id}</span>
                {c.from_plan !== c.to_plan && (
                  <span className="text-xs text-slate-500">
                    {PLAN_LABEL[c.from_plan || ''] || c.from_plan || '—'} → {PLAN_LABEL[c.to_plan || ''] || c.to_plan}
                  </span>
                )}
                {typeof c.metadata?.fromSeats === 'number' && (
                  <span className="text-xs text-slate-500">加席 {String(c.metadata.fromSeats)} → {String(c.metadata.toSeats)}</span>
                )}
                {typeof c.metadata?.member === 'string' && (
                  <span className="text-xs text-slate-500">{String(c.metadata.member)}</span>
                )}
                {reason && <span className="text-xs text-rose-500">「{reason}」</span>}
                <span className="ml-auto text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 一个经纪的套餐 + 本月用量 + 手动授予下拉。 */
function PlanCell({ a, busy, onSet }: { a: AgentRow; busy: boolean; onSet: (plan: 'explore' | 'rookie' | 'agent' | 'founder' | 'revoke') => void }) {
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
        onChange={(e) => { const v = e.target.value as 'explore' | 'rookie' | 'agent' | 'founder' | 'revoke'; if (v) onSet(v) }}
        className="rounded-lg border border-slate-200 px-1.5 py-1 text-[11px] text-slate-600 disabled:opacity-50"
        title="手动授予/撤销套餐(不走 Stripe)"
      >
        <option value="">授予…</option>
        <option value="rookie">赠 启程版</option>
        <option value="agent">赠 专业版</option>
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

      {/* 套餐变更审计:升/降/取消(含客户留下的原因)/席位/手动赠送,一处看全 */}
      <PlanChangeLog />
    </div>
  )
}
