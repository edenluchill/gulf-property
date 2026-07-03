/**
 * About / Features — cohesive dark "high-tech" theme.
 *
 * One deep-dark base (no white↔dark flips), a subtle dot-grid texture, soft
 * RADIAL-GRADIENT glows (NOT blur filters → no scroll repaint jank), glass cards
 * WITHOUT backdrop-blur (also for perf), a bento feature grid, and lightweight
 * scroll reveals. Helmet + JSON-LD for SEO / AI discoverability. At /about & /pricing.
 */
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState } from 'react'
import {
  Map as MapIcon, TrendingUp, Building2, Sparkles, Radio, FileText, Mic,
  Upload, Database, KeyRound, Ruler, Layers, ArrowRight, Languages, ShieldCheck,
  PenTool, PhoneCall, MousePointer2, Check, Users,
} from 'lucide-react'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)'

/** Pure-CSS scroll reveal: a light IntersectionObserver toggles a class; the
 *  animation itself is a GPU-composited CSS transition (opacity + transform) —
 *  no per-element JS animation loop, so scrolling stays smooth. */
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } }, { rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref}
      className={`${className} motion-safe:transition-[opacity,transform] motion-safe:duration-500 motion-safe:ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
      style={{ transitionDelay: shown ? `${delay}s` : '0s', willChange: shown ? 'auto' : 'opacity, transform' }}>
      {children}
    </div>
  )
}

/** Soft glow via radial-gradient — cheap to composite, no blur filter (no jank). */
function Glow({ className, color = ACCENT, opacity = 0.18 }: { className?: string; color?: string; opacity?: number }) {
  return <div aria-hidden className={`pointer-events-none absolute rounded-full ${className}`}
    style={{ background: `radial-gradient(circle, ${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%)` }} />
}

export default function AboutPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const L = (cn: string, en: string) => (zh ? cn : en)

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Pinzos', url: 'https://pinzos.com', description: 'Interactive Dubai off-plan property platform with real DLD data, AI brochure parsing, investment analytics, and agent tools for overseas clients.', areaServed: 'Dubai, United Arab Emirates' },
      {
        '@type': 'SoftwareApplication', name: 'Pinzos', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: 'https://pinzos.com',
        description: 'Pinzos helps buyers and agents explore Dubai off-plan property: a satellite map with real DLD transactions/rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, real-time co-presence map tours, AI-guided Luna tours, and buyer-intent reports.',
        offers: [
          { '@type': 'Offer', name: 'Buyers (Free)', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Starter', price: '25', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Pro', price: '99', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Founder', price: '699', priceCurrency: 'USD' },
        ],
        featureList: [
          'Satellite map of Dubai with 3D landmarks', 'Real DLD transactions and rental contracts',
          'Area metrics: median price, price/sqft, capital growth, rental yield',
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
    <div className="relative flex-1 overflow-y-auto bg-[#070b16] text-white" style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}>
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

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Glow className="-right-32 -top-32 h-[34rem] w-[34rem]" />
        <Glow className="-left-32 top-52 h-96 w-96" color={GOLD} opacity={0.1} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] tracking-wide" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} /> {L('迪拜期房 · 真实数据 · AI 驱动', 'DUBAI OFF-PLAN · REAL DATA · AI')}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] md:text-5xl xl:text-6xl">
              {L('买卖迪拜期房的', 'A smarter way to buy & sell')}<br /><span style={{ color: ACCENT }}>{L('全新方式', 'Dubai off-plan')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300/90">
              {L('一张交互式卫星地图,装下迪拜每个区的真实成交、租金与回报;AI 读懂开发商楼书;经纪带海外客户实时在地图上看房、生成导览与意向报告。',
                'One interactive satellite map with every district\'s real transactions, rents and returns; AI that reads developer brochures; and agents who guide overseas clients live on the map.')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>{L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" /></Link>
              <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">{L('查看定价', 'See pricing')}</Link>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="relative">
              <Glow className="-inset-6" opacity={0.22} />
              <div className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
                <div className="flex items-center gap-1.5 bg-white/[0.06] px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ml-2 truncate font-mono text-[11px] text-slate-400">pinzos.com</span>
                </div>
                <img src={zh ? '/about-map.jpg' : '/about-map-en.jpg'} alt={L('Pinzos 迪拜卫星地图', 'Pinzos Dubai satellite map')} className="block w-full" loading="eager" />
              </div>
            </div>
          </Reveal>
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pb-12">
          <Reveal delay={0.2}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ icon: <Database className="h-4 w-4" />, t: L('真实 DLD 数据', 'Real DLD data') }, { icon: <Sparkles className="h-4 w-4" />, t: L('AI 解析与助手', 'AI parsing & assistant') }, { icon: <Languages className="h-4 w-4" />, t: L('中英阿多语', 'CN · EN · AR') }, { icon: <Radio className="h-4 w-4" />, t: L('实时海外带看', 'Live overseas tours') }].map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300"><span style={{ color: ACCENT }}>{s.icon}</span> {s.t}</div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* sticky nav (solid dark, no blur for perf) */}
      <nav className="sticky top-0 z-20 border-y border-white/10 bg-[#070b16]/95">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2.5 text-sm">
          {([['buyers', L('给买家', 'For buyers')], ['agents', L('给经纪 & 开发商', 'For agents & developers')], ['pricing', L('定价', 'Pricing')]] as [string, string][]).map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-slate-400 transition hover:bg-white/10 hover:text-white">{label}</a>
          ))}
        </div>
      </nav>

      {/* ═══ SEE IT LIVE — Luna tour video ════════════════════ */}
      <Section glow>
        <Reveal><Label tone={ACCENT}>// {L('实况演示', 'SEE IT LIVE')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{L('Luna 带看,长这样', 'This is what a Luna tour looks like')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{L('每个导览都由经纪自己设计 —— 选项目、排路线、配讲解。下面是其中一个的实际效果。', 'Every tour is built by the agent — their projects, their route, their narration. Here\'s one in action.')}</p></Reveal>
        <Reveal delay={0.1} className="mt-8">
          <div className="relative mx-auto max-w-4xl">
            <Glow className="-inset-6" opacity={0.18} />
            <div className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
              <div className="flex items-center gap-1.5 bg-white/[0.06] px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ml-2 truncate font-mono text-[11px] text-slate-400">pinzos.com</span>
              </div>
              <video key={zh ? 'zh' : 'en'} src={zh ? '/luna-tour-demo.mp4' : '/luna-tour-demo-en.mp4'} autoPlay muted loop playsInline preload="metadata" poster={zh ? '/about-map.jpg' : '/about-map-en.jpg'} className="block w-full" />
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.16} className="mt-6 text-center">
          <a href="/?toursession=demo" target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>
            {L('▶ 试玩这个导览 · 无需登录', '▶ Try this tour — no login')} <ArrowRight className="h-4 w-4" />
          </a>
          <p className="mt-2 text-xs text-slate-500">{L('在新标签页打开真实的 Luna 导览,自己点点看。', 'Opens a real Luna tour in a new tab — click around yourself.')}</p>
        </Reveal>
      </Section>

      {/* ═══ WHERE THE DATA COMES FROM — trust ════════════════ */}
      <Section>
        <Reveal><Label tone={ACCENT}>// {L('数据从哪来', 'WHERE THE DATA COMES FROM')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{L('每个数字都来自迪拜政府官方记录', 'Every number comes from official Dubai government records')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{L('我们不用中介挂牌价、不做模型估算。成交、租约、面积、回报全部来自迪拜土地局(DLD)登记的真实交易,并通过迪拜政府官方数据平台持续同步。', 'No agent asking-prices, no model guesswork. Sales, rents, sizes and returns all come from real transactions registered with the Dubai Land Department (DLD), synced continuously from Dubai\'s official government data platform.')}</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <Reveal><Tile className="h-full"><TileHead icon={<Database />} title={L('迪拜土地局 (DLD)', 'Dubai Land Department')} /><p className="text-sm text-slate-400">{L('每一笔成交与租约都是 DLD 政府登记的真实交易 —— 不是中介挂牌价,不是模型估算。', 'Every sale and lease is a real transaction registered with the DLD — not an agent listing, not a model estimate.')}</p></Tile></Reveal>
          <Reveal delay={0.06}><Tile className="h-full"><TileHead icon={<Radio />} title={L('官方平台 · 持续同步', 'Official platform · live sync')} /><p className="text-sm text-slate-400">{L('通过迪拜政府官方数据接口(data.dubai)增量同步,房价与租约保持更新 —— 不是一次性导入的旧数据。', 'Incrementally synced through Dubai\'s official data platform (data.dubai) — prices and leases stay current, not a one-off stale import.')}</p></Tile></Reveal>
          <Reveal delay={0.12}><Tile className="h-full"><TileHead icon={<ShieldCheck />} title={L('逐笔可溯源', 'Traceable, deal by deal')} /><p className="text-sm text-slate-400">{L('每个区的成交按日期、面积、楼栋逐笔列出;Luna 回答时每个数字都标注来源 —— 无数据就说没有,从不编造。', 'Each district\'s deals are listed by date, size and tower; Luna sources every figure it quotes — and says so when data is missing.')}</p></Tile></Reveal>
        </div>
      </Section>

      {/* ═══ FOR BUYERS — bento ════════════════════════════════ */}
      <Section id="buyers">
        <Reveal><Label tone={ACCENT}>// {L('给买家 / 投资人', 'FOR BUYERS / INVESTORS')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{L('在一张地图上看懂迪拜值不值得买', 'Understand what\'s worth buying — on one map')}</h2></Reveal>

        <div className="mt-8 grid auto-rows-[150px] grid-cols-2 gap-3 md:grid-cols-4">
          {/* big: latest sales & rents */}
          <Reveal className="col-span-2 row-span-2" delay={0}>
            <Tile className="h-full overflow-hidden">
              <TileHead icon={<TrendingUp />} title={L('最新成交 & 区域指标', 'Real sales & area metrics')} />
              <p className="text-sm text-slate-400">{L('每个区直接看 DLD 真实成交、租约与回报 — 不是估算。', 'Real DLD sales, rents and returns per district — not estimates.')}</p>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                <img src={zh ? '/about-area.jpg' : '/about-area-en.jpg'} alt={L('迪拜码头区域详情:真实成交与指标', 'Area detail: real transactions and metrics')} className="block w-full" loading="lazy" />
              </div>
            </Tile>
          </Reveal>
          <Reveal className="col-span-2" delay={0.05}>
            <Tile className="h-full"><TileHead icon={<Database />} title={L('区域指标', 'Area metrics')} />
              <div className="flex flex-wrap gap-1.5">{[L('中位房价', 'Median'), L('价/sqft', '$/sqft'), L('增长', 'Growth'), L('租金回报', 'Yield')].map((m, i) => (<span key={i} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{m}</span>))}</div>
            </Tile>
          </Reveal>
          <Reveal delay={0.1}><Tile className="h-full"><TileHead icon={<Layers />} title={L('筛选 & 图层', 'Filters & layers')} /><p className="text-xs text-slate-400">{L('价格/卧室/状态;交通·医院·学校·超市', 'Price/beds/status; transit, hospital, school, supermarket')}</p></Tile></Reveal>
          <Reveal delay={0.13}><Tile className="h-full"><TileHead icon={<Ruler />} title={L('测距 & 3D', 'Measure & 3D')} /><p className="text-xs text-slate-400">{L('到地铁/海滩/机场;3D + 地标', 'To metro/beach/airport; 3D + landmarks')}</p></Tile></Reveal>
        </div>

        {/* investment stat strip */}
        <Reveal delay={0.05} className="mt-3">
          <Tile className="flex flex-col gap-5 md:flex-row md:items-center">
            <div className="md:flex-1">
              <TileHead icon={<KeyRound />} title={L('投资分析 + 投资信心', 'Investment + confidence')} />
              <p className="text-sm text-slate-400">{L('5 年回报、回本年限全部标注真实数据来源;黄金签证、永久产权、零税一目了然。', '5-year ROI & payback from real data, sourced; Golden Visa, freehold, zero tax — clear.')}</p>
            </div>
            <div className="grid grid-cols-4 gap-3 md:w-1/2">
              {[{ k: L('租金回报', 'Yield'), v: '6–8%' }, { k: L('房产税', 'Tax'), v: '0%' }, { k: L('回本', 'Payback'), v: '~12y' }, { k: L('黄金签证', 'Visa'), v: '2M+' }].map((m, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center"><div className="text-lg font-bold" style={{ color: ACCENT }}>{m.v}</div><div className="mt-0.5 text-[10px] text-slate-500">{m.k}</div></div>
              ))}
            </div>
          </Tile>
        </Reveal>
      </Section>

      {/* ═══ FOR AGENTS & DEVELOPERS ═══════════════════════════ */}
      <Section id="agents" glow>
        <Reveal><Label tone={GOLD}>// {L('给经纪 / 开发商', 'FOR AGENTS / DEVELOPERS')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{L('把地图变成成交工具', 'Turn the map into a closing tool')}</h2></Reveal>

        <Reveal delay={0.05} className="mt-8"><SubHead icon={<Sparkles className="h-4 w-4" />}>{L('开发商 · AI 楼书解析', 'Developers · AI brochure parsing')}</SubHead></Reveal>
        <Reveal delay={0.1}><Pipeline steps={[{ icon: <Upload className="h-5 w-5" />, t: L('上传开发商 PDF', 'Upload developer PDF') }, { icon: <Sparkles className="h-5 w-5" />, t: L('AI 提取户型/价格/付款/配套', 'AI extracts units / prices / plans / amenities') }, { icon: <Building2 className="h-5 w-5" />, t: L('结构化房源上线地图', 'Structured listing on the map') }]} /></Reveal>

        <Reveal delay={0.05} className="mt-12"><SubHead icon={<Radio className="h-4 w-4" />}>{L('经纪 · 招牌:实时海外带看', 'Agents · flagship: live overseas tours')}</SubHead></Reveal>
        <Reveal delay={0.1}><CoPresenceDiagram L={L} /></Reveal>

        {/* 带看中的工具:画图标注 · 双向语音 · 详情同步 —— 像坐在客户身边一样讲盘 */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Reveal delay={0.05}>
            <Tile className="h-full"><TileHead icon={<PenTool />} title={L('地图上直接画', 'Draw right on the map')} />
              <p className="text-sm text-slate-400">{L('圈小区、画箭头、标文字、落图钉 —— 你在地图上画的每一笔,客户手机上同步出现,像面对面拿笔讲盘。', 'Circle a community, draw arrows, drop pins and notes — every stroke appears live on the client\'s phone, like explaining with a pen in hand.')}</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.1}>
            <Tile className="h-full"><TileHead icon={<PhoneCall />} title={L('应用内语音通话', 'In-app voice call')} />
              <p className="text-sm text-slate-400">{L('带看时直接开口讲,无需微信来回切换;客户在手机浏览器里就能听、能说。', 'Talk while you tour — no juggling WeChat calls; clients listen and speak right in their mobile browser.')}</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.15}>
            <Tile className="h-full"><TileHead icon={<MousePointer2 />} title={L('项目详情同步翻页', 'Detail pages, in sync')} />
              <p className="text-sm text-slate-400">{L('你点开哪个项目、翻到哪张户型图,客户屏幕同步跟随;客户也可以随时脱离自己看,再一键跟回。', 'Open a project or flip a floor plan — the client\'s screen follows; they can break off to explore and rejoin anytime.')}</p>
            </Tile>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-2">
          <Reveal><Tile><TileHead icon={<MapIcon />} title={L('Build Your Own Tour · 自建导览', 'Build Your Own Tour')} /><p className="text-sm text-slate-400">{L('经纪自己设计专属看房路线:挑项目、排顺序、配语音讲解与 5 年回报,一键生成可分享的自助导览;客户看了什么、问了什么自动回传。', 'Agents design their own tour: pick projects, set the order, add voice narration & 5-year ROI, then share a self-serve tour — every view and question flows back.')}</p></Tile></Reveal>
          <Reveal delay={0.08}><Tile><TileHead icon={<FileText />} title={L('买家意向报告', 'Buyer-intent reports')} /><p className="text-sm text-slate-400">{L('每次带看后自动生成:看了什么、问了什么,AI 判定意向 + 跟进话术。', 'Auto report per tour: viewed / asked, AI interest level + follow-up.')}</p></Tile></Reveal>
        </div>

        <Reveal delay={0.1} className="mt-3">
          <Tile className="relative overflow-hidden">
            <Glow className="-right-10 -top-10 h-48 w-48" opacity={0.16} />
            <div className="relative grid items-center gap-5 md:grid-cols-[auto,1fr]">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,224,184,0.14)' }}><Mic className="h-8 w-8" style={{ color: ACCENT }} /></div>
              <div>
                <h3 className="text-xl font-bold">{L('Luna — 会查数据的语音助手', 'Luna — a voice assistant that knows the data')}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{L('用说的就行:"这区 5 年回报多少?到地铁多远?" 现场查真实 DLD 数据作答,并在地图上飞过去/高亮/画距离 — 每个数字带来源。', 'Just ask: "5-year return here? How far to metro?" Answers from real DLD data, drives the map — every figure sourced.')}</p>
                <div className="mt-3 inline-flex items-center gap-2 text-sm" style={{ color: ACCENT }}><ShieldCheck className="h-4 w-4" /> {L('反编造:无数据就说没有', 'No hallucination — says so if data is missing')}</div>
              </div>
            </div>
          </Tile>
        </Reveal>
      </Section>

      {/* ═══ PRICING — 四档速览;完整额度与结账在 /pricing ═══ */}
      <Section id="pricing">
        <Reveal><Label tone={ACCENT}>// {L('定价', 'PRICING')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{L('买家免费,经纪按量选档', 'Free for buyers. Plans for agents.')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{L(
            '买家与投资人永久免费使用地图、真实 DLD 数据与 Luna 助手;经纪 $25/月起,7 天免费试用,按月或按年付(年付送 2 个月),随时取消。',
            'Buyers and investors use the map, real DLD data and Luna for free; agents from $25/mo with a 7-day free trial, billed monthly or yearly (2 months free), cancel anytime.'
          )}</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              n: L('买家 / 投资人', 'Buyers'), p: L('免费', 'Free'), per: '', c: ACCENT,
              fs: [L('地图与市场数据不限时', 'Unlimited map & data'), L('收藏 · Luna 智能助手', 'Favorites · Luna AI'), L('5 年回报与黄金签证分析', '5-yr ROI & Golden Visa')],
            },
            {
              n: L('启程版 Starter', 'Starter'), p: '$25', per: L('/月', '/mo'), c: ACCENT,
              fs: [L('全部买家功能 + 客户 CRM', 'Everything free + client CRM'), L('意向报告 + AI 楼书解析', 'Intent reports + AI brochures'), L('买家线索(尽力推送)', 'Buyer leads (best effort)')],
            },
            {
              n: L('专业版 Pro', 'Pro'), p: '$99', per: L('/月', '/mo'), c: ACCENT, hot: true,
              fs: [L('实时带看 + 画图 + 语音', 'Live tours + drawing + voice'), L('Luna 智能导览', 'Luna AI tours'), L('线索优先推送 + 行为洞察', 'Priority leads + insights')],
            },
            {
              n: L('创始会员 Founder', 'Founder'), p: '$699', per: L('/月', '/mo'), c: GOLD,
              fs: [L('含 3 席共享积分池', '3 seats, shared pool'), L('White-label 品牌定制', 'White-label branding'), L('线索独占优先 · 优先支持', 'First pick of leads')],
            },
          ].map((tier, i) => (
            <Reveal key={i} delay={i * 0.05}>
              <div className="relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-5"
                style={{ borderColor: tier.hot ? ACCENT : tier.c === GOLD ? `${GOLD}66` : 'rgba(255,255,255,0.1)', boxShadow: tier.hot ? `0 0 34px -14px ${ACCENT}` : undefined }}>
                {tier.hot && <span className="absolute -top-2.5 left-5 rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-900" style={{ background: ACCENT }}>{L('最受欢迎', 'Most popular')}</span>}
                <div className="text-sm font-semibold" style={{ color: tier.c }}>{tier.n}</div>
                <div className="mt-1 flex items-end gap-1">
                  <span className="text-2xl font-bold">{tier.p}</span>
                  {tier.per && <span className="pb-0.5 text-xs text-slate-500">{tier.per}</span>}
                </div>
                <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-slate-300">
                  {tier.fs.map((f, j) => (
                    <li key={j} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: tier.c }} /> {f}</li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.14} className="mt-7 flex flex-wrap items-center gap-4">
          <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>
            {L('查看完整定价并开始试用', 'Full pricing & start free trial')} <ArrowRight className="h-4 w-4" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users className="h-3.5 w-3.5" /> {L('经纪档均含 7 天免费试用,试用期取消零费用', 'All agent plans include a 7-day free trial')}</span>
        </Reveal>
      </Section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/10 py-20">
        <Glow className="left-1/2 top-0 h-64 w-[40rem] -translate-x-1/2" opacity={0.16} />
        <Reveal className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold md:text-4xl">{L('准备好了吗?', 'Ready to explore?')}</h2>
          <p className="mt-3 text-slate-400">{L('打开地图,或以经纪身份登录开始带看。', 'Open the map, or sign in as an agent to start tours.')}</p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>{L('打开地图探索', 'Open the map')} <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/agent" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">{L('经纪台', 'Agent console')}</Link>
          </div>
        </Reveal>
      </section>
    </div>
  )
}

// ── building blocks ─────────────────────────────────────────
function Section({ id, glow, children }: { id?: string; glow?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className="relative scroll-mt-14 py-16">
      {glow && <Glow className="right-0 top-1/4 h-72 w-72" opacity={0.08} />}
      <div className="relative mx-auto max-w-6xl px-6">{children}</div>
    </section>
  )
}

function Label({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className="font-mono text-xs font-semibold tracking-widest" style={{ color: tone }}>{children}</span>
}

function SubHead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-slate-200"><span style={{ color: ACCENT }}>{icon}</span>{children}</div>
}

function Tile({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-white/20 hover:bg-white/[0.05] ${className}`}>{children}</div>
}

function TileHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-1 flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: 'rgba(0,224,184,0.12)', color: ACCENT }}>{icon}</span>
      <h3 className="font-semibold text-white">{title}</h3>
    </div>
  )
}

function Pipeline({ steps }: { steps: { icon: React.ReactNode; t: string }[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
      {steps.map((s, i) => (
        <div key={i} className="contents">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:flex-col md:text-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.14)', color: ACCENT }}>{s.icon}</span>
            <span className="text-sm font-medium text-slate-200">{s.t}</span>
          </div>
          {i < steps.length - 1 && <ArrowRight className="mx-auto hidden h-5 w-5 md:block" style={{ color: ACCENT }} />}
        </div>
      ))}
    </div>
  )
}

function CoPresenceDiagram({ L }: { L: (cn: string, en: string) => string }) {
  const Node = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) => (
    <div className="rounded-2xl border p-5 text-center" style={{ borderColor: accent ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', background: accent ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)' }}>
      <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.14)', color: ACCENT }}>{icon}</div>
      <div className="text-sm font-bold text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  )
  const Arrow = ({ label }: { label: string }) => (
    <div className="flex flex-col items-center justify-center px-1 md:px-2"><ArrowRight className="h-5 w-5" style={{ color: ACCENT }} /><span className="font-mono text-[10px] text-slate-500">{label}</span></div>
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
