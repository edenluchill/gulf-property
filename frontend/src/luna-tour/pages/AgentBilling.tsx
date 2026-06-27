/**
 * 经纪台 — 订阅 / 升级页(route: /agent/billing)。
 *
 * 显示当前套餐 + 本月用量 + 升级按钮(→ Stripe Checkout)+ 管理订阅(→ Billing Portal)。
 * 数据来自 /api/billing/me。设计稿: docs/stripe-billing-spec.md
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Check, ExternalLink } from 'lucide-react'
import { fetchBillingMe, startCheckout, openPortal, type BillingMe, type BillingInterval } from '../../lib/billingApi'

const STATUS_LABEL: Record<string, string> = {
  none: '未订阅', trialing: '试用中', active: '生效中', past_due: '续费失败', canceled: '已取消',
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit < 0
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100))
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{used} / {unlimited ? '∞' : limit}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function AgentBilling() {
  const [me, setMe] = useState<BillingMe | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()
  const [cycle, setCycle] = useState<BillingInterval>('quarter') // 默认季付

  const refresh = () => fetchBillingMe().then((m) => { setMe(m); setLoading(false) })
  useEffect(() => { refresh() }, [])

  // Checkout 回跳提示(?status=success|cancel),读后清掉 query
  const banner = params.get('status')
  useEffect(() => {
    if (banner) { const t = setTimeout(() => setParams({}, { replace: true }), 6000); return () => clearTimeout(t) }
  }, [banner, setParams])

  async function upgrade(planId: 'agent' | 'founder') {
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
  const limits = me?.plan.limits || {}
  const isPaid = status === 'active' || status === 'trialing'
  const lunaLimit = Number(limits.sessions_month ?? 0)
  const liveLimit = Number(limits.live_tours_month ?? 0)
  const reportsLimit = Number(limits.reports_month ?? 0)

  const PLANS: { id: 'agent' | 'founder'; name: string; monthly: number; lines: string[]; edge: string }[] = [
    { id: 'agent', name: '经纪版 Agent', monthly: 99, edge: '#10b981',
      lines: ['实时带看 20 场/月', 'Luna 导览 20 个/月', '意向报告 30 份/月', '应用内语音 + AI 楼书解析'] },
    { id: 'founder', name: '创始会员 Founder', monthly: 699, edge: '#E8C37E',
      lines: ['实时带看 200 场/月', 'Luna 导览 200 个/月', '意向报告 300 份/月', '锁定创始价 · 优先支持'] },
  ]
  const priceLabel = (monthly: number) =>
    cycle === 'year' ? `$${monthly * 10} / 年` : `$${monthly * 3} / 季`
  const noteLabel = (monthly: number) =>
    cycle === 'year' ? `省 $${monthly * 2}(送 2 个月)` : '一次付清'

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

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <UsageBar label="Luna 智能导览(本月)" used={me?.usage.luna_tours ?? 0} limit={lunaLimit} />
          <UsageBar label="实时带看(本月)" used={me?.usage.live_tours ?? 0} limit={liveLimit} />
          <UsageBar label="买家意向报告(本月)" used={me?.usage.reports ?? 0} limit={reportsLimit} />
        </div>

        {isPaid && (
          <button onClick={manage} disabled={busy === 'portal'}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            管理订阅 / 改套餐 / 取消
          </button>
        )}
      </div>

      {/* 升级选项(已是 founder 则不显示) */}
      {planId !== 'founder' && (
        <div>
          {/* 季付 / 年付 切换 */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-slate-400">计费周期:</span>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button onClick={() => setCycle('quarter')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'quarter' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>按季付</button>
              <button onClick={() => setCycle('year')} className={`rounded-md px-2.5 py-1 font-medium ${cycle === 'year' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>按年付 · 省17%</button>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {PLANS.filter((p) => !(planId === 'agent' && p.id === 'agent')).map((p) => (
              <div key={p.id} className="flex flex-col rounded-2xl bg-white p-5 ring-1 ring-slate-900/[0.06]">
                <div className="flex items-baseline justify-between">
                  <div className="font-bold text-slate-900">{p.name}</div>
                  <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5">
                      {cycle === 'year' && <span className="text-xs text-slate-400 line-through">${p.monthly * 12}</span>}
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
                  {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (p.id === 'agent' ? '免费试用 15 天' : '升级到 Founder')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
