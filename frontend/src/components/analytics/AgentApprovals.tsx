/**
 * 「订阅」tab —— B 端:谁订阅了我们的 SaaS。
 *
 * 重构自旧「经纪审批」:主角是订阅客户列表(谁付费/什么套餐/真付费vs赠送/到期/
 * 积分用量),审批(付费即自动准入,见 agents.ts)弱化为顶部一个待审批小区。
 * 数据走 fetchSubscribers(lt_agents ⨝ lt_subscriptions ⨝ plans ⨝ 本月用量 ⨝ 审批状态)。
 * 保留:楼书上传权限、套餐变更审计。
 */
import { useEffect, useState } from 'react'
import { Loader2, Check, Clock, History, Upload, Plus, CreditCard, Gift, Crown } from 'lucide-react'
import {
  approveAgent, rejectAgent, setAgentPlan,
  listUploadPerms, grantUploadPerm, revokeUploadPerm, UploadPermRow,
} from '../../lib/agentApi'
import { fetchPlanChanges, type PlanChange } from '../../lib/billingApi'
import { fetchSubscribers, type Subscriber, type SubscriptionSummary } from '../../lib/analyticsApi'
import StatCard from './StatCard'

const PLAN_LABEL: Record<string, string> = { explore: '探索(免费)', rookie: '启程版', agent: '专业版', founder: '经纪公司版', developer: '开发商版' }
const ROLE_LABEL: Record<string, string> = { buyer: '买家', agent: '经纪人', agency: '经纪公司', developer: '开发商' }

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
const FEEDBACK_ZH: Record<string, string> = {
  too_expensive: '太贵了', missing_features: '缺功能', switched_service: '换了别家',
  unused: '用不上', too_complex: '太复杂', low_quality: '质量不满意',
  customer_service: '客服问题', other: '其他原因',
}

/** 订阅状态标签:真付费 / 试用 / 赠送 / 自己人。 */
function SubBadge({ s }: { s: Subscriber }) {
  if (s.is_internal) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">自己人</span>
  if (s.status === 'trialing') return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">试用中</span>
  if (s.status === 'active' && s.paid) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">付费</span>
  if (s.status === 'active' && !s.paid) return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">赠送</span>
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">未订阅</span>
}

/** 一行订阅客户:身份 + 套餐 + 积分用量 + 到期 + 授予下拉 + (待审批时)批准/拒绝。 */
function SubRow({ s, busy, onSet, onApprove, onReject }: {
  s: Subscriber; busy: boolean
  onSet: (plan: 'rookie' | 'agent' | 'founder' | 'developer' | 'revoke') => void
  onApprove: () => void; onReject: () => void
}) {
  const unlimited = s.credits_month < 0
  const pct = unlimited || s.credits_month === 0 ? 0 : Math.min(100, Math.round((s.credits_used / s.credits_month) * 100))
  const subscribed = s.status !== 'none'
  const isPending = s.approval_status === 'pending'
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-sm font-semibold text-white">
        {(s.email || 'U').charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800">{s.display_name || s.email}</span>
          {s.role && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] text-slate-500">{ROLE_LABEL[s.role] || s.role}</span>}
        </div>
        <div className="truncate text-xs text-slate-400">{s.email}</div>
      </div>

      {/* 套餐 + 积分用量 */}
      <div className="hidden w-40 shrink-0 sm:block">
        {subscribed ? (
          <>
            <div className="text-right text-[12px] font-semibold text-slate-700">{PLAN_LABEL[s.plan_id || ''] || s.plan_name || s.plan_id}</div>
            <div className="mt-1 flex items-center justify-end gap-1.5">
              {unlimited ? (
                <span className="text-[10px] text-emerald-600">无限积分</span>
              ) : (
                <>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${pct > 85 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-slate-400">{s.credits_used}/{s.credits_month}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="text-right text-[11px] text-slate-300">—</div>
        )}
      </div>

      {/* 到期 */}
      <div className="hidden w-24 shrink-0 text-right text-[11px] text-slate-400 md:block">
        {s.current_period_end ? (
          <>
            {s.cancel_at_period_end ? '将取消 ' : '续费 '}
            {new Date(s.current_period_end).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
          </>
        ) : ''}
      </div>

      {/* 状态 + 操作 */}
      <div className="flex shrink-0 items-center gap-2">
        <SubBadge s={s} />
        {isPending ? (
          <div className="flex gap-1">
            <button disabled={busy} onClick={onApprove} className="flex items-center gap-0.5 rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="h-3 w-3" />批</button>
            <button disabled={busy} onClick={onReject} className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50">拒</button>
          </div>
        ) : (
          <select
            disabled={busy}
            value=""
            onChange={(e) => { const v = e.target.value as 'rookie' | 'agent' | 'founder' | 'developer' | 'revoke'; if (v) onSet(v) }}
            className="rounded-lg border border-slate-200 px-1.5 py-1 text-[11px] text-slate-500 disabled:opacity-50"
            title="手动授予/撤销套餐(不走 Stripe)"
          >
            <option value="">授予…</option>
            <option value="rookie">赠 启程版</option>
            <option value="agent">赠 专业版</option>
            <option value="founder">赠 经纪公司版</option>
            <option value="developer">赠 开发商版</option>
            <option value="revoke">撤销赠送</option>
          </select>
        )}
      </div>
    </div>
  )
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
            const reason = c.reason ? c.reason.replace(/^(\w+)/, (m) => FEEDBACK_ZH[m] || m) : null
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${a.cls}`}>{a.label}</span>
                <span className="font-medium text-slate-700">{c.display_name || c.agent_email || c.id}</span>
                {c.from_plan !== c.to_plan && (
                  <span className="text-xs text-slate-500">{PLAN_LABEL[c.from_plan || ''] || c.from_plan || '—'} → {PLAN_LABEL[c.to_plan || ''] || c.to_plan}</span>
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

/** 楼书上传权限:单独授权某个 email 用上传/审核/项目管理,不给分析后台。 */
function UploadPermissions() {
  const [rows, setRows] = useState<UploadPermRow[] | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const load = () => listUploadPerms().then(setRows).catch(() => setRows([]))
  useEffect(() => { load() }, [])
  const grant = async () => {
    const email = input.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('请输入有效邮箱'); return }
    setBusy(true); setErr(null)
    try { await grantUploadPerm(email); setInput(''); await load() }
    catch { setErr('授权失败,请重试') } finally { setBusy(false) }
  }
  const revoke = async (email: string) => { setBusy(true); try { await revokeUploadPerm(email); await load() } finally { setBusy(false) } }
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Upload className="h-4 w-4 text-teal-500" />
        <h3 className="text-sm font-semibold text-slate-800">楼书上传权限</h3>
        <span className="text-xs text-slate-400">授权后可用「上传楼书 / 任务审核 / 项目管理」,看不到数据分析后台</span>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <input type="email" value={input}
            onChange={(e) => { setInput(e.target.value); setErr(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') grant() }}
            placeholder="输入邮箱,如 someone@example.com"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400" />
          <button disabled={busy || !input.trim()} onClick={grant}
            className="flex items-center gap-1 rounded-lg bg-teal-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50">
            <Plus className="h-4 w-4" /> 授权
          </button>
        </div>
        {err && <p className="text-xs text-rose-500">{err}</p>}
        {rows == null ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-teal-500" /></div>
        ) : rows.length === 0 ? (
          <p className="py-2 text-xs text-slate-400">还没有单独授权的账号(admin 本身就能上传)。</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((r) => (
              <div key={r.email} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate font-medium text-slate-700">{r.email}</span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] text-slate-400">{String(r.created_at).slice(0, 10)} 授权</span>
                  <button disabled={busy} onClick={() => revoke(r.email)} className="text-[11px] text-slate-400 hover:text-rose-500 disabled:opacity-50">撤销</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Owner-only 订阅中心。 */
export default function AgentApprovals() {
  const [data, setData] = useState<{ subscribers: Subscriber[]; summary: SubscriptionSummary } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => fetchSubscribers().then(setData).catch(() => setData({ subscribers: [], summary: { total_accounts: 0, subscribed: 0, paid: 0, trialing: 0, comp: 0, pending_approval: 0 } }))
  useEffect(() => { load() }, [])

  const act = async (email: string | null, fn: (e: string) => Promise<void>) => {
    if (!email) return
    setBusy(email)
    try { await fn(email); await load() } finally { setBusy(null) }
  }

  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const { subscribers, summary } = data
  const subscribed = subscribers.filter((s) => s.status !== 'none')
  const notSubscribed = subscribers.filter((s) => s.status === 'none')

  const renderRow = (s: Subscriber) => (
    <SubRow key={s.agent_id} s={s} busy={busy === s.email}
      onSet={(plan) => act(s.email, (e) => setAgentPlan(e, plan))}
      onApprove={() => act(s.email, approveAgent)}
      onReject={() => act(s.email, rejectAgent)} />
  )

  return (
    <div className="space-y-5">
      {/* 商业化 summary */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="经纪账户" value={summary.total_accounts} icon={<CreditCard className="h-4 w-4" />} />
        <StatCard label="已订阅" value={summary.subscribed} icon={<Check className="h-4 w-4" />} />
        <StatCard label="真付费" value={summary.paid} icon={<Crown className="h-4 w-4" />} hint="走 Stripe 扣款" />
        <StatCard label="试用中" value={summary.trialing} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="手动赠送" value={summary.comp} icon={<Gift className="h-4 w-4" />} />
        <StatCard label="待审批" value={summary.pending_approval} icon={<Clock className="h-4 w-4" />} />
      </div>

      {/* 订阅客户(主角) */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">订阅客户 ({subscribed.length})</h3>
          <span className="text-xs text-slate-400">谁订阅了我们 · 付费 / 试用 / 赠送</span>
        </div>
        {subscribed.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">还没有任何订阅。</p>
        ) : (
          <div className="divide-y divide-slate-50">{subscribed.map(renderRow)}</div>
        )}
      </div>

      {/* 未订阅账户(次要:注册了但没订阅,含待审批) */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-600">未订阅账户 ({notSubscribed.length})</h3>
          <span className="text-xs text-slate-400">注册了但还没付费 —— 待审批的可一键批准</span>
        </div>
        {notSubscribed.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">没有未订阅账户。</p>
        ) : (
          <div className="divide-y divide-slate-50">{notSubscribed.map(renderRow)}</div>
        )}
      </div>

      <UploadPermissions />
      <PlanChangeLog />
    </div>
  )
}
