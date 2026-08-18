/**
 * 「订阅」tab —— B 端:谁订阅了我们的 SaaS。
 *
 * 重构自旧「经纪审批」:主角是订阅客户列表(谁付费/什么套餐/真付费vs赠送/到期/
 * 积分用量)。
 *
 * ⚠️ 2026-08-17:准入排队已取消 —— 那些 pending 行**不是任何人申请出来的**,是任何
 * 登录用户(包括误点进来的买家)访问 /agent/* 时被 agents.ts 自动插的。现在默认
 * 'approved',所以「待审批」组正常永远为空。见 agents.ts 的 GET /me 注释。
 * 数据走 fetchSubscribers(lt_agents ⨝ lt_subscriptions ⨝ plans ⨝ 本月用量 ⨝ 审批状态)。
 * 保留:楼书上传权限、套餐变更审计。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Check, Clock, History, Upload, Plus, CreditCard, Gift, Crown, Search, ChevronDown } from 'lucide-react'
import {
  approveAgent, rejectAgent, grantAgentTrial, revokeAgentGrant,
  listUploadPerms, grantUploadPerm, revokeUploadPerm, UploadPermRow,
} from '../../lib/agentApi'
import { fetchPlanChanges, type PlanChange } from '../../lib/billingApi'
import { fetchSubscribers, type Subscriber, type SubscriptionSummary } from '../../lib/analyticsApi'
import StatCard from './StatCard'

const PLAN_LABEL: Record<string, string> = { explore: '探索(免费)', rookie: '启程版', agent: '专业版', founder: '经纪公司版', developer: '开发商版' }

// 赠送的东西叫什么 —— 一处定义,按钮/确认弹窗/已赠标/审计记录都用它。
// 不叫「30 天」(听着像随便送几天),叫「经纪 Pro 30 天免费套餐」:它给的是完整
// 一个月的专业版(1200 积分,实时带看 / Luna 导览全开)。
const GRANT_NAME = '经纪 Pro 30 天免费套餐(1200 积分)'
const GRANT_SHORT = 'Pro 30 天'
const ROLE_LABEL: Record<string, string> = {
  buyer: '买家', agent: '经纪人', agency: '经纪公司', developer: '开发商',
  // 登录了但从没走完角色选择 —— 以前这批人也被标成「经纪人」(lt_agents.role 的
  // 列默认值),于是后台看到的「经纪注册了不试用」里混着一堆根本不是经纪的人。
  unset: '没选角色',
}
const ROLE_CLS: Record<string, string> = {
  buyer: 'bg-sky-50 text-sky-600',
  agent: 'bg-teal-50 text-teal-700',
  agency: 'bg-teal-50 text-teal-700',
  developer: 'bg-indigo-50 text-indigo-600',
  unset: 'bg-amber-50 text-amber-700',
}
/** 从业者角色(要订阅才能用地图的那几个) */
const TRADE_ROLES = ['agent', 'agency']
/** 钱出了问题的现有客户 —— 不是新注册,该催换卡 */
const FAILED_STATUS = ['past_due', 'unpaid', 'incomplete']

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  subscribed: { label: '订阅', cls: 'bg-emerald-100 text-emerald-700' },
  trial_started: { label: '开始试用(绑卡)', cls: 'bg-sky-100 text-sky-700' },
  // 免绑卡试用的三个 action —— 原来没有标签,记录里直接露出英文 key。
  free_trial_started: { label: '自助领 7 天', cls: 'bg-sky-100 text-sky-700' },
  free_trial_expired: { label: '试用到期', cls: 'bg-slate-100 text-slate-600' },
  developer_verified: { label: '开发商验证', cls: 'bg-indigo-100 text-indigo-700' },
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
  trial_granted: { label: '赠 Pro 30 天', cls: 'bg-violet-100 text-violet-700' },
  comp_granted: { label: '手动赠送(旧·永久)', cls: 'bg-amber-100 text-amber-700' },
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
  // 扣款失败排最前:这是**现有付费客户**出了问题,不能和「没订阅」长得一样
  if (FAILED_STATUS.includes(s.status)) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">扣款失败</span>
  if (s.status === 'trialing') return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">试用中</span>
  if (s.status === 'active' && s.paid) return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">付费</span>
  if (s.status === 'active' && !s.paid) return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">赠送</span>
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">未订阅</span>
}

/** 积分用量:额度列必须**列宽固定**,否则每行数字位数不同 → 进度条左右横跳。 */
function CreditMeter({ s }: { s: Subscriber }) {
  const unlimited = s.credits_month < 0
  if (s.status === 'none') return <span className="text-[11px] text-slate-300">—</span>
  if (unlimited) return <span className="text-[11px] font-medium text-emerald-600">无限积分</span>
  const pct = s.credits_month === 0 ? 0 : Math.min(100, Math.round((s.credits_used / s.credits_month) * 100))
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${pct > 85 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
      </div>
      {/* tabular-nums + 固定宽度右对齐 → 1200 和 200 的行也能对齐 */}
      <span className="w-[52px] shrink-0 text-end text-[10px] tabular-nums text-slate-400">
        {s.credits_used}/{s.credits_month}
      </span>
    </div>
  )
}

/** 「已赠送」标 —— 赠了什么、谁赠的、什么时候,一眼看全。 */
function GrantedTag({ s, compact }: { s: Subscriber; compact?: boolean }) {
  const at = new Date(s.trial_granted_at!)
  const by = s.trial_granted_by || '未知'
  const title = `${GRANT_NAME} · ${by} 于 ${at.toLocaleString('zh-CN')} 赠送`
  return (
    <span
      // whitespace-nowrap:不加的话「已赠 Pro 30 天 · 7/13 · lzp6529」会折成两行,把整行撑高
      className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 ring-1 ring-violet-100"
      title={title}
    >
      <Gift className="h-3 w-3 shrink-0" />
      {compact ? '已赠 Pro' : `已赠 ${GRANT_SHORT}`}
      <span className="font-normal text-violet-400">
        · {at.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} · {by.split('@')[0]}
      </span>
    </span>
  )
}

/**
 * 一行订阅客户。
 *
 * 布局:桌面走**固定列宽**的行(套餐/额度/到期/状态/操作各自定宽 → 列对齐不抖);
 * 手机不挤成一行(挤了就是截图里那种谁也看不清的样子),而是第二层单独一行放
 * 套餐·额度·到期·操作 —— 手机上这些信息同样要看得见、点得到(触摸目标 ≥32px)。
 */
function SubRow({ s, busy, onGrant, onRevoke, onApprove, onReject }: {
  s: Subscriber; busy: boolean
  onGrant: () => void; onRevoke: () => void
  onApprove: () => void; onReject: () => void
}) {
  const granted = !!s.trial_granted_at
  // 已有生效套餐(真付费 / 存量永久赠送)→ 不需要再赠送。
  const hasLiveNonTrial = s.status === 'active'
  const isPending = s.approval_status === 'pending'
  const planLabel = s.status === 'none' ? '—' : (PLAN_LABEL[s.plan_id || ''] || s.plan_name || s.plan_id)
  const expiry = s.current_period_end
    ? `${s.cancel_at_period_end ? '将取消 ' : '续费 '}${new Date(s.current_period_end).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
    : ''

  const Actions = ({ compact }: { compact?: boolean }) => {
    if (isPending) {
      return (
        <div className="flex gap-1">
          <button disabled={busy} onClick={onApprove} className="flex items-center gap-0.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="h-3 w-3" />批准</button>
          <button disabled={busy} onClick={onReject} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50">拒绝</button>
        </div>
      )
    }
    if (granted) {
      return (
        <div className="flex items-center gap-1">
          <GrantedTag s={s} compact={compact} />
          <button
            disabled={busy}
            onClick={onRevoke}
            className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:opacity-50"
            title="撤销赠送(停掉赠送的订阅)。注意:撤销不退还赠送名额,不能再赠第二次。"
          >
            撤销
          </button>
        </div>
      )
    }
    if (hasLiveNonTrial) {
      return <span className="px-2 py-1 text-[11px] text-slate-300" title="已有生效套餐,不需要赠送">—</span>
    }
    return (
      <button
        disabled={busy}
        onClick={onGrant}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-100 hover:bg-violet-100 disabled:opacity-50"
        title={`一次性赠送${GRANT_NAME}。每人只能一次,到期自动停。`}
      >
        <Gift className="h-3 w-3" />赠 {GRANT_SHORT}
      </button>
    )
  }

  return (
    <div className="px-3 py-3 sm:px-4">
      {/* ── 第一层:身份(手机/桌面共用)────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-emerald-500 text-sm font-semibold text-white">
          {(s.email || 'U').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-slate-800">{s.display_name || s.email}</span>
            {s.role && (
              <span className={`hidden shrink-0 rounded px-1.5 py-px text-[10px] font-medium sm:inline ${ROLE_CLS[s.role] || 'bg-slate-100 text-slate-500'}`}>
                {ROLE_LABEL[s.role] || s.role}
              </span>
            )}
            <SubBadge s={s} />
          </div>
          <div className="truncate text-xs text-slate-400">{s.email}</div>
        </div>

        {/* 桌面:每列**都**定宽(操作列尤其 —— 它的内容宽度随状态变化很大:
            「赠 Pro 30 天」按钮 vs「已赠 … + 撤销」。不定宽就会把左边所有列推歪,
            这正是原来 credit 列左右横跳的真正原因。) */}
        <div className="hidden w-[76px] shrink-0 text-end text-[12px] font-semibold text-slate-700 sm:block">{planLabel}</div>
        <div className="hidden w-[128px] shrink-0 justify-end sm:flex"><CreditMeter s={s} /></div>
        <div className="hidden w-[76px] shrink-0 text-end text-[11px] tabular-nums text-slate-400 md:block">{expiry}</div>
        <div className="hidden w-[252px] shrink-0 justify-end sm:flex"><Actions /></div>
      </div>

      {/* ── 第二层:手机专用。套餐/额度/到期在手机上原来是全隐藏的 ——
             owner 在手机上根本看不到谁快用完积分、谁快到期。 ── */}
      <div className="mt-2.5 flex items-center justify-between gap-2 ps-12 sm:hidden">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-600">{planLabel}</span>
            {expiry && <span className="text-[10px] tabular-nums text-slate-400">{expiry}</span>}
          </div>
          <CreditMeter s={s} />
        </div>
        <div className="shrink-0"><Actions compact /></div>
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
                {c.actor_email && <span className="text-[11px] text-slate-400">操作人 {c.actor_email}</span>}
                <span className="ms-auto text-[11px] text-slate-400">{new Date(c.created_at).toLocaleString('zh-CN')}</span>
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
/**
 * 赠送确认弹窗。赠送是**一次性、不可再来**的动作(撤销也不退还名额),
 * 且列表里相邻两行的按钮离得很近 —— 手机上尤其容易点错人。必须先确认。
 */
function GrantConfirm({ s, busy, onCancel, onConfirm }: {
  s: Subscriber; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  // 铁律:fixed 全屏 modal 必须 portal 到 body —— 祖先只要有 transform/backdrop-filter,
  // fixed 就会相对那个祖先定位而不是视口,弹窗会被卡在半路。
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-700">
            <Gift className="h-4 w-4" />
          </span>
          <h3 className="text-base font-semibold text-slate-800">确认赠送?</h3>
        </div>

        <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">赠给</span>
            <span className="min-w-0 truncate font-medium text-slate-800">{s.display_name || s.email}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="shrink-0 text-slate-400">邮箱</span>
            <span className="min-w-0 truncate text-slate-600">{s.email}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="shrink-0 text-slate-400">赠送内容</span>
            <span className="text-end font-medium text-violet-700">{GRANT_NAME}</span>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          每人<span className="font-semibold text-slate-700">只能赠送一次</span>,撤销也不会退还名额。
          30 天后自动停止,不会变成永久免费。
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-200"
          >
            取消
          </button>
          <button
            disabled={busy}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            确认赠送
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

type SubFilter = 'all' | 'paid' | 'trialing' | 'granted' | 'ungranted' | 'pending'
const FILTERS: { id: SubFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'paid', label: '真付费' },
  { id: 'trialing', label: '试用中' },
  { id: 'granted', label: '已赠送过' },
  { id: 'ungranted', label: '还能赠' },
]

/**
 * 可折叠的一组账户。
 *
 * 🔴 为什么必须折叠:以前是两个平铺的长列表,账号一多(现在 80 个)就得**滚过
 * 几十行才能看到下一个 section**,而下面还有「楼书权限」「套餐变更记录」——
 * owner 原话:「人一多得疯狂 scroll 下面才能看到下一个 section」。
 *
 * 规则:
 *   • 默认只露 PEEK 行,其余收起,标题上写清「还有 N 个」——**绝不静默截断**
 *   • `alert` 组(扣款失败/待审批)默认展开:那是要立刻处理的事,不能藏
 *   • 空组直接不渲染,不占一行标题
 */
const PEEK = 5

function Group({
  title, hint, tone = 'plain', rows, render, defaultOpen,
}: {
  title: string
  hint?: string
  tone?: 'plain' | 'alert' | 'good'
  rows: Subscriber[]
  render: (s: Subscriber) => React.ReactNode
  defaultOpen?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [open, setOpen] = useState(defaultOpen ?? true)
  if (rows.length === 0) return null
  const shown = expanded ? rows : rows.slice(0, PEEK)
  const rest = rows.length - shown.length
  const ring = tone === 'alert' ? 'ring-rose-200' : tone === 'good' ? 'ring-emerald-100' : 'ring-slate-900/[0.06]'
  const titleCls = tone === 'alert' ? 'text-rose-700' : 'text-slate-800'

  return (
    <div className={`overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ${ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 text-start transition hover:bg-slate-50/70"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className={`text-sm font-semibold ${titleCls}`}>{title}</span>
          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-500">{rows.length}</span>
        </span>
        {hint && <span className="hidden truncate text-xs text-slate-400 sm:inline">{hint}</span>}
      </button>
      {open && (
        <>
          <div className="divide-y divide-slate-50">{shown.map(render)}</div>
          {rest > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-teal-600 transition hover:bg-teal-50/60"
            >
              展开其余 {rest} 个
            </button>
          )}
          {expanded && rows.length > PEEK && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full border-t border-slate-100 py-2.5 text-xs font-medium text-slate-400 transition hover:bg-slate-50"
            >
              收起
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function AgentApprovals() {
  const [data, setData] = useState<{ subscribers: Subscriber[]; summary: SubscriptionSummary } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<SubFilter>('all')
  // 待确认赠送的对象(null = 弹窗关着)。赠送不可逆,不能点一下就发出去。
  const [confirming, setConfirming] = useState<Subscriber | null>(null)

  const EMPTY_SUMMARY: SubscriptionSummary = {
    total_accounts: 0, subscribed: 0, paid: 0, trialing: 0, comp: 0, pending_approval: 0,
    payment_failed: 0, agents_total: 0, agents_never_trialed: 0, agents_trial_expired: 0,
    role_unset: 0, buyers: 0,
  }
  const load = () => fetchSubscribers().then(setData).catch(() => setData({ subscribers: [], summary: EMPTY_SUMMARY }))
  useEffect(() => { load() }, [])

  // 失败必须让 owner 看见 —— 赠送被后端拒掉(已赠过 / 已有套餐)时静默刷新一下,
  // 他只会看到「什么都没发生」,然后再点一次。
  const act = async (email: string | null, fn: (e: string) => Promise<void>) => {
    if (!email) return
    setBusy(email)
    try {
      await fn(email)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败')
      await load()
    } finally { setBusy(null) }
  }

  if (!data) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>

  const { subscribers, summary } = data

  // 搜索(邮箱/姓名)+ 筛选。账号越来越多,靠肉眼在长列表里翻找是不现实的。
  const kw = q.trim().toLowerCase()
  const match = (s: Subscriber) => {
    if (kw && !`${s.email || ''} ${s.display_name || ''}`.toLowerCase().includes(kw)) return false
    switch (filter) {
      case 'paid': return s.paid
      case 'trialing': return s.status === 'trialing'
      case 'granted': return !!s.trial_granted_at      // 赠送过的(不管现在还生效没)
      case 'ungranted': return !s.trial_granted_at && !s.paid  // 还能赠的
      case 'pending': return s.approval_status === 'pending'
      default: return true
    }
  }
  const hits = subscribers.filter(match)
  const grantedCount = subscribers.filter((s) => s.trial_granted_at).length

  /**
   * 分组 —— 每一组对应一个**不同的结论和不同的动作**,不能再糊成「订阅/未订阅」两坨。
   *
   * 2026-07-28 实测 80 个账户,原来那个「未订阅账户 (36)」列表里其实混着:
   *   14 个真经纪没转化 · 17 个试用过期了 · 9 个买家 · 3 个开发商 · 10 个没选角色
   *   还有 1 个**扣款失败的付费客户**(全站唯一的外部付费客户!)
   * 一个标签盖住六种人,看到的数字自然是错的。
   */
  const g = {
    failed: hits.filter((s) => FAILED_STATUS.includes(s.status)),
    pending: hits.filter((s) => s.approval_status === 'pending' && s.status === 'none'),
    live: hits.filter((s) => (s.status === 'active' || s.status === 'trialing')),
    // 从业者(经纪/经纪公司)没订阅:试用过 vs 从没试用 —— 留存问题 vs 激活问题
    expired: hits.filter((s) => s.status === 'none' && TRADE_ROLES.includes(s.role || '') && s.trial_ever),
    never: hits.filter((s) => s.status === 'none' && TRADE_ROLES.includes(s.role || '') && !s.trial_ever),
    developer: hits.filter((s) => s.status === 'none' && s.role === 'developer'),
    buyer: hits.filter((s) => s.status === 'none' && s.role === 'buyer'),
    unset: hits.filter((s) => s.status === 'none' && (s.role === 'unset' || !s.role)),
  }

  const renderRow = (s: Subscriber) => (
    <SubRow key={s.agent_id} s={s} busy={busy === s.email}
      onGrant={() => setConfirming(s)}
      onRevoke={() => act(s.email, revokeAgentGrant)}
      onApprove={() => act(s.email, approveAgent)}
      onReject={() => act(s.email, rejectAgent)} />
  )

  return (
    <div className="space-y-5">
      {confirming && (
        <GrantConfirm
          s={confirming}
          busy={busy === confirming.email}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            const target = confirming
            setConfirming(null)
            await act(target.email, grantAgentTrial)
          }}
        />
      )}

      {/* 商业化 summary。
          ⚠️「账户总数」不等于「经纪」—— 每个登录用户(买家/开发商/没选角色的)都会有
          一行 lt_agents,所以单独标出真经纪的分母,别再拿总数当经纪数看。 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="账户总数" value={summary.total_accounts} icon={<CreditCard className="h-4 w-4" />} hint="含买家/开发商/没选角色的" />
        <StatCard label="真付费" value={summary.paid} icon={<Crown className="h-4 w-4" />} hint="走 Stripe 扣款" />
        <StatCard label="试用中" value={summary.trialing} icon={<Clock className="h-4 w-4" />} />
        <StatCard label="扣款失败" value={summary.payment_failed} icon={<CreditCard className="h-4 w-4" />} hint="现有付费客户卡出了问题 —— 催换卡,别当新注册" />
        <StatCard label="经纪未转化" value={summary.agents_never_trialed + summary.agents_trial_expired} icon={<Clock className="h-4 w-4" />} hint={`真经纪共 ${summary.agents_total} 个 · 从没试用 ${summary.agents_never_trialed} · 试用过期 ${summary.agents_trial_expired}`} />
        <StatCard label="没选角色" value={summary.role_unset} icon={<Clock className="h-4 w-4" />} hint="登录了却没选角色 —— 试用接口会 403 挡回,永远转化不了" />
      </div>

      {/* 搜索 + 筛选 —— 两个列表共用 */}
      <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex flex-wrap items-center gap-2">
          {/* 手机上搜索框独占一行 —— 和 chips 挤在一行会被压成一条缝 */}
          <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜邮箱或姓名…"
              className="w-full rounded-lg border border-slate-200 py-1.5 ps-8 pe-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
            />
          </div>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
                filter === f.id
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100 hover:bg-slate-100'
              }`}
            >
              {f.label}
              {f.id === 'granted' && grantedCount > 0 ? ` ${grantedCount}` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* 按「要做什么」排序:先是等着我处理的,再是客户,最后才是各种没转化的池子 */}
      <Group tone="alert" title="扣款失败" rows={g.failed} render={renderRow} defaultOpen
        hint="现有付费客户的卡出了问题 —— 该催换卡,不是赠送" />
      {/* 2026-08-17 起 /me 默认建 approved(agents.ts),这一组正常情况下**永远是空的**,
          Group 自己会返回 null。留着只是为了兜住万一出现的存量/异常 pending 行。 */}
      <Group tone="alert" title="待审批" rows={g.pending} render={renderRow} defaultOpen
        hint="一键批准" />
      <Group tone="good" title="订阅客户" rows={g.live} render={renderRow} defaultOpen
        hint="付费 / 试用 / 赠送" />
      <Group title="试用过期了" rows={g.expired} render={renderRow}
        hint="试过了没留下 —— 这是留存问题,不是获客问题" />
      <Group title="经纪·从没试用" rows={g.never} render={renderRow}
        hint="注册了连试都没试 —— 首次价值的坎" />
      <Group title="开发商" rows={g.developer} render={renderRow} defaultOpen={false} />
      <Group title="买家" rows={g.buyer} render={renderRow} defaultOpen={false}
        hint="买家本来就免费,不订阅是设计如此" />
      <Group title="没选角色" rows={g.unset} render={renderRow} defaultOpen={false}
        hint="登录了没选角色 —— 试用接口会 403 挡回,得先把他们推回选择页" />

      {hits.length === 0 && (
        <p className="rounded-2xl bg-white px-4 py-6 text-xs text-slate-400 shadow-sm ring-1 ring-slate-900/[0.06]">
          没有符合条件的账户。
        </p>
      )}

      <UploadPermissions />
      <PlanChangeLog />
    </div>
  )
}
