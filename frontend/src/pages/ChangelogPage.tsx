/**
 * /changelog —— 面向客户的更新历史 + 功能建议。
 *
 * 两件事放一页是有意的：左边证明「我们一直在改」，右边让你「告诉我们改什么」。
 * 分成两页就断了这个回路 —— 提建议的人看不到东西真的会上线，提一次就不会再提。
 *
 * 结构：
 *   · 桌面双栏：左侧 sticky 导航（按月 + 功能建议），右侧内容；滚动时高亮当前月份
 *   · 手机：导航塌成顶部一条横滑 pill 条（sticky）
 *   · 更新历史内容手写在 data/changelog.ts —— **绝不从 git commit 自动生成**
 *   · 功能建议：看列表不用登录，提交要登录；**任何地方都不显示是谁提的**
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles, Wrench, Bug, ArrowRight, Lightbulb, Loader2, Check, Send } from 'lucide-react'
import { CHANGELOG, type ChangeKind } from '../data/changelog'
import { useUnseenChangelog } from '../hooks/useUnseenChangelog'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchFeatureRequests, submitFeatureRequest,
  type FeatureRequest, type RequestStatus,
} from '../lib/featureRequestApi'

const ACCENT = '#00E0B8'
const REQ_ID = 'requests'

const KIND: Record<ChangeKind, { icon: React.ReactNode; cls: string; zh: string; en: string }> = {
  new: { icon: <Sparkles className="h-3.5 w-3.5" />, cls: 'bg-teal-50 text-teal-700 ring-teal-100', zh: '新功能', en: 'New' },
  improve: { icon: <Wrench className="h-3.5 w-3.5" />, cls: 'bg-sky-50 text-sky-700 ring-sky-100', zh: '改进', en: 'Improved' },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, cls: 'bg-amber-50 text-amber-700 ring-amber-100', zh: '修复', en: 'Fixed' },
}

const STATUS: Record<RequestStatus, { cls: string; zh: string; en: string }> = {
  shipped: { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-100', zh: '已上线', en: 'Shipped' },
  planned: { cls: 'bg-sky-50 text-sky-700 ring-sky-100', zh: '计划中', en: 'Planned' },
  open: { cls: 'bg-slate-100 text-slate-600 ring-slate-200', zh: '待评估', en: 'Under review' },
  // 「暂不做」也照常显示 —— 悄悄让它消失比明说更伤人，提议的人会觉得石沉大海
  declined: { cls: 'bg-slate-50 text-slate-400 ring-slate-100', zh: '暂不做', en: 'Not planned' },
}

export default function ChangelogPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  const { markSeen } = useUnseenChangelog()
  useEffect(() => { markSeen() }, [markSeen])

  const title = zh ? '更新历史' : "What's new"
  const subtitle = zh
    ? '我们每周都在改。这里是自 2026 年 1 月上线以来的新功能、改进和修复 —— 也是你告诉我们下一步该改什么的地方。'
    : 'We ship every week. Everything below has gone live since launch in January 2026 — and this is also where you tell us what to build next.'

  // ── 按月分组（导航锚点就是月份）───────────────────────────────────────
  const months = useMemo(() => {
    const out: { key: string; label: string; items: typeof CHANGELOG }[] = []
    for (const e of CHANGELOG) {
      const key = e.date.slice(0, 7)                    // YYYY-MM
      const last = out[out.length - 1]
      if (last && last.key === key) last.items.push(e)
      else {
        const [y, m] = key.split('-')
        out.push({
          key,
          label: zh ? `${y} 年 ${Number(m)} 月` : new Date(`${key}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
          items: [e],
        })
      }
    }
    return out
  }, [zh])

  // ── 滚动高亮当前区块（IntersectionObserver，不监听 scroll）─────────────
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
      // 上边留 96px 给 sticky 头，下边收窄，避免整页都算"可见"
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [months.length])

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { month: 'long', day: 'numeric' })

  const navItems = [
    ...months.map((m) => ({ key: m.key, label: m.label, count: m.items.length })),
    { key: REQ_ID, label: zh ? '功能建议' : 'Feature requests', count: null as number | null },
  ]

  const jump = (key: string) => {
    const el = document.querySelector(`[data-sec="${key}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={subtitle} />
        <link rel="canonical" href="https://www.pinzos.com/changelog" />
      </Helmet>

      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-6 md:py-16">
        {/* hero */}
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">{subtitle}</p>
        <button
          type="button"
          onClick={() => jump(REQ_ID)}
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90 active:scale-95"
          style={{ background: ACCENT }}
        >
          <Lightbulb className="h-4 w-4" />
          {zh ? '提一个功能建议' : 'Request a feature'}
        </button>

        {/* 手机：横滑 pill 导航（sticky 贴顶） */}
        <nav className="sticky top-0 z-20 -mx-5 mt-8 overflow-x-auto border-b border-slate-100 bg-white/95 px-5 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-1.5">
            {navItems.map((n) => (
              <button
                key={n.key}
                type="button"
                onClick={() => jump(n.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  active === n.key ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-100'
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="mt-8 flex gap-10 md:mt-12">
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
                      <button
                        type="button"
                        onClick={() => jump(n.key)}
                        className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-start text-[13px] transition ${
                          on ? 'bg-slate-900 font-medium text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                        }`}
                      >
                        <span className="truncate">{n.label}</span>
                        {n.count != null && (
                          <span className={`shrink-0 text-[11px] tabular-nums ${on ? 'text-white/60' : 'text-slate-300'}`}>
                            {n.count}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </nav>

          {/* 内容 */}
          <div ref={contentRef} className="min-w-0 flex-1">
            {months.map((m) => (
              <section key={m.key} data-sec={m.key} className="mb-12 scroll-mt-24">
                <h2 className="mb-5 text-xs font-semibold uppercase tracking-wider text-slate-400">{m.label}</h2>
                <ol className="relative space-y-7 border-s border-slate-100 ps-6">
                  {m.items.map((e, i) => {
                    const k = KIND[e.kind]
                    return (
                      <li key={`${e.date}-${i}`} className="relative">
                        <span
                          className="absolute -start-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white"
                          style={{ background: ACCENT }}
                          aria-hidden
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${k.cls}`}>
                            {k.icon}{zh ? k.zh : k.en}
                          </span>
                          <time dateTime={e.date} className="text-[11px] tabular-nums text-slate-400">{fmtDate(e.date)}</time>
                        </div>
                        <p className="mt-2 text-[15px] leading-relaxed text-slate-700">{zh ? e.zh : e.en}</p>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}

            <FeatureRequests zh={zh} />
          </div>
        </div>

        <div className="mt-16 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-900 transition hover:opacity-90"
            style={{ background: ACCENT }}
          >
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

/** 功能建议：提交（要登录）+ 公开列表（**不显示提交人**）。 */
function FeatureRequests({ zh }: { zh: boolean }) {
  const { user, signInWithGoogle } = useAuth()
  const [list, setList] = useState<FeatureRequest[] | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => { fetchFeatureRequests().then(setList) }, [])

  const send = async () => {
    setErr(''); setBusy(true)
    try {
      const created = await submitFeatureRequest(title.trim(), body.trim())
      setList((prev) => [created, ...(prev || [])])
      setTitle(''); setBody(''); setDone(true)
      setTimeout(() => setDone(false), 4000)
    } catch (e) {
      // 后端把「每天最多 5 条」「标题太短」写在 message 里 —— 原样显示,
      // 静默失败会让人以为提交成功了
      setErr(e instanceof Error ? e.message : (zh ? '提交失败' : 'Could not submit'))
    } finally { setBusy(false) }
  }

  return (
    <section data-sec={REQ_ID} className="scroll-mt-24 border-t border-slate-100 pt-10">
      <div className="mb-2 flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h2 className="text-xl font-bold text-slate-900">{zh ? '功能建议' : 'Feature requests'}</h2>
      </div>
      <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-500">
        {zh
          ? '缺什么就说。所有建议都会公开列在下面，但我们不会显示是谁提的。'
          : 'Tell us what is missing. Every request is listed publicly below — we never show who asked.'}
      </p>

      {/* 提交表单 */}
      <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-100 sm:p-5">
        {!user ? (
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {zh ? '登录后就能提建议（我们只用它来防刷，不会公开）。' : 'Sign in to post a request — we only use it to prevent spam, never to show your name.'}
            </p>
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              {zh ? '登录' : 'Sign in'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={zh ? '一句话说清楚你想要什么' : 'In one line — what do you want?'}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={zh ? '（选填）什么场景下需要它？现在你是怎么将就的？' : '(Optional) When would you use it? How do you work around it today?'}
              className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-teal-400 focus:outline-none"
            />
            {err && <p className="text-xs font-medium text-rose-600">{err}</p>}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy || title.trim().length < 4}
                onClick={send}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: ACCENT }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {zh ? '提交' : 'Submit'}
              </button>
              {done && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <Check className="h-3.5 w-3.5" />{zh ? '收到了，谢谢' : 'Got it — thank you'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 公开列表 */}
      <div className="mt-8">
        {list === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
        ) : list.length === 0 ? (
          <p className="py-6 text-sm text-slate-400">
            {zh ? '还没有人提过建议 —— 你可以是第一个。' : 'No requests yet — you could be the first.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((r) => {
              const s = STATUS[r.status] || STATUS.open
              return (
                <li key={r.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${s.cls}`}>
                      {zh ? s.zh : s.en}
                    </span>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {new Date(r.created_at).toLocaleDateString(zh ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[15px] font-medium leading-snug text-slate-800">{r.title}</p>
                  {r.body && <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">{r.body}</p>}
                  {r.reply && (
                    <p className="mt-2 rounded-xl bg-teal-50/70 px-3 py-2 text-sm leading-relaxed text-teal-800 ring-1 ring-teal-100">
                      <span className="font-semibold">Pinzos：</span>{r.reply}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
