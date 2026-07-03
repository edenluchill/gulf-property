/**
 * 独立营销报价页(route: /pricing)。专门展示套餐与功能 —— 三栏对比 + 价格 + 单一 CTA。
 *
 * 价格来自后端 /api/billing/plans(与 Stripe 单一真相源);功能文案为营销 copy(本地)。
 * CTA:未登录 → 经纪台登录;已登录 → 直接发起 Stripe Checkout(后端校验审批/试用)。
 * 视觉沿用 AboutPage 的深色高科技品牌风。设计稿: docs/stripe-billing-spec.md
 */
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ArrowRight, Check, Loader2, Flame, Lock, Briefcase } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchPlans, fetchPromo, fetchFeatures, startCheckout, setMyRole, type BillingPlan, type BillingInterval, type Promo, type FeaturesInfo } from '../lib/billingApi'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)'

/**
 * agentOnboarding(route /agent/plans):选完「我是经纪」后落地的专属选档页。
 * 只展示三个付费档(不放免费卡分流),文案讲解锁的能力而非付费义务;
 * 底部留一条小字「先以买家身份逛逛」作为软出口(改回 buyer,免费)。
 */
export default function PricingPage({ agentOnboarding = false }: { agentOnboarding?: boolean }) {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (cn: string, en: string) => (zh ? cn : en)
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 从地图被计量门送过来(?from=map)→ 顶部解释为什么来到这里
  const fromMapGate = agentOnboarding && params.get('from') === 'map'

  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cycle, setCycle] = useState<BillingInterval>('year') // 默认年付(送2个月,现金流/留存都更好)
  const [promo, setPromo] = useState<Promo>({ active: false })
  const [feat, setFeat] = useState<FeaturesInfo>({ features: [], plans: [] })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => { fetchPlans().then(setPlans); fetchPromo().then(setPromo); fetchFeatures().then(setFeat) }, [])
  const creditsOf = (id: string) => feat.plans.find((p) => p.id === id)?.creditsMonth ?? 0
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
  // 当套餐卖:只显示一个总价。年付收 10 个月价(送 2 个月);月付 = 1 个月价。
  const chargeMonths = cycle === 'year' ? 10 : 1
  const totalOf = (monthly: number) => monthly * chargeMonths
  const fmt = (n: number) => { const r = Math.round(n * 100) / 100; return r % 1 === 0 ? `$${r}` : `$${r.toFixed(2)}` }
  // 大字 = 套餐总价(有优惠则扣 30%)
  const bigPriceOf = (monthly: number) => fmt(totalOf(monthly) * (1 - pct))
  // 划掉的锚点:年付锚满 12 个月;月付仅在有优惠时锚原月价。
  const struckOf = (monthly: number): string | undefined => {
    if (pct > 0) return `$${cycle === 'year' ? monthly * 12 : monthly}`
    return cycle === 'year' ? `$${monthly * 12}` : undefined
  }
  // 大字下方一行
  const billedLine = (monthly: number) => {
    if (promo.active) {
      return cycle === 'year'
        ? L('永久锁定创始价 · 已含送 2 个月 · 随时取消', 'Founding price locked forever · 2 months free included · cancel anytime')
        : L('永久锁定创始价 · 按月付 · 随时取消', 'Founding price locked forever · billed monthly · cancel anytime')
    }
    return cycle === 'year'
      ? L(`年度套餐 · 省 $${monthly * 2}(送 2 个月)· 随时取消`, `Yearly package · save $${monthly * 2} (2 months free) · cancel anytime`)
      : L('按月付 · 随时取消', 'Billed monthly · cancel anytime')
  }

  // 倒计时 dd hh mm ss
  const countdown = (() => {
    if (!promo.endsAt) return null
    const ms = new Date(promo.endsAt).getTime() - now
    if (ms <= 0) return null
    const s = Math.floor(ms / 1000)
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
  })()

  async function subscribe(planId: 'rookie' | 'agent' | 'founder') {
    setErr(null)
    if (!user) { navigate('/agent'); return }   // 去经纪台登录(登录后回来再订阅)
    setBusy(planId)
    const error = await startCheckout(planId, cycle)  // 成功则跳转 Stripe,不返回
    if (error) { setErr(error); setBusy(null) }
  }

  // 软出口:其实是买家 → 改回免费身份,回地图
  const [switching, setSwitching] = useState(false)
  async function backToBuyer() {
    setSwitching(true)
    const ok = await setMyRole('buyer')
    if (ok) {
      try { sessionStorage.setItem('pinzos-role', 'buyer') } catch { /* noop */ }
      window.location.href = '/'
      return
    }
    setSwitching(false)
  }

  const allTiers = [
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
      id: 'rookie', name: L('启程版', 'Starter'), price: bigPriceOf(priceOf('rookie', 25)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: ACCENT,
      badge: L('7 天免费试用', '7-day free trial'),
      note: L('个人经纪起步 · 付款即开通', 'Solo agents · instant activation'),
      billed: billedLine(priceOf('rookie', 25)), priceWas: struckOf(priceOf('rookie', 25)),
      creditsMo: creditsOf('rookie') || 200,
      features: [
        L('地图与市场数据不限时(全部买家功能)', 'Unlimited map & data (everything for buyers)'),
        L('客户 CRM + 买家意向报告 + AI 楼书解析', 'Client CRM + intent reports + AI brochures'),
        L('符合关注区域的买家线索(尽力推送)', 'Buyer leads for your focus areas (best effort)'),
      ],
      cta: { label: L('免费试用 7 天', 'Start 7-day free trial'), onClick: () => subscribe('rookie') },
    },
    {
      id: 'agent', name: L('专业版', 'Pro'), price: bigPriceOf(priceOf('agent', 99)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: ACCENT, highlight: true,
      badge: L('最受欢迎 · 7 天免费', 'Most popular · 7 days free'),
      note: L('7 天免费 · 需绑卡 · 提前取消不扣费', '7 days free · card required · cancel before billing'),
      billed: billedLine(priceOf('agent', 99)), priceWas: struckOf(priceOf('agent', 99)),
      creditsMo: creditsOf('agent') || 2500,
      features: [
        L('启程版全部功能', 'Everything in Starter'),
        L('实时海外带看 · Luna 智能导览 · 应用内语音', 'Live tours · Luna AI tours · in-app voice'),
        L('买家线索优先推送 + 客户行为洞察', 'Priority lead flow + behaviour insights'),
      ],
      cta: { label: L('免费试用 7 天', 'Start 7-day free trial'), onClick: () => subscribe('agent') },
    },
    {
      id: 'founder', name: L('创始会员', 'Founder'), price: bigPriceOf(priceOf('founder', 699)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: GOLD, badge: L('团队 · 3 席', 'Team · 3 seats'),
      note: L('早期支持者 · 名额有限', 'Early supporters · limited'),
      billed: billedLine(priceOf('founder', 699)), priceWas: struckOf(priceOf('founder', 699)),
      creditsMo: creditsOf('founder') || 15000, founderDiscount: true,
      features: [
        L('专业版全部功能 · 买家线索独占优先', 'Everything in Pro · first pick of leads'),
        L('含 3 个席位共享积分池,+$49/席扩容', '3 seats sharing one credit pool, +$49/seat'),
        L('White-label 品牌定制 · 自定义域名 · 优先支持', 'White-label · custom domain · priority support'),
      ],
      cta: { label: L('申请 Founder', 'Apply for Founder'), onClick: () => subscribe('founder') },
    },
  ]
  // 经纪选档页不放免费卡(引导聚焦三个付费档);公共 /pricing 保持四卡
  const tiers = agentOnboarding ? allTiers.filter((t) => t.id !== 'explore') : allTiers

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

      <section className="mx-auto max-w-6xl px-6 py-5 md:py-7">
        {/* 无导航的选档页:只留一个品牌标识定位(不可点 —— 一个页面一个决定) */}
        {agentOnboarding && (
          <div className="mb-5 flex items-center justify-center gap-2 select-none">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: ACCENT }}>
              <span className="text-sm font-black text-slate-900">P</span>
            </span>
            <span className="text-lg font-bold tracking-tight">Pinzos</span>
          </div>
        )}
        {/* 从地图跳来的说明条:讲清楚规则(经纪身份订阅后使用),并给买家留出口 */}
        {fromMapGate && (
          <div className="mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-indigo-300/30 bg-indigo-500/10 px-4 py-3 text-sm text-slate-200">
            <Briefcase className="h-4 w-4 shrink-0 text-indigo-300" />
            <span>
              {L(
                '你的账号是经纪身份 —— 经纪版(含不限时地图与数据)需选择套餐后使用,7 天免费试用、试用期取消零费用。',
                'Your account is registered as an agent — agent access (incl. unlimited map & data) starts with a plan. 7-day free trial, cancel at no charge.'
              )}
            </span>
            <button onClick={() => void backToBuyer()} disabled={switching}
              className="font-medium text-teal-300 underline-offset-2 hover:underline disabled:opacity-60">
              {L('我其实是买家 → 改回免费身份', "I'm actually a buyer → switch back (free)")}
            </button>
          </div>
        )}
        <div className="text-center">
          {agentOnboarding ? (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('经纪工作台', 'AGENT WORKSPACE')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('欢迎!你的经纪工作台已就绪', 'Welcome! Your agent workspace is ready')}</h1>
              <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{L(
                '选一档解锁客户 CRM、品牌化报告与买家线索 —— 7 天免费试用,试用期内取消不产生任何费用。',
                'Pick a plan to unlock client CRM, branded reports and buyer leads — 7-day free trial, cancel within the trial at no charge.'
              )}</p>
            </>
          ) : (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('定价', 'PRICING')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('买家免费,经纪按量选档', 'Free for buyers. Plans for agents.')}</h1>
              <p className="mx-auto mt-1.5 hidden max-w-2xl text-sm text-slate-400 sm:block">{L(
                '$25 起步:地图不限时 + 客户线索。带海外客户实时看房、生成导览与意向报告。按月或按年付,随时取消。',
                'From $25: unlimited map + buyer leads. Tour overseas clients live, generate tours and intent reports. Billed monthly or yearly, cancel anytime.'
              )}</p>
            </>
          )}
        </div>

        {/* ── 创始发布优惠条(纤细单行;限名额+限时均为 Stripe 真实 enforce)── */}
        {promo.active && (
          <div className="mx-auto mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: `${GOLD}66`, background: `linear-gradient(90deg, ${GOLD}22, ${ACCENT}12)`, boxShadow: `0 0 40px -22px ${GOLD}` }}>
            <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: GOLD }}>
              <Flame className="h-4 w-4" /> {L('创始发布优惠', 'Founding Launch')}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-extrabold text-slate-900" style={{ background: GOLD }}>-{promo.percentOff}%</span>
            {promo.forever && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-200"><Lock className="h-3 w-3" /> {L('永久锁价', 'locked forever')}</span>
            )}
            {promo.seatsRemaining != null && (
              <span className="text-xs text-slate-300">· {L('仅剩', 'only')} <b style={{ color: GOLD }}>{promo.seatsRemaining}</b>/{promo.seatsTotal} {L('席', 'left')}</span>
            )}
            {countdown && (
              <span className="font-mono text-xs font-semibold tabular-nums text-white">
                · ⏱ {String(countdown.d).padStart(2, '0')}:{String(countdown.h).padStart(2, '0')}:{String(countdown.m).padStart(2, '0')}:{String(countdown.s).padStart(2, '0')}
              </span>
            )}
          </div>
        )}

        {/* 月付 / 年付 切换(月单价不变,年付送 2 个月) */}
        <div className="mt-5 flex justify-center">
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
            <button onClick={() => setCycle('month')}
              className={`rounded-full px-4 py-1.5 font-medium transition ${cycle === 'month' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'month' ? { background: ACCENT } : undefined}>
              {L('按月付', 'Monthly')}
            </button>
            <button onClick={() => setCycle('year')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition ${cycle === 'year' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'year' ? { background: ACCENT } : undefined}>
              {L('按年付', 'Yearly')}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${cycle === 'year' ? 'bg-slate-900/15 text-slate-900' : 'bg-white/10 text-slate-300'}`}>{L('省 17%', 'save 17%')}</span>
            </button>
          </div>
        </div>

        {err && <div className="mx-auto mt-4 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">{err}</div>}

        <div className={`mt-4 grid items-stretch gap-3 md:grid-cols-2 ${agentOnboarding ? 'xl:grid-cols-3 mx-auto max-w-4xl' : 'xl:grid-cols-4'}`}>
          {tiers.map((t) => (
            // 手机端把付费档排前(受众是经纪),桌面端保持 探索/启程/专业/创始 原序
            <div key={t.id} className={`relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-5 xl:order-none ${t.id === 'agent' ? 'order-1' : t.id === 'rookie' ? 'order-2' : t.id === 'founder' ? 'order-3' : 'order-4'}`}
              style={{ borderColor: t.highlight ? ACCENT : t.edge === GOLD ? `${GOLD}77` : 'rgba(255,255,255,0.1)', boxShadow: t.highlight ? `0 0 40px -16px ${ACCENT}` : undefined }}>
              {t.badge && <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: t.edge }}>{t.badge}</span>}
              <div className="text-sm font-semibold" style={{ color: t.edge }}>{t.name}</div>
              <div className="mt-1 flex items-end gap-2">
                <span className="text-3xl font-bold">{t.price}</span>
                {t.priceWas && <span className="pb-1 text-base font-medium text-slate-500 line-through">{t.priceWas}</span>}
                {t.per && <span className="pb-1 text-sm text-slate-500">{t.per}{L(' (USD)', ' (USD)')}</span>}
              </div>
              <p className="mt-1 text-[13px] text-slate-400">{t.note}</p>
              {t.billed && <p className="mt-0.5 text-[11px] text-slate-500">{t.billed}</p>}
              {/* 醒目的每月积分额度 */}
              {'creditsMo' in t && (t as { creditsMo?: number }).creditsMo != null && (
                <div className="mt-2.5 flex items-baseline gap-1.5 rounded-lg px-3 py-1.5" style={{ background: `${t.edge}1a` }}>
                  <span className="text-xl font-extrabold" style={{ color: t.edge }}>{(t as { creditsMo: number }).creditsMo.toLocaleString()}</span>
                  <span className="text-[13px] font-medium text-slate-300">{L('积分 / 月', 'credits / mo')}</span>
                  {(t as { founderDiscount?: boolean }).founderDiscount && (
                    <span className="ml-auto text-[11px] font-semibold" style={{ color: t.edge }}>{L('消耗 ×0.6', '0.6× cost')}</span>
                  )}
                </div>
              )}
              <ul className="mt-3 flex-1 space-y-1.5 text-[13px] leading-snug text-slate-300">
                {t.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: t.edge }} /> {f}</li>
                ))}
              </ul>
              <button onClick={t.cta.onClick} disabled={busy === t.id}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-slate-900 transition hover:opacity-90 disabled:opacity-60"
                style={{ background: t.edge }}>
                {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t.cta.label} <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          ))}
        </div>

        {/* 积分消耗表(成本来自后端 /features 配置,改配置自动同步) */}
        {feat.features.length > 0 && (() => {
          const founderMult = feat.plans.find((p) => p.id === 'founder')?.multiplier ?? 0.6
          return (
            <div className="mx-auto mt-4 max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th className="px-4 py-1.5 text-left font-semibold" style={{ color: ACCENT }}>{L('积分消耗对照', 'WHAT CREDITS BUY')}</th>
                    <th className="px-4 py-1.5 text-right font-medium">{L('标准', 'Standard')}</th>
                    <th className="px-4 py-1.5 text-right font-medium" style={{ color: GOLD }}>Founder ×{founderMult}</th>
                  </tr>
                </thead>
                <tbody>
                  {feat.features.map((f) => (
                    <tr key={f.key} className="border-t border-white/[0.05]">
                      <td className="px-4 py-1 text-slate-300">{f.label}{f.key === 'live_tours' ? L('(每场)', ' (each)') : ''}</td>
                      <td className="px-4 py-1 text-right font-semibold text-white">{f.credits} {L('积分', 'cr')}</td>
                      <td className="px-4 py-1 text-right" style={{ color: GOLD }}>{Math.round(f.credits * founderMult)} {L('积分', 'cr')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
          {promo.active
            ? L(`创始发布优惠:全场 ${promo.percentOff}% off,早鸟订阅永久锁定此价(限 ${promo.seatsTotal} 席,限时)。划掉为原价。`,
                `Founding Launch: ${promo.percentOff}% off everything, early subscribers lock this price forever (${promo.seatsTotal} seats, limited time). Struck price is the regular rate.`)
            : L('价格以美元(USD)计,按月或按年付(年付送 2 个月)。', 'Prices in USD, billed monthly or yearly (yearly = 2 months free).')}
          {L(' 7 天免费试用,提前取消不扣费。支付由 Stripe 安全处理。', ' 7-day free trial, cancel before billing. Payments securely handled by Stripe.')}
        </p>

        <div className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
          <Link to="/about" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-400 transition hover:text-white">
            {L('查看完整功能介绍', 'See all features')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {agentOnboarding && (
            <button onClick={() => void backToBuyer()} disabled={switching}
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 transition hover:text-slate-300 disabled:opacity-60">
              {switching && <Loader2 className="h-3 w-3 animate-spin" />}
              {L('还没准备好?先以买家身份免费逛逛地图 →', 'Not ready yet? Explore the map free as a buyer →')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
