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
import { ArrowRight, ArrowLeft, Check, Loader2, Flame, Lock, Briefcase } from 'lucide-react'
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
        ? L('永久锁定发布价 · 已含送 2 个月 · 随时取消', 'Launch price locked forever · 2 months free included · cancel anytime')
        : L('永久锁定发布价 · 按月付 · 随时取消', 'Launch price locked forever · billed monthly · cancel anytime')
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

  // ── 免绑卡试用 (2026-07-11) ────────────────────────────────
  // 主 CTA = 零摩擦试用(不跳 Stripe、不收卡);「直接订阅」降级为次要链接。
  // 已用过试用 / 已有生效套餐 → 主 CTA 回落成「立即订阅」。
  const ROLE_BY_PLAN: Record<string, TrialRole> = { rookie: 'agent', agent: 'agent', founder: 'agency', developer: 'developer' }
  const hasPlan = me?.status === 'active' || me?.status === 'trialing'
  const canTrial = !me || (!me.trial?.used && !hasPlan)  // 未登录也按"能试用"展示(点了先去登录)

  async function subscribe(planId: PaidPlanId) {
    setErr(null)
    if (!user) { navigate('/agent'); return }   // 去经纪台登录(登录后回来再订阅)
    trackEvent('plan_select', { plan_id: planId, cycle, action: 'subscribe' })
    setBusy(planId)
    const error = await startCheckout(planId, cycle, { hadTrial: !!me?.trial?.used })  // 成功则跳转 Stripe,不返回
    if (error) { setErr(error); setBusy(null) }
  }

  async function beginTrial(planId: PaidPlanId) {
    setErr(null)
    if (!user) { navigate('/agent'); return }   // 先登录,回来再开
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

  /** 主 CTA:能试用 → 免绑卡试用;否则 → 订阅。 */
  const ctaFor = (planId: PaidPlanId) => canTrial
    ? { label: L('免费试用 7 天 · 无需信用卡', 'Try free for 7 days · no card'), onClick: () => beginTrial(planId) }
    : { label: L('立即订阅', 'Subscribe now'), onClick: () => subscribe(planId) }

  // 软出口:选错身份 → 回选择身份页重选(不直接改成买家)
  const reselectRole = () => {
    try { sessionStorage.removeItem('pinzos-role') } catch { /* noop */ }
    window.location.assign('/choose-role')
  }

  const allTiers = [
    {
      id: 'explore', name: L('探索版', 'Explore'), price: L('免费', 'Free'), edge: ACCENT,
      note: L('给买家', 'For buyers'),
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
      badge: canTrial ? L('7 天免费 · 免绑卡', '7 days free · no card') : L('个人经纪起步', 'Solo agents'),
      note: L('个人经纪起步 · 付款即开通', 'Solo agents · instant activation'),
      billed: billedLine(priceOf('rookie', 25)), priceWas: struckOf(priceOf('rookie', 25)),
      creditsMo: creditsOf('rookie') || 200,
      features: [
        L('地图与市场数据不限时:260+ 区域真实成交/租金/收益率(DLD 官方,每周更新)', 'Unlimited map & data: 260+ areas of official DLD sales/rent/yield, weekly refresh'),
        L('客户 CRM:档案 · 热度评分 · 活动时间线 · 跟进记录 · 交易管道', 'Client CRM: profiles · heat score · timeline · notes · pipeline'),
        L('买家意向报告:客户看了哪些盘、停留多久、意向多强', 'Intent reports: what they viewed, how long, how hot'),
        L('AI 楼书解析:上传开发商 PDF,户型/价格/付款计划自动成库', 'AI brochures: upload a PDF, units/prices/plans auto-extracted'),
        L('Sales Offer 报价单:选户型填报价,品牌盖章+优惠标注,链接/PDF 发客户(60 天有效)', 'Sales Offers: pick a unit, set your quote — stamped, discount-marked, link/PDF, valid 60 days'),
        L('品牌报告页:带你头像与联系方式的项目投资报告(5年ROI+真实成交)', 'Branded report page: your face & contact on a 5-yr ROI report'),
        L('符合关注区域的 lead(尽力推送)', 'Leads for your focus areas (best effort)'),
      ],
      cta: ctaFor('rookie'),
    },
    {
      id: 'agent', name: L('专业版', 'Pro'), price: bigPriceOf(priceOf('agent', 49)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: ACCENT, highlight: true,
      badge: canTrial ? L('最受欢迎 · 7 天免费 · 免绑卡', 'Most popular · 7 days free · no card') : L('最受欢迎', 'Most popular'),
      note: L('全部专业功能 · 随时取消', 'Every pro feature · cancel anytime'),
      billed: billedLine(priceOf('agent', 49)), priceWas: struckOf(priceOf('agent', 49)),
      creditsMo: creditsOf('agent') || 1200,
      features: [
        L('启程版全部功能,积分池 ×6(200 → 1,200)', 'Everything in Starter, 6× the credits (200 → 1,200)'),
        L('实时海外带看:与客户同屏看地图和楼盘,你动他也动', 'Live overseas tours: same screen, you move, they follow'),
        L('应用内语音:带看中直接通话,不用切微信/电话', 'In-app voice: talk during the tour, no app switching'),
        L('Luna AI 智能导览:自动飞盘讲盘,中英双语', 'Luna AI tours: auto fly-through with narration, EN/中文'),
        L('带看意向报告:一场带看结束自动生成客户意向小结', 'Tour intent report auto-generated after every tour'),
        L('Lead 优先推送(排在启程版之前)', 'Priority lead flow (ahead of Starter)'),
        L('客户行为洞察:谁在看、看了多久、何时该跟进', 'Behaviour insights: who is browsing, for how long, when to follow up'),
      ],
      cta: ctaFor('agent'),
    },
    {
      // agency 角色页把同一套餐展示为「经纪公司版」(多席位 + lead),套餐 id 仍是 founder
      id: 'founder',
      name: L('经纪公司版', 'Agency'),
      price: bigPriceOf(priceOf('founder', 699)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: GOLD,
      badge: L('团队 · 3 席', 'Team · 3 seats'), highlight: variant === 'agency',
      note: L('经纪公司 / 团队 · 付款即开通', 'Agencies & teams · instant activation'),
      billed: billedLine(priceOf('founder', 699)), priceWas: struckOf(priceOf('founder', 699)),
      creditsMo: creditsOf('founder') || 15000, founderDiscount: true,
      features: [
        L('专业版全部功能 · Lead 独占优先分发(你的团队先挑)', 'Everything in Pro · first pick of every lead'),
        L('含 3 个席位共享 15,000 积分池,+$49/席无限扩容', '3 seats sharing 15,000 credits, +$49/seat unlimited'),
        L('团队管理:一键邀请/移除成员,套餐与用量一处看', 'Team management: invite/remove in one click, one bill'),
        L('积分消耗 ×0.6 —— 同样的活省 40%', 'Credits burn at ×0.6 — 40% cheaper per action'),
        L('White-label 品牌定制 · 自定义域名', 'White-label branding · custom domain'),
        L('优先支持(直连产品团队)', 'Priority support (direct line to the team)'),
      ],
      cta: ctaFor('founder'),
    },
    {
      id: 'developer', name: L('开发商版', 'Developer'), price: bigPriceOf(priceOf('developer', 999)),
      per: cycle === 'year' ? L('/ 年', '/ yr') : L('/ 月', '/ mo'), edge: ACCENT,
      badge: L('7 天免费试用', '7-day free trial'), highlight: variant === 'developer',
      note: L('开发商 / 团队 · 付款即开通', 'Developers & teams · instant activation'),
      billed: billedLine(priceOf('developer', 999)), priceWas: struckOf(priceOf('developer', 999)),
      creditsMo: creditsOf('developer') || 20000,
      features: [
        L('上传楼书:AI 解析户型/价格/付款计划,分钟级上架', 'Upload brochures: AI parses units/prices/plans, live in minutes'),
        L('项目管理:开盘状态 · 图册主图 · 详情页随时可改', 'Project management: sales status, gallery, details — edit anytime'),
        L('楼盘全站曝光:地图 pin · 搜索 · Luna AI 主动推荐给买家', 'Sitewide exposure: map pins, search, Luna AI recommends you to buyers'),
        L('销售工具全套:客户 CRM · 实时海外带看 · 应用内语音', 'Full sales toolkit: CRM · live overseas tours · in-app voice'),
        L('品牌报告页 + Sales Offer 报价单,置业顾问人手一份', 'Branded reports + Sales Offers for every sales rep'),
        L('含 5 个席位共享 20,000 积分池,+$49/席无限扩容', '5 seats sharing 20,000 credits, +$49/seat unlimited'),
        L('买家行为数据:谁在看你的盘、看了多久、意向多强', 'Buyer behaviour data: who views your projects, how long, how hot'),
      ],
      cta: ctaFor('developer'),
    },
  ]
  // 完整功能全景(onboarding 页原地铺开;经纪/经纪公司一套,开发商一套)
  const featureGroups: { title: string; items: string[] }[] = variant === 'developer' ? [
    { title: L('上架与曝光', 'Listing & exposure'), items: [
      L('楼书 PDF 上传,AI 自动解析户型/价格/付款计划', 'Upload brochure PDFs — AI extracts units, prices, payment plans'),
      L('项目分钟级上架:地图 pin + 搜索直达 + 详情页', 'Projects live in minutes: map pin, search, full detail page'),
      L('Luna AI 会向匹配的买家主动讲你的盘', 'Luna AI actively pitches your projects to matching buyers'),
      L('开盘状态管理:即将开盘 / 在售 / 建设中 / 售罄', 'Sales status: coming soon / selling / building / sold out'),
    ]},
    { title: L('销售工具', 'Sales toolkit'), items: [
      L('客户 CRM:档案 · 热度评分 · 时间线 · 跟进 · 管道', 'Client CRM: profiles, heat score, timeline, notes, pipeline'),
      L('实时海外带看 + 应用内语音,一场会议签下海外客户', 'Live overseas tours + in-app voice — close remote buyers in one call'),
      L('品牌报告页:5年 ROI + 真实 DLD 成交做信任背书', 'Branded reports: 5-yr ROI backed by real DLD transactions'),
      L('Sales Offer 报价单:实价+可调付款周期,品牌盖章一键发客户', 'Sales Offers: your price + negotiable schedule, stamped & shareable'),
    ]},
    { title: L('团队与席位', 'Team & seats'), items: [
      L('含 5 个席位,置业顾问人手一号', '5 seats included — one for every sales rep'),
      L('全团队共享 20,000 积分池,+$49/席无限扩容', 'Team shares 20,000 credits, +$49/seat unlimited'),
      L('一键邀请/移除成员,一张账单', 'Invite/remove in one click, one bill'),
      L('成员自动获得开发商会员卡', 'Every member gets a Developer membership card'),
    ]},
    { title: L('数据与洞察', 'Data & insights'), items: [
      L('谁在看你的盘、看了多久、意向多强', 'Who views your projects, how long, how hot'),
      L('260+ 区域官方 DLD 成交/租金数据做定价参考', '260+ areas of official DLD data for pricing'),
      L('区域供给信号:同区在售/待售有多少', 'Supply signals: competing inventory per area'),
      L('优先支持', 'Priority support'),
    ]},
  ] : [
    { title: L('数据与地图', 'Data & map'), items: [
      L('260+ 区域官方 DLD 成交/租金数据,每周更新', '260+ areas of official DLD sales & rent data, weekly refresh'),
      L('收益率 · 增值 · 供给信号 · 期房/现房口径切换', 'Yields, appreciation, supply signals, off-plan vs ready'),
      L('5 年 ROI 投资模型 + 回本年限,一盘一算', '5-yr ROI model with payback years, per project'),
      L('卫星图 / 3D 建筑 / 测距,专业感拉满', 'Satellite, 3D buildings, measuring tools'),
    ]},
    { title: L('客户与 CRM', 'Clients & CRM'), items: [
      L('客户档案 + 热度评分,该跟谁一眼看出', 'Profiles + heat score — know who to call first'),
      L('活动时间线:浏览/收藏/联系全记录', 'Full activity timeline: views, favorites, contacts'),
      L('跟进记录 + 交易管道(洽谈→带看→成交)', 'Notes + pipeline (talking → touring → closed)'),
      L('买家意向报告一键生成', 'One-click buyer intent reports'),
    ]},
    { title: L('带看与导览', 'Tours'), items: [
      L('实时海外带看:同屏同步,你看哪他看哪', 'Live overseas tours: same screen, perfectly synced'),
      L('应用内语音通话,带看不切 App', 'In-app voice — no switching apps mid-tour'),
      L('Luna AI 导览:自动飞盘讲盘(中/英)', 'Luna AI tours: auto fly-through with narration'),
      L('带看结束自动生成意向小结', 'Intent summary auto-generated after each tour'),
    ]},
    { title: L('品牌与转化', 'Brand & closing'), items: [
      L('品牌报告页:你的头像+联系方式+项目 ROI', 'Branded report pages with your face & contact'),
      L('Sales Offer 报价单:优惠标注+品牌盖章,链接/PDF 发客户', 'Sales Offers: discount-marked & stamped, link or PDF'),
      L('AI 楼书解析:PDF 秒变结构化户型库', 'AI brochure parsing: PDF to structured units'),
      variant === 'agency'
        ? L('White-label 品牌定制 + 自定义域名', 'White-label + custom domain')
        : L('Lead 推送:买家在你关注的区域出现就通知你', 'Lead flow: get notified when buyers appear in your areas'),
    ]},
  ]

  // 角色专属页:各自只看到自己的套餐(不显示免费/其他角色价格)。
  // 公共 /pricing 展示四个付费档(启程/专业/经纪公司/开发商),不再放买家免费卡
  // (2026-07-06 用户定:买家本来就免费用,定价页只讲付费档;免费在标题里说)。
  const tiers = variant === 'agent' ? allTiers.filter((t) => t.id === 'rookie' || t.id === 'agent')
    : variant === 'agency' ? allTiers.filter((t) => t.id === 'founder')
    : variant === 'developer' ? allTiers.filter((t) => t.id === 'developer')
    : agentOnboarding ? allTiers.filter((t) => t.id !== 'explore' && t.id !== 'developer')
    : allTiers.filter((t) => t.id !== 'explore')

  return (
    <div className="relative flex-1 overflow-y-auto bg-[#070b16] text-white" style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}>
      {/* 动效:入场浮现(交错)+ 价格切换弹跳。只动 opacity/transform,零重排 */}
      <style>{`
        @keyframes pz-fade-up { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
        @keyframes pz-pop { from { opacity: .35; transform: scale(.94) } to { opacity: 1; transform: scale(1) } }
        @media (prefers-reduced-motion: reduce) { .pz-anim { animation: none !important } }
      `}</style>
      <Helmet>
        <title>{L('定价 — Pinzos 订阅', 'Pricing — Pinzos Plans')}</title>
        <meta name="description" content={L(
          'Pinzos 订阅:买家免费;经纪 $25/月起,专业版 $49/月含实时海外带看、Luna 智能导览与买家意向报告;经纪公司版 $699/月 3 席;开发商版 $999/月含楼书上传与 5 席。',
          'Pinzos plans: free for buyers; agents from $25/mo, Pro $49/mo with live overseas tours, Luna AI tours and buyer-intent reports; Agency $699/mo with 3 seats; Developer $999/mo with brochure uploads and 5 seats.'
        )} />
        <link rel="canonical" href="https://pinzos.com/pricing" />
      </Helmet>

      <section className="mx-auto max-w-6xl px-6 py-5 md:py-7">
        {/* 无导航的选档页:品牌标识 + 顶部显眼的「返回重选角色」——所有角色的
            开通页都要有后退选项,选错身份不需要滚到页底找小字 */}
        {agentOnboarding && (
          <div className="relative mb-5 flex items-center justify-center gap-2 select-none">
            <button
              onClick={reselectRole}
              className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{L('重新选择角色', 'Choose another role')}</span>
              <span className="sm:hidden">{L('重选角色', 'Back')}</span>
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
              {L(
                '你的账号是经纪身份 —— 经纪版(含不限时地图与数据)需选择套餐后使用。可以先免费试用 7 天,无需信用卡。',
                'Your account is registered as an agent — agent access (incl. unlimited map & data) starts with a plan. Start with a free 7-day trial, no credit card needed.'
              )}
            </span>
            <button onClick={reselectRole}
              className="font-medium text-teal-300 underline-offset-2 hover:underline">
              {L('选错身份?重新选择角色 →', 'Wrong role? Choose again →')}
            </button>
          </div>
        )}
        <div className="pz-anim text-center" style={{ animation: 'pz-fade-up .45s ease-out both' }}>
          {agentOnboarding ? (
            variant === 'agency' ? (
              <>
                <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: GOLD }}>// {L('经纪公司工作台', 'AGENCY WORKSPACE')}</span>
                <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('欢迎!为你的团队开通 Pinzos', 'Welcome! Set up Pinzos for your team')}</h1>
                <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{L(
                  '多席位共享一个积分池,lead 独占优先分发,White-label 品牌定制 —— 开通后立即可为团队邀请席位。',
                  'Multiple seats sharing one credit pool, first pick of buyer leads, white-label branding — invite your team right after activation.'
                )}</p>
              </>
            ) : variant === 'developer' ? (
              <>
                <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('开发商工作台', 'DEVELOPER WORKSPACE')}</span>
                <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('欢迎!让你的楼盘被全站买家看到', 'Welcome! Put your projects in front of every buyer')}</h1>
                <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{L(
                  '上传楼书 AI 自动解析上架,配套销售工具(CRM/实时带看/品牌报告),含 5 个团队席位 —— 先免费试用 7 天,不需要信用卡。',
                  'Upload brochures, AI parses and lists them, full sales toolkit (CRM, live tours, branded reports), 5 team seats included — try free for 7 days, no credit card.'
                )}</p>
              </>
            ) : (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('经纪工作台', 'AGENT WORKSPACE')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('欢迎!你的经纪工作台已就绪', 'Welcome! Your agent workspace is ready')}</h1>
              <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-400">{L(
                '客户 CRM、品牌化报告、实时带看、Luna 导览 —— 先免费用 7 天,不需要信用卡。',
                'Client CRM, branded reports, live tours, Luna AI tours — try it free for 7 days. No credit card.'
              )}</p>
            </>
            )
          ) : (
            <>
              <span className="font-mono text-[11px] font-semibold tracking-widest" style={{ color: ACCENT }}>// {L('定价', 'PRICING')}</span>
              <h1 className="mt-1.5 text-2xl font-bold md:text-4xl">{L('买家免费,经纪与开发商按量选档', 'Free for buyers. Plans for agents & developers.')}</h1>
              <p className="mx-auto mt-1.5 hidden max-w-2xl text-sm text-slate-400 sm:block">{L(
                '买家直接打开地图就能用。经纪 $25 起:地图不限时 + lead,带海外客户实时看房、生成导览与意向报告;开发商版含楼书上传与 5 席。按月或按年付,随时取消。',
                'Buyers just open the map — free. Agents from $25: unlimited map + leads, live overseas tours, intent reports; Developer plan adds brochure uploads & 5 seats. Billed monthly or yearly, cancel anytime.'
              )}</p>
            </>
          )}
        </div>

        {/* ── 发布限时优惠条(纤细单行;限名额+限时均为 Stripe 真实 enforce)── */}
        {promo.active && (
          <div className="mx-auto mt-5 flex max-w-3xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: `${GOLD}66`, background: `linear-gradient(90deg, ${GOLD}22, ${ACCENT}12)`, boxShadow: `0 0 40px -22px ${GOLD}` }}>
            <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: GOLD }}>
              <Flame className="h-4 w-4" /> {L('发布限时优惠', 'Launch Offer')}
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
        <div className="pz-anim mt-5 flex justify-center" style={{ animation: 'pz-fade-up .45s ease-out both', animationDelay: '80ms' }}>
          <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
            <button onClick={() => setCycle('month')}
              className={`rounded-full px-4 py-1.5 font-medium transition-all duration-200 active:scale-95 ${cycle === 'month' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'month' ? { background: ACCENT } : undefined}>
              {L('按月付', 'Monthly')}
            </button>
            <button onClick={() => setCycle('year')}
              className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-all duration-200 active:scale-95 ${cycle === 'year' ? 'text-slate-900' : 'text-slate-400 hover:text-white'}`}
              style={cycle === 'year' ? { background: ACCENT } : undefined}>
              {L('按年付', 'Yearly')}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${cycle === 'year' ? 'bg-slate-900/15 text-slate-900' : 'bg-white/10 text-slate-300'}`}>{L('免费送 2 个月', '2 months free')}</span>
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
          {tiers.map((t, ti) => (
            // 自然升序(便宜的在前),手机桌面一致 —— 低门槛档先入眼;入场交错浮现+悬浮抬升
            <div key={t.id} className="pz-anim relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-5 transition-transform duration-200 hover:-translate-y-1"
              style={{
                borderColor: t.highlight ? ACCENT : t.edge === GOLD ? `${GOLD}77` : 'rgba(255,255,255,0.1)',
                boxShadow: t.highlight ? `0 0 40px -16px ${ACCENT}` : undefined,
                animation: 'pz-fade-up .5s ease-out both',
                animationDelay: `${ti * 80}ms`,
              }}>
              {t.badge && <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: t.edge }}>{t.badge}</span>}
              <div className="text-sm font-semibold" style={{ color: t.edge }}>{t.name}</div>
              <div className="mt-1 flex items-end gap-2">
                {/* key=cycle:月/年切换时价格轻弹一下,肉眼能看到变化发生 */}
                <span key={cycle} className="pz-anim text-3xl font-bold" style={{ animation: 'pz-pop .25s ease-out both' }}>{t.price}</span>
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
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-slate-900 transition-all duration-150 hover:opacity-90 hover:shadow-lg active:scale-[0.97] disabled:opacity-60"
                style={{ background: t.edge }}>
                {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{t.cta.label} <ArrowRight className="h-4 w-4" /></>}
              </button>
              {/* 试用到底给什么,说清楚 —— 试用发的是 Pro 档功能 + 200 积分,
                  经纪公司/开发商的席位不在试用里,别让人以为 $699 的东西白拿 7 天 */}
              {canTrial && t.id !== 'explore' && (
                <>
                  <p className="mt-1.5 text-center text-[11px] leading-snug text-slate-500">
                    {L('试用含全部专业功能 + 200 积分 · 不收卡 · 到期自动停止',
                       'Trial: all Pro features + 200 credits · no card · auto-stops')}
                  </p>
                  <button onClick={() => subscribe(t.id as PaidPlanId)} disabled={busy === t.id}
                    className="mt-1 text-center text-[11px] text-slate-500 underline-offset-2 transition hover:text-slate-300 hover:underline disabled:opacity-60">
                    {L('或直接订阅 →', 'Or subscribe now →')}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 积分消耗表(成本来自后端 /features 配置,改配置自动同步)。角色专属单档页不放(列别档折扣反而困惑) */}
        {!variant && feat.features.length > 0 && (() => {
          const founderMult = feat.plans.find((p) => p.id === 'founder')?.multiplier ?? 0.6
          return (
            <div className="pz-anim mx-auto mt-4 max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]"
              style={{ animation: 'pz-fade-up .5s ease-out both', animationDelay: '320ms' }}>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-slate-400" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th className="px-4 py-1.5 text-left font-semibold" style={{ color: ACCENT }}>{L('积分消耗对照', 'WHAT CREDITS BUY')}</th>
                    <th className="px-4 py-1.5 text-right font-medium">{L('标准', 'Standard')}</th>
                    <th className="px-4 py-1.5 text-right font-medium" style={{ color: GOLD }}>{L('经纪公司版', 'Agency')} ×{founderMult}</th>
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
            ? L(`发布限时优惠:全场 ${promo.percentOff}% off,早鸟订阅永久锁定此价(限 ${promo.seatsTotal} 席,限时)。划掉为原价。`,
                `Launch offer: ${promo.percentOff}% off everything, early subscribers lock this price forever (${promo.seatsTotal} seats, limited time). Struck price is the regular rate.`)
            : L('价格以美元(USD)计,按月或按年付(年付送 2 个月)。', 'Prices in USD, billed monthly or yearly (yearly = 2 months free).')}
          {canTrial
            ? L(' 7 天免费试用无需信用卡 —— 到期自动停止,不会自动扣款。支付由 Stripe 安全处理。',
                ' The 7-day free trial needs no credit card — it just stops at the end, nothing is charged. Payments securely handled by Stripe.')
            : L(' 支付由 Stripe 安全处理。', ' Payments securely handled by Stripe.')}
        </p>

        {/* 完整功能全景:直接铺在付费页里(卖点信息宁多勿少,不外链) */}
        {agentOnboarding && (
          <div className="mt-10">
            <h2 className="text-center text-lg font-bold text-white">{L('开通后你得到的全部', 'Everything you get')}</h2>
            <p className="mt-1 text-center text-xs text-slate-500">{L('不是节选 —— 这就是完整清单', 'Not highlights — the full list')}</p>
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
              {L('选错身份?重新选择角色 →', 'Wrong role? Choose again →')}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
