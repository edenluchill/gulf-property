/**
 * 经纪台 — 订阅 / 升级页(route: /agent/billing)。
 *
 * 显示当前套餐 + 本月用量 + 升级按钮(→ Stripe Checkout)+ 管理订阅(→ Billing Portal)。
 * 数据来自 /api/billing/me。设计稿: docs/stripe-billing-spec.md
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, ExternalLink, Users, UserPlus, X, ArrowUpRight } from 'lucide-react'
import { badgeForPlan } from '../../lib/roleBadge'
import RoleBadgeDialog from '../../components/RoleBadgeDialog'
import { useAuth } from '../../contexts/AuthContext'
import { useResetOnBFCache } from '../../hooks/useResetOnBFCache'
import { trackEvent } from '../../lib/track'
import {
  fetchBillingMe, fetchFeatures, openPortal,
  fetchTeam, inviteTeamMember, removeTeamMember, setExtraSeats, setMyRole,
  type BillingMe, type FeaturesInfo, type TeamInfo, type UserRole,
} from '../../lib/billingApi'

// 付费才定身份:套餐 → 角色(webhook 服务端也会落一次,这里是登录态兜底 + 即时生效)
const ROLE_BY_PLAN: Record<string, UserRole> = { rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer' }

export default function AgentBilling() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)
  const STATUS_LABEL: Record<string, string> = {
    none: L('未订阅', 'Not subscribed'), trialing: L('试用中', 'Trial'), active: L('生效中', 'Active'), past_due: L('续费失败', 'Renewal failed'), canceled: L('已取消', 'Canceled'),
  }
  const [me, setMe] = useState<BillingMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // 跳 Stripe 后按「后退」时,页面从 bfcache 恢复会保留 busy → spinner 卡死。重置。
  useResetOnBFCache(() => setBusy(null))
  const [params, setParams] = useSearchParams()
  const [feat, setFeat] = useState<FeaturesInfo>({ features: [], plans: [] })
  // 经纪公司版团队席位
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [teamMsg, setTeamMsg] = useState<string | null>(null)

  const refresh = () => fetchBillingMe().then((m) => { setMe(m); setLoading(false) })
  useEffect(() => { refresh(); fetchFeatures().then(setFeat); fetchTeam().then(setTeam) }, [])

  // Checkout 回跳提示(?status=success|cancel),读后清掉 query
  const banner = params.get('status')
  useEffect(() => {
    if (banner) { const t = setTimeout(() => setParams({}, { replace: true }), 6000); return () => clearTimeout(t) }
  }, [banner, setParams])

  // 漏斗闭环:checkout_start 打在跳走前,这里打回来的那一端。
  // 两者的差值 = 「在 Stripe 绑卡页放弃了多少人」。
  const funnelRef = useState(() => ({ done: false }))[0]
  useEffect(() => {
    if (!banner || !me || funnelRef.done) return
    funnelRef.done = true
    if (banner === 'success') trackEvent('checkout_success', { plan_id: me.plan?.id }, { immediate: true })
    if (banner === 'cancel') trackEvent('checkout_abandon', { plan_id: me.plan?.id }, { immediate: true })
  }, [banner, me, funnelRef])

  // 付款成功 → 按套餐落角色(选付费角色时不预写 role,付款成功才定身份)
  const roleSetRef = useState(() => ({ done: false }))[0]
  useEffect(() => {
    if (banner === 'success' && me && ['active', 'trialing'].includes(me.status) && !roleSetRef.done) {
      const r = ROLE_BY_PLAN[me.plan?.id || '']
      if (r) {
        roleSetRef.done = true
        void setMyRole(r)
        try { sessionStorage.setItem('pinzos-role', r) } catch { /* noop */ }
      }
    }
  }, [banner, me, roleSetRef])

  // 付款成功 → 颁发认证勋章(自动弹出,可保存发朋友圈)
  const { user } = useAuth()
  const [showBadge, setShowBadge] = useState(false)
  const badgeShownRef = useState(() => ({ done: false }))[0]
  useEffect(() => {
    if (banner === 'success' && me && !badgeShownRef.done && badgeForPlan(me.plan?.id, me.status, me.teamMember)) {
      badgeShownRef.done = true
      setShowBadge(true)
    }
  }, [banner, me, badgeShownRef])
  const successBadge = me ? badgeForPlan(me.plan?.id, me.status, me.teamMember) : null

  async function manage() {
    setErr(null); setBusy('portal')
    const error = await openPortal()
    if (error) { setErr(error); setBusy(null) }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>
  }

  const badgeDialog = showBadge && successBadge ? (
    <RoleBadgeDialog
      badge={successBadge}
      name={user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Pinzos'}
      // 付款成功回跳(?status=success)自动弹 = 里程碑庆祝框;手动点勋章不庆祝
      celebrate={banner === 'success'}
      onClose={() => setShowBadge(false)}
    />
  ) : null

  const planId = me?.plan.id || 'explore'
  const status = me?.status || 'none'
  const isPaid = status === 'active' || status === 'trialing'
  // 积分(-1 = 无限/owner)
  const cMonth = me?.credits.month ?? 0
  const cUsed = me?.credits.used ?? 0
  const cBalance = me?.credits.balance ?? 0
  const unlimited = cMonth < 0
  // 我的套餐折扣(Founder<1),用来在消耗表显示实扣
  const myMult = Number(feat.plans.find((p) => p.id === planId)?.multiplier ?? 1)

  // 升级入口:非顶档 + 非席位成员才显示(→ 角色专属选档页)
  const canUpgrade = planId !== 'founder' && planId !== 'developer' && !me?.teamMember
  const canceling = !!me?.cancel_at_period_end
  const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '')

  // 团队席位操作(founder 专用)
  async function invite() {
    if (!inviteEmail.trim()) return
    setTeamMsg(null); setBusy('invite')
    const error = await inviteTeamMember(inviteEmail.trim())
    setBusy(null)
    if (error) { setTeamMsg(error); return }
    setInviteEmail(''); setTeamMsg(L('已加入团队 ✓', 'Added to team ✓'))
    fetchTeam().then(setTeam)
  }
  async function removeMember(id: string) {
    setTeamMsg(null); setBusy(`rm-${id}`)
    const error = await removeTeamMember(id)
    setBusy(null)
    if (error) { setTeamMsg(error); return }
    fetchTeam().then(setTeam)
  }
  async function changeSeats(next: number) {
    setTeamMsg(null); setBusy('seats')
    const error = await setExtraSeats(next)
    setBusy(null)
    if (error) { setTeamMsg(error); return }
    setTeamMsg(L('席位已调整,账单按比例计费 ✓', 'Seats updated, billed pro-rata ✓'))
    setTimeout(() => fetchTeam().then(setTeam), 1500) // 等 webhook 镜像
  }

  return (
    <div className="space-y-6">
      {badgeDialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{L('订阅与用量', 'Subscription & usage')}</h1>
          <p className="mt-1 text-sm text-slate-500">{L('管理你的套餐、查看本月额度。支付由 Stripe 安全处理。', 'Manage your plan and view this month’s credits. Payments are handled securely by Stripe.')}</p>
        </div>
        {canUpgrade && (
          <Link to="/agent/plans"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
            {L('升级套餐', 'Upgrade')} <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {banner === 'success' && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{L('✅ 订阅成功!额度已更新。', '✅ Subscription complete! Your credits are updated.')}</div>}
      {banner === 'cancel' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">{L('已取消结账,未产生费用。', 'Checkout canceled, no charge was made.')}</div>}
      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}

      {/* 当前套餐 */}
      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">{L('当前套餐', 'Current plan')}</div>
            <div className="text-xl font-bold text-slate-900">{me?.plan.name || 'Explore'}</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${
            canceling ? 'bg-amber-50 text-amber-700' : isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
          }`}>
            {canceling ? L('已取消', 'Canceling') : (STATUS_LABEL[status] || status)}
          </span>
        </div>
        {me?.current_period_end && (
          <div className={`mt-2 text-xs ${canceling ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
            {canceling
              ? L(`已取消订阅 —— 到期前仍可正常使用,可用至 ${fmtDate(me.current_period_end)}`, `Subscription canceled — you keep full access until ${fmtDate(me.current_period_end)}`)
              : status === 'canceled'
                ? L('有效期至 ', 'Valid until ') + fmtDate(me.current_period_end)
                : status === 'trialing'
                  ? L('免费试用至 ', 'Free trial until ') + fmtDate(me.current_period_end)
                  : L('下次续费 ', 'Next renewal ') + fmtDate(me.current_period_end)}
          </div>
        )}
        {canceling && (
          <button onClick={manage} disabled={busy === 'portal'}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-60">
            {busy === 'portal' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{L('恢复订阅', 'Resume subscription')}
          </button>
        )}

        {/* 本月积分余额 */}
        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm text-slate-500">{L('本月积分余额', 'Credits this month')}</span>
            <span className="text-sm font-semibold text-slate-900">
              {unlimited ? L('无限', 'Unlimited') : <>{L('剩', '')} <b className="text-emerald-600">{cBalance.toLocaleString()}</b> / {cMonth.toLocaleString()}</>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: unlimited || cMonth === 0 ? '0%' : `${Math.min(100, Math.round((cUsed / cMonth) * 100))}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-slate-400">
            {me?.credits_reset_at
              ? L(`${fmtDate(me.credits_reset_at)} 刷新额度,未用完不累积。`, `Credits reset ${fmtDate(me.credits_reset_at)}; unused don’t roll over.`)
              : L('每月 1 日刷新,未用完不累积。', 'Resets on the 1st; unused credits don’t roll over.')}
          </div>
        </div>

        {/* 积分消耗表(成本来自后端配置,自动同步) */}
        {feat.features.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">{L('积分这样花', 'How credits are spent')}{myMult < 1 ? L(`(你的套餐 ×${myMult},已含折扣)`, ` (your plan ×${myMult}, discount applied)`) : ''}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {feat.features.map((f) => (
                <div key={f.key} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{zh ? f.label : (f.labelEn || f.label)}</span>
                  <span className="font-medium text-slate-800">{Math.round(f.credits * myMult)} {L('积分', 'credits')}{f.key === 'live_tours' ? L('/场', '/session') : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isPaid && (
          <button onClick={manage} disabled={busy === 'portal'}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {L('管理订阅 / 改套餐 / 取消', 'Manage / change plan / cancel')}
          </button>
        )}
      </div>

      {/* 经纪公司版团队席位(owner 视角);成员看到归属提示 */}
      {team?.role === 'member' && (
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="h-4 w-4 text-amber-500" />
            {L('你在 ', 'You’re on ')}<b>{team.owner?.display_name || team.owner?.email}</b>{L(' 的团队中,套餐与积分由团队共享承担。', '’s team — the plan and credits are shared across the team.')}
          </div>
        </div>
      )}
      {team?.role === 'owner' && (
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" />
              <span className="font-bold text-slate-900">{L('团队席位', 'Team seats')}</span>
              <span className="text-xs text-slate-400">
                {1 + (team.members?.length || 0)} / {team.seatLimit} {L('席(含你自己)· 共享积分池', 'seats (incl. you) · shared credit pool')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">{L('加席 $49/席/月:', 'Add seat $49/seat/mo:')}</span>
              <button onClick={() => changeSeats(Math.max(0, (team.extraSeats || 0) - 1))} disabled={busy === 'seats' || (team.extraSeats || 0) === 0}
                className="h-6 w-6 rounded border border-slate-200 font-bold text-slate-600 disabled:opacity-40">−</button>
              <span className="w-5 text-center font-semibold">{team.extraSeats || 0}</span>
              <button onClick={() => changeSeats((team.extraSeats || 0) + 1)} disabled={busy === 'seats'}
                className="h-6 w-6 rounded border border-slate-200 font-bold text-slate-600 disabled:opacity-40">+</button>
              {busy === 'seats' && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
          </div>
          {teamMsg && <div className="mt-2 text-xs text-slate-500">{teamMsg}</div>}
          <div className="mt-3 space-y-1.5">
            {(team.members || []).map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-slate-700">{m.display_name} <span className="text-xs text-slate-400">{m.email}</span></span>
                <button onClick={() => removeMember(m.id)} disabled={busy === `rm-${m.id}`} title={L('移出团队', 'Remove from team')}
                  className="text-slate-300 transition hover:text-rose-500">
                  {busy === `rm-${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              </div>
            ))}
            {(team.members?.length || 0) === 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">{L('还没有成员 —— 邀请同事共享 15,000 积分/月和 ×0.6 折扣。', 'No members yet — invite colleagues to share 15,000 credits/mo and the ×0.6 discount.')}</div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void invite() }}
              placeholder={L('同事邮箱(登录后自动进入团队)', 'Colleague email (auto-joins on sign-in)')}
              className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400" />
            <button onClick={() => void invite()} disabled={busy === 'invite' || !inviteEmail.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">
              {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {L('邀请', 'Invite')}
            </button>
          </div>
        </div>
      )}

      {/* 升级引导(非顶档):不再内嵌套餐卡,改一条克制的入口 → 专属选档页 */}
      {canUpgrade && (
        <Link to="/agent/plans"
          className="flex items-center justify-between gap-3 rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06] transition hover:ring-slate-300">
          <div>
            <div className="font-semibold text-slate-900">{L('需要更多额度与功能?', 'Need more credits and features?')}</div>
            <div className="mt-0.5 text-sm text-slate-500">{L('查看专业版 / 经纪公司版 —— 更大积分池、实时带看、Lead 优先。', 'See Pro / Agency — bigger credit pool, live tours, priority leads.')}</div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            {L('查看套餐', 'View plans')} <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>
      )}
    </div>
  )
}
