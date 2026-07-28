/**
 * /changelog —— 更新历史 + 功能建议（同一页）。
 *
 * 两件事放一页是有意的：上半页证明「我们一直在改」，下半页让你「告诉我们改什么」。
 * 分成两页就断了这个回路 —— 提建议的人看不到东西真的会上线，提一次就不会再提。
 *
 * 视觉：深色 hero（和 /about 同一套语言：点阵纹理 + 径向光晕，不用 blur 滤镜，
 * 免得滚动重绘掉帧）+ 浅色内容区。时间线的竖线**画在卡片外的独立栏**里，
 * 不再用 border-s + 负边距把圆点摞在文字块左边（owner：「line change 在奇怪的地方」）。
 *
 * 内容手写在 data/changelog.ts —— **绝不从 git commit 自动生成**（原因见那个文件）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Sparkles, Wrench, Bug, ArrowRight, Lightbulb, Loader2, Check, Send,
  ChevronUp, MessageSquare, Search as SearchIcon, ChevronDown,
} from 'lucide-react'
import { CHANGELOG, type ChangeKind } from '../data/changelog'
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

const KIND: Record<ChangeKind, { icon: React.ReactNode; dot: string; chip: string; zh: string; en: string }> = {
  new: { icon: <Sparkles className="h-3.5 w-3.5" />, dot: '#00E0B8', chip: 'bg-teal-50 text-teal-700 ring-teal-100', zh: '新功能', en: 'New' },
  improve: { icon: <Wrench className="h-3.5 w-3.5" />, dot: '#38BDF8', chip: 'bg-sky-50 text-sky-700 ring-sky-100', zh: '改进', en: 'Improved' },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, dot: '#FBBF24', chip: 'bg-amber-50 text-amber-700 ring-amber-100', zh: '修复', en: 'Fixed' },
}

const STATUS: Record<RequestStatus, { chip: string; zh: string; en: string }> = {
  shipped: { chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100', zh: '已上线', en: 'Shipped' },
  planned: { chip: 'bg-sky-50 text-sky-700 ring-sky-100', zh: '计划中', en: 'Planned' },
  open: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', zh: '待评估', en: 'Under review' },
  // 「暂不做」也照常显示 —— 悄悄让它消失比明说更伤人，提议的人会觉得石沉大海
  declined: { chip: 'bg-slate-50 text-slate-400 ring-slate-100', zh: '暂不做', en: 'Not planned' },
}

/** 角色标记：**群体属性，不是身份**。指认不到具体的人，但能看出这条诉求来自哪一侧。 */
const ROLE: Record<string, { chip: string; zh: string; en: string }> = {
  agent: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', zh: '经纪', en: 'Agent' },
  agency: { chip: 'bg-teal-50 text-teal-700 ring-teal-100', zh: '经纪公司', en: 'Agency' },
  developer: { chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', zh: '开发商', en: 'Developer' },
  buyer: { chip: 'bg-sky-50 text-sky-600 ring-sky-100', zh: '买家', en: 'Buyer' },
}

function RoleTag({ role, zh }: { role: string | null; zh: boolean }) {
  const r = role && ROLE[role]
  if (!r) return null
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${r.chip}`}>
      {zh ? r.zh : r.en}
    </span>
  )
}

export default function ChangelogPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const { markSeen } = useUnseenChangelog()
  useEffect(() => { markSeen() }, [markSeen])

  const title = zh ? '更新历史' : "What's new"

  const months = useMemo(() => {
    const out: { key: string; label: string; items: typeof CHANGELOG }[] = []
    for (const e of CHANGELOG) {
      const key = e.date.slice(0, 7)
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(e)
      else {
        const [y, m] = key.split('-')
        out.push({
          key,
          label: zh ? `${y} 年 ${Number(m)} 月`
            : new Date(`${key}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
          items: [e],
        })
      }
    }
    return out
  }, [zh])

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

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric' })

  const navItems = [
    ...months.map((m) => ({ key: m.key, label: m.label, count: m.items.length as number | null })),
    { key: REQ_ID, label: zh ? '功能建议' : 'Requests', count: null },
  ]
  const jump = (key: string) => document.querySelector(`[data-sec="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const kindCount = (k: ChangeKind) => CHANGELOG.filter((e) => e.kind === k).length

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={zh
          ? '我们每周都在改。这里是自 2026 年 1 月上线以来的新功能、改进和修复，也是你告诉我们下一步该做什么的地方。'
          : 'We ship every week. Everything since launch in January 2026 — and where you tell us what to build next.'} />
        <link rel="canonical" href="https://www.pinzos.com/changelog" />
      </Helmet>

      {/* ── Hero：深色 + 点阵 + 光晕（和 /about 同一套视觉语言）───────────── */}
      <section
        className="relative overflow-hidden bg-[#070b16] text-white"
        style={{ backgroundImage: GRID, backgroundSize: '34px 34px' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -end-24 -top-32 h-[30rem] w-[30rem] rounded-full"
          style={{ background: `radial-gradient(circle, ${ACCENT}30 0%, transparent 70%)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -start-28 bottom-[-8rem] h-80 w-80 rounded-full"
          style={{ background: `radial-gradient(circle, ${GOLD}1f 0%, transparent 70%)` }}
        />

        <div className="relative mx-auto max-w-5xl px-5 py-14 sm:px-6 md:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] tracking-wide" style={{ color: ACCENT }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACCENT }} />
            {zh ? '每周都在改' : 'Shipping every week'}
          </span>

          <h1 className="mt-5 text-4xl font-bold leading-[1.1] md:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300/90">
            {zh
              ? '自 2026 年 1 月上线以来的每一次改动。缺什么就在下面说 —— 我们会回你，做了也会记在这里。'
              : 'Every change since we launched in January 2026. Tell us what is missing below — we reply, and when it ships it shows up here.'}
          </p>

          {/* 数字条：这一页的「形象」——不靠插画，靠事实 */}
          <div className="mt-8 flex flex-wrap gap-2.5">
            {[
              { n: CHANGELOG.length, l: zh ? '次更新' : 'updates', c: '#fff' },
              { n: kindCount('new'), l: zh ? '新功能' : 'new', c: ACCENT },
              { n: kindCount('improve'), l: zh ? '改进' : 'improved', c: '#7DD3FC' },
              { n: kindCount('fix'), l: zh ? '修复' : 'fixed', c: '#FCD34D' },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2">
                <div className="text-lg font-bold tabular-nums" style={{ color: s.c }}>{s.n}</div>
                <div className="text-[11px] text-slate-400">{s.l}</div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => jump(REQ_ID)}
            className="mt-8 inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
            style={{ background: ACCENT, boxShadow: `0 8px 30px -8px ${ACCENT}` }}
          >
            <Lightbulb className="h-4 w-4" />
            {zh ? '提一个功能建议' : 'Request a feature'}
          </button>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 sm:px-6">
        {/* 手机：横滑 pill 导航 */}
        <nav className="sticky top-0 z-20 -mx-5 overflow-x-auto border-b border-slate-100 bg-white/95 px-5 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-1.5">
            {navItems.map((n) => (
              <button key={n.key} type="button" onClick={() => jump(n.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active === n.key ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100'
                }`}>
                {n.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="flex gap-10 py-10 md:py-14">
          {/* 桌面：左侧 sticky 导航 */}
          <nav className="hidden w-44 shrink-0 md:block">
            <div className="sticky top-24">
              <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {zh ? '快速浏览' : 'Jump to'}
              </p>
              <ul className="space-y-0.5">
                {navItems.map((n) => {
                  const on = active === n.key
                  return (
                    <li key={n.key}>
                      <button type="button" onClick={() => jump(n.key)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-start text-[13px] transition ${
                          on ? 'bg-slate-900 font-medium text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                        }`}>
                        <span className="truncate">{n.label}</span>
                        {n.count != null && (
                          <span className={`shrink-0 text-[11px] tabular-nums ${on ? 'text-white/60' : 'text-slate-300'}`}>{n.count}</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </nav>

          <div ref={contentRef} className="min-w-0 flex-1">
            {months.map((m) => (
              <section key={m.key} data-sec={m.key} className="mb-12 scroll-mt-24">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{m.label}</h2>

                {/* 时间线：竖线画在**独立的 24px 栏**里，圆点在栏中间，卡片在右边。
                    以前用 ol 的 border-s + 圆点负边距，圆点会骑在文字块左缘上，
                    线也从月标题下方凭空开始 —— owner 说「line change 在奇怪的地方」。 */}
                <ul className="space-y-2">
                  {m.items.map((e, i) => {
                    const k = KIND[e.kind]
                    const last = i === m.items.length - 1
                    return (
                      <li key={`${e.date}-${i}`} className="flex gap-3">
                        <div className="relative flex w-6 shrink-0 flex-col items-center">
                          <span className="mt-4 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white" style={{ background: k.dot }} />
                          {!last && <span className="mt-1 w-px flex-1 bg-slate-100" />}
                        </div>
                        <div className="group min-w-0 flex-1 rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${k.chip}`}>
                              {k.icon}{zh ? k.zh : k.en}
                            </span>
                            <time dateTime={e.date} className="text-[11px] tabular-nums text-slate-400">{fmtDate(e.date)}</time>
                          </div>
                          <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{zh ? e.zh : e.en}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}

            <FeatureRequests zh={zh} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 py-10">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90" style={{ background: ACCENT }}>
            {zh ? '打开地图' : 'Open the map'} <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </Link>
          <Link to="/about" className="text-sm text-slate-500 transition hover:text-slate-800">
            {zh ? '了解 Pinzos' : 'About Pinzos'}
          </Link>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 功能建议
// ════════════════════════════════════════════════════════════════════════════

type Filter = 'all' | RequestStatus
type Sort = 'top' | 'new'

function FeatureRequests({ zh }: { zh: boolean }) {
  const { user, isAdmin, signInWithGoogle } = useAuth()
  const [list, setList] = useState<FeatureRequest[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('top')
  const [openForm, setOpenForm] = useState(false)

  useEffect(() => { fetchFeatureRequests().then(setList) }, [])

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
    // 这里只在用户明确选「最新」时才重排，别把默认顺序也搅了。
    return sort === 'new'
      ? [...hit].sort((a, b) => b.created_at.localeCompare(a.created_at))
      : hit
  }, [list, q, filter, sort])

  const FILTERS: { id: Filter; label: string }[] = [
    { id: 'all', label: zh ? '全部' : 'All' },
    { id: 'open', label: zh ? '待评估' : 'Under review' },
    { id: 'planned', label: zh ? '计划中' : 'Planned' },
    { id: 'shipped', label: zh ? '已上线' : 'Shipped' },
    { id: 'declined', label: zh ? '暂不做' : 'Not planned' },
  ]
  const countOf = (f: Filter) => (f === 'all' ? (list?.length || 0) : (list || []).filter((r) => r.status === f).length)

  return (
    <section data-sec={REQ_ID} className="scroll-mt-24 border-t border-slate-100 pt-10">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-500">
          <Lightbulb className="h-5 w-5" />
        </span>
        <h2 className="text-xl font-bold text-slate-900">{zh ? '功能建议' : 'Feature requests'}</h2>
      </div>
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-500">
        {zh
          ? '缺什么就说。所有建议公开列出，会标注提议人是经纪还是买家 —— 但永远不显示是谁。'
          : 'Tell us what is missing. Every request is public and tagged by whether it came from an agent or a buyer — never by who.'}
      </p>

      {/* 提交 */}
      <SubmitBox
        zh={zh} user={!!user} openForm={openForm} setOpenForm={setOpenForm}
        onSignIn={() => void signInWithGoogle()}
        onCreated={(r) => setList((p) => [r, ...(p || [])])}
      />

      {/* 搜索 + 筛选 + 排序 */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={zh ? '搜索建议…' : 'Search requests…'}
            className="w-full rounded-xl border border-slate-200 py-2 ps-9 pe-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
          />
        </div>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
              filter === f.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100 hover:bg-slate-100'
            }`}>
            {f.label}<span className="ms-1 opacity-50 tabular-nums">{countOf(f.id)}</span>
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:block" />
        <button type="button" onClick={() => setSort(sort === 'top' ? 'new' : 'top')}
          className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-100 transition hover:bg-slate-100">
          {sort === 'top' ? (zh ? '最热' : 'Top') : (zh ? '最新' : 'Newest')}
        </button>
      </div>

      {/* 列表 */}
      <div className="mt-5">
        {list === null ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">
            {list.length === 0
              ? (zh ? '还没有人提过建议 —— 你可以是第一个。' : 'No requests yet — you could be the first.')
              : (zh ? '没有符合条件的建议。' : 'Nothing matches those filters.')}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((r) => (
              <RequestCard key={r.id} r={r} zh={zh} canPost={!!user} isAdmin={!!isAdmin} onPatch={patch} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function SubmitBox({ zh, user, openForm, setOpenForm, onSignIn, onCreated }: {
  zh: boolean; user: boolean; openForm: boolean
  setOpenForm: (v: boolean) => void
  onSignIn: () => void
  onCreated: (r: FeatureRequest) => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  if (!user) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <p className="text-sm text-slate-500">
          {zh ? '登录后就能提建议和点赞（只用来防刷，不会公开）。' : 'Sign in to post and upvote — we only use it to prevent spam, never to show your name.'}
        </p>
        <button type="button" onClick={onSignIn}
          className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
          {zh ? '登录' : 'Sign in'}
        </button>
      </div>
    )
  }

  if (!openForm) {
    return (
      <button type="button" onClick={() => setOpenForm(true)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-dashed border-slate-200 px-4 py-3.5 text-start text-sm text-slate-400 transition hover:border-teal-300 hover:text-slate-600">
        <Lightbulb className="h-4 w-4" />
        {zh ? '你希望 Pinzos 加点什么？' : 'What should Pinzos add?'}
      </button>
    )
  }

  const send = async () => {
    setErr(''); setBusy(true)
    try {
      onCreated(await submitFeatureRequest(title.trim(), body.trim()))
      setTitle(''); setBody(''); setDone(true); setOpenForm(false)
      setTimeout(() => setDone(false), 4000)
    } catch (e) {
      // 后端把「每天最多 5 条」「标题太短」写在 message 里 —— 原样显示，
      // 静默失败会让人以为提交成功了
      setErr(e instanceof Error ? e.message : (zh ? '提交失败' : 'Could not submit'))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:p-5">
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus
        placeholder={zh ? '一句话说清楚你想要什么' : 'In one line — what do you want?'}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3}
        placeholder={zh ? '（选填）什么场景下需要它？现在你是怎么将就的？' : '(Optional) When would you use it? How do you work around it today?'}
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none" />
      {err && <p className="text-xs font-medium text-rose-600">{err}</p>}
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || title.trim().length < 4} onClick={send}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: ACCENT }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {zh ? '提交' : 'Submit'}
        </button>
        <button type="button" onClick={() => setOpenForm(false)} className="text-sm text-slate-400 hover:text-slate-600">
          {zh ? '取消' : 'Cancel'}
        </button>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="h-3.5 w-3.5" />{zh ? '收到了，谢谢' : 'Got it — thank you'}
          </span>
        )}
      </div>
    </div>
  )
}

/** 一条建议：票数 / 状态 / 角色 / 楼层 / admin 内联操作。 */
function RequestCard({ r, zh, canPost, isAdmin, onPatch }: {
  r: FeatureRequest; zh: boolean; canPost: boolean; isAdmin: boolean
  onPatch: (r: FeatureRequest) => void
}) {
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
    if (!canPost) return
    // 乐观更新：点赞要**立刻**有反馈，一个要等一圈网络才动的赞没人点第二次
    const before = { votes: r.votes, voted: r.voted }
    onPatch({ ...r, votes: r.votes + (r.voted ? -1 : 1), voted: !r.voted })
    try {
      const res = await toggleVote(r.id)
      onPatch({ ...r, ...res })
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
    <li className="rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200">
      <div className="flex gap-3.5">
        {/* 点赞 */}
        <button
          type="button" onClick={vote} disabled={!canPost}
          title={canPost ? (zh ? '赞同这条' : 'Upvote') : (zh ? '登录后可点赞' : 'Sign in to vote')}
          className={`flex h-14 w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border transition ${
            r.voted
              ? 'border-teal-200 bg-teal-50 text-teal-700'
              : 'border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
          } ${canPost ? 'active:scale-95' : 'cursor-not-allowed opacity-60'}`}
        >
          <ChevronUp className="h-4 w-4" />
          <span className="text-xs font-semibold tabular-nums">{r.votes}</span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.chip}`}>
              {zh ? s.zh : s.en}
            </span>
            <RoleTag role={r.role} zh={zh} />
            <span className="text-[11px] tabular-nums text-slate-400">
              {new Date(r.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
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
              {r.comments > 0 ? `${r.comments} ${zh ? '条回复' : 'replies'}` : (zh ? '回复' : 'Reply')}
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
                    {zh ? STATUS[st].zh : STATUS[st].en}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 楼层 */}
          {open && (
            <div className="mt-3 space-y-2.5 border-t border-slate-100 pt-3">
              {thread === null ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-300" />
              ) : thread.length === 0 ? (
                <p className="text-xs text-slate-400">{zh ? '还没有回复。' : 'No replies yet.'}</p>
              ) : (
                thread.map((c, i) => (
                  <div key={c.id} className="flex gap-2.5">
                    <span className="mt-0.5 w-7 shrink-0 text-end text-[11px] tabular-nums text-slate-300">#{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {c.is_staff ? (
                          <span className="inline-flex items-center rounded-full bg-slate-900 px-1.5 py-px text-[10px] font-medium text-white">Pinzos</span>
                        ) : (
                          <>
                            <span className="text-[11px] text-slate-400">{zh ? '匿名' : 'Anonymous'}</span>
                            <RoleTag role={c.role} zh={zh} />
                          </>
                        )}
                        <span className="text-[10px] tabular-nums text-slate-300">
                          {new Date(c.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{c.body}</p>
                    </div>
                  </div>
                ))
              )}

              {canPost ? (
                <div className="flex items-start gap-2 pt-1">
                  <textarea
                    value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={800}
                    placeholder={isAdmin ? (zh ? '以 Pinzos 身份回复…' : 'Reply as Pinzos…') : (zh ? '说点什么…' : 'Add a reply…')}
                    className="min-w-0 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
                  />
                  <button type="button" onClick={reply} disabled={busy || draft.trim().length < 2}
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-900 transition hover:opacity-90 disabled:opacity-40"
                    style={{ background: ACCENT }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              ) : (
                <p className="pt-1 text-xs text-slate-400">{zh ? '登录后可以回复。' : 'Sign in to reply.'}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}
