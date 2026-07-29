/**
 * /changelog —— 更新历史 + 功能建议（同一页）。
 *
 * 两件事放一页是有意的：上半页是「我们改了什么」，下半页是「你要我们改什么」。
 * 分成两页就断了回路 —— 提建议的人看不到东西真的上线，提一次就不会再提。
 *
 * 视觉/交互决定（都来自 owner 的实际反馈）：
 *   · hero 里一次把三个出口给全（提建议 / 打开地图 / 了解 Pinzos），页面**底部不再重复**
 *   · 提建议走**弹窗**，不用滚到页尾；没登录也能点开，弹窗里再说要登录
 *   · 桌面用左侧「书脊」目录（一直在，读到哪线亮到哪）；手机才用滚动后贴顶的细条 —— 一个断点一个导航，别打架
 *   · 文案只陈述事实，不自夸（「每周都在改」那种话删掉了）
 *   · 动效走 CSS + IntersectionObserver 的入场揭示。**不用 Remotion** —— 那是渲染
 *     视频的，跑不进网页运行时；这里要的是轻量、不掉帧。
 *
 * 内容手写在 data/changelog.ts —— **绝不从 git commit 自动生成**（原因见那个文件）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  Sparkles, Wrench, Bug, ArrowRight, Lightbulb, Loader2, Check, Send,
  ChevronUp, MessageSquare, Search as SearchIcon, ChevronDown, X,
} from 'lucide-react'
import { CHANGELOG, pickLang, type ChangeKind } from '../data/changelog'
import { useUnseenChangelog } from '../hooks/useUnseenChangelog'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchFeatureRequests, submitFeatureRequest, toggleVote, fetchThread, postReply, updateRequest,
  type FeatureRequest, type RequestStatus, type RequestComment,
} from '../lib/featureRequestApi'

const ACCENT = '#00E0B8'
const GOLD = '#E8C37E'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)'
const REQ_ID = 'requests'

const KIND: Record<ChangeKind, { icon: React.ReactNode; dot: string; chip: string; key: string }> = {
  new: { icon: <Sparkles className="h-3.5 w-3.5" />, dot: '#00E0B8', chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.kindNew' },
  improve: { icon: <Wrench className="h-3.5 w-3.5" />, dot: '#38BDF8', chip: 'bg-sky-50 text-sky-700 ring-sky-100', key: 'misc:changelog.kindImprove' },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, dot: '#FBBF24', chip: 'bg-amber-50 text-amber-700 ring-amber-100', key: 'misc:changelog.kindFix' },
}

const STATUS: Record<RequestStatus, { chip: string; key: string }> = {
  shipped: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', key: 'misc:changelog.fShipped' },
  planned: { chip: 'bg-sky-50 text-sky-700 ring-sky-100', key: 'misc:changelog.fPlanned' },
  open: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', key: 'misc:changelog.fOpen' },
  // 「暂不做」也照常显示 —— 悄悄让它消失比明说更伤人，提议的人会觉得石沉大海
  declined: { chip: 'bg-slate-50 text-slate-400 ring-slate-100', key: 'misc:changelog.fDeclined' },
}

/** 角色标记：**群体属性，不是身份**。指认不到具体的人，但能看出诉求来自哪一侧。 */
const ROLE: Record<string, { chip: string; key: string }> = {
  agent: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.roleAgent' },
  agency: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.roleAgency' },
  developer: { chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', key: 'misc:changelog.roleDeveloper' },
  buyer: { chip: 'bg-sky-50 text-sky-600 ring-sky-100', key: 'misc:changelog.roleBuyer' },
}

/** Intl 用完整 BCP-47；数据字段(zh/en/fr/ru/ar)用 pickLang。两件事，别混。 */
const INTL_LOCALE = { zh: 'zh-CN', en: 'en-GB', fr: 'fr-FR', ru: 'ru-RU', ar: 'ar-AE' } as const

/** 页面里到处要 t()，统一从这里拿（带宽松签名，免得每处都写 as）。 */
function useT() {
  const { t: raw, i18n } = useTranslation('misc')
  return {
    t: raw as (k: string, o?: Record<string, unknown>) => string,
    i18n,
    lang: pickLang(i18n.language),
    locale: INTL_LOCALE[pickLang(i18n.language)],
  }
}

function RoleTag({ role }: { role: string | null }) {
  const { t } = useT()
  const r = role && ROLE[role]
  if (!r) return null
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${r.chip}`}>
      {t(r.key)}
    </span>
  )
}

/**
 * 入场揭示：IntersectionObserver 打一个 class，动画本身是 GPU 合成的 CSS 过渡。
 * 没有 per-element 的 JS 动画循环，滚动不掉帧（和 /about 的 Reveal 同一套）。
 */
function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect() } },
      { rootMargin: '0px 0px -40px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref}
      className={`${className} motion-safe:transition-[opacity,transform] motion-safe:duration-500 motion-safe:ease-out ${on ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
      style={{ transitionDelay: on ? `${delay}s` : '0s' }}>
      {children}
    </div>
  )
}

/** 数字滚上去 —— 一个小动效，但它讲的是「这里有多少东西」，不是装饰。 */
function CountUp({ to, className, style }: { to: number; className?: string; style?: React.CSSProperties }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    // prefers-reduced-motion 直接给终值：动效是锦上添花，不能变成无障碍负担
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(to); return }
    let raf = 0
    const t0 = performance.now()
    const dur = 900
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))))   // easeOutCubic
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  // translate="no":浏览器自带翻译会把数字/日期一起「翻译」掉(实测中文页被 Chrome
  // 译成英文后,「1月13日」变成「1 month 13 months」)。数字不需要翻译。
  return <span translate="no" className={className} style={style}>{n}</span>
}

/**
 * 「书脊」目录 —— 一根竖线，每个月一个刻度，读到哪里线就亮到哪里。
 *
 * 为什么不是普通的一列按钮：这是**日记**，目录本身就该像书脊/胶片边缘，
 * 而不是设置面板里的一排选项。功能上完全等价（点了跳过去），只是它顺手把
 * 「你读到哪儿了」也画了出来 —— 一个普通列表做不到的事。
 *
 * 动效都交给 framer-motion 的 `layoutId`：高亮块在两个月份之间**滑过去**，
 * 不是闪一下。滑动的那 200ms 正是让人看懂「我从这里到了那里」的东西。
 */
function SpineNav({ items, active, onJump }: {
  items: { key: string; label: string; count: number | null }[]
  active: string
  onJump: (k: string) => void
}) {
  const idx = Math.max(0, items.findIndex((i) => i.key === active))
  // 进度：读到第几个刻度（最后一项是功能建议，算满）
  const pct = items.length > 1 ? (idx / (items.length - 1)) * 100 : 0

  return (
    <ul className="relative ps-1">
      {/* 书脊本体：整根淡线 + 一段随进度生长的亮线 */}
      <span aria-hidden className="absolute bottom-2 start-[7px] top-2 w-px bg-slate-200/80" />
      <motion.span
        aria-hidden
        className="absolute start-[7px] top-2 w-px origin-top"
        style={{ background: ACCENT }}
        initial={false}
        animate={{ height: `calc(${pct}% - 0px)` }}
        transition={{ type: 'spring', stiffness: 260, damping: 32 }}
      />

      {items.map((n) => {
        const on = active === n.key
        return (
          <li key={n.key} className="relative">
            <button
              type="button"
              onClick={() => onJump(n.key)}
              className="group flex w-full items-center gap-3 py-1.5 text-start"
            >
              {/* 刻度：当前那个变成实心大点 + 光晕 */}
              <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {on && (
                  <motion.span
                    layoutId="spine-halo"
                    className="absolute inset-0 rounded-full"
                    style={{ background: `${ACCENT}33` }}
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                )}
                <span
                  className={`rounded-full ring-2 ring-white transition-all duration-200 ${
                    on ? 'h-2 w-2' : 'h-1.5 w-1.5 group-hover:h-2 group-hover:w-2'
                  }`}
                  style={{ background: on ? ACCENT : '#CBD5E1' }}
                />
              </span>

              <span
                translate="no"
                className={`min-w-0 flex-1 truncate text-[13px] transition-all duration-200 ${
                  on ? 'font-semibold text-slate-900' : 'text-slate-400 group-hover:translate-x-0.5 group-hover:text-slate-700'
                }`}
              >
                {n.label}
              </span>

              {n.count != null && (
                <span
                  translate="no"
                  className={`shrink-0 text-[11px] tabular-nums transition-colors ${on ? 'text-slate-500' : 'text-slate-300'}`}
                >
                  {n.count}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default function ChangelogPage() {
  const { t, lang, locale } = useT()
  const { markSeen } = useUnseenChangelog()
  useEffect(() => { markSeen() }, [markSeen])

  const title = t('misc:changelog.title')
  const [composeOpen, setComposeOpen] = useState(false)

  const months = useMemo(() => {
    const out: { key: string; label: string; items: typeof CHANGELOG }[] = []
    for (const e of CHANGELOG) {
      const key = e.date.slice(0, 7)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(e)
      else {
        out.push({
          key,
          // 月份标题交给 Intl —— 五种语言各自的写法它都知道，不用我们拼字符串
          label: new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
          items: [e],
        })
      }
    }
    return out
  }, [locale])

  const [active, setActive] = useState<string>(months[0]?.key || '')
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const els = Array.from(contentRef.current?.querySelectorAll('[data-sec]') || [])
    if (!els.length) return
    const io = new IntersectionObserver(
      (ents) => {
        // 取当前**最靠上**的可见区块，比「最后一个 intersecting」稳定得多
        const vis = ents.filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive((vis[0].target as HTMLElement).dataset.sec || '')
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [months.length])

  // hero 滚出视野 → 顶部贴一条细导航条（owner：「往下 scroll 时可以 attach 小一点在上面」）
  const heroRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = heroRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' })

  const navItems = [
    ...months.map((m) => ({ key: m.key, label: m.label, count: m.items.length as number | null })),
    { key: REQ_ID, label: t('misc:changelog.requestsNav'), count: null },
  ]
  const jump = (key: string) => document.querySelector(`[data-sec="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const kindCount = (k: ChangeKind) => CHANGELOG.filter((e) => e.kind === k).length

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={t('misc:changelog.metaDesc')} />
        <link rel="canonical" href="https://www.pinzos.com/changelog" />
      </Helmet>

      {composeOpen && <ComposeModal onClose={() => setComposeOpen(false)} />}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative overflow-hidden bg-[#070b16] text-white"
        style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}
      >
        <div aria-hidden className="pointer-events-none absolute -end-24 -top-32 h-[30rem] w-[30rem] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENT}30 0%, transparent 70%)` }} />
        <div aria-hidden className="pointer-events-none absolute -start-28 bottom-[-8rem] h-80 w-80 rounded-full"
          style={{ background: `radial-gradient(circle, ${GOLD}1f 0%, transparent 70%)` }} />

        <div className="relative mx-auto max-w-5xl px-5 py-14 sm:px-6 md:py-20">
          <Reveal>
            {/* 只陈述事实:最近一次更新是什么时候。不写「我们每周都在改」那种自夸。 */}
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] tracking-wide" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              <span>{t('misc:changelog.lastUpdate')} <span translate="no">{fmtDate(CHANGELOG[0]?.date || '')}</span></span>
            </span>

            <h1 className="mt-5 text-4xl font-bold leading-[1.1] md:text-5xl">{title}</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-400">
              {t('misc:changelog.tagline')}
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {[
                { n: CHANGELOG.length, l: t('misc:changelog.statUpdates'), c: '#fff' },
                { n: kindCount('new'), l: t('misc:changelog.statNew'), c: ACCENT },
                { n: kindCount('improve'), l: t('misc:changelog.statImproved'), c: '#7DD3FC' },
                { n: kindCount('fix'), l: t('misc:changelog.statFixed'), c: '#FCD34D' },
              ].map((s) => (
                <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 transition hover:border-white/20 hover:bg-white/[0.07]">
                  <CountUp to={s.n} className="block text-lg font-bold tabular-nums" style={{ color: s.c }} />
                  <div className="text-[11px] text-slate-400">{s.l}</div>
                </div>
              ))}
            </div>
          </Reveal>

          {/* 三个出口一次给全 —— 页面底部**不再重复**一遍(owner:「打开地图和了解 pinzos
              感觉都是多余，可以放在一开始那个 section」) */}
          <Reveal delay={0.14}>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <button type="button" onClick={() => setComposeOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
                style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}>
                <Lightbulb className="h-4 w-4" />
                {t('misc:changelog.requestCta')}
              </button>
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-300 transition hover:text-white">
                {t('misc:changelog.openMap')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
              <Link to="/about" className="text-sm text-slate-400 transition hover:text-slate-200">
                {t('misc:changelog.aboutPinzos')}
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 滚动后贴顶的细导航条 ── **只在手机/平板**。
             桌面有左边那根书脊(sticky,一直在),再来一条贴顶条就是两个导航打架 ——
             而且书脊被它盖掉后,只有滚动最初那 600px 能看见,等于白做。
             一个断点一个导航。 ─────────────────────────────────────────── */}
      <div className={`sticky top-0 z-30 border-b border-slate-100 bg-white/90 backdrop-blur transition-all duration-200 md:hidden ${
        stuck ? 'pointer-events-auto opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
      }`}>
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-5 py-2 sm:px-6">
          <span className="hidden shrink-0 items-center gap-1.5 text-[13px] font-semibold text-slate-800 sm:flex">
            <Sparkles className="h-3.5 w-3.5" style={{ color: ACCENT }} />{title}
          </span>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {/* 高亮块用 layoutId 在月份之间**滑过去**（手机上同一套）。
                滑动的那一下正是让人看懂「我从这里到了那里」的东西。 */}
            {navItems.map((n) => (
              <button key={n.key} type="button" onClick={() => jump(n.key)}
                className={`relative shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  active === n.key ? 'text-white' : 'text-slate-500 hover:text-slate-800'
                }`}>
                {active === n.key && (
                  <motion.span layoutId="topnav-pill" className="absolute inset-0 rounded-full bg-slate-900"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                )}
                <span translate="no" className="relative">{n.label}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setComposeOpen(true)}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-slate-900 transition hover:opacity-90"
            style={{ background: ACCENT }}>
            {t('misc:changelog.requestShort')}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 sm:px-6">
        <div className="flex gap-10 py-10 md:py-14">
          {/* 桌面：左侧「书脊」目录 —— 一直在，它就是这一页的导航 */}
          <nav className="hidden w-44 shrink-0 md:block">
            <div className="sticky top-24">
              <p className="mb-4 ps-7 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {t('misc:changelog.jumpTo')}
              </p>
              <SpineNav items={navItems} active={active} onJump={jump} />
            </div>
          </nav>

          <div ref={contentRef} className="min-w-0 flex-1">
            {months.map((m) => (
              <section key={m.key} data-sec={m.key} className="mb-12 scroll-mt-20">
                {/* 月份标题：当前这个月加一条短横线 + 变深，像日记里翻到的那一页 */}
                <h2 translate="no" className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                  <motion.span
                    aria-hidden
                    className="block h-px"
                    style={{ background: ACCENT }}
                    initial={false}
                    animate={{ width: active === m.key ? 20 : 0, opacity: active === m.key ? 1 : 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                  <span className={`transition-colors duration-300 ${active === m.key ? 'text-slate-800' : 'text-slate-400'}`}>
                    {m.label}
                  </span>
                </h2>

                {/* 时间线：竖线在**独立的 24px 栏**里，圆点在栏中间，卡片在右边。
                    以前用 border-s + 圆点负边距，圆点会骑在文字块左缘上。 */}
                <ul className="space-y-2">
                  {m.items.map((e, i) => {
                    const k = KIND[e.kind]
                    const last = i === m.items.length - 1
                    return (
                      <li key={`${e.date}-${i}`} className="flex gap-3">
                        {/* 刻度：当前正在读的这个月，圆点亮起来并微微放大 ——
                            和左边书脊上的那个刻度是同一件事，两头呼应。 */}
                        <div className="relative flex w-6 shrink-0 flex-col items-center">
                          <span
                            className={`mt-4 shrink-0 rounded-full ring-4 ring-white transition-all duration-300 ${
                              active === m.key ? 'h-2.5 w-2.5' : 'h-2 w-2'
                            }`}
                            style={{ background: k.dot, opacity: active === m.key ? 1 : 0.45 }}
                          />
                          {!last && <span className="mt-1 w-px flex-1 bg-slate-100" />}
                        </div>
                        <Reveal delay={Math.min(i, 6) * 0.03} className="min-w-0 flex-1">
                          <div className="rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-[0_2px_16px_-6px_rgba(15,23,42,0.15)]">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${k.chip}`}>
                                {k.icon}{t(k.key)}
                              </span>
                              {/* translate="no":浏览器翻译会把日期搅烂(「1月13日」→「1 month 13 months」) */}
                              <time translate="no" dateTime={e.date} className="text-[11px] tabular-nums text-slate-400">{fmtDate(e.date)}</time>
                            </div>
                            <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{e[lang]}</p>
                          </div>
                        </Reveal>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

            <FeatureRequests onCompose={() => setComposeOpen(true)} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 提建议弹窗 —— 没登录也能打开，弹窗里再说要登录
// ════════════════════════════════════════════════════════════════════════════

function ComposeModal({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const { user, signInWithGoogle } = useAuth()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const send = async () => {
    setErr(''); setBusy(true)
    try {
      await submitFeatureRequest(title.trim(), body.trim())
      setOk(true)
      setTimeout(onClose, 1400)
    } catch (e) {
      // 后端把「每天最多 5 条」「标题太短」写在 message 里 —— 原样显示，
      // 静默失败会让人以为提交成功了
      setErr(e instanceof Error ? e.message : t('misc:changelog.failed'))
    } finally { setBusy(false) }
  }

  // 铁律:fixed modal 必须 portal 到 body(否则被祖先的 transform/backdrop-filter 困住)
  return createPortal(
    <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl motion-safe:animate-[slideUp_.22s_ease-out] sm:rounded-3xl"
      >
        <style>{`@keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>

        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
              <Lightbulb className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{t('misc:changelog.requestCta')}</h3>
              <p className="text-xs text-slate-400">
                {t('misc:changelog.modalSub')}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {ok ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-slate-800">{t('misc:changelog.submitted')}</p>
              <p className="text-xs text-slate-400">{t('misc:changelog.submittedSub')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus
                placeholder={t('misc:changelog.phTitle')}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
              <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={4}
                placeholder={t('misc:changelog.phBody')}
                className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />

              {err && <p className="text-xs font-medium text-rose-600">{err}</p>}

              {/* 🔴 没登录**也能一路填到这里** —— 登录提示放在最后一步。
                  一上来就拿登录墙拦住,大多数人根本不会去登录,那条建议就永远没了。 */}
              {user ? (
                <button type="button" disabled={busy || title.trim().length < 4} onClick={send}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: ACCENT }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {t('misc:changelog.submit')}
                </button>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-100">
                  <p className="text-xs leading-relaxed text-slate-500">
                    {t('misc:changelog.needLogin')}
                  </p>
                  <button type="button" onClick={() => void signInWithGoogle()}
                    className="mt-2.5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                    {t('misc:changelog.signInSubmit')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 功能建议列表
// ════════════════════════════════════════════════════════════════════════════

type Filter = 'all' | RequestStatus
type Sort = 'top' | 'new'

function FeatureRequests({ onCompose }: { onCompose: () => void }) {
  const { t } = useT()
  const { user, isAdmin } = useAuth()
  const [list, setList] = useState<FeatureRequest[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('top')

  const reload = useCallback(() => { fetchFeatureRequests().then(setList) }, [])
  useEffect(() => { reload() }, [reload])

  const patch = (r: FeatureRequest) => setList((p) => (p || []).map((x) => (x.id === r.id ? r : x)))

  const shown = useMemo(() => {
    if (!list) return []
    const kw = q.trim().toLowerCase()
    const hit = list.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false
      if (kw && !`${r.title} ${r.body || ''}`.toLowerCase().includes(kw)) return false
      return true
    })
    // 服务端已按「已上线 > 计划中 > 待评估 > 暂不做」再按票数排好；
    // 只在用户明确选「最新」时才重排，别把默认顺序也搅了。
    return sort === 'new' ? [...hit].sort((a, b) => b.created_at.localeCompare(a.created_at)) : hit
  }, [list, q, filter, sort])

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: t('misc:changelog.fAll') },
    { id: 'open', label: t('misc:changelog.fOpen') },
    { id: 'planned', label: t('misc:changelog.fPlanned') },
    { id: 'shipped', label: t('misc:changelog.fShipped') },
    { id: 'declined', label: t('misc:changelog.fDeclined') },
  ]
  const countOf = (f: Filter) => (f === 'all' ? (list?.length || 0) : (list || []).filter((r) => r.status === f).length)

  return (
    <section data-sec={REQ_ID} className="scroll-mt-20 border-t border-slate-100 pt-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
            <Lightbulb className="h-5 w-5" />
          </span>
          <h2 className="text-xl font-bold text-slate-900">{t('misc:changelog.requestsTitle')}</h2>
        </div>
        <button type="button" onClick={onCompose}
          className="rounded-xl px-3.5 py-2 text-sm font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
          style={{ background: ACCENT }}>
          {t('misc:changelog.newRequest')}
        </button>
      </div>
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-slate-500">
        {t('misc:changelog.requestsIntro')}
      </p>

      {/* 搜索 + 筛选 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-60">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('misc:changelog.search')}
            className="w-full rounded-xl border border-slate-200 py-2 ps-9 pe-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
        </div>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              filter === f.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100 hover:bg-slate-100'
            }`}>
            {f.label}<span translate="no" className="ms-1 opacity-50 tabular-nums">{countOf(f.id)}</span>
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
        <button type="button" onClick={() => setSort(sort === 'top' ? 'new' : 'top')}
          className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-100 transition hover:bg-slate-100">
          {t(sort === 'top' ? 'misc:changelog.sortTop' : 'misc:changelog.sortNew')}
        </button>
      </div>

      <div className="mt-5">
        {list === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : shown.length === 0 ? (
          <button type="button" onClick={onCompose}
            className="w-full rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400 transition hover:border-teal-300 hover:text-slate-600">
            {t(list.length === 0 ? 'misc:changelog.emptyNone' : 'misc:changelog.emptyFilter')}
          </button>
        ) : (
          <ul className="space-y-3">
            {shown.map((r, i) => (
              <Reveal key={r.id} delay={Math.min(i, 6) * 0.03}>
                <RequestCard r={r} user={!!user} isAdmin={!!isAdmin} onPatch={patch} onNeedLogin={onCompose} />
              </Reveal>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** 一条建议：票数 / 状态 / 角色 / 楼层 / admin 内联操作。 */
function RequestCard({ r, user, isAdmin, onPatch, onNeedLogin }: {
  r: FeatureRequest; user: boolean; isAdmin: boolean
  onPatch: (r: FeatureRequest) => void
  onNeedLogin: () => void
}) {
  const { t, locale } = useT()
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState<RequestComment[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const s = STATUS[r.status] || STATUS.open

  const loadThread = async () => {
    setOpen((v) => !v)
    if (thread === null) setThread(await fetchThread(r.id))
  }

  const vote = async () => {
    // 没登录**照样能点** —— 点了就告诉他要登录,而不是把按钮画成灰色让他猜
    if (!user) { onNeedLogin(); return }
    // 乐观更新：点赞要**立刻**有反馈，一个要等一圈网络才动的赞没人点第二次
    const before = { votes: r.votes, voted: r.voted }
    onPatch({ ...r, votes: r.votes + (r.voted ? -1 : 1), voted: !r.voted })
    try {
      onPatch({ ...r, ...(await toggleVote(r.id)) })
    } catch {
      onPatch({ ...r, ...before })   // 失败回滚，绝不留一个假的赞
    }
  }

  const reply = async () => {
    const body = draft.trim()
    if (body.length < 2) return
    setBusy(true)
    try {
      const c = await postReply(r.id, body)
      setThread((p) => [...(p || []), c])
      setDraft('')
      onPatch({ ...r, comments: r.comments + 1 })
    } catch { /* 失败保留草稿,让他能重试 */ } finally { setBusy(false) }
  }

  const setStatus = async (status: RequestStatus) => {
    try { onPatch(await updateRequest(r.id, { status })) } catch { /* 403 等 */ }
  }

  return (
    <li className="rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-[0_2px_16px_-6px_rgba(15,23,42,0.15)]">
      <div className="flex gap-3.5">
        <button type="button" onClick={vote}
          title={t(user ? 'misc:changelog.upvote' : 'misc:changelog.signInVote')}
          className={`flex h-14 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border transition active:scale-95 ${
            r.voted ? 'border-teal-200 bg-teal-50 text-teal-700'
                    : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
          }`}>
          <ChevronUp className="h-4 w-4" />
          <span translate="no" className="text-xs font-semibold tabular-nums">{r.votes}</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.chip}`}>
              {t(s.key)}
            </span>
            <RoleTag role={r.role} />
            <span translate="no" className="text-[11px] tabular-nums text-slate-400">
              {new Date(r.created_at).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </div>

          <p className="mt-1.5 text-[15px] font-medium leading-snug text-slate-800">{r.title}</p>
          {r.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{r.body}</p>}

          {r.reply && (
            <p className="mt-2.5 rounded-xl bg-teal-50/70 px-3 py-2 text-sm leading-relaxed text-teal-800 ring-1 ring-teal-100">
              <span className="font-semibold">Pinzos：</span>{r.reply}
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={loadThread}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition hover:text-slate-700">
              <MessageSquare className="h-3.5 w-3.5" />
              {r.comments > 0 ? `${r.comments} ${t('misc:changelog.replies')}` : t('misc:changelog.reply')}
              <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {/* admin：直接在这条上决定要不要纳入 */}
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-1">
                {(['open', 'planned', 'shipped', 'declined'] as RequestStatus[]).map((st) => (
                  <button key={st} type="button" onClick={() => setStatus(st)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
                      r.status === st ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-400 ring-1 ring-slate-100 hover:bg-slate-100'
                    }`}>
                    {t(STATUS[st].key)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {open && (
            <div className="mt-3 space-y-2.5 border-t border-slate-100 pt-3">
              {thread === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              ) : thread.length === 0 ? (
                <p className="text-xs text-slate-400">{t('misc:changelog.noReplies')}</p>
              ) : (
                thread.map((c, i) => (
                  <div key={c.id} className="flex gap-2.5">
                    <span translate="no" className="mt-0.5 w-7 shrink-0 text-end text-[11px] tabular-nums text-slate-300">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {c.is_staff ? (
                          <span className="inline-flex items-center rounded-full bg-slate-900 px-1.5 py-px text-[10px] font-medium text-white">Pinzos</span>
                        ) : (
                          <>
                            <span className="text-[11px] text-slate-400">{t('misc:changelog.anonymous')}</span>
                            <RoleTag role={c.role} />
                          </>
                        )}
                        <span translate="no" className="text-[10px] tabular-nums text-slate-300">
                          {new Date(c.created_at).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{c.body}</p>
                    </div>
                  </div>
                ))
              )}

              {user ? (
                <div className="flex items-start gap-2 pt-1">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={800}
                    placeholder={t(isAdmin ? 'misc:changelog.phReplyStaff' : 'misc:changelog.phReply')}
                    className="min-w-0 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
                  <button type="button" onClick={reply} disabled={busy || draft.trim().length < 2}
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-900 transition hover:opacity-90 disabled:opacity-40"
                    style={{ background: ACCENT }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onNeedLogin}
                  className="pt-1 text-xs text-teal-600 underline-offset-2 hover:underline">
                  {t('misc:changelog.signInReply')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
