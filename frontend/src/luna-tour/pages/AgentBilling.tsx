/**
 * 经纪台 — 订阅 / 升级页(route: /agent/billing)。
 *
 * 显示当前套餐 + 本月用量 + 升级按钮(→ Stripe Checkout)+ 管理订阅(→ Billing Portal)。
 * 数据来自 /api/billing/me。设计稿: docs/stripe-billing-spec.md
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Check, ExternalLink, Users, UserPlus, X } from 'lucide-react'
import { badgeForPlan } from '../../lib/roleBadge'
import RoleBadgeDialog from '../../components/RoleBadgeDialog'
import { useAuth } from '../../contexts/AuthContext'
import { useResetOnBFCache } from '../../hooks/useResetOnBFCache'
import {
  fetchBillingMe, fetchPromo, fetchFeatures, fetchPlans, startCheckout, openPortal,
  fetchTeam, inviteTeamMember, removeTeamMember, setExtraSeats, setMyRole,
  type BillingMe, type BillingInterval, type Promo, type FeaturesInfo, type TeamInfo, type PaidPlanId, type UserRole, type BillingPlan,
} from '../../lib/billingApi'

// 付费才定身份:套餐 → 角色(webhook 服务端也会落一次,这里是登录态兜底 + 即时生效)
const ROLE_BY_PLAN: Record<string, UserRole> = { rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer' }

// 升级卡只展示比当前档更高的档
const PLAN_ORDER: Record<string, number> = { explore: 0, rookie: 1, agent: 2, founder: 3 }

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
  const [cycle, setCycle] = useState<BillingInterval>('month') // 默认月付(低门槛)
  const [promo, setPromo] = useState<Promo>({ active: false })
  const [feat, setFeat] = useState<FeaturesInfo>({ features: [], plans: [] })
  // 经纪公司版团队席位
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [teamMsg, setTeamMsg] = useState<string | null>(null)

  // 套餐目录(价格以后端/Stripe 为准,硬编码只是兜底,防止价格改了页面还显示旧价)
  const [catalog, setCatalog] = useState<BillingPlan[]>([])

  const refresh = () => fetchBillingMe().then((m) => { setMe(m); setLoading(false) })
  useEffect(() => { refresh(); fetchPromo().then(setPromo); fetchFeatures().then(setFeat); fetchTeam().then(setTeam); fetchPlans().then(setCatalog) }, [])

  // Checkout 回跳提示(?status=success|cancel),读后清掉 query
  const banner = params.get('status')
  useEffect(() => {
    if (banner) { const t = setTimeout(() => setParams({}, { replace: true }), 6000); return () => clearTimeout(t) }
  }, [banner, setParams])

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

  async function upgrade(planId: PaidPlanId) {
    setErr(null); setBusy(planId)
    const error = await startCheckout(planId, cycle)  // 成功跳转 Stripe
    if (error) { setErr(error); setBusy(null) }
  }
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

  // 月价优先取后端目录(与 Stripe 一致);积分额度同理
  const catMonthly = (id: string, fallback: number) => {
    const n = Number(catalog.find((p) => p.id === id)?.price_usd_month)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  const catCredits = (id: string, fallback: number) => {
    const n = Number(catalog.find((p) => p.id === id)?.limits?.credits_month)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  // 年付实收价优先取后端目录(rookie=249,与 Stripe 一致),缺省回退 month×10
  const catYear = (id: string, monthly: number) => {
    const n = Number(catalog.find((p) => p.id === id)?.price_usd_year)
    return Number.isFinite(n) && n > 0 ? n : monthly * 10
  }
  type PlanCard = { id: PaidPlanId; name: string; monthly: number; yearly: number; lines: string[]; edge: string }
  const PLANS: PlanCard[] = [
    { id: 'rookie', name: L('启程版 Starter', 'Starter'), monthly: catMonthly('rookie', 25), yearly: catYear('rookie', catMonthly('rookie', 25)), edge: '#0ea5e9',
      lines: [L(`${catCredits('rookie', 200).toLocaleString()} 积分/月`, `${catCredits('rookie', 200).toLocaleString()} credits/mo`), L('地图/数据不限时 + 客户 CRM', 'Unlimited map & data + client CRM'), L('意向报告 + AI 楼书解析', 'Intent reports + AI brochure parsing'), L('Lead(尽力推送)', 'Leads (best-effort)')] },
    { id: 'agent', name: L('专业版 Pro', 'Pro'), monthly: catMonthly('agent', 99), yearly: catYear('agent', catMonthly('agent', 99)), edge: '#10b981',
      lines: [L(`${catCredits('agent', 1200).toLocaleString()} 积分/月`, `${catCredits('agent', 1200).toLocaleString()} credits/mo`), L('实时带看 + Luna 智能导览', 'Live tours + Luna AI tour'), L('应用内语音 + AI 楼书解析', 'In-app voice + AI brochure parsing'), L('Lead 优先推送 + 行为洞察', 'Priority leads + behavior insights')] },
    { id: 'founder', name: L('经纪公司版 Agency', 'Agency'), monthly: catMonthly('founder', 699), yearly: catYear('founder', catMonthly('founder', 699)), edge: '#E8C37E',
      lines: [L(`${catCredits('founder', 15000).toLocaleString()} 积分/月 · 含 3 席共享`, `${catCredits('founder', 15000).toLocaleString()} credits/mo · 3 shared seats`), L('积分消耗 ×0.6(省40%)', 'Credit cost ×0.6 (save 40%)'), L('White-label + 自定义域名', 'White-label + custom domain'), L('Lead 独占优先 · 优先支持', 'Exclusive lead priority · priority support')] },
  ]
  const pct = promo.active ? (promo.percentOff || 0) / 100 : 0
  const fmtUsd = (n: number) => { const r = Math.round(n * 100) / 100; return r % 1 === 0 ? `$${r}` : `$${r.toFixed(2)}` }
  const cycleTotal = (p: PlanCard) => (cycle === 'year' ? p.yearly : p.monthly)
  const priceLabel = (p: PlanCard) =>
    `${fmtUsd(cycleTotal(p) * (1 - pct))} / ${cycle === 'year' ? L('年', 'yr') : L('月', 'mo')}`
  // 划掉锚点:年付锚满 12 个月(月付连交一年),月付仅在有优惠时锚原月价
  const struckLabel = (p: PlanCard) =>
    cycle === 'year' ? `$${p.monthly * 12}` : pct > 0 ? `$${p.monthly}` : ''
  const noteLabel = (p: PlanCard) => {
    if (promo.active) return L(`发布价 -${promo.percentOff}% · 永久锁定`, `Launch price -${promo.percentOff}% · locked forever`)
    if (cycle === 'year') {
      const save = Math.round(p.monthly * 12 - p.yearly)
      const monthsFree = p.monthly > 0 ? Math.round(save / p.monthly) : 0
      return save > 0 ? L(`省 $${save}${monthsFree > 0 ? `(≈${monthsFree} 个月免费)` : ''}`, `Save $${save}${monthsFree > 0 ? ` (≈${monthsFree} months free)` : ''}`) : L('按年付,随时取消', 'Billed yearly, cancel anytime')
    }
    return L('按月付,随时取消', 'Billed monthly, cancel anytime')
  }

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
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{L('订阅与用量', 'Subscription & usage')}</h1>
        <p className="mt-1 text-sm text-slate-500">{L('管理你的套餐、查看本月额度。支付由 Stripe 安全处理。', 'Manage your plan and view this month’s credits. Payments are handled securely by Stripe.')}</p>
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
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {STATUS_LABEL[status] || status}
          </span>
        </div>
        {me?.current_period_end && (
          <div className="mt-2 text-xs text-slate-400">
            {status === 'canceled' ? L('有效期至 ', 'Valid until ') : L('下次续费 ', 'Next renewal ')}{new Date(me.current_period_end).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}
          </div>
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
          <div className="mt-1 text-[11px] text-slate-400">{L('每月 1 日刷新,未用完不累积。', 'Resets on the 1st; unused credits don’t roll over.')}</div>
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

      {/* 升级选项(已是 founder 则不显示) */}
      {planId !== 'founder' && planId !== 'developer' && !me?.teamMember && (
        <div>
          {promo.active && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
              <span className="font-bold text-amber-700">{L('🔥 创始优惠 -', '🔥 Founding offer -')}{promo.percentOff}%</span>
              <span className="text-amber-700">{L('订阅即永久锁定此价', 'Subscribe to lock this price forever')}</span>
              {promo.seatsRemaining != null && <span className="text-amber-600">{L(`· 限 ${promo.seatsTotal} 席,仅剩 ${promo.seatsRemaining}`, `· ${promo.seatsTotal} seats only, ${promo.seatsRemaining} left`)}</span>}
            </div>
          )}
          {/* 月付 / 年付 切换 */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-slate-400">{L('计费周期:', 'Billing cycle:')}</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button onClick={() => setCycle('month')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'month' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>{L('按月付', 'Monthly')}</button>
              <button onClick={() => setCycle('year')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'year' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>{L('按年付 · 免费送2个月', 'Yearly · 2 months free')}</button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANS.filter((p) => (PLAN_ORDER[p.id] ?? 0) > (PLAN_ORDER[planId] ?? 0)).map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
                <div className="flex items-baseline justify-between">
                  <div className="font-bold text-slate-900">{p.name}</div>
                  <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5">
                      {struckLabel(p) && <span className="text-xs text-slate-400 line-through">{struckLabel(p)}</span>}
                      <span className="text-sm font-semibold" style={{ color: p.edge }}>{priceLabel(p)}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{noteLabel(p)}</div>
                  </div>
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                  {p.lines.map((l, i) => (<li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: p.edge }} /> {l}</li>))}
                </ul>
                <button onClick={() => upgrade(p.id)} disabled={busy === p.id}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  style={{ background: p.edge }}>
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (p.id === 'founder' ? L('升级到 Founder', 'Upgrade to Founder') : L('免费试用 7 天', 'Start 7-day free trial'))}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
