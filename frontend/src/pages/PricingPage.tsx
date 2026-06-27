/**
 * 独立营销报价页(route: /pricing)。专门展示套餐与功能 —— 三栏对比 + 价格 + 单一 CTA。
 *
 * 价格来自后端 /api/billing/plans(与 Stripe 单一真相源);功能文案为营销 copy(本地)。
 * CTA:未登录 → 经纪台登录;已登录 → 直接发起 Stripe Checkout(后端校验审批/试用)。
 * 视觉沿用 AboutPage 的深色高科技品牌风。设计稿: docs/stripe-billing-spec.md
 */
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, Flame, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchPlans, fetchPromo, startCheckout, type BillingPlan, type BillingInterval, type Promo } from '../lib/billingApi'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)'

export default function PricingPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (cn: string, en: string) => (zh ? cn : en)
  const { user } = useAuth()
  const navigate = useNavigate()

  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cycle, setCycle] = useState<BillingInterval>('quarter') // 默认季付(更少扣费,经纪偏好)
  const [promo, setPromo] = useState<Promo>({ active: false })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { fetchPlans().then(setPlans); fetchPromo().then(setPromo) }, [])
  // 倒计时心跳(仅在有截止时间时跑)
  useEffect(() => {
    if (!promo.active || !promo.endsAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [promo.active, promo.endsAt])

  const pct = promo.active ? (promo.percentOff || 0) / 100 : 0
  // 价格优先后端,回退本地默认(后端不可达时仍能展示)
  const priceOf = (id: string, fallback: number) => {
    const p = plans.find((x) => x.id === id)
    return p ? Number(p.price_usd_month) : fallback
  }
  // 当套餐卖:只显示一个总价。年付收 10 个月价(送 2 个月);季付 = 3 个月价。
  const chargeMonths = cycle === 'year' ? 10 : 3
  const totalOf = (monthly: number) => monthly * chargeMonths
  const fmt = (n: number) => { const r = Math.round(n * 100) / 100; return r % 1 === 0 ? `$${r}` : `$${r.toFixed(2)}` }
  // 大字 = 套餐总价(有优惠则扣 30%)
  const bigPriceOf = (monthly: number) => fmt(totalOf(monthly) * (1 - pct))
  // 划掉的锚点:年付锚满 12 个月($1188);季付锚原季价。无优惠时仅年付显示满价锚。
  const struckOf = (monthly: number): string | undefined => {
    if (pct > 0) return `$${cycle === 'year' ? monthly * 12 : monthly * 3}`
    return cycle === 'year' ? `$${monthly * 12}` : undefined
  }
  // 大字下方一行
  const billedLine = (monthly: number) => {
    if (promo.active) {
      return cycle === 'year'
        ? L('永久锁定创始价 · 已含送 2 个月 · 随时取消', 'Founding price locked forever · 2 months free included · cancel anytime')
        : L('永久锁定创始价 · 一次付清 · 随时取消', 'Founding price locked forever · cancel anytime')
    }
    return cycle === 'year'
      ? L(`年度套餐 · 省 $${monthly * 2}(送 2 个月)· 随时取消`, `Yearly package · save $${monthly * 2} (2 months free) · cancel anytime`)
      : L('季度套餐 · 一次付清 · 随时取消', 'Quarterly package · cancel anytime')
  }

  // 倒计时 dd hh mm ss
  const countdown = (() => {
    if (!promo.endsAt) return null
    const ms = new Date(promo.endsAt).getTime() - now
    if (ms <= 0) return null
    const s = Math.floor(ms / 1000)
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
  })()

  async function subscribe(planId: 'agent' | 'founder') {
    setErr(null)
    if (!user) { navigate('/agent'); return }   // 去经纪台登录(登录后回来再订阅)
    setBusy(planId)
    const error = await startCheckout(planId, cycle)  // 成功则跳转 Stripe,不返回
    if (error) { setErr(error); setBusy(null) }
  }

  const tiers = [
    {
      id: 'explore', name: L('探索版', 'Explore'), price: L('免费', 'Free'), edge: ACCENT,
      note: L('给买家 / 投资人', 'For buyers / investors'),
      features: [
        L('交互式卫星地图 + 真实 DLD 成交/租约', 'Interactive map + real DLD data'),
        L('区域指标 + 项目详情 + 5 年投资分析', 'Area metrics + detail + 5-yr ROI'),
        L('Luna 语音助手(查数据、飞镜头)', 'Luna voice assistant'),
        L('经纪工具需订阅 Agent 解锁', 'Agent tools unlock with a paid plan'),
      ],
      cta: { label: L('打开地图', 'Open the map'), onClick: () => navigate('/') },
    },
    {
      id: 'agent', name: L('经纪版', 'Agent'), price: bigPriceOf(priceOf('agent', 99)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 季', '/ qtr'), edge: ACCENT, highlight: true,
      badge: L('15 天免费试用', '15-day free trial'),
      note: L('15 天免费 · 需绑卡 · 提前取消不扣费', '15 days free · card required · cancel before billing'),
      billed: billedLine(priceOf('agent', 99)), priceWas: struckOf(priceOf('agent', 99)),
      features: [
        L('实时海外带看 20 场/月 + 应用内语音', '20 live overseas tours/mo + in-app voice'),
        L('Luna 智能导览 20 个/月(可分享自助看房)', '20 Luna AI tours/mo (shareable)'),
        L('买家意向报告 30 份/月(AI 意向判定 + 跟进话术)', '30 buyer-intent reports/mo'),
        L('AI 楼书解析:上传开发商 PDF 秒变可视化房源', 'AI brochure parsing: PDF → listings'),
        L('经纪品牌项目报告 · 无限分享(头像+ROI+真实成交)', 'Branded project reports · unlimited'),
        L('客户行为洞察 + 热度排序(谁最可能成交)', 'Client behaviour insights + lead scoring'),
      ],
      cta: { label: L('免费试用 15 天', 'Start 15-day free trial'), onClick: () => subscribe('agent') },
    },
    {
      id: 'founder', name: L('创始会员', 'Founder'), price: bigPriceOf(priceOf('founder', 699)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 季', '/ qtr'), edge: GOLD, badge: L('10× 额度', '10× quota'),
      note: L('早期支持者 · 名额有限', 'Early supporters · limited'),
      billed: billedLine(priceOf('founder', 699)), priceWas: struckOf(priceOf('founder', 699)),
      features: [
        L('Agent 全部功能 · 额度 ×10(带看200·导览200·报告300)', 'Everything in Agent · 10× quota'),
        L('White-label 品牌定制:你的 logo/配色', 'White-label branding (your logo/colors)'),
        L('自定义域名(客户只看到你的品牌)', 'Custom domain'),
        L('优先支持 · 共建功能 · 锁定创始价', 'Priority support · shape features · locked price'),
      ],
      cta: { label: L('申请 Founder', 'Apply for Founder'), onClick: () => subscribe('founder') },
    },
  ]

  return (
    <div className="relative flex-1 overflow-y-auto bg-[#070b16] text-white" style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}>
      <Helmet>
        <title>{L('定价 — Pinzos 经纪订阅', 'Pricing — Pinzos for Agents')}</title>
        <meta name="description" content={L(
          'Pinzos 经纪订阅:买家免费;经纪 $99/月含实时海外带看、Luna 智能导览与买家意向报告;Founder $699/月 10× 额度。',
          'Pinzos for agents: free for buyers; Agent $99/mo with live overseas tours, Luna AI tours and buyer-intent reports; Founder $699/mo with 10× quota.'
        )} />
        <link rel="canonical" href="https://pinzos.com/pricing" />
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="text-center">
          <span className="font-mono text-xs font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('定价', 'PRICING')}</span>
          <h1 className="mt-3 text-4xl font-bold md:text-5xl">{L('买家免费,经纪按量选档', 'Free for buyers. Plans for agents.')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-slate-400">{L(
            '一张地图看懂迪拜期房;经纪用它带海外客户实时看房、生成导览与意向报告。按季或按年付,随时取消。',
            'One map for Dubai off-plan; agents use it to tour overseas clients live, generate tours and intent reports. Billed quarterly or yearly, cancel anytime.'
          )}</p>
        </div>

        {/* ── 创始发布优惠横幅(限名额 + 限时,均为 Stripe 真实 enforce)── */}
        {promo.active && (
          <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-2xl border"
            style={{ borderColor: `${GOLD}66`, background: `linear-gradient(135deg, ${GOLD}1f, ${ACCENT}14)`, boxShadow: `0 0 50px -20px ${GOLD}` }}>
            <div className="flex flex-col items-center gap-3 p-5 text-center md:flex-row md:justify-between md:text-left">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: `${GOLD}26`, color: GOLD }}>
                  <Flame className="h-5 w-5" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-x-2 text-base font-bold">
                    {L('创始发布优惠', 'Founding Launch')}
                    <span className="rounded-md px-2 py-0.5 text-sm font-extrabold text-slate-900" style={{ background: GOLD }}>-{promo.percentOff}%</span>
                    {promo.forever && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: GOLD }}>
                        <Lock className="h-3 w-3" /> {L('永久锁定创始价', 'price locked forever')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-300">
                    {L('全场 7 折 · 早鸟订阅永久享此价 · 错过即恢复原价', 'Everything 30% off · early subscribers keep this price forever')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {promo.seatsRemaining != null && (
                  <div className="text-center">
                    <div className="text-2xl font-extrabold leading-none" style={{ color: GOLD }}>{promo.seatsRemaining}</div>
                    <div className="text-[10px] text-slate-400">{L(`/ ${promo.seatsTotal} 席仅剩`, `of ${promo.seatsTotal} left`)}</div>
                  </div>
                )}
                {countdown && (
                  <div className="text-center">
                    <div className="font-mono text-lg font-bold tabular-nums text-white">
                      {String(countdown.d).padStart(2, '0')}:{String(countdown.h).padStart(2, '0')}:{String(countdown.m).padStart(2, '0')}:{String(countdown.s).padStart(2, '0')}
                    </div>
                    <div className="text-[10px] text-slate-400">{L('天 时 分 秒 后结束', 'until offer ends')}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 季付 / 年付 切换(月单价不变,年付送 2 个月) */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
            <button onClick={() => setCycle('quarter')}
              className={`rounded-full px-4 py-1.5 font-medium transition ${cycle === 'quarter' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'quarter' ? { background: ACCENT } : undefined}>
              {L('按季付', 'Quarterly')}
            </button>
            <button onClick={() => setCycle('year')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition ${cycle === 'year' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'year' ? { background: ACCENT } : undefined}>
              {L('按年付', 'Yearly')}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${cycle === 'year' ? 'bg-slate-900/15 text-slate-900' : 'bg-white/10 text-slate-300'}`}>{L('省 17%', 'save 17%')}</span>
            </button>
          </div>
        </div>

        {err && <div className="mx-auto mt-6 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">{err}</div>}

        <div className="mt-8 grid items-stretch gap-4 lg:grid-cols-3">
          {tiers.map((t) => (
            <div key={t.id} className="relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-6"
              style={{ borderColor: t.highlight ? ACCENT : t.edge === GOLD ? `${GOLD}77` : 'rgba(255,255,255,0.1)', boxShadow: t.highlight ? `0 0 40px -16px ${ACCENT}` : undefined }}>
              {t.badge && <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: t.edge }}>{t.badge}</span>}
              <div className="text-sm font-semibold" style={{ color: t.edge }}>{t.name}</div>
              <div className="mt-1 flex items-end gap-2">
                <span className="text-3xl font-bold">{t.price}</span>
                {t.priceWas && <span className="pb-1 text-base font-medium text-slate-500 line-through">{t.priceWas}</span>}
                {t.per && <span className="pb-1 text-sm text-slate-500">{t.per}{L(' (USD)', ' (USD)')}</span>}
              </div>
              <p className="mt-1.5 text-sm text-slate-400">{t.note}</p>
              {t.billed && <p className="mt-0.5 text-xs text-slate-500">{t.billed}</p>}
              <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-300">
                {t.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: t.edge }} /> {f}</li>
                ))}
              </ul>
              <button onClick={t.cta.onClick} disabled={busy === t.id}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:opacity-60"
                style={{ background: t.edge }}>
                {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t.cta.label} <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          {promo.active
            ? L(`创始发布优惠:全场 ${promo.percentOff}% off,早鸟订阅永久锁定此价(限 ${promo.seatsTotal} 席,限时)。划掉为原价。`,
                `Founding Launch: ${promo.percentOff}% off everything, early subscribers lock this price forever (${promo.seatsTotal} seats, limited time). Struck price is the regular rate.`)
            : L('价格以美元(USD)计,按季或按年付(年付送 2 个月)。', 'Prices in USD, billed quarterly or yearly (yearly = 2 months free).')}
          {L(' 15 天免费试用,提前取消不扣费。支付由 Stripe 安全处理。', ' 15-day free trial, cancel before billing. Payments securely handled by Stripe.')}
        </p>

        <div className="mt-10 text-center">
          <Link to="/about" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            {L('查看完整功能介绍', 'See all features')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
