/**
 * About / Features — zoned, dark↔light, with smooth gradient transitions.
 *
 * Flow: dark hero → (blend) → LIGHT buyer zone → (blend) → DARK agent/developer
 * zone → (blend) → LIGHT pricing → dark CTA. Clear audiences (buyers vs
 * agents & developers). Scroll-reveal animations (framer-motion). Helmet + JSON-LD
 * for SEO / AI discoverability. Reachable at /about and /pricing.
 */
import { Helmet } from 'react-helmet-async'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { useEffect } from 'react'
import {
  Map as MapIcon, TrendingUp, Building2, Sparkles, Radio, FileText, Mic,
  Upload, Database, KeyRound, Ruler, Layers, ArrowRight, Languages, ShieldCheck, Users, Briefcase,
} from 'lucide-react'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'

function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  )
}

export default function AboutPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (cn: string, en: string) => (zh ? cn : en)
  const location = useLocation()

  // /pricing deep-links straight to the pricing section
  useEffect(() => {
    if (location.pathname === '/pricing') {
      const el = document.getElementById('pricing')
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 300)
    }
  }, [location.pathname])

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Pinzos', url: 'https://pinzos.com', description: 'Interactive Dubai off-plan property platform with real DLD data, AI brochure parsing, investment analytics, and agent tools for overseas clients.', areaServed: 'Dubai, United Arab Emirates' },
      {
        '@type': 'SoftwareApplication', name: 'Pinzos', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: 'https://pinzos.com',
        description: 'Pinzos helps buyers and agents explore Dubai off-plan property: a satellite map with real DLD transactions/rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, real-time co-presence map tours, AI-guided Luna tours, and buyer-intent reports.',
        offers: [
          { '@type': 'Offer', name: 'Explore', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Agent', price: '99', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Founder', price: '699', priceCurrency: 'USD' },
        ],
        featureList: [
          'Satellite map of Dubai with 3D landmarks', 'Real DLD transactions and rental contracts',
          'Area metrics: median price, price/sqft, capital growth, rental yield, rental stability',
          'AI brochure parsing: developer PDF to structured listings',
          '5-year ROI, payback, rental yield, Golden Visa eligibility, freehold & tax-free',
          'Real-time co-presence map tours for overseas clients with voice',
          'Luna AI-guided shareable self-serve tours', 'Buyer-intent reports for agents',
          'Luna voice assistant over real DLD data, multilingual',
        ],
      },
    ],
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-900">
      <Helmet>
        <title>{L('Pinzos — 迪拜期房的全新购买方式 | 功能与定价', 'Pinzos — Features & Pricing: The New Way to Buy Dubai Off-Plan')}</title>
        <meta name="description" content={L(
          'Pinzos 是迪拜期房的交互式平台:卫星地图 + 真实 DLD 成交/租约/区域指标、AI 楼书解析、5 年回报与黄金签证分析,以及面向经纪与开发商的实时地图带看、Luna AI 导览、买家意向报告。',
          'Pinzos is an interactive Dubai off-plan platform: a satellite map with real DLD transactions, rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, plus tools for agents & developers — real-time co-presence map tours, AI-guided Luna tours, and buyer-intent reports.'
        )} />
        <meta property="og:title" content="Pinzos — The New Way to Buy Dubai Off-Plan" />
        <meta property="og:description" content="Real DLD data on an interactive map, AI brochure parsing, investment analytics, and real-time co-presence tours for overseas clients." />
        <link rel="canonical" href="https://pinzos.com/about" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* ── Hero (dark) ──────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: ACCENT }} />
        <div className="absolute -left-24 top-40 h-80 w-80 rounded-full opacity-[0.12] blur-3xl" style={{ background: GOLD }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} /> {L('迪拜期房 · 真实数据 · AI 驱动', 'Dubai Off-Plan · Real Data · AI-Powered')}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] md:text-5xl xl:text-6xl">
              {L('买卖迪拜期房的', 'A smarter way to buy & sell')}<br /><span style={{ color: ACCENT }}>{L('全新方式', 'Dubai off-plan')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              {L('一张交互式卫星地图,装下迪拜每个区的真实成交、租金与回报;AI 读懂开发商楼书;经纪带海外客户实时在地图上看房、生成导览与意向报告。',
                'One interactive satellite map with every district\'s real transactions, rents and returns; AI that reads developer brochures; and agents who guide overseas clients live on the map.')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>{L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" /></Link>
              <a href="#pricing" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">{L('查看定价', 'See pricing')}</a>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl opacity-30 blur-2xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, transparent)` }} />
              <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15">
                <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ml-2 truncate text-[11px] text-slate-400">pinzos.com</span>
                </div>
                <img src="/about-map.jpg" alt={L('Pinzos 迪拜卫星地图', 'Pinzos Dubai satellite map')} className="block w-full" loading="eager" />
              </div>
            </div>
          </Reveal>
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pb-14">
          <Reveal delay={0.2}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ icon: <Database className="h-4 w-4" />, t: L('真实 DLD 数据', 'Real DLD data') }, { icon: <Sparkles className="h-4 w-4" />, t: L('AI 解析与助手', 'AI parsing & assistant') }, { icon: <Languages className="h-4 w-4" />, t: L('中英阿多语', 'CN · EN · AR') }, { icon: <Radio className="h-4 w-4" />, t: L('实时海外带看', 'Live overseas tours') }].map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-slate-300 ring-1 ring-white/10"><span style={{ color: ACCENT }}>{s.icon}</span> {s.t}</div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* blend hero(dark) → light, BEFORE the white nav so there's no abrupt stripe */}
      <div className="h-24 bg-gradient-to-b from-slate-950 to-white" />

      {/* sticky section nav (light) */}
      <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2.5 text-sm">
          {([['buyers', L('给买家', 'For buyers')], ['agents', L('给经纪 & 开发商', 'For agents & developers')], ['pricing', L('定价', 'Pricing')]] as [string, string][]).map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">{label}</a>
          ))}
        </div>
      </nav>

      {/* ═══ ZONE A · BUYERS (light) ═══════════════════════════ */}
      <div id="buyers" className="scroll-mt-14">
        <ZoneHeader icon={<Users className="h-4 w-4" />} who={L('给买家 / 投资人', 'For buyers / investors')}
          title={L('在一张地图上看懂迪拜值不值得买', 'Understand what\'s worth buying — on one map')} />

        <Section>
          <Reveal><SectionTitle icon={<MapIcon className="h-5 w-5" />} eyebrow={L('地图情报', 'Map intelligence')} title={L('整个迪拜,真实数据,一眼看懂', 'All of Dubai, in real data, at a glance')} /></Reveal>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <TrendingUp />, t: L('最新成交 & 租约', 'Latest sales & rents'), d: L('每个区直接看 DLD 真实成交价与租约,不是估算。', 'Real DLD prices and rental contracts per district.') },
              { icon: <Database />, t: L('区域指标', 'Area metrics'), d: L('中位房价、价/sqft、资本增长、租金回报、稳定性。', 'Median price, price/sqft, growth, yield, stability.') },
              { icon: <Layers />, t: L('筛选 & 图层', 'Filters & layers'), d: L('价格/卧室/状态/开发商;交通医院学校超市 POI。', 'Filter + POI layers (transit, hospital, school, supermarket).') },
              { icon: <Ruler />, t: L('测距 & 3D', 'Measure & 3D'), d: L('量到地铁/海滩/机场;3D 倾斜 + 地标扣图。', 'Distance to metro/beach/airport; 3D + landmarks.') },
              { icon: <Building2 />, t: L('项目详情', 'Project detail'), d: L('户型、面积(㎡/sqft)、付款计划、配套、位置。', 'Units, area (m²/sqft), payment plans, amenities.') },
              { icon: <KeyRound />, t: L('投资信心', 'Investor confidence'), d: L('黄金签证资格、永久产权、零房产税/资本利得税。', 'Golden Visa, freehold, zero property & gains tax.') },
            ].map((f, i) => (<Reveal key={i} delay={(i % 3) * 0.06}><FeatureCard icon={f.icon} title={f.t} desc={f.d} /></Reveal>))}
          </div>
        </Section>

        <Section muted>
          <Reveal><SectionTitle icon={<TrendingUp className="h-5 w-5" />} eyebrow={L('投资分析', 'Investment analytics')} title={L('不止看价格,看 5 年后值多少', 'Beyond price — what it\'s worth in 5 years')} /></Reveal>
          <div className="grid items-center gap-8 md:grid-cols-2">
            <Reveal><p className="leading-relaxed text-slate-600">{L('每个项目都用真实区域成交数据测算:租金回报率、5 年增值、年化回报、回本年限 — 全部标注来源,不编造。再加黄金签证门槛与免税优势,海外买家最关心的一次答清。', 'Every project is modelled on real area DLD data: rental yield, 5-year appreciation, annualized return and payback — each figure sourced, never invented. Plus Golden-Visa thresholds and tax-free advantages.')}</p></Reveal>
            <div className="grid grid-cols-2 gap-3">
              {[{ k: L('租金回报', 'Rental yield'), v: '~6–8%' }, { k: L('5 年年化', '5-yr annualized'), v: '↑' }, { k: L('回本年限', 'Payback'), v: '~12y' }, { k: L('黄金签证', 'Golden Visa'), v: 'AED 2M+' }].map((m, i) => (
                <Reveal key={i} delay={(i % 2) * 0.07}><div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="text-2xl font-bold" style={{ color: '#0d9488' }}>{m.v}</div><div className="mt-1 text-xs font-medium text-slate-500">{m.k}</div></div></Reveal>
              ))}
            </div>
          </div>
        </Section>
      </div>

      {/* blend light → dark */}
      <div className="h-24 bg-gradient-to-b from-white to-slate-950" />

      {/* ═══ ZONE B · AGENTS & DEVELOPERS (dark) ═══════════════ */}
      <div id="agents" className="scroll-mt-14 bg-slate-950 text-white">
        <ZoneHeader dark icon={<Briefcase className="h-4 w-4" />} who={L('给经纪 / 开发商', 'For agents / developers')}
          title={L('把地图变成成交工具', 'Turn the map into a closing tool')} />

        <Section>
          <Reveal><SectionTitle dark icon={<Sparkles className="h-5 w-5" />} eyebrow={L('开发商 · AI 楼书解析', 'Developers · AI brochure parsing')} title={L('上传一份楼书,自动变成结构化房源', 'Upload a brochure → a structured listing')} /></Reveal>
          <Reveal delay={0.1}><Pipeline steps={[{ icon: <Upload className="h-5 w-5" />, t: L('上传开发商 PDF', 'Upload developer PDF') }, { icon: <Sparkles className="h-5 w-5" />, t: L('AI 提取户型/价格/付款/配套', 'AI extracts units / prices / plans / amenities') }, { icon: <Building2 className="h-5 w-5" />, t: L('结构化房源上线地图', 'Structured listing on the map') }]} /></Reveal>
          <Reveal delay={0.2}><p className="mt-6 text-center text-sm text-slate-400">{L('几百页楼书几分钟变成可搜索、可比较、可上地图的房源数据。', 'Hundreds of brochure pages become searchable, comparable, map-ready data in minutes.')}</p></Reveal>
        </Section>

        <Section>
          <Reveal><SectionTitle dark icon={<Radio className="h-5 w-5" />} eyebrow={L('经纪 · 招牌功能', 'Agents · flagship')} title={L('带海外客户,实时在地图上看房', 'Tour overseas clients live, on the map')} /></Reveal>
          <Reveal delay={0.06}><p className="mb-8 max-w-3xl leading-relaxed text-slate-300">{L('不是投屏,是"联机"。经纪拖地图、点项目、问 Luna,客户(手机/微信打开链接,零安装)镜头丝滑跟随,也能随时脱离自己逛再跟回。配语音,像并肩看房。', 'Not screen-sharing — "co-presence". The agent drives the map; the client (phone/WeChat, zero install) follows smoothly and can break off, then snap back. With voice, like sitting side by side.')}</p></Reveal>
          <Reveal delay={0.12}><CoPresenceDiagram L={L} /></Reveal>
        </Section>

        <Section>
          <div className="grid gap-5 md:grid-cols-2">
            <Reveal><BigCard icon={<FileText />} title={L('Luna AI 智能导览', 'Luna AI guided tour')} desc={L('生成可分享的自助看房导览:AI 精选房源、语音讲解、5 年回报。客户随时看,行为回传经纪。', 'A shareable self-serve tour: AI-picked properties, voice narration, ROI. Behaviour flows back to the agent.')} /></Reveal>
            <Reveal delay={0.1}><BigCard icon={<FileText />} title={L('买家意向报告', 'Buyer-intent reports')} desc={L('每次带看后自动生成:看了哪些区/项目、聊了什么、问了 Luna 什么,AI 判定意向 + 跟进话术。', 'Auto report after each tour: areas/projects viewed, what was discussed, an AI interest level + follow-up.')} /></Reveal>
          </div>
          <Reveal delay={0.16}>
            <div className="relative mt-5 overflow-hidden rounded-3xl bg-white/[0.04] p-8 ring-1 ring-white/10 md:p-10">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl" style={{ background: ACCENT }} />
              <div className="relative grid items-center gap-6 md:grid-cols-[auto,1fr]">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,224,184,0.15)' }}><Mic className="h-8 w-8" style={{ color: ACCENT }} /></div>
                <div>
                  <h3 className="text-xl font-bold">{L('Luna — 会查数据的语音助手', 'Luna — a voice assistant that knows the data')}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{L('用说的就行:"这区 5 年回报多少?到地铁多远?" 现场查真实 DLD 数据作答,并在地图上飞过去/高亮/画距离 — 每个数字带来源。', 'Just ask: "5-year return here? How far to metro?" Answers from real DLD data and drives the map — sourced.')}</p>
                  <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: ACCENT }}><ShieldCheck className="h-4 w-4" /> {L('反编造:无数据就说没有', 'No hallucination — if data is missing, it says so')}</div>
                </div>
              </div>
            </div>
          </Reveal>
        </Section>
      </div>

      {/* blend dark → light */}
      <div className="h-24 bg-gradient-to-b from-slate-950 to-white" />

      {/* ═══ PRICING (light) ═══════════════════════════════════ */}
      <div id="pricing" className="scroll-mt-14">
        <Section>
          <Reveal><SectionTitle icon={<KeyRound className="h-5 w-5" />} eyebrow={L('定价', 'Pricing')} title={L('买家免费,经纪按量选档', 'Free for buyers. Plans for agents.')} /></Reveal>
          <div className="grid items-stretch gap-5 lg:grid-cols-3">
            <Reveal><PriceTier name={L('探索版', 'Explore')} price={L('免费', 'Free')} note={L('给买家 / 投资人', 'For buyers / investors')}
              features={[L('交互式地图 + 真实 DLD 数据', 'Interactive map + real DLD data'), L('区域指标 + 项目详情 + 投资分析', 'Area metrics + detail + analytics'), L('Luna 语音助手', 'Luna voice assistant'), L('经纪工具试用:带看/导览/报告 各 2 次', 'Agent trial: 2 tours / tours / reports')]}
              cta={{ label: L('打开地图', 'Open the map'), to: '/' }} /></Reveal>
            <Reveal delay={0.08}><PriceTier highlight name={L('经纪版', 'Agent')} price="$99" priceWas="$199" per={L('/ 月 (USD)', '/ mo (USD)')}
              badge={L('7 天免费试用', '7-day free trial')} note={L('7 天免费 · 需绑卡 · 随时取消', '7 days free · card required · cancel anytime')}
              features={[L('实时海外带看 20 场/月', '20 live tours / mo'), L('Luna 智能导览 20 个/月', '20 Luna AI tours / mo'), L('买家意向报告 30 份/月', '30 buyer-intent reports / mo'), L('应用内语音 + AI 楼书解析', 'In-app voice + AI brochure parsing')]}
              cta={{ label: L('免费试用 7 天', 'Start 7-day free trial'), href: 'mailto:info@pinzos.com?subject=Pinzos%20Agent%20Plan%20-%207-day%20free%20trial' }} /></Reveal>
            <Reveal delay={0.16}><PriceTier founder name={L('创始会员', 'Founder')} price="$699" per={L('/ 月 (USD)', '/ mo (USD)')}
              badge={L('10× 额度', '10× quota')} note={L('早期支持者 · 名额有限', 'Early supporters · limited')}
              features={[L('实时带看 200 场/月', '200 live tours / mo'), L('Luna 导览 200 个/月', '200 Luna AI tours / mo'), L('意向报告 300 份/月', '300 reports / mo'), L('锁定创始价 · 优先支持 · 抢先体验', 'Locked price · priority · early access'), L('直接与我们沟通,定制功能与需求', 'Direct line to us — shape features & requests')]}
              cta={{ label: L('申请 Founder', 'Apply for Founder'), href: 'mailto:info@pinzos.com?subject=Pinzos%20Founder%20Access%20($699)' }} /></Reveal>
          </div>
          <p className="mt-5 text-center text-xs text-slate-400">{L('价格以美元(USD)计,按月计费。', 'Prices in USD, billed monthly.')}</p>
        </Section>
      </div>

      {/* ── CTA (dark) ──────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-950 py-20 text-white">
        <div className="absolute left-1/2 top-0 h-64 w-[40rem] -translate-x-1/2 rounded-full opacity-15 blur-3xl" style={{ background: ACCENT }} />
        <Reveal className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold md:text-4xl">{L('准备好了吗?', 'Ready to explore?')}</h2>
          <p className="mt-3 text-slate-300">{L('打开地图,或以经纪身份登录开始带看。', 'Open the map, or sign in as an agent to start tours.')}</p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>{L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/agent" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">{L('经纪台', 'Agent console')}</Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}

// ── building blocks (theme-aware) ───────────────────────────
function ZoneHeader({ who, title, icon, dark }: { who: string; title: string; icon: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mx-auto max-w-6xl px-6 pt-12">
      <Reveal>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${dark ? 'bg-white/10' : 'bg-teal-50 text-teal-700'}`} style={dark ? { color: ACCENT } : undefined}>{icon}{who}</span>
        <h2 className={`mt-3 text-2xl font-bold md:text-4xl ${dark ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
      </Reveal>
    </div>
  )
}

function Section({ muted, children }: { muted?: boolean; children: React.ReactNode }) {
  return (
    <section className={`relative py-14 ${muted ? 'bg-slate-50' : ''}`}>
      <div className="relative mx-auto max-w-6xl px-6">{children}</div>
    </section>
  )
}

function SectionTitle({ eyebrow, title, icon, dark }: { eyebrow: string; title: string; icon?: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: dark ? ACCENT : '#0d9488' }}>{icon}{eyebrow}</div>
      <h3 className={`text-2xl font-bold md:text-3xl ${dark ? 'text-white' : 'text-slate-900'}`}>{title}</h3>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="h-full rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">{icon}</div>
      <h4 className="font-semibold text-slate-900">{title}</h4>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{desc}</p>
    </div>
  )
}

function BigCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="h-full rounded-2xl bg-white/[0.04] p-6 ring-1 ring-white/10 backdrop-blur">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.12)', color: ACCENT }}>{icon}</div>
      <h4 className="text-lg font-bold text-white">{title}</h4>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{desc}</p>
    </div>
  )
}

interface CTA { label: string; to?: string; href?: string }
function PriceTier({ name, price, priceWas, per, badge, note, features, cta, highlight, founder }: {
  name: string; price: string; priceWas?: string; per?: string; badge?: string; note: string; features: string[]; cta: CTA; highlight?: boolean; founder?: boolean
}) {
  const edge = founder ? GOLD : ACCENT
  const btn = <span className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: edge }}>{cta.label}</span>
  return (
    <div className="relative flex h-full flex-col rounded-2xl border border-slate-100 bg-white p-6 shadow-sm"
      style={highlight ? { boxShadow: `0 0 0 2px ${ACCENT}` } : founder ? { boxShadow: `0 0 0 2px ${GOLD}` } : undefined}>
      {badge && <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: edge }}>{badge}</span>}
      <div className="text-sm font-semibold" style={{ color: founder ? '#B8860B' : '#0d9488' }}>{name}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-3xl font-bold text-slate-900">{price}</span>
        {priceWas && <span className="pb-1 text-base font-medium text-slate-400 line-through">{priceWas}</span>}
        {per && <span className="pb-1 text-sm text-slate-400">{per}</span>}
      </div>
      <p className="mt-1.5 text-sm text-slate-500">{note}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
        {features.map((f, i) => (<li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: edge }} /> {f}</li>))}
      </ul>
      {cta.to ? <Link to={cta.to}>{btn}</Link> : <a href={cta.href}>{btn}</a>}
    </div>
  )
}

function Pipeline({ steps }: { steps: { icon: React.ReactNode; t: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
      {steps.map((s, i) => (
        <div key={i} className="contents">
          <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10 md:flex-col md:text-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.15)', color: ACCENT }}>{s.icon}</span>
            <span className="text-sm font-medium text-slate-200">{s.t}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-600 md:block" style={{ color: ACCENT }} />}
        </div>
      ))}
    </div>
  )
}

function CoPresenceDiagram({ L }: { L: (cn: string, en: string) => string }) {
  const Node = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) => (
    <div className={`rounded-2xl p-5 text-center ring-1 backdrop-blur ${accent ? 'bg-white/[0.07] ring-white/20' : 'bg-white/[0.04] ring-white/10'}`}>
      <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.15)', color: ACCENT }}>{icon}</div>
      <div className="text-sm font-bold text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  )
  const Arrow = ({ label }: { label: string }) => (
    <div className="flex flex-col items-center justify-center px-1 md:px-2">
      <ArrowRight className="h-5 w-5" style={{ color: ACCENT }} />
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
    </div>
  )
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
      <Node accent icon={<Radio className="h-5 w-5" />} title={L('经纪', 'Agent')} sub={L('拖地图 · 点项目 · 问 Luna', 'pans · opens · asks Luna')} />
      <Arrow label={L('镜头 JSON', 'camera JSON')} />
      <Node icon={<Database className="h-5 w-5" />} title={L('Pinzos 服务器', 'Pinzos server')} sub={L('扇出广播 · 毫秒级', 'fans out · ms')} />
      <Arrow label={L('本地渲染', 'local render')} />
      <Node accent icon={<MapIcon className="h-5 w-5" />} title={L('客户(手机/微信)', 'Client (phone/WeChat)')} sub={L('丝滑跟随 · 可脱离 · 语音', 'smooth · break off · voice')} />
    </div>
  )
}
