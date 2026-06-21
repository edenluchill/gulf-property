/**
 * About / Features — the marketing + SEO + AI-discoverability page.
 *
 * Bilingual (follows app language). Rich visuals via inline SVG/CSS diagrams (no
 * external assets). Helmet adds meta + JSON-LD (Organization / SoftwareApplication
 * / feature ItemList) so search engines and AI crawlers understand what Pinzos is.
 */
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Map as MapIcon, TrendingUp, Building2, Sparkles, Radio, FileText, Mic,
  Upload, Database, KeyRound, Ruler, Layers, ArrowRight, Languages, ShieldCheck,
} from 'lucide-react'

const ACCENT = '#00E0B8'

export default function AboutPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (cn: string, en: string) => (zh ? cn : en)

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'Pinzos',
        url: 'https://pinzos.com',
        description: 'Interactive Dubai off-plan property platform with real DLD data, AI brochure parsing, investment analytics, and agent tools for overseas clients.',
        areaServed: 'Dubai, United Arab Emirates',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Pinzos',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: 'https://pinzos.com',
        description: 'Pinzos helps buyers and agents explore Dubai off-plan property: a satellite map with real DLD transactions/rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, real-time co-presence map tours, AI-guided Luna tours, and buyer-intent reports.',
        featureList: [
          'Satellite map of Dubai with 3D landmarks',
          'Real DLD transactions and rental contracts',
          'Area metrics: median price, price/sqft, capital growth, rental yield, rental stability',
          'Filters by price, bedrooms, status, developer',
          'POI layers (transit, hospital, school, supermarket) and distance measuring',
          'AI brochure parsing: developer PDF to structured listings',
          '5-year ROI, payback, rental yield, Golden Visa eligibility, freehold & tax-free',
          'Real-time co-presence map tours for overseas clients with voice',
          'Luna AI-guided shareable self-serve tours',
          'Buyer-intent reports for agents',
          'Luna voice assistant over real DLD data, multilingual',
        ],
      },
    ],
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      <Helmet>
        <title>{L('Pinzos — 迪拜期房的全新购买方式 | 功能介绍', 'Pinzos — Features: The New Way to Buy Dubai Off-Plan')}</title>
        <meta name="description" content={L(
          'Pinzos 是迪拜期房的交互式平台:卫星地图 + 真实 DLD 成交/租约/区域指标、AI 楼书解析、5 年回报与黄金签证分析,以及经纪变现工具 — 面向海外客户的实时地图带看、Luna AI 智能导览、买家意向报告。',
          'Pinzos is an interactive Dubai off-plan platform: a satellite map with real DLD transactions, rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, plus agent tools — real-time co-presence map tours for overseas clients, AI-guided Luna tours, and buyer-intent reports.'
        )} />
        <meta property="og:title" content="Pinzos — The New Way to Buy Dubai Off-Plan" />
        <meta property="og:description" content="Real DLD data on an interactive map, AI brochure parsing, investment analytics, and real-time co-presence tours for overseas clients." />
        <link rel="canonical" href="https://pinzos.com/about" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full opacity-20 blur-3xl" style={{ background: ACCENT }} />
        <div className="absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-emerald-500 opacity-10 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} /> {L('迪拜期房 · 真实数据 · AI 驱动', 'Dubai Off-Plan · Real Data · AI-Powered')}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] md:text-5xl xl:text-6xl">
              {L('买卖迪拜期房的', 'A smarter way to buy & sell')}<br />
              <span style={{ color: ACCENT }}>{L('全新方式', 'Dubai off-plan')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
              {L(
                '一张交互式卫星地图,装下迪拜每个区的真实成交、租金与回报;AI 读懂开发商楼书;经纪能带海外客户实时在地图上看房、生成 AI 导览与意向报告。',
                'One interactive satellite map with every district\'s real transactions, rents and returns; AI that reads developer brochures; and agents who guide overseas clients live on the map — with AI tours and buyer-intent reports.'
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>
                {L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/agent" className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/15">
                {L('我是经纪', 'I\'m an agent')}
              </Link>
            </div>
          </div>

          {/* framed product shot — the single most "premium" element */}
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl opacity-20 blur-2xl" style={{ background: `linear-gradient(135deg, ${ACCENT}, transparent)` }} />
            <div className="relative overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15">
              <div className="flex items-center gap-1.5 bg-slate-800/90 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-2 truncate text-[11px] text-slate-400">pinzos.com</span>
              </div>
              <img src="/about-map.jpg" alt={L('Pinzos 迪拜卫星地图,带真实成交与区域指标', 'Pinzos Dubai satellite map with real transactions and area metrics')} className="block w-full" loading="eager" />
            </div>
          </div>
        </div>

        {/* credibility strip — full width under the hero */}
        <div className="relative mx-auto max-w-6xl px-6 pb-14">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: <Database className="h-4 w-4" />, t: L('真实 DLD 数据', 'Real DLD data') },
              { icon: <Sparkles className="h-4 w-4" />, t: L('AI 解析与助手', 'AI parsing & assistant') },
              { icon: <Languages className="h-4 w-4" />, t: L('中英阿多语', 'CN · EN · AR') },
              { icon: <Radio className="h-4 w-4" />, t: L('实时海外带看', 'Live overseas tours') },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm text-slate-300 ring-1 ring-white/10">
                <span style={{ color: ACCENT }}>{s.icon}</span> {s.t}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* sticky section nav — product-page feel */}
      <nav className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2.5 text-sm">
          {([
            ['map', L('地图情报', 'Map intelligence')],
            ['investment', L('投资分析', 'Investment')],
            ['ai', L('AI 解析', 'AI parsing')],
            ['agents', L('经纪工具', 'For agents')],
            ['pricing', L('定价', 'Pricing')],
          ] as [string, string][]).map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">{label}</a>
          ))}
        </div>
      </nav>

      {/* ── Two sides ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <SectionTitle eyebrow={L('一个平台,两端受益', 'One platform, two sides')} title={L('给买家洞察,给经纪生意', 'Insight for buyers. Business for agents.')} />
        <div className="grid gap-5 md:grid-cols-2">
          <SideCard accent title={L('买家 / 投资人', 'Buyers / Investors')} desc={L('在一张地图上看懂迪拜每个区值不值得买。', 'Understand every Dubai district on one map.')}
            items={[L('真实成交 + 租约', 'Real sales + rents'), L('5 年回报 + 黄金签证', '5-yr ROI + Golden Visa'), L('户型/付款计划', 'Units / payment plans')]} />
          <SideCard title={L('经纪 / 团队', 'Agents / Teams')} desc={L('把地图变成成交工具:带看、导览、报告。', 'Turn the map into a closing tool.')}
            items={[L('实时海外带看', 'Live overseas tours'), L('Luna AI 智能导览', 'Luna AI tours'), L('买家意向报告', 'Buyer-intent reports')]} />
        </div>
      </section>

      {/* ── Map intelligence ────────────────────────────────── */}
      <section id="map" className="scroll-mt-14 bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionTitle eyebrow={L('地图情报', 'Map intelligence')} icon={<MapIcon className="h-5 w-5" />}
            title={L('整个迪拜,真实数据,一眼看懂', 'All of Dubai, in real data, at a glance')} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard icon={<TrendingUp />} title={L('最新成交 & 租约', 'Latest sales & rents')} desc={L('每个区直接看 DLD 真实成交价与租约,不是估算。', 'Real DLD transaction prices and rental contracts per district — not estimates.')} />
            <FeatureCard icon={<Database />} title={L('区域指标', 'Area metrics')} desc={L('中位房价、价/sqft、资本增长、租金回报、租赁稳定性,一键切换。', 'Median price, price/sqft, capital growth, rental yield and rental stability — one tap to switch.')} />
            <FeatureCard icon={<Layers />} title={L('筛选 & 图层', 'Filters & layers')} desc={L('按价格/卧室/状态/开发商筛;叠加交通、医院、学校、超市 POI。', 'Filter by price, beds, status, developer; overlay transit, hospital, school and supermarket POIs.')} />
            <FeatureCard icon={<Ruler />} title={L('测距 & 3D', 'Measure & 3D')} desc={L('量到地铁/海滩/机场的距离;3D 倾斜 + 地标扣图,直观感受地段。', 'Measure distance to metro/beach/airport; 3D tilt + landmark cut-outs to feel the location.')} />
            <FeatureCard icon={<Building2 />} title={L('项目详情', 'Project detail')} desc={L('户型、面积(㎡/sqft)、付款计划、配套、位置一应俱全。', 'Unit types, area (m²/sqft), payment plans, amenities and location — all in one place.')} />
            <FeatureCard icon={<KeyRound />} title={L('投资信心', 'Investor confidence')} desc={L('黄金签证资格、永久产权、零房产税/资本利得税一目了然。', 'Golden-Visa eligibility, freehold ownership, zero property & capital-gains tax — made clear.')} />
          </div>
        </div>
      </section>

      {/* ── Investment analytics ───────────────────────────── */}
      <section id="investment" className="mx-auto max-w-6xl scroll-mt-14 px-6 py-16">
        <SectionTitle eyebrow={L('投资分析', 'Investment analytics')} icon={<TrendingUp className="h-5 w-5" />}
          title={L('不止看价格,看 5 年后值多少', 'Beyond price — what it\'s worth in 5 years')} />
        <div className="grid items-center gap-8 md:grid-cols-2">
          <p className="text-slate-600 leading-relaxed">
            {L('每个项目都用真实区域成交数据测算:租金回报率、5 年增值、年化回报、回本年限 — 全部标注数据来源,不编造。再加黄金签证门槛判定与免税优势,海外买家最关心的问题一次答清。',
              'Every project is modelled on real area DLD data: rental yield, 5-year appreciation, annualized return and payback years — each figure cites its source, never invented. Plus Golden-Visa thresholds and tax-free advantages — the questions overseas buyers actually ask.')}
          </p>
          {/* metric chips diagram */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { k: L('租金回报', 'Rental yield'), v: '~6–8%' },
              { k: L('5 年年化', '5-yr annualized'), v: '↑' },
              { k: L('回本年限', 'Payback'), v: '~12y' },
              { k: L('黄金签证', 'Golden Visa'), v: 'AED 2M+' },
            ].map((m, i) => (
              <div key={i} className="rounded-2xl bg-gradient-to-br from-slate-50 to-emerald-50/50 p-4 ring-1 ring-slate-900/[0.05]">
                <div className="text-2xl font-bold" style={{ color: '#0d9488' }}>{m.v}</div>
                <div className="mt-1 text-xs font-medium text-slate-500">{m.k}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI brochure pipeline ───────────────────────────── */}
      <section id="ai" className="scroll-mt-14 bg-slate-950 py-16 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <SectionTitle dark eyebrow={L('AI 楼书解析', 'AI brochure parsing')} icon={<Sparkles className="h-5 w-5" />}
            title={L('上传一份楼书,自动变成结构化房源', 'Upload a brochure → a structured listing')} />
          <Pipeline
            steps={[
              { icon: <Upload className="h-5 w-5" />, t: L('上传开发商 PDF', 'Upload developer PDF') },
              { icon: <Sparkles className="h-5 w-5" />, t: L('AI 提取户型/价格/付款计划/配套', 'AI extracts units / prices / payment plans / amenities') },
              { icon: <Building2 className="h-5 w-5" />, t: L('结构化房源上线地图', 'Structured listing on the map') },
            ]}
          />
          <p className="mt-6 text-center text-sm text-slate-400">
            {L('几百页的楼书几分钟变成可搜索、可比较、可上地图的房源数据。', 'Hundreds of brochure pages become searchable, comparable, map-ready listing data in minutes.')}
          </p>
        </div>
      </section>

      {/* ── Agent monetization: live co-presence tour ──────── */}
      <section id="agents" className="mx-auto max-w-6xl scroll-mt-14 px-6 py-16">
        <SectionTitle eyebrow={L('经纪变现 · 招牌功能', 'For agents · flagship')} icon={<Radio className="h-5 w-5" />}
          title={L('带海外客户,实时在地图上看房', 'Tour overseas clients live, on the map')} />
        <p className="mb-8 max-w-3xl text-slate-600 leading-relaxed">
          {L('不是投屏,是"联机"。经纪拖动地图、点项目、问 Luna,客户(手机/微信打开链接,零安装)镜头丝滑跟随;客户也能随时脱离自己逛、再一键跟回。配语音通话,像并肩坐着看房。',
            'Not screen-sharing — it\'s "co-presence". The agent pans the map, opens projects and asks Luna; the client (opens a link on phone/WeChat, zero install) follows the camera smoothly — and can break off to explore, then snap back. With voice, it feels like sitting side by side.')}
        </p>
        <CoPresenceDiagram L={L} />
      </section>

      {/* ── Luna tour + intent report ──────────────────────── */}
      <section className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-6 grid gap-5 md:grid-cols-2">
          <BigCard icon={<FileText />} title={L('Luna AI 智能导览', 'Luna AI guided tour')}
            desc={L('为客户生成一条可分享的自助看房导览:AI 精选房源、语音讲解、5 年回报测算。客户随时打开自己看,行为(看了哪些区/停留多久/问了什么)回传给经纪。',
              'Generate a shareable self-serve tour: AI-picked properties, voice narration, 5-year ROI. Clients open it anytime; their behaviour (areas viewed, dwell time, questions) flows back to the agent.')} />
          <BigCard icon={<FileText />} title={L('买家意向报告', 'Buyer-intent reports')}
            desc={L('每次带看后自动生成报告:客户看了哪些区/项目、聊了什么、问了 Luna 什么,AI 判定意向等级并给出可直接发的跟进话术。',
              'After each tour, an automatic report: which areas/projects the client viewed, what they discussed and asked Luna, an AI-judged interest level, and a ready-to-send follow-up message.')} />
        </div>
      </section>

      {/* ── Luna voice assistant ───────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-8 text-white md:p-12">
          <div className="grid items-center gap-8 md:grid-cols-[auto,1fr]">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,224,184,0.15)' }}>
              <Mic className="h-10 w-10" style={{ color: ACCENT }} />
            </div>
            <div>
              <h3 className="text-2xl font-bold">{L('Luna — 会查数据的语音助手', 'Luna — a voice assistant that knows the data')}</h3>
              <p className="mt-2 text-slate-300 leading-relaxed">
                {L('用说的就行:"这区 5 年回报多少?到地铁多远?" Luna 现场查真实 DLD 数据作答,并在地图上飞过去、高亮、画距离 — 每个数字都带来源。中英阿多语。',
                  'Just ask out loud: "What\'s this area\'s 5-year return? How far to the metro?" Luna answers from real DLD data and drives the map — flying over, highlighting, measuring — every figure sourced. Multilingual.')}
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: ACCENT }}>
                <ShieldCheck className="h-4 w-4" /> {L('反编造:无数据就说没有,绝不瞎编', 'No hallucination: if data is missing, it says so')}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-14 bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <SectionTitle eyebrow={L('定价', 'Pricing')} icon={<KeyRound className="h-5 w-5" />}
            title={L('买家免费,经纪按量选档', 'Free for buyers. Plans for agents.')} />
          <div className="grid items-stretch gap-5 lg:grid-cols-3">

            {/* Free */}
            <PriceTier
              name={L('探索版', 'Explore')}
              price={L('免费', 'Free')}
              note={L('给买家 / 投资人', 'For buyers / investors')}
              features={[
                L('交互式地图 + 真实 DLD 数据', 'Interactive map + real DLD data'),
                L('区域指标 + 项目详情 + 投资分析', 'Area metrics + detail + analytics'),
                L('Luna 语音助手', 'Luna voice assistant'),
                L('经纪工具试用:带看 / 导览 / 报告 各 2 次', 'Agent trial: 2 tours / tours / reports each'),
              ]}
              cta={{ label: L('打开地图', 'Open the map'), to: '/' }}
            />

            {/* Agent — highlighted, intro discount */}
            <PriceTier
              highlight
              name={L('经纪版', 'Agent')}
              price="$199"
              priceWas="$299"
              per={L('/ 月', '/ mo')}
              badge={L('7 天免费试用', '7-day free trial')}
              note={L('7 天免费 · 需绑卡 · 随时取消', '7 days free · card required · cancel anytime')}
              features={[
                L('实时海外带看 20 场/月', '20 live tours / mo'),
                L('Luna 智能导览 20 个/月', '20 Luna AI tours / mo'),
                L('买家意向报告 30 份/月', '30 buyer-intent reports / mo'),
                L('应用内语音 + AI 楼书解析', 'In-app voice + AI brochure parsing'),
              ]}
              cta={{ label: L('免费试用 7 天', 'Start 7-day free trial'), href: 'mailto:info@pinzos.com?subject=Pinzos%20Agent%20Plan%20-%207-day%20free%20trial' }}
            />

            {/* Founder — 5x */}
            <PriceTier
              dark
              name={L('创始会员', 'Founder')}
              price="$699"
              per={L('/ 月', '/ mo')}
              badge={L('5× 额度', '5× quota')}
              note={L('早期支持者 · 名额有限', 'Early supporters · limited')}
              features={[
                L('实时带看 100 场/月', '100 live tours / mo'),
                L('Luna 导览 100 个/月', '100 Luna AI tours / mo'),
                L('意向报告 150 份/月', '150 reports / mo'),
                L('锁定创始价 · 优先支持 · 抢先体验', 'Locked price · priority support · early access'),
              ]}
              cta={{ label: L('申请 Founder', 'Apply for Founder'), href: 'mailto:info@pinzos.com?subject=Pinzos%20Founder%20Access%20($699)' }}
            />
          </div>
          <p className="mt-5 text-center text-xs text-slate-400">
            {L('价格以美元计,可开月付。开通请联系洽询。', 'Prices in USD, billed monthly. Contact us to get started.')}
          </p>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="border-t border-slate-100 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold text-slate-900">{L('准备好了吗?', 'Ready to explore?')}</h2>
          <p className="mt-3 text-slate-600">{L('打开地图,或以经纪身份登录开始带看。', 'Open the map, or sign in as an agent to start tours.')}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>
              {L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/agent" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              {L('经纪台', 'Agent console')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── building blocks ────────────────────────────────────────
function SectionTitle({ eyebrow, title, icon, dark }: { eyebrow: string; title: string; icon?: React.ReactNode; dark?: boolean }) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: dark ? ACCENT : '#0d9488' }}>
        {icon}{eyebrow}
      </div>
      <h2 className={`text-2xl font-bold md:text-3xl ${dark ? 'text-white' : 'text-slate-900'}`}>{title}</h2>
    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.05] transition hover:shadow-md hover:-translate-y-0.5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">{icon}</div>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{desc}</p>
    </div>
  )
}

function SideCard({ title, desc, items, accent }: { title: string; desc: string; items: string[]; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-6 ${accent ? 'bg-gradient-to-br from-teal-50 to-emerald-50 ring-1 ring-teal-100' : 'bg-slate-900 text-white'}`}>
      <h3 className={`text-xl font-bold ${accent ? 'text-slate-900' : 'text-white'}`}>{title}</h3>
      <p className={`mt-1 text-sm ${accent ? 'text-slate-600' : 'text-slate-300'}`}>{desc}</p>
      <ul className="mt-4 space-y-2">
        {items.map((it, i) => (
          <li key={i} className={`flex items-center gap-2 text-sm ${accent ? 'text-slate-700' : 'text-slate-200'}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} /> {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function BigCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-900/[0.05]">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">{icon}</div>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{desc}</p>
    </div>
  )
}

interface CTA { label: string; to?: string; href?: string }
function PriceTier({ name, price, priceWas, per, badge, note, features, cta, highlight, dark }: {
  name: string; price: string; priceWas?: string; per?: string; badge?: string; note: string
  features: string[]; cta: CTA; highlight?: boolean; dark?: boolean
}) {
  const base = dark ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-900 ring-slate-900/[0.06]'
  const ring = highlight ? 'ring-2' : 'ring-1'
  const btnCls = highlight || dark
    ? 'text-slate-900'
    : 'text-slate-900'
  const btnStyle = highlight || dark ? { background: ACCENT } : { background: ACCENT }
  const btn = (
    <span className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition hover:opacity-90" style={btnStyle as React.CSSProperties}>
      <span className={btnCls}>{cta.label}</span>
    </span>
  )
  return (
    <div className={`relative flex flex-col rounded-2xl p-6 shadow-sm ${base} ${ring}`} style={highlight ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}>
      {badge && (
        <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-900" style={{ background: ACCENT }}>{badge}</span>
      )}
      <div className={`text-sm font-semibold ${dark ? '' : 'text-slate-500'}`} style={dark ? { color: ACCENT } : undefined}>{name}</div>
      <div className="mt-1 flex items-end gap-2">
        <span className="text-3xl font-bold">{price}</span>
        {priceWas && <span className={`pb-1 text-base font-medium line-through ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{priceWas}</span>}
        {per && <span className={`pb-1 text-sm ${dark ? 'text-slate-400' : 'text-slate-400'}`}>{per}</span>}
      </div>
      <p className={`mt-1.5 text-sm ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{note}</p>
      <ul className={`mt-4 flex-1 space-y-2 text-sm ${dark ? 'text-slate-200' : 'text-slate-600'}`}>
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENT }} /> {f}</li>
        ))}
      </ul>
      {cta.to ? <Link to={cta.to}>{btn}</Link> : <a href={cta.href}>{btn}</a>}
    </div>
  )
}

function Pipeline({ steps }: { steps: { icon: React.ReactNode; t: string }[] }) {
  return (
    <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
      {steps.map((s, i) => (
        <div key={i} className="flex flex-1 items-center gap-3 md:flex-col md:gap-3 md:text-center">
          <div className="flex w-full items-center gap-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 md:flex-col">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.15)', color: ACCENT }}>{s.icon}</span>
            <span className="text-sm font-medium text-slate-200">{s.t}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight className="hidden h-5 w-5 shrink-0 text-slate-600 md:block" />}
        </div>
      ))}
    </div>
  )
}

function CoPresenceDiagram({ L }: { L: (cn: string, en: string) => string }) {
  const Node = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) => (
    <div className={`flex-1 rounded-2xl p-5 text-center ring-1 ${accent ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white ring-slate-900/[0.06] shadow-sm'}`}>
      <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: accent ? 'rgba(0,224,184,0.15)' : '#f0fdfa', color: accent ? ACCENT : '#0d9488' }}>{icon}</div>
      <div className={`text-sm font-bold ${accent ? 'text-white' : 'text-slate-900'}`}>{title}</div>
      <div className={`mt-1 text-xs ${accent ? 'text-slate-400' : 'text-slate-500'}`}>{sub}</div>
    </div>
  )
  const Arrow = ({ label }: { label: string }) => (
    <div className="flex shrink-0 flex-col items-center justify-center px-1 md:px-2">
      <ArrowRight className="hidden h-5 w-5 text-teal-500 md:block" />
      <span className="text-[10px] font-medium text-slate-400">{label}</span>
    </div>
  )
  return (
    <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
      <Node accent icon={<Radio className="h-5 w-5" />} title={L('经纪', 'Agent')} sub={L('拖地图 · 点项目 · 问 Luna', 'pans map · opens projects · asks Luna')} />
      <Arrow label={L('镜头 JSON', 'camera JSON')} />
      <Node icon={<Database className="h-5 w-5" />} title={L('Pinzos 服务器', 'Pinzos server')} sub={L('扇出广播 · 毫秒级', 'fans out · milliseconds')} />
      <Arrow label={L('本地渲染', 'local render')} />
      <Node accent icon={<MapIcon className="h-5 w-5" />} title={L('客户(手机/微信)', 'Client (phone/WeChat)')} sub={L('丝滑跟随 · 可脱离 · 语音', 'smooth follow · break off · voice')} />
    </div>
  )
}
