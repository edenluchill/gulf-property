/**
 * /changelog —— 更新历史 + 功能建议（同一页）。
 *
 * 两件事放一页是有意的：日记是「我们改了什么」，建议是「你要我们改什么」。
 * 分成两页就断了回路 —— 提建议的人看不到东西真的上线，提一次就不会再提。
 *
 * 🔴 但**建议不能只在页尾**：日记是我们想给的，建议是用户来这页要用的。
 * 把用户要用的东西埋在 54 条日记底下，等于让他为了提一句话先读半年更新，
 * 而且看不到别人提过没有 → 要么重复提，要么干脆不提。所以 hero 右侧常驻一张
 * 「大家在提什么」（最热 4 条 + 票数 + 状态 + 提建议），完整列表仍在页尾。
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sparkles, Wrench, Bug, ArrowRight, Lightbulb, Loader2, ChevronUp, Briefcase } from 'lucide-react'
import { CHANGELOG, type ChangeKind } from '../data/changelog'
import { useUnseenChangelog } from '../hooks/useUnseenChangelog'
import { useIsAgentSide } from '../hooks/useMyRole'
// 建议是**独立一页**（/requests）；这里只留一张 hero 入口卡，共用同一套标签定义
import { STATUS, ROLE, useT, ACCENT as REQ_ACCENT } from '../components/requests/shared'
import { fetchFeatureRequests, type FeatureRequest } from '../lib/featureRequestApi'

const ACCENT = REQ_ACCENT
const GOLD = '#E8C37E'

/** 经纪侧的三个视角(见页面里 `view` 的注释)。买家没有这个开关。 */
type DiaryView = 'agent' | 'shared' | 'both'
const VIEW_KEY = 'pz-changelog-view'
const GRID = 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)'

const KIND: Record<ChangeKind, { icon: React.ReactNode; dot: string; chip: string; key: string }> = {
  new: { icon: <Sparkles className="h-3.5 w-3.5" />, dot: '#00E0B8', chip: 'bg-teal-50 text-teal-700 ring-teal-100', key: 'misc:changelog.kindNew' },
  improve: { icon: <Wrench className="h-3.5 w-3.5" />, dot: '#38BDF8', chip: 'bg-sky-50 text-sky-700 ring-sky-100', key: 'misc:changelog.kindImprove' },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, dot: '#FBBF24', chip: 'bg-amber-50 text-amber-700 ring-amber-100', key: 'misc:changelog.kindFix' },
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

/**
 * hero 里的「大家在提什么」——一进页面就看得到别人提了什么。
 *
 * 只放**最热 4 条**:这是决定「要不要开口」用的,不是完整列表。
 * 每条给三件事:多少人附议(票数)、我们的处理状态、来自经纪还是买家。
 * 有人已经提过 → 他去点赞(更有用的信号);没人提过 → 他自己写一条。
 */
function HeroRequests({ list }: { list: FeatureRequest[] | null }) {
  const { t } = useT()
  /**
   * ⚠️ 这里**不能用服务端那个排序**。服务端给完整列表排的是「已上线 > 计划中 >
   * 待评估」—— 那是给来看进度的人的。而这张卡叫「大家在提什么」,要回答的是
   * 「现在最多人想要什么」:一个 0 票的「已上线」排在 7 票的前面,看起来就是坏的。
   * 这里按票数来。
   */
  const top = [...(list || [])]
    .sort((a, b) => b.votes - a.votes || b.created_at.localeCompare(a.created_at))
    .slice(0, 4)
  const empty = list !== null && top.length === 0

  return (
    <Reveal delay={0.1}>
      <div className={`rounded-2xl border p-4 transition ${
        empty ? 'border-teal-400/30 bg-teal-400/[0.06]' : 'border-white/10 bg-white/[0.04]'
      }`}>
        <div className="mb-3 flex items-center gap-2">
          <Lightbulb className={`h-4 w-4 ${empty ? 'text-teal-300' : 'text-amber-300'}`} />
          <h2 className="text-sm font-semibold text-white">{t('misc:changelog.heroReqTitle')}</h2>
        </div>

        {list === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-white/30" /></div>
        ) : top.length === 0 ? (
          /* 空态必须**看起来像个入口**。原来是「一行灰字 + 一个描边按钮」,
             在深色 hero 上几乎看不见 —— owner:「这里哪里显示入口了」。
             一条建议都没有的时候这张卡没东西可展示,那它的全部工作就是发出邀请:
             实心主按钮 + 一句直接的问句。 */
          <div className="py-1">
            <p className="text-[15px] font-semibold text-white">{t('misc:changelog.heroEmptyTitle')}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-400">{t('misc:changelog.heroEmpty')}</p>
            <Link to="/requests?new=1"
              className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
              style={{ background: ACCENT }}>
              <Lightbulb className="h-4 w-4" />
              {t('misc:changelog.heroEmptyCta')}
            </Link>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {top.map((r) => {
                const st = STATUS[r.status] || STATUS.open
                return (
                  <li key={r.id}>
                    <Link to={`/requests/${r.id}`}
                      className="flex w-full items-start gap-2.5 rounded-xl p-2 text-start transition hover:bg-white/[0.06]">
                      <span className="flex h-9 w-8 shrink-0 flex-col items-center justify-center rounded-lg bg-white/[0.06] text-white/70">
                        <ChevronUp className="h-3 w-3" />
                        <span translate="no" className="text-[11px] font-semibold tabular-nums">{r.votes}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block text-[13px] leading-snug text-slate-200">{r.title}</span>
                        <span className="mt-1 flex items-center gap-1.5">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium ${
                            r.status === 'shipped' ? 'bg-emerald-400/15 text-emerald-300'
                              : r.status === 'planned' ? 'bg-sky-400/15 text-sky-300'
                              : 'bg-white/10 text-slate-400'
                          }`}>
                            {t(st.key)}
                          </span>
                          {r.role && ROLE[r.role] && (
                            <span className="text-[10px] text-slate-500">{t(ROLE[r.role].key)}</span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
              <Link to="/requests?new=1"
                className="flex-1 rounded-xl py-2 text-center text-[13px] font-semibold text-slate-900 transition hover:opacity-90"
                style={{ background: ACCENT }}>
                {t('misc:changelog.requestShort')}
              </Link>
              <Link to="/requests"
                className="shrink-0 rounded-xl px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
                {t('misc:changelog.seeAll', { n: (list || []).length })}
              </Link>
            </div>
          </>
        )}
      </div>
    </Reveal>
  )
}

export default function ChangelogPage() {
  const { t, lang, locale } = useT()
  const { markSeen } = useUnseenChangelog()
  useEffect(() => { markSeen() }, [markSeen])

  const title = t('misc:changelog.title')
  // hero 那张入口卡要展示最热几条，所以这里也拉一次（只读，不做任何写操作）
  const [requests, setRequests] = useState<FeatureRequest[] | null>(null)
  useEffect(() => { fetchFeatureRequests().then(setRequests) }, [])

  /**
   * 🔴 **买家看不到经纪侧的更新。**
   *
   * 买家不会用报价单、不会开实时带看、更不会传楼书 —— 给他看「带看工具条重做了」
   * 只是在告诉他「这页有一多半不是给你的」。经纪反过来要看**全部**:他得知道
   * 客户那边的地图/数据改了什么,否则客户问起来他答不上。
   *
   * ⚠️ 这是**展示层**的分流,不是权限 —— 数据本来就是公开的静态文案,没有秘密。
   *    所以未登录访客按买家处理(最小惊讶),不做任何提示。
   */
  const isAgentSide = useIsAgentSide()

  /**
   * 经纪那一侧**再分一道**:混在一起看不出哪些是自己的工具、哪些是客户那边的。
   *   'agent'   经纪专属 —— 「我的工具改了什么」
   *   'shared'  客户也看得到 —— 「我能拿去跟客户说的」
   *   'both'    全部,按时间混排
   *
   * 默认落在 'agent':他点进这一页多半是想知道自己手上的东西改了什么;
   * 客户那边的更新他要用的时候是**带着目的**来的(要发给客户),那时再切一下。
   * 选择记在本地 —— 每次进来都被打回默认,等于这个开关白给。
   */
  const [view, setView] = useState<DiaryView>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      return v === 'shared' || v === 'both' || v === 'agent' ? v : 'agent'
    } catch { return 'agent' }
  })
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* 隐私模式 */ } }, [view])

  const visible = useMemo(() => {
    // 买家没有第二种东西可看,压根不该出现这个开关 —— 直接给他客户侧那一份
    if (!isAgentSide) return CHANGELOG.filter((e) => e.audience !== 'agent')
    if (view === 'agent') return CHANGELOG.filter((e) => e.audience === 'agent')
    if (view === 'shared') return CHANGELOG.filter((e) => e.audience !== 'agent')
    return CHANGELOG
  }, [isAgentSide, view])

  const agentCount = useMemo(() => CHANGELOG.filter((e) => e.audience === 'agent').length, [])

  const months = useMemo(() => {
    const out: { key: string; label: string; items: typeof CHANGELOG }[] = []
    for (const e of visible) {
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
  }, [locale, visible])

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

  // 切换视角后月份会变 —— 当前高亮的那个月可能已经不在了。不兜这一下的话，
  // 书脊上会一个高亮都没有（observer 要等你滚动才会重新报），像是坏了。
  useEffect(() => {
    if (months.length && !months.some((m) => m.key === active)) setActive(months[0].key)
  }, [months, active])

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

  // ⚠️ 这里**不能**再有「功能建议」——它已经是独立一页(/requests),
  //    留一个跳不到任何区块的目录项只会点了没反应。
  const navItems = months.map((m) => ({ key: m.key, label: m.label, count: m.items.length as number | null }))
  const jump = (key: string) => document.querySelector(`[data-sec="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // ⚠️ 统计要数 `visible` 而不是 CHANGELOG —— 买家看到「54 条更新」却只列出 31 条,
  //    等于当着他的面少给了 23 条,比不分流还糟。屏幕上有几条,数字就写几条。
  const kindCount = (k: ChangeKind) => visible.filter((e) => e.kind === k).length

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={t('misc:changelog.metaDesc')} />
        <link rel="canonical" href="https://www.pinzos.com/changelog" />
      </Helmet>

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

        <div className="relative mx-auto grid max-w-5xl gap-10 px-5 py-14 sm:px-6 md:py-20 lg:grid-cols-[1fr_20rem]">
          <div>
          <Reveal>
            {/* 只陈述事实:最近一次更新是什么时候。不写「我们每周都在改」那种自夸。 */}
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] tracking-wide" style={{ color: ACCENT }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
              <span>{t('misc:changelog.lastUpdate')} <span translate="no">{fmtDate(visible[0]?.date || '')}</span></span>
            </span>

            <h1 className="mt-5 text-4xl font-bold leading-[1.1] md:text-5xl">{title}</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-400">
              {t('misc:changelog.tagline')}
            </p>
          </Reveal>

          <Reveal delay={0.08}>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {[
                { n: visible.length, l: t('misc:changelog.statUpdates'), c: '#fff' },
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

          {/* 🔴 **经纪的两份更新必须能分开看。**
              owner:「经纪看时不要整理在一起 要区分开 单独展示」——混排的问题是
              他要的答案(我手上的工具改了什么)被埋在客户侧的更新里,得自己一条条挑。
              开关放在**统计数字下面**是有讲究的:切换时上面那四个数字跟着重新数,
              一眼就看得出「这一份有 23 条」,不用滚到下面去数。
              买家看不到这一行 —— 他只有一份东西,给他一个只有一个选项的开关是噪音。 */}
          {isAgentSide && (
            <Reveal delay={0.11}>
              <div className="mt-5 inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
                {([
                  { id: 'agent', label: t('misc:changelog.agentOnly'), n: agentCount },
                  { id: 'shared', label: t('misc:changelog.viewShared'), n: CHANGELOG.length - agentCount },
                  { id: 'both', label: t('misc:changelog.viewAll'), n: CHANGELOG.length },
                ] as { id: DiaryView; label: string; n: number }[]).map((v) => (
                  <button key={v.id} type="button" onClick={() => setView(v.id)}
                    className={`relative inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
                      view === v.id ? 'text-slate-900' : 'text-slate-400 hover:text-white'
                    }`}>
                    {/* 高亮块滑过去 —— 和月份导航是同一套语言:滑动那一下让人看懂「我换到了哪」 */}
                    {view === v.id && (
                      <motion.span layoutId="diary-view-pill" className="absolute inset-0 rounded-xl"
                        style={{ background: ACCENT }}
                        transition={{ type: 'spring', stiffness: 420, damping: 36 }} />
                    )}
                    <span className="relative">{v.label}</span>
                    <span translate="no" className="relative tabular-nums opacity-60">{v.n}</span>
                  </button>
                ))}
              </div>
            </Reveal>
          )}

          {/* 三个出口一次给全 —— 页面底部**不再重复**一遍(owner:「打开地图和了解 pinzos
              感觉都是多余，可以放在一开始那个 section」) */}
          <Reveal delay={0.14}>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* ⚠️ 这里**不要**再放「提一个功能建议」——右边那张卡上已经有一颗了,
                  同一屏里两个一模一样的主按钮只会让人犹豫点哪个。
                  这一行只留「去别处」的出口。 */}
              <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-300 transition hover:text-white">
                {t('misc:changelog.openMap')} <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
              <Link to="/about" className="text-sm text-slate-400 transition hover:text-slate-200">
                {t('misc:changelog.aboutPinzos')}
              </Link>
            </div>
          </Reveal>
          </div>

          {/* 🔴 **「大家在提什么」必须在这里，不能只在页尾。**
              owner:「建议不应该提在底部啊 而且其他建议怎么看?也在一开始那个 session
              能看看其他人的提议」——他说得对,而且这是我把顺序搞反了:
              **日记是我想给的,建议是用户来这一页要用的**。把用户要用的东西埋在 54 条
              日记底下,等于让他为了提一句话先读半年更新;更要命的是他看不到别人提过没有,
              于是要么重复提,要么干脆不提。
              这张卡片给的正是决定要不要开口之前需要的三件事:有没有人提过、多少人附议、
              我们答了没有。 */}
          <HeroRequests list={requests} />
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
                className={`relative inline-flex min-h-[34px] shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
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
          <Link to="/requests"
            className="inline-flex min-h-[34px] shrink-0 items-center rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-900 transition hover:opacity-90"
            style={{ background: ACCENT }}>
            {t('misc:changelog.requestShort')}
          </Link>
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
                              {/* 只有经纪看得到这一条 —— 顺手告诉他「这条你的客户看不到」,
                                  免得他截图发给客户,对方打开一脸茫然。
                                  ⚠️ 只在**混排**时标:单看「经纪专属」那一份时每条都挂一个,
                                  等于没标,纯噪音。 */}
                              {e.audience === 'agent' && view === 'both' && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-600 ring-1 ring-violet-100">
                                  <Briefcase className="h-3 w-3" />
                                  {t('misc:changelog.agentOnly')}
                                </span>
                              )}
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

          </div>
        </div>
      </div>
    </div>
  )
}
