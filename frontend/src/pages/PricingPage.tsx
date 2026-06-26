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
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchPlans, startCheckout, type BillingPlan } from '../lib/billingApi'

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

  useEffect(() => { fetchPlans().then(setPlans) }, [])

  // 价格优先后端,回退本地默认(后端不可达时仍能展示)
  const priceOf = (id: string, fallback: number) => {
    const p = plans.find((x) => x.id === id)
    return p ? Number(p.price_usd_month) : fallback
  }

  async function subscribe(planId: 'agent' | 'founder') {
    setErr(null)
    if (!user) { navigate('/agent'); return }   // 去经纪台登录(登录后回来再订阅)
    setBusy(planId)
    const error = await startCheckout(planId)    // 成功则跳转 Stripe,不返回
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
      id: 'agent', name: L('经纪版', 'Agent'), price: `$${priceOf('agent', 99)}`, priceWas: '$199',
      per: L('/ 月', '/ mo'), edge: ACCENT, highlight: true, badge: L('7 天免费试用', '7-day free trial'),
      note: L('7 天免费 · 需绑卡 · 随时取消', '7 days free · card required · cancel anytime'),
      features: [
        L('实时海外带看 20 场/月 + 应用内语音', '20 live overseas tours/mo + in-app voice'),
        L('Luna 智能导览 20 个/月(可分享自助看房)', '20 Luna AI tours/mo (shareable)'),
        L('买家意向报告 30 份/月(AI 意向判定 + 跟进话术)', '30 buyer-intent reports/mo'),
        L('AI 楼书解析:上传开发商 PDF 秒变可视化房源', 'AI brochure parsing: PDF → listings'),
        L('经纪品牌项目报告 · 无限分享(头像+ROI+真实成交)', 'Branded project reports · unlimited'),
        L('客户行为洞察 + 热度排序(谁最可能成交)', 'Client behaviour insights + lead scoring'),
      ],
      cta: { label: L('免费试用 7 天', 'Start 7-day free trial'), onClick: () => subscribe('agent') },
    },
    {
      id: 'founder', name: L('创始会员', 'Founder'), price: `$${priceOf('founder', 699)}`,
      per: L('/ 月', '/ mo'), edge: GOLD, badge: L('10× 额度', '10× quota'),
      note: L('早期支持者 · 名额有限', 'Early supporters · limited'),
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
            '一张地图看懂迪拜期房;经纪用它带海外客户实时看房、生成导览与意向报告。按月计费,随时取消。',
            'One map for Dubai off-plan; agents use it to tour overseas clients live, generate tours and intent reports. Billed monthly, cancel anytime.'
          )}</p>
        </div>

        {err && <div className="mx-auto mt-6 max-w-md rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-center text-sm text-rose-300">{err}</div>}

        <div className="mt-10 grid items-stretch gap-4 lg:grid-cols-3">
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

        <p className="mt-6 text-center text-xs text-slate-500">{L(
          '价格以美元(USD)计,按月计费,随时取消。支付由 Stripe 安全处理。',
          'Prices in USD, billed monthly, cancel anytime. Payments securely handled by Stripe.'
        )}</p>

        <div className="mt-10 text-center">
          <Link to="/about" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            {L('查看完整功能介绍', 'See all features')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
