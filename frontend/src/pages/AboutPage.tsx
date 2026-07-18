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
  PenTool, PhoneCall, MousePointer2, Check, Users, BadgeCheck,
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
  const { t: tRaw, i18n } = useTranslation('about')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = (i18n.language || 'en').startsWith('zh')

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Pinzos', url: 'https://www.pinzos.com', description: 'Interactive Dubai off-plan property platform with real DLD data, AI brochure parsing, investment analytics, and agent tools for overseas clients.', areaServed: 'Dubai, United Arab Emirates' },
      {
        '@type': 'SoftwareApplication', name: 'Pinzos', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: 'https://www.pinzos.com',
        description: 'Pinzos helps buyers and agents explore Dubai off-plan property: a satellite map with real DLD transactions/rents and area metrics, AI brochure parsing, 5-year ROI & Golden-Visa analysis, real-time co-presence map tours, AI-guided Luna tours, and buyer-intent reports.',
        offers: [
          { '@type': 'Offer', name: 'Buyers (Free)', price: '0', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Starter', price: '25', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Pro', price: '49', priceCurrency: 'USD' },
          { '@type': 'Offer', name: 'Agency', price: '699', priceCurrency: 'USD' },
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
        <title>{t('about:pinzosPinProjectsOn')}</title>
        <meta name="description" content={t('about:pinzosIsAnInteractive')} />
        <meta property="og:title" content="Pinzos — The New Way to Buy Dubai Off-Plan" />
        <meta property="og:description" content="Real DLD data on an interactive map, AI brochure parsing, investment analytics, and real-time co-presence tours for overseas clients." />
        {/* ⚠️ 规范域是 **www**(裸域在边缘 301 过来)。canonical 写裸域 = 让 Google
            顺着它撞上一次跳转,GSC 直接判「Page with redirect / 未索引」。 */}
        <link rel="canonical" href="https://www.pinzos.com/about" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <Glow className="-end-32 -top-32 h-[34rem] w-[34rem]" />
        <Glow className="-start-32 top-52 h-96 w-96" color={GOLD} opacity={0.1} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 md:py-24 lg:grid-cols-2">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] tracking-wide" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} /> {t('about:dubaiOffPlanReal')}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] md:text-5xl xl:text-6xl">
              {t('about:pinProjectsOnThe')}<br /><span style={{ color: ACCENT }}>{t('about:seeValueBeforeYou')}</span>
            </h1>
            {/* 英文 slogan(用户定):pin 双关品牌名 Pinzos;英文版 h1 本身就是 slogan,只在中文页加这行 */}
            {zh && (
              <p className="mt-4 font-mono text-[13px] font-semibold tracking-[0.14em] text-slate-300">
                PIN PROJECTS ON THE MAP<span style={{ color: ACCENT }}> · </span>SEE VALUE BEFORE YOU BUY
              </p>
            )}
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300/90">
              {t('about:oneInteractiveSatelliteMap')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>{t('about:openTheMap')} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></Link>
              <Link to="/pricing" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">{t('about:seePricing')}</Link>
            </div>
          </Reveal>
          <Reveal delay={0.12}>
            <div className="relative">
              <Glow className="-inset-6" opacity={0.22} />
              <div className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
                <div className="flex items-center gap-1.5 bg-white/[0.06] px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                  <span className="ms-2 truncate font-mono text-[11px] text-slate-400">pinzos.com</span>
                </div>
                <img src={zh ? '/about-map.jpg' : '/about-map-en.jpg'} alt={t('about:pinzosDubaiSatelliteMap')} className="block w-full" loading="eager" />
              </div>
            </div>
          </Reveal>
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pb-12">
          <Reveal delay={0.2}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[{ icon: <Database className="h-4 w-4" />, t: t('about:realDldData') }, { icon: <Sparkles className="h-4 w-4" />, t: t('about:aiParsingAssistant') }, { icon: <Languages className="h-4 w-4" />, t: t('about:cnEnAr') }, { icon: <Radio className="h-4 w-4" />, t: t('about:liveOverseasTours') }].map((s, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-300"><span style={{ color: ACCENT }}>{s.icon}</span> {s.t}</div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* sticky nav (solid dark, no blur for perf) */}
      <nav className="sticky top-0 z-20 border-y border-white/10 bg-[#070b16]/95">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2.5 text-sm">
          {([['buyers', t('about:forBuyers')], ['agents', t('about:forAgentsDevelopers')], ['pricing', t('about:pricing')]] as [string, string][]).map(([id, label]) => (
            <a key={id} href={`#${id}`} className="whitespace-nowrap rounded-full px-3 py-1.5 font-medium text-slate-400 transition hover:bg-white/10 hover:text-white">{label}</a>
          ))}
        </div>
      </nav>

      {/* ═══ SEE IT LIVE — Luna tour video ════════════════════ */}
      <Section glow>
        <Reveal><Label tone={ACCENT}>// {t('about:seeItLive')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t('about:thisIsWhatA')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{t('about:everyTourIsBuilt')}</p></Reveal>
        <Reveal delay={0.1} className="mt-8">
          <div className="relative mx-auto max-w-4xl">
            <Glow className="-inset-6" opacity={0.18} />
            <div className="relative overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
              <div className="flex items-center gap-1.5 bg-white/[0.06] px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                <span className="ms-2 truncate font-mono text-[11px] text-slate-400">pinzos.com</span>
              </div>
              <video key={zh ? 'zh' : 'en'} src={zh ? '/luna-tour-demo.mp4' : '/luna-tour-demo-en.mp4'} autoPlay muted loop playsInline preload="metadata" poster={zh ? '/about-map.jpg' : '/about-map-en.jpg'} className="block w-full" />
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.16} className="mt-6 text-center">
          <a href="/?toursession=demo" target="_blank" rel="noopener" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>
            {t('about:tryThisTourNo')} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </a>
          <p className="mt-2 text-xs text-slate-500">{t('about:opensARealLuna')}</p>
        </Reveal>
      </Section>

      {/* ═══ WHERE THE DATA COMES FROM — trust ════════════════ */}
      <Section>
        <Reveal><Label tone={ACCENT}>// {t('about:whereTheDataComes')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t('about:everyNumberComesFrom')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{t('about:noAgentAskingPrices')}</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <Reveal><Tile className="h-full"><TileHead icon={<Database />} title={t('about:dubaiLandDepartment')} /><p className="text-sm text-slate-400">{t('about:everySaleAndLease')}</p></Tile></Reveal>
          <Reveal delay={0.06}><Tile className="h-full"><TileHead icon={<Radio />} title={t('about:officialPlatformLiveSync')} /><p className="text-sm text-slate-400">{t('about:incrementallySyncedThroughDubai')}</p></Tile></Reveal>
          <Reveal delay={0.12}><Tile className="h-full"><TileHead icon={<ShieldCheck />} title={t('about:traceableDealByDeal')} /><p className="text-sm text-slate-400">{t('about:eachDistrictSDeals')}</p></Tile></Reveal>
        </div>
      </Section>

      {/* ═══ FOR BUYERS — bento ════════════════════════════════ */}
      <Section id="buyers">
        <Reveal><Label tone={ACCENT}>// {t('about:forBuyersInvestors')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t('about:understandWhatSWorth')}</h2></Reveal>

        <div className="mt-8 grid auto-rows-[150px] grid-cols-2 gap-3 md:grid-cols-4">
          {/* big: latest sales & rents */}
          <Reveal className="col-span-2 row-span-2" delay={0}>
            <Tile className="h-full overflow-hidden">
              <TileHead icon={<TrendingUp />} title={t('about:realSalesAreaMetrics')} />
              <p className="text-sm text-slate-400">{t('about:realDldSalesRents')}</p>
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                <img src={zh ? '/about-area.jpg' : '/about-area-en.jpg'} alt={t('about:areaDetailRealTransactions')} className="block w-full" loading="lazy" />
              </div>
            </Tile>
          </Reveal>
          <Reveal className="col-span-2" delay={0.05}>
            <Tile className="h-full"><TileHead icon={<Database />} title={t('about:areaMetrics')} />
              <div className="flex flex-wrap gap-1.5">{[t('about:median'), t('about:sqft'), t('about:growth'), t('about:yield')].map((m, i) => (<span key={i} className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{m}</span>))}</div>
            </Tile>
          </Reveal>
          <Reveal delay={0.1}><Tile className="h-full"><TileHead icon={<Layers />} title={t('about:filtersLayers')} /><p className="text-xs text-slate-400">{t('about:priceBedsStatusTransit')}</p></Tile></Reveal>
          <Reveal delay={0.13}><Tile className="h-full"><TileHead icon={<Ruler />} title={t('about:measure3d')} /><p className="text-xs text-slate-400">{t('about:toMetroBeachAirport')}</p></Tile></Reveal>
        </div>

        {/* investment stat strip */}
        <Reveal delay={0.05} className="mt-3">
          <Tile className="flex flex-col gap-5 md:flex-row md:items-center">
            <div className="md:flex-1">
              <TileHead icon={<KeyRound />} title={t('about:investmentConfidence')} />
              <p className="text-sm text-slate-400">{t('about:5YearRoiPayback')}</p>
            </div>
            <div className="grid grid-cols-4 gap-3 md:w-1/2">
              {[{ k: t('about:yield2'), v: '6–8%' }, { k: t('about:tax'), v: '0%' }, { k: t('about:payback'), v: '~12y' }, { k: t('about:visa'), v: '2M+' }].map((m, i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center"><div className="text-lg font-bold" style={{ color: ACCENT }}>{m.v}</div><div className="mt-0.5 text-[10px] text-slate-500">{m.k}</div></div>
              ))}
            </div>
          </Tile>
        </Reveal>
      </Section>

      {/* ═══ FOR AGENTS & DEVELOPERS ═══════════════════════════ */}
      <Section id="agents" glow>
        <Reveal><Label tone={GOLD}>// {t('about:forAgentsDevelopers2')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t('about:turnTheMapInto')}</h2></Reveal>

        <Reveal delay={0.05} className="mt-8"><SubHead icon={<Sparkles className="h-4 w-4" />}>{t('about:developersAiBrochureParsing')}</SubHead></Reveal>
        <Reveal delay={0.1}><Pipeline steps={[{ icon: <Upload className="h-5 w-5" />, t: t('about:uploadDeveloperPdf') }, { icon: <Sparkles className="h-5 w-5" />, t: t('about:aiExtractsUnitsPrices') }, { icon: <Building2 className="h-5 w-5" />, t: t('about:structuredListingOnThe') }]} /></Reveal>

        <Reveal delay={0.05} className="mt-12"><SubHead icon={<Radio className="h-4 w-4" />}>{t('about:agentsFlagshipLiveOverseas')}</SubHead></Reveal>
        <Reveal delay={0.1}><CoPresenceDiagram /></Reveal>

        {/* 带看中的工具:画图标注 · 双向语音 · 详情同步 —— 像坐在客户身边一样讲盘 */}
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Reveal delay={0.05}>
            <Tile className="h-full"><TileHead icon={<PenTool />} title={t('about:drawRightOnThe')} />
              <p className="text-sm text-slate-400">{t('about:circleACommunityDraw')}</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.1}>
            <Tile className="h-full"><TileHead icon={<PhoneCall />} title={t('about:inAppVoiceCall')} />
              <p className="text-sm text-slate-400">{t('about:talkWhileYouTour')}</p>
            </Tile>
          </Reveal>
          <Reveal delay={0.15}>
            <Tile className="h-full"><TileHead icon={<MousePointer2 />} title={t('about:detailPagesInSync')} />
              <p className="text-sm text-slate-400">{t('about:openAProjectOr')}</p>
            </Tile>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-3">
          <Reveal><Tile className="h-full"><TileHead icon={<MapIcon />} title={t('about:buildYourOwnTour')} /><p className="text-sm text-slate-400">{t('about:agentsDesignTheirOwn')}</p></Tile></Reveal>
          <Reveal delay={0.08}><Tile className="h-full"><TileHead icon={<FileText />} title={t('about:buyerIntentReports')} /><p className="text-sm text-slate-400">{t('about:autoReportPerTour')}</p></Tile></Reveal>
          <Reveal delay={0.16}><Tile className="h-full"><TileHead icon={<BadgeCheck />} title={t('about:salesOffers')} /><p className="text-sm text-slate-400">{t('about:pickAUnitSet')}</p></Tile></Reveal>
        </div>

        <Reveal delay={0.1} className="mt-3">
          <Tile className="relative overflow-hidden">
            <Glow className="-end-10 -top-10 h-48 w-48" opacity={0.16} />
            <div className="relative grid items-center gap-5 md:grid-cols-[auto,1fr]">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'rgba(0,224,184,0.14)' }}><Mic className="h-8 w-8" style={{ color: ACCENT }} /></div>
              <div>
                <h3 className="text-xl font-bold">{t('about:lunaAVoiceAssistant')}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{t('about:justAsk5Year')}</p>
                <div className="mt-3 inline-flex items-center gap-2 text-sm" style={{ color: ACCENT }}><ShieldCheck className="h-4 w-4" /> {t('about:noHallucinationSaysSo')}</div>
              </div>
            </div>
          </Tile>
        </Reveal>
      </Section>

      {/* ═══ PRICING — 四档速览;完整额度与结账在 /pricing ═══ */}
      <Section id="pricing">
        <Reveal><Label tone={ACCENT}>// {t('about:pricing2')}</Label>
          <h2 className="mt-3 text-3xl font-bold md:text-4xl">{t('about:freeForBuyersPlans')}</h2>
          <p className="mt-3 max-w-2xl text-slate-400">{t('about:buyersAndInvestorsUse')}</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              n: t('about:starter'), p: '$25', per: t('about:mo'), c: ACCENT,
              fs: [t('about:everythingFreeClientCrm'), t('about:salesOffersAiBrochures'), t('about:buyerLeadsBestEffort')],
            },
            {
              n: t('about:pro'), p: '$49', per: t('about:mo2'), c: ACCENT, hot: true,
              fs: [t('about:liveToursDrawingVoice'), t('about:lunaAiTours'), t('about:priorityLeadsInsights')],
            },
            {
              n: t('about:agency'), p: '$699', per: t('about:mo3'), c: GOLD,
              fs: [t('about:3SeatsSharedPool'), t('about:whiteLabelBranding'), t('about:firstPickOfLeads')],
            },
            {
              n: t('about:developer'), p: '$999', per: t('about:mo4'), c: GOLD,
              fs: [t('about:uploadBrochuresAiLists'), t('about:sitewideExposureLunaRecommends'), t('about:5Seats20kShared')],
            },
          ].map((tier, i) => (
            <Reveal key={i} delay={i * 0.05}>
              <div className="relative flex h-full flex-col rounded-2xl border bg-white/[0.03] p-5"
                style={{ borderColor: tier.hot ? ACCENT : tier.c === GOLD ? `${GOLD}66` : 'rgba(255,255,255,0.1)', boxShadow: tier.hot ? `0 0 34px -14px ${ACCENT}` : undefined }}>
                {tier.hot && <span className="absolute -top-2.5 start-5 rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-900" style={{ background: ACCENT }}>{t('about:mostPopular')}</span>}
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
            {t('about:fullPricingStartFree')} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Users className="h-3.5 w-3.5" /> {t('about:allAgentPlansInclude')}</span>
        </Reveal>
      </Section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/10 py-20">
        <Glow className="left-1/2 top-0 h-64 w-[40rem] -translate-x-1/2" opacity={0.16} />
        <Reveal className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold md:text-4xl">{t('about:readyToExplore')}</h2>
          <p className="mt-3 text-slate-400">{t('about:openTheMapOr')}</p>
          <div className="mt-7 flex justify-center gap-3">
            <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>{t('about:openTheMap2')} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></Link>
            <Link to="/agent" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">{t('about:agentConsole')}</Link>
          </div>
          {/* legal footer — Google OAuth verification requires reachable policy links */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>© {new Date().getFullYear()} Pinzos</span>
            <Link to="/privacy" className="transition hover:text-slate-300">{t('about:privacyPolicy')}</Link>
            <Link to="/terms" className="transition hover:text-slate-300">{t('about:termsOfService')}</Link>
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
      {glow && <Glow className="end-0 top-1/4 h-72 w-72" opacity={0.08} />}
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
          {i < steps.length - 1 && <ArrowRight className="mx-auto hidden h-5 w-5 md:block rtl:-scale-x-100" style={{ color: ACCENT }} />}
        </div>
      ))}
    </div>
  )
}

function CoPresenceDiagram() {
  const { t: tRaw } = useTranslation('about')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const Node = ({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) => (
    <div className="rounded-2xl border p-5 text-center" style={{ borderColor: accent ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', background: accent ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)' }}>
      <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.14)', color: ACCENT }}>{icon}</div>
      <div className="text-sm font-bold text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{sub}</div>
    </div>
  )
  const Arrow = ({ label }: { label: string }) => (
    <div className="flex flex-col items-center justify-center px-1 md:px-2"><ArrowRight className="h-5 w-5 rtl:-scale-x-100" style={{ color: ACCENT }} /><span className="font-mono text-[10px] text-slate-500">{label}</span></div>
  )
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
      <Node accent icon={<Radio className="h-5 w-5" />} title={t('about:agent')} sub={t('about:pansOpensAsksLuna')} />
      <Arrow label={t('about:cameraJson')} />
      <Node icon={<Database className="h-5 w-5" />} title={t('about:pinzosServer')} sub={t('about:fansOutMs')} />
      <Arrow label={t('about:localRender')} />
      <Node accent icon={<MapIcon className="h-5 w-5" />} title={t('about:clientPhoneWechat')} sub={t('about:smoothBreakOffVoice')} />
    </div>
  )
}
