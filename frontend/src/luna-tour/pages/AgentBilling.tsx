/**
 * 经纪台 — 订阅 / 升级页(route: /agent/billing)。
 *
 * 显示当前套餐 + 本月用量 + 升级按钮(→ Stripe Checkout)+ 管理订阅(→ Billing Portal)。
 * 数据来自 /api/billing/me。设计稿: docs/stripe-billing-spec.md
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Check, ExternalLink, Users, UserPlus, X } from 'lucide-react'
import {
  fetchBillingMe, fetchPromo, fetchFeatures, startCheckout, openPortal,
  fetchTeam, inviteTeamMember, removeTeamMember, setExtraSeats,
  type BillingMe, type BillingInterval, type Promo, type FeaturesInfo, type TeamInfo, type PaidPlanId,
} from '../../lib/billingApi'

const STATUS_LABEL: Record<string, string> = {
  none: '未订阅', trialing: '试用中', active: '生效中', past_due: '续费失败', canceled: '已取消',
}

// 升级卡只展示比当前档更高的档
const PLAN_ORDER: Record<string, number> = { explore: 0, rookie: 1, agent: 2, founder: 3 }

export default function AgentBilling() {
  const [me, setMe] = useState<BillingMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const [cycle, setCycle] = useState<BillingInterval>('year') // 默认年付(送2个月)
  const [promo, setPromo] = useState<Promo>({ active: false })
  const [feat, setFeat] = useState<FeaturesInfo>({ features: [], plans: [] })
  // Founder 团队席位
  const [team, setTeam] = useState<TeamInfo | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [teamMsg, setTeamMsg] = useState<string | null>(null)

  const refresh = () => fetchBillingMe().then((m) => { setMe(m); setLoading(false) })
  useEffect(() => { refresh(); fetchPromo().then(setPromo); fetchFeatures().then(setFeat); fetchTeam().then(setTeam) }, [])

  // Checkout 回跳提示(?status=success|cancel),读后清掉 query
  const banner = params.get('status')
  useEffect(() => {
    if (banner) { const t = setTimeout(() => setParams({}, { replace: true }), 6000); return () => clearTimeout(t) }
  }, [banner, setParams])

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

  const PLANS: { id: PaidPlanId; name: string; monthly: number; lines: string[]; edge: string }[] = [
    { id: 'rookie', name: '启程版 Starter', monthly: 25, edge: '#0ea5e9',
      lines: ['200 积分/月', '地图/数据不限时 + 客户 CRM', '意向报告 + AI 楼书解析', '买家线索(尽力推送)'] },
    { id: 'agent', name: '专业版 Pro', monthly: 99, edge: '#10b981',
      lines: ['2,500 积分/月', '实时带看 + Luna 智能导览', '应用内语音 + AI 楼书解析', '线索优先推送 + 行为洞察'] },
    { id: 'founder', name: '创始会员 Founder', monthly: 699, edge: '#E8C37E',
      lines: ['15,000 积分/月 · 含 3 席共享', '积分消耗 ×0.6(省40%)', 'White-label + 自定义域名', '线索独占优先 · 锁定创始价'] },
  ]
  const pct = promo.active ? (promo.percentOff || 0) / 100 : 0
  const fmtUsd = (n: number) => { const r = Math.round(n * 100) / 100; return r % 1 === 0 ? `$${r}` : `$${r.toFixed(2)}` }
  const cycleTotal = (monthly: number) => (cycle === 'year' ? monthly * 10 : monthly)
  const priceLabel = (monthly: number) =>
    `${fmtUsd(cycleTotal(monthly) * (1 - pct))} / ${cycle === 'year' ? '年' : '月'}`
  // 划掉锚点:年付锚满 12 个月,月付仅在有优惠时锚原月价
  const struckLabel = (monthly: number) =>
    cycle === 'year' ? `$${monthly * 12}` : pct > 0 ? `$${monthly}` : ''
  const noteLabel = (monthly: number) =>
    promo.active
      ? `创始价 -${promo.percentOff}% · 永久锁定`
      : cycle === 'year' ? `省 $${monthly * 2}(送 2 个月)` : '按月付,随时取消'

  // 团队席位操作(founder 专用)
  async function invite() {
    if (!inviteEmail.trim()) return
    setTeamMsg(null); setBusy('invite')
    const error = await inviteTeamMember(inviteEmail.trim())
    setBusy(null)
    if (error) { setTeamMsg(error); return }
    setInviteEmail(''); setTeamMsg('已加入团队 ✓')
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
    setTeamMsg('席位已调整,账单按比例计费 ✓')
    setTimeout(() => fetchTeam().then(setTeam), 1500) // 等 webhook 镜像
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">订阅与用量</h1>
        <p className="mt-1 text-sm text-slate-500">管理你的套餐、查看本月额度。支付由 Stripe 安全处理。</p>
      </div>

      {banner === 'success' && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">✅ 订阅成功!额度已更新。</div>}
      {banner === 'cancel' && <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">已取消结账,未产生费用。</div>}
      {err && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>}

      {/* 当前套餐 */}
      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">当前套餐</div>
            <div className="text-xl font-bold text-slate-900">{me?.plan.name || 'Explore'}</div>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {STATUS_LABEL[status] || status}
          </span>
        </div>
        {me?.current_period_end && (
          <div className="mt-2 text-xs text-slate-400">
            {status === 'canceled' ? '有效期至 ' : '下次续费 '}{new Date(me.current_period_end).toLocaleDateString('zh-CN')}
          </div>
        )}

        {/* 本月积分余额 */}
        <div className="mt-5">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm text-slate-500">本月积分余额</span>
            <span className="text-sm font-semibold text-slate-900">
              {unlimited ? '无限' : <>剩 <b className="text-emerald-600">{cBalance.toLocaleString()}</b> / {cMonth.toLocaleString()}</>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: unlimited || cMonth === 0 ? '0%' : `${Math.min(100, Math.round((cUsed / cMonth) * 100))}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-slate-400">每月 1 日刷新,未用完不累积。</div>
        </div>

        {/* 积分消耗表(成本来自后端配置,自动同步) */}
        {feat.features.length > 0 && (
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-600">积分这样花{myMult < 1 ? `(你的套餐 ×${myMult},已含折扣)` : ''}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {feat.features.map((f) => (
                <div key={f.key} className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{f.label}</span>
                  <span className="font-medium text-slate-800">{Math.round(f.credits * myMult)} 积分{f.key === 'live_tours' ? '/场' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isPaid && (
          <button onClick={manage} disabled={busy === 'portal'}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            管理订阅 / 改套餐 / 取消
          </button>
        )}
      </div>

      {/* Founder 团队席位(owner 视角);成员看到归属提示 */}
      {team?.role === 'member' && (
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Users className="h-4 w-4 text-amber-500" />
            你在 <b>{team.owner?.display_name || team.owner?.email}</b> 的 Founder 团队中,套餐与积分由团队共享承担。
          </div>
        </div>
      )}
      {team?.role === 'owner' && (
        <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-amber-500" />
              <span className="font-bold text-slate-900">团队席位</span>
              <span className="text-xs text-slate-400">
                {1 + (team.members?.length || 0)} / {team.seatLimit} 席(含你自己)· 共享积分池
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">加席 $49/席/月:</span>
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
                <button onClick={() => removeMember(m.id)} disabled={busy === `rm-${m.id}`} title="移出团队"
                  className="text-slate-300 transition hover:text-rose-500">
                  {busy === `rm-${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              </div>
            ))}
            {(team.members?.length || 0) === 0 && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">还没有成员 —— 邀请同事共享 15,000 积分/月和 ×0.6 折扣。</div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void invite() }}
              placeholder="同事邮箱(登录后自动进入团队)"
              className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-400" />
            <button onClick={() => void invite()} disabled={busy === 'invite' || !inviteEmail.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">
              {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              邀请
            </button>
          </div>
        </div>
      )}

      {/* 升级选项(已是 founder 则不显示) */}
      {planId !== 'founder' && !me?.teamMember && (
        <div>
          {promo.active && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
              <span className="font-bold text-amber-700">🔥 创始优惠 -{promo.percentOff}%</span>
              <span className="text-amber-700">订阅即永久锁定此价</span>
              {promo.seatsRemaining != null && <span className="text-amber-600">· 限 {promo.seatsTotal} 席,仅剩 {promo.seatsRemaining}</span>}
            </div>
          )}
          {/* 月付 / 年付 切换 */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-slate-400">计费周期:</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button onClick={() => setCycle('month')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'month' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>按月付</button>
              <button onClick={() => setCycle('year')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'year' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>按年付 · 省17%</button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANS.filter((p) => (PLAN_ORDER[p.id] ?? 0) > (PLAN_ORDER[planId] ?? 0)).map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
                <div className="flex items-baseline justify-between">
                  <div className="font-bold text-slate-900">{p.name}</div>
                  <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5">
                      {struckLabel(p.monthly) && <span className="text-xs text-slate-400 line-through">{struckLabel(p.monthly)}</span>}
                      <span className="text-sm font-semibold" style={{ color: p.edge }}>{priceLabel(p.monthly)}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">{noteLabel(p.monthly)}</div>
                  </div>
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
                  {p.lines.map((l, i) => (<li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: p.edge }} /> {l}</li>))}
                </ul>
                <button onClick={() => upgrade(p.id)} disabled={busy === p.id}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                  style={{ background: p.edge }}>
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (p.id === 'founder' ? '升级到 Founder' : '免费试用 15 天')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
