/**
 * 独立营销报价页(route: /pricing)。专门展示套餐与功能 —— 三栏对比 + 价格 + 单一 CTA。
 *
 * 价格来自后端 /api/billing/plans(与 Stripe 单一真相源);功能文案为营销 copy(本地)。
 * CTA:未登录 → 经纪台登录;已登录 → 直接发起 Stripe Checkout(后端校验审批/试用)。
 * 视觉沿用 AboutPage 的深色高科技品牌风。设计稿: docs/stripe-billing-spec.md
 */
import { Helmet } from 'react-helmet-async'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { ArrowRight, ArrowLeft, Check, Loader2, Flame, Lock, Briefcase, Gift } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchPlans, fetchPromo, fetchFeatures, fetchBillingMe, startCheckout, startFreeTrial, type BillingPlan, type BillingInterval, type Promo, type FeaturesInfo, type BillingMe, type PaidPlanId, type TrialRole } from '../lib/billingApi'
import { useResetOnBFCache } from '../hooks/useResetOnBFCache'
import { trackEvent } from '../lib/track'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)'

/**
 * agentOnboarding(route /agent/plans):选完「我是经纪」后落地的专属选档页。
 * 只展示三个付费档(不放免费卡分流),文案讲解锁的能力而非付费义务;
 * 底部留一条小字「先以买家身份逛逛」作为软出口(改回 buyer,免费)。
 */
export default function PricingPage({ agentOnboarding = false, variant }: {
  agentOnboarding?: boolean
  /** 角色专属选档页:各角色只看到自己的套餐(agent=启程+专业 / agency=经纪公司版 / developer=开发商版) */
  variant?: 'agent' | 'agency' | 'developer'
}) {
  const { t: tRaw } = useTranslation('misc')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // 从地图被计量门送过来(?from=map)→ 顶部解释为什么来到这里
  const fromMapGate = agentOnboarding && params.get('from') === 'map'

  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // 跳 Stripe Checkout 后按「后退」从 bfcache 恢复会保留 busy → spinner 卡死。重置。
  useResetOnBFCache(() => setBusy(null))
  const [cycle, setCycle] = useState<BillingInterval>('month') // 默认月付(低门槛;年付按钮用「送2个月」吸引)
  const [promo, setPromo] = useState<Promo>({ active: false })
  const [feat, setFeat] = useState<FeaturesInfo>({ features: [], plans: [] })
  const [now, setNow] = useState(() => Date.now())
  const [me, setMe] = useState<BillingMe | null>(null)

  useEffect(() => { fetchPlans().then(setPlans); fetchPromo().then(setPromo); fetchFeatures().then(setFeat) }, [])
  // 试用资格:已用过 / 已有生效套餐 → CTA 回落「立即订阅」
  useEffect(() => { if (user) void fetchBillingMe().then(setMe) }, [user])
  useEffect(() => {
    trackEvent('pricing_view', { variant: variant || (agentOnboarding ? 'onboarding' : 'public'), from: params.get('from') || null })
  }, [variant, agentOnboarding, params])
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
  // 年付实收价:优先后端显式列 price_usd_year(rookie=$249 —— 中国人忌 250),
  // 回退 month×10(founder/developer 仍是「送 2 个月」)。这里必须跟 Stripe 实收一致,
  // 否则页面标一个价、结账扣另一个价。
  const yearOf = (id: string, monthly: number) => {
    const y = Number(plans.find((x) => x.id === id)?.price_usd_year)
    return Number.isFinite(y) && y > 0 ? y : monthly * 10
  }
  // 当套餐卖:只显示一个总价。年付 = 真实年付价;月付 = 1 个月价。
  const totalOf = (id: string, monthly: number) => (cycle === 'year' ? yearOf(id, monthly) : monthly)
  const fmt = (n: number) => { const r = Math.round(n * 100) / 100; return r % 1 === 0 ? `$${r}` : `$${r.toFixed(2)}` }
  // 大字 = 套餐总价(有优惠则扣 30%)
  const bigPriceOf = (id: string, monthly: number) => fmt(totalOf(id, monthly) * (1 - pct))
  // 划掉的锚点:年付锚满 12 个月;月付仅在有优惠时锚原月价。
  const struckOf = (monthly: number): string | undefined => {
    if (pct > 0) return `$${cycle === 'year' ? monthly * 12 : monthly}`
    return cycle === 'year' ? `$${monthly * 12}` : undefined
  }
  // 大字下方一行
  const billedLine = (id: string, monthly: number) => {
    if (promo.active) {
      return cycle === 'year'
        ? t('misc:launchPriceLockedForever')
        : t('misc:launchPriceLockedForever2')
    }
    // 省多少 = 12 个月月价 − 真实年付价(锚点 $300 − $249 = 省 $51,跟划掉的价对得上)
    const saved = fmt(monthly * 12 - yearOf(id, monthly))
    return cycle === 'year'
      ? t('misc:yearlyPackageSave2', { saved })
      : t('misc:billedMonthlyCancelAnytime')
  }

  // 倒计时 dd hh mm ss
  const countdown = (() => {
    if (!promo.endsAt) return null
    const ms = new Date(promo.endsAt).getTime() - now
    if (ms <= 0) return null
    const s = Math.floor(ms / 1000)
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
  })()

  // ── 免绑卡试用 (2026-07-11) ────────────────────────────────
  // 主 CTA = 零摩擦试用(不跳 Stripe、不收卡);「直接订阅」降级为次要链接。
  // 已用过试用 / 已有生效套餐 → 主 CTA 回落成「立即订阅」。
  const ROLE_BY_PLAN: Record<string, TrialRole> = { rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer' }
  const hasPlan = me?.status === 'active' || me?.status === 'trialing'
  const canTrial = !me || (!me.trial?.used && !hasPlan)  // 未登录也按"能试用"展示(点了先去登录)

  // 未登录 → 带 returnTo 去登录,登录完回到**这一页**继续(原来跳 /agent 要绕好几跳)
  const goLogin = () => {
    const back = encodeURIComponent(location.pathname + location.search)
    navigate(`/login?returnTo=${back}`)
  }

  async function subscribe(planId: PaidPlanId) {
    setErr(null)
    if (!user) { goLogin(); return }
    trackEvent('plan_select', { plan_id: planId, cycle, action: 'subscribe' })
    setBusy(planId)
    const error = await startCheckout(planId, cycle, { hadTrial: !!me?.trial?.used })  // 成功则跳转 Stripe,不返回
    if (error) { setErr(error); setBusy(null) }
  }

  async function beginTrial(planId: PaidPlanId) {
    setErr(null)
    if (!user) { goLogin(); return }            // 登录完回到这一页,再点一次即可
    trackEvent('plan_select', { plan_id: planId, cycle, action: 'trial' })
    setBusy(planId)
    const r = await startFreeTrial(ROLE_BY_PLAN[planId] || 'agent')
    if (r.trial) { window.location.assign('/agent'); return }  // 直接进工作台开始用
    // 试用已用过 / 已有套餐 → 别把人卡在这,直接转去订阅
    if (r.code === 'trial_used' || r.code === 'already_subscribed') {
      const error = await startCheckout(planId, cycle, { hadTrial: true })
      if (error) { setErr(error); setBusy(null) }
      return
    }
    setErr(r.error || null)
    setBusy(null)
  }

  // onboarding 页上方已有独立的「试用」主卡 → 卡片就别再重复放试用按钮了
  // (两张卡各一个试用按钮,而试用点哪张都一样,只会让人以为要先选套餐才能试)。
  // 公共 /pricing 没有那张主卡,卡片 CTA 仍然主推试用。
  const heroTrial = agentOnboarding && canTrial

  /** 主 CTA:能试用且没有主卡 → 试用;否则 → 订阅。 */
  const ctaFor = (planId: PaidPlanId) => canTrial && !heroTrial
    ? { label: t('misc:tryFreeFor7'), onClick: () => beginTrial(planId) }
    : { label: t('misc:subscribeNow'), onClick: () => subscribe(planId) }

  // 软出口:选错身份 → 回选择身份页重选(不直接改成买家)
  const reselectRole = () => {
    try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ }
    window.location.assign('/choose-role')
  }

  const allTiers = [
    {
      id: 'explore', name: t('misc:explore'), price: t('misc:free'), edge: ACCENT,
      note: t('misc:forBuyers'),
      features: [
        t('misc:interactiveMapRealDld'),
        t('misc:areaMetricsDetail5'),
        t('misc:lunaVoiceAssistant'),
        t('misc:agentToolsUnlockWith'),
      ],
      cta: { label: t('misc:openTheMap'), onClick: () => navigate('/') },
    },
    {
      id: 'rookie', name: t('misc:starter'), price: bigPriceOf('rookie', priceOf('rookie', 25)),
      per: cycle === 'year' ? t('misc:yr2') : t('misc:mo'), edge: ACCENT,
      badge: canTrial && !heroTrial ? t('misc:7DaysFreeNo') : t('misc:soloAgents'),
      note: t('misc:soloAgentsInstantActivation'),
      billed: billedLine('rookie', priceOf('rookie', 25)), priceWas: struckOf(priceOf('rookie', 25)),
      creditsMo: creditsOf('rookie') || 200,
      features: [
        t('misc:unlimitedMapData260'),
        t('misc:clientCrmProfilesHeat'),
        t('misc:intentReportsWhatThey'),
        t('misc:aiBrochuresUploadA'),
        t('misc:salesOffersPickA'),
        t('misc:brandedReportPageYour'),
        t('misc:leadsForYourFocus'),
      ],
      cta: ctaFor('rookie'),
    },
    {
      id: 'agent', name: t('misc:pro'), price: bigPriceOf('agent', priceOf('agent', 49)),
      per: cycle === 'year' ? t('misc:yr3') : t('misc:mo2'), edge: ACCENT, highlight: true,
      badge: canTrial && !heroTrial ? t('misc:mostPopular7Days') : t('misc:mostPopular'),
      note: t('misc:everyProFeatureCancel'),
      billed: billedLine('agent', priceOf('agent', 49)), priceWas: struckOf(priceOf('agent', 49)),
      creditsMo: creditsOf('agent') || 1200,
      features: [
        t('misc:everythingInStarter6'),
        t('misc:liveOverseasToursSame'),
        t('misc:inAppVoiceTalk'),
        t('misc:lunaAiToursFeature'),
        t('misc:tourIntentReportAuto'),
        t('misc:priorityLeadFlowAhead'),
        t('misc:behaviourInsightsWhoIs'),
      ],
      cta: ctaFor('agent'),
    },
    {
      // agency 角色页把同一套餐展示为「经纪公司版」(多席位 + lead),套餐 id 仍是 founder
      id: 'founder',
      name: t('misc:agency'),
      price: bigPriceOf('founder', priceOf('founder', 699)),
      per: cycle === 'year' ? t('misc:yr4') : t('misc:mo3'), edge: GOLD,
      badge: t('misc:team3Seats'), highlight: variant === 'agency',
      note: t('misc:agenciesTeamsInstantActivation'),
      billed: billedLine('founder', priceOf('founder', 699)), priceWas: struckOf(priceOf('founder', 699)),
      creditsMo: creditsOf('founder') || 15000, founderDiscount: true,
      features: [
        t('misc:everythingInProFirst'),
        t('misc:3SeatsSharing15'),
        t('misc:teamManagementInviteRemove'),
        t('misc:creditsBurnAt0'),
        t('misc:whiteLabelBrandingCustom'),
        t('misc:prioritySupportDirectLine'),
      ],
      cta: ctaFor('founder'),
    },
    {
      id: 'developer', name: t('misc:developer'), price: bigPriceOf('developer', priceOf('developer', 999)),
      per: cycle === 'year' ? t('misc:yr5') : t('misc:mo4'), edge: ACCENT,
      badge: canTrial && !heroTrial ? t('misc:7DaysFreeNo2') : t('misc:developersTeams'),
      highlight: variant === 'developer',
      note: t('misc:developersTeamsInstantActivation'),
      billed: billedLine('developer', priceOf('developer', 999)), priceWas: struckOf(priceOf('developer', 999)),
      creditsMo: creditsOf('developer') || 20000,
      features: [
        t('misc:uploadBrochuresAiParses'),
        t('misc:projectManagementSalesStatus'),
        t('misc:sitewideExposureMapPins'),
        t('misc:fullSalesToolkitCrm'),
        t('misc:brandedReportsSalesOffers'),
        t('misc:5SeatsSharing20'),
        t('misc:buyerBehaviourDataWho'),
      ],
      cta: ctaFor('developer'),
    },
  ]
  // 完整功能全景(onboarding 页原地铺开;经纪/经纪公司一套,开发商一套)
  const featureGroups: { title: string; items: string[] }[] = variant === 'developer' ? [
    { title: t('misc:listingExposure'), items: [
      t('misc:uploadBrochurePdfsAi'),
      t('misc:projectsLiveInMinutes'),
      t('misc:lunaAiActivelyPitches'),
      t('misc:salesStatusComingSoon'),
    ]},
    { title: t('misc:salesToolkit'), items: [
      t('misc:clientCrmProfilesHeat2'),
      t('misc:liveOverseasToursIn'),
      t('misc:brandedReports5Yr'),
      t('misc:salesOffersYourPrice'),
    ]},
    { title: t('misc:teamSeats'), items: [
      t('misc:5SeatsIncludedOne'),
      t('misc:teamShares20000'),
      t('misc:inviteRemoveInOne'),
      t('misc:everyMemberGetsA'),
    ]},
    { title: t('misc:dataInsights'), items: [
      t('misc:whoViewsYourProjects'),
      t('misc:260AreasOfOfficial'),
      t('misc:supplySignalsCompetingInventory'),
      t('misc:prioritySupport'),
    ]},
  ] : [
    { title: t('misc:dataMap'), items: [
      t('misc:260AreasOfOfficial2'),
      t('misc:yieldsAppreciationSupplySignals'),
      t('misc:5YrRoiModel'),
      t('misc:satellite3dBuildingsMeasuring'),
    ]},
    { title: t('misc:clientsCrm'), items: [
      t('misc:profilesHeatScoreKnow'),
      t('misc:fullActivityTimelineViews'),
      t('misc:notesPipelineTalkingTouring'),
      t('misc:oneClickBuyerIntent'),
    ]},
    { title: t('misc:tours'), items: [
      t('misc:liveOverseasToursSame2'),
      t('misc:inAppVoiceNo'),
      t('misc:lunaAiToursAuto'),
      t('misc:intentSummaryAutoGenerated'),
    ]},
    { title: t('misc:brandClosing'), items: [
      t('misc:brandedReportPagesWith'),
      t('misc:salesOffersDiscountMarked'),
      t('misc:aiBrochureParsingPdf'),
      variant === 'agency'
        ? t('misc:whiteLabelCustomDomain')
        : t('misc:leadFlowGetNotified'),
    ]},
  ]

  // 角色专属页:各自只看到自己的套餐(不显示免费/其他角色价格)。
  // 公共 /pricing 展示四个付费档(启程/专业/经纪公司/开发商),不再放买家免费卡
  // (2026-07-06 用户定:买家本来就免费用,定价页只讲付费档;免费在标题里说)。
  const tiers = variant === 'agent' ? allTiers.filter((t) => t.id === 'rookie' || t.id === 'agent')
    : variant === 'agency' ? allTiers.filter((t) => t.id === 'founder')
    // 开发商也给一个便宜入口:Pro $49(与经纪同价)—— 不是每个开发商一上来就要 $999/5 席,
    // 小开发商先用 Pro 的销售工具(楼书上传按 role=developer 判定,不看套餐档次)
    : variant === 'developer' ? allTiers.filter((t) => t.id === 'agent' || t.id === 'developer')
    : agentOnboarding ? allTiers.filter((t) => t.id !== 'explore' && t.id !== 'developer')
    : allTiers.filter((t) => t.id !== 'explore')

  // 试用条与套餐卡同宽 —— 各角色卡片数不同(经纪公司只有 1 张),宽度必须跟着走,
  // 否则一条通栏的试用条压在一张窄卡上面,难看。
  const gridW = tiers.length === 1 ? 'max-w-md' : tiers.length === 2 ? 'max-w-3xl' : 'max-w-4xl'

  return (
    <div className="relative flex-1 overflow-y-auto bg-[#070b16] text-white" style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}>
      {/* 动效:入场浮现(交错)+ 价格切换弹跳。只动 opacity/transform,零重排 */}
      <style>{`
        @keyframes pz-fade-up { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
        @keyframes pz-pop { from { opacity: .35; transform: scale(.94) } to { opacity: 1; transform: scale(1) } }
        @media (prefers-reduced-motion: reduce) { .pz-anim { animation: none !important } }
      `}</style>
      <Helmet>
        <title>{t('misc:pricingPinzosPlans')}</title>
        <meta name="description" content={t('misc:pinzosPlansFreeFor')} />
        <link rel="canonical" href="https://pinzos.com/pricing" />
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 py-5 md:py-7">
        {/* 无导航的选档页:品牌标识 + 顶部显眼的「返回重选角色」——所有角色的
            开通页都要有后退选项,选错身份不需要滚到页底找小字 */}
        {agentOnboarding && (
          <div className="relative mb-5 flex items-center justify-center gap-2 select-none">
            <button
              onClick={reselectRole}
              className="absolute start-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
              <span className="hidden sm:inline">{t('misc:chooseAnotherRole')}</span>
              <span className="sm:hidden">{t('misc:back')}</span>
            </button>
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
              {t('misc:yourAccountIsRegistered')}
            </span>
            <button onClick={reselectRole}
              className="font-medium text-teal-300 underline-offset-2 hover:underline">
              {t('misc:wrongRoleChooseAgain')}
            </button>
          </div>
        )}
        <div className="pz-anim text-center" style={{ animation: 'pz-fade-up .45s ease-out both' }}>
          {agentOnboarding ? (
            variant === 'agency' ? (
              <>
                <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: GOLD }}>// {t('misc:agencyWorkspace')}</span>
                <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{t('misc:welcomeSetUpPinzos')}</h1>
                <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{t('misc:multipleSeatsSharingOne')}</p>
              </>
            ) : variant === 'developer' ? (
              <>
                <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {t('misc:developerWorkspace')}</span>
                <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{t('misc:welcomePutYourProjects')}</h1>
                <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{canTrial
                  ? t('misc:uploadBrochuresAiParses2')
                  : t('misc:uploadBrochuresAiParses3')
                }</p>
              </>
            ) : (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {t('misc:agentWorkspace')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{t('misc:welcomeYourAgentWorkspace')}</h1>
              <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{canTrial
                ? t('misc:clientCrmBrandedReports')
                : t('misc:clientCrmBrandedReports2')
              }</p>
            </>
            )
          ) : (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {t('misc:pricing')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{t('misc:freeForBuyersPlans')}</h1>
              <p className="mx-auto mt-1.5 hidden max-w-2xl text-sm text-slate-400 sm:block">{t('misc:buyersJustOpenThe')}</p>
            </>
          )}
        </div>

        {/* ── 发布限时优惠条(纤细单行;限名额+限时均为 Stripe 真实 enforce)── */}
        {promo.active && (
          <div className="mx-auto mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: `${GOLD}66`, background: `linear-gradient(90deg, ${GOLD}22, ${ACCENT}12)`, boxShadow: `0 0 40px -22px ${GOLD}` }}>
            <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: GOLD }}>
              <Flame className="h-4 w-4" /> {t('misc:launchOffer')}
            </span>
            <span className="rounded-md px-1.5 py-0.5 text-xs font-extrabold text-slate-900" style={{ background: GOLD }}>-{promo.percentOff}%</span>
            {promo.forever && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-200"><Lock className="h-3 w-3" /> {t('misc:lockedForever')}</span>
            )}
            {promo.seatsRemaining != null && (
              <span className="text-xs text-slate-300">· {t('misc:only')} <b style={{ color: GOLD }}>{promo.seatsRemaining}</b>/{promo.seatsTotal} {t('misc:left')}</span>
            )}
            {countdown && (
              <span className="font-mono text-xs font-semibold tabular-nums text-white">
                · ⏱ {String(countdown.d).padStart(2, '0')}:{String(countdown.h).padStart(2, '0')}:{String(countdown.m).padStart(2, '0')}:{String(countdown.s).padStart(2, '0')}
              </span>
            )}
          </div>
        )}

        {/* ── 试用主卡:选完角色落地时,主角是「免费试用」而不是价格 ────────────
            为什么:原来两张套餐卡各挂一个「免费试用」按钮 —— ①$25/$49 是视觉主角,
            整页读起来是付费墙,试用被埋在按钮里(用户自己看都没注意到)②更蠢的是:
            试用不管点哪张卡都**完全一样**(Pro 功能 + 200 积分),等于逼人做一个
            毫无意义的选择。所以试用抽成独立主卡,套餐卡退到「试用结束后再选」。 */}
        {agentOnboarding && canTrial && (
          <div className={`pz-anim mx-auto mt-5 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border px-5 py-4 ${gridW}`}
            style={{
              borderColor: ACCENT,
              background: `linear-gradient(100deg, ${ACCENT}1f, transparent 70%)`,
              boxShadow: `0 0 50px -22px ${ACCENT}`,
              animation: 'pz-fade-up .5s ease-out both', animationDelay: '60ms',
            }}>
            <div className="min-w-[260px] flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-xl font-bold md:text-2xl">{t('misc:useItFreeFor')}</h2>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-slate-900" style={{ background: ACCENT }}>
                  <Gift className="h-3 w-3" /> {t('misc:noCreditCard')}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-snug text-slate-300">
                {t('misc:allProFeatures200')}
              </p>
            </div>
            <button
              onClick={() => beginTrial(variant === 'agency' ? 'founder' : variant === 'developer' ? 'developer' : 'agent')}
              disabled={!!busy}
              className="flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-[14px] font-bold text-slate-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
              style={{ background: ACCENT, boxShadow: `0 0 26px -8px ${ACCENT}` }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t('misc:startFreeTrial')} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></>}
            </button>
          </div>
        )}

        {/* 套餐卡的定位:能试用时它们是"以后"的事,不是现在要做的决定(细一行,别再占一屏) */}
        {agentOnboarding && canTrial && (
          <p className="mt-5 text-center text-xs text-slate-500">
            {t('misc:pickAPlanAfter')}
          </p>
        )}

        {/* 月付 / 年付 切换(月单价不变,年付送 2 个月) */}
        <div className="pz-anim mt-5 flex justify-center" style={{ animation: 'pz-fade-up .45s ease-out both', animationDelay: '80ms' }}>
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
            <button onClick={() => setCycle('month')}
              className={`rounded-full px-4 py-1.5 font-medium transition-all duration-200 active:scale-95 ${cycle === 'month' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'month' ? { background: ACCENT } : undefined}>
              {t('misc:monthly')}
            </button>
            <button onClick={() => setCycle('year')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-all duration-200 active:scale-95 ${cycle === 'year' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'year' ? { background: ACCENT } : undefined}>
              {t('misc:yearly')}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${cycle === 'year' ? 'bg-slate-900/15 text-slate-900' : 'bg-white/10 text-slate-300'}`}>{t('misc:2MonthsFree')}</span>
            </button>
          </div>
        </div>

        {err && <div className="mx-auto mt-4 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">{err}</div>}

        <div className={`mt-4 grid items-stretch gap-3 ${
          tiers.length === 1 ? 'mx-auto max-w-md'
            : tiers.length === 2 ? 'mx-auto max-w-3xl md:grid-cols-2'
            : agentOnboarding ? 'md:grid-cols-2 xl:grid-cols-3 mx-auto max-w-4xl'
            : 'md:grid-cols-2 xl:grid-cols-4'
        }`}>
          {tiers.map((tier, ti) => (
            // 自然升序(便宜的在前),手机桌面一致 —— 低门槛档先入眼;入场交错浮现+悬浮抬升
            <div key={tier.id} className="pz-anim relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-5 transition-transform duration-200 hover:-translate-y-1"
              style={{
                borderColor: tier.highlight ? ACCENT : tier.edge === GOLD ? `${GOLD}77` : 'rgba(255,255,255,0.1)',
                boxShadow: tier.highlight ? `0 0 40px -16px ${ACCENT}` : undefined,
                animation: 'pz-fade-up .5s ease-out both',
                animationDelay: `${ti * 80}ms`,
              }}>
              {tier.badge && <span className="absolute -top-3 start-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: tier.edge }}>{tier.badge}</span>}
              <div className="text-sm font-semibold" style={{ color: tier.edge }}>{tier.name}</div>
              <div className="mt-1 flex items-end gap-2">
                {/* key=cycle:月/年切换时价格轻弹一下,肉眼能看到变化发生 */}
                <span key={cycle} className="pz-anim text-3xl font-bold" style={{ animation: 'pz-pop .25s ease-out both' }}>{tier.price}</span>
                {tier.priceWas && <span className="pb-1 text-base font-medium text-slate-500 line-through">{tier.priceWas}</span>}
                {tier.per && <span className="pb-1 text-sm text-slate-500">{tier.per} (USD)</span>}
              </div>
              <p className="mt-1 text-[13px] text-slate-400">{tier.note}</p>
              {tier.billed && <p className="mt-0.5 text-[11px] text-slate-500">{tier.billed}</p>}
              {/* 醒目的每月积分额度 */}
              {'creditsMo'  in tier && (tier as { creditsMo?: number }).creditsMo != null && (
                <div className="mt-2.5 flex items-baseline gap-1.5 rounded-lg px-3 py-1.5" style={{ background: `${tier.edge}1a` }}>
                  <span className="text-xl font-extrabold" style={{ color: tier.edge }}>{(tier as { creditsMo: number }).creditsMo.toLocaleString()}</span>
                  <span className="text-[13px] font-medium text-slate-300">{t('misc:creditsMo')}</span>
                  {(tier as { founderDiscount?: boolean }).founderDiscount && (
                    <span className="ms-auto text-[11px] font-semibold" style={{ color: tier.edge }}>{t('misc:06Cost')}</span>
                  )}
                </div>
              )}
              <ul className="mt-3 flex-1 space-y-1.5 text-[13px] leading-snug text-slate-300">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: tier.edge }} /> {f}</li>
                ))}
              </ul>
              <button onClick={tier.cta.onClick} disabled={busy === tier.id}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-slate-900 transition-all duration-150 hover:opacity-90 hover:shadow-lg active:scale-[0.97] disabled:opacity-60"
                style={{ background: tier.edge }}>
                {busy === tier.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{tier.cta.label} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></>}
              </button>
              {/* 试用到底给什么,说清楚 —— 试用发的是 Pro 档功能 + 200 积分,
                  经纪公司/开发商的席位不在试用里,别让人以为 $699 的东西白拿 7 天。
                  onboarding 页有独立主卡讲这些,卡片里就不重复了。 */}
              {canTrial && !heroTrial && tier.id !== 'explore' && (
                <>
                  <p className="mt-1.5 text-center text-[11px] leading-snug text-slate-500">
                    {t('misc:trialAllProFeatures')}
                  </p>
                  <button onClick={() => subscribe(tier.id as PaidPlanId)} disabled={busy === tier.id}
                    className="mt-1 text-center text-[11px] text-slate-500 underline-offset-2 transition hover:text-slate-300 hover:underline disabled:opacity-60">
                    {t('misc:orSubscribeNow')}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 积分消耗表(成本来自后端 /features 配置,改配置自动同步)。角色专属单档页不放(列别档折扣反而困惑) */}
        {!variant && feat.features.length > 0 && (() => {
          const founderMult = feat.plans.find((p) => p.id === 'founder')?.multiplier ?? 0.6
          const proCallUnits = feat.plans.find((p) => p.id === 'agent')?.callUnits ?? 0
          const agencyCallUnits = feat.plans.find((p) => p.id === 'founder')?.callUnits ?? 0
          const videoWeight = feat.videoUnitWeight ?? 4
          return (
            <div className="pz-anim mx-auto mt-4 max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
              style={{ animation: 'pz-fade-up .5s ease-out both', animationDelay: '320ms' }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th className="px-4 py-1.5 text-start font-semibold" style={{ color: ACCENT }}>{t('misc:whatCreditsBuy')}</th>
                    <th className="px-4 py-1.5 text-end font-medium">{t('misc:standard')}</th>
                    <th className="px-4 py-1.5 text-end font-medium" style={{ color: GOLD }}>{t('misc:agency2')} ×{founderMult}</th>
                  </tr>
                </thead>
                <tbody>
                  {feat.features.map((f) => {
                    // 三种形态。不区分的话「通话与视频 1 积分」会被读成「一场通话 1 积分」,
                    // 而**免费**的实时带看会被渲染成收费的 —— 两个都是错的。
                    const isFree = f.unit === 'free' || f.credits === 0
                    const metered = f.unit === 'call_unit'
                    const suffix = metered
                      ? t('misc:4MinVoice1')
                      : isFree ? t('misc:unlimited') : ''
                    return (
                      <tr key={f.key} className="border-t border-white/[0.05]">
                        {/* 曾直接渲染后端的 f.label —— 那是**恒中文**的,定价页是面向客户的。
                            后端现在只送 key,文案在这边按 key 出,5 语言齐。 */}
                        <td className="px-4 py-1 text-slate-300">{t(`pricing:feature.${f.key}`)}<span className="text-slate-500">{suffix}</span></td>
                        {isFree ? (
                          <td className="px-4 py-1 text-end font-semibold" colSpan={2} style={{ color: ACCENT }}>
                            {t('misc:free2')}
                          </td>
                        ) : (
                          <>
                            <td className="px-4 py-1 text-end font-semibold text-white">{f.credits} {t('misc:cr')}</td>
                            <td className="px-4 py-1 text-end" style={{ color: GOLD }}>{Math.round(f.credits * founderMult)} {t('misc:cr2')}</td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* 通话对绝大多数经纪是**免费**的 —— 套餐内含额度,用完才扣积分。
                  不说这句,上面那行「通话与视频 1 积分」会把人吓退。 */}
              {feat.features.some((f) => f.unit === 'call_unit') && proCallUnits > 0 && (
                <p className="border-t border-white/[0.05] px-4 py-2 text-[11px] leading-relaxed text-slate-400">
                  {t('misc:callUnitsExplain', {
                    units: proCallUnits,
                    hours: Math.floor(proCallUnits / 2 / 60),
                    videoMin: Math.floor(proCallUnits / videoWeight),
                    agency: agencyCallUnits,
                  })}
                </p>
              )}
            </div>
          )
        })()}

        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-500">
          {promo.active
            ? t('misc:launchOfferOffEverything', { promo_percentOff: promo.percentOff, promo_seatsTotal: promo.seatsTotal })
            : t('misc:pricesInUsdBilled')}
          {canTrial
            ? t('misc:the7DayFree')
            : t('misc:paymentsSecurelyHandledBy')}
        </p>

        {/* 完整功能全景:直接铺在付费页里(卖点信息宁多勿少,不外链) */}
        {agentOnboarding && (
          <div className="mt-10">
            <h2 className="text-center text-lg font-bold text-white">{t('misc:everythingYouGet')}</h2>
            <p className="mt-1 text-center text-xs text-slate-500">{t('misc:notHighlightsTheFull')}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {featureGroups.map((g) => (
                <div key={g.title} className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10">
                  <div className="text-sm font-bold" style={{ color: ACCENT }}>{g.title}</div>
                  <ul className="mt-3 space-y-2">
                    {g.items.map((it, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: ACCENT }} />
                        {it}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-1.5 text-center">
          {agentOnboarding && (
            <button onClick={reselectRole}
              className="inline-flex items-center gap-1.5 text-[12px] text-slate-500 transition hover:text-slate-300">
              {t('misc:wrongRoleChooseAgain2')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
