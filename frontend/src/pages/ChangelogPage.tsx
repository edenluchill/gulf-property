/**
 * /changelog —— 面向客户的更新历史（像 app 的「更新内容」）。
 *
 * 为什么值得有：客户看不到我们在做什么，就默认我们没在做。一份持续更新的清单是
 * 少数几个「不用打扰任何人」就能传达「这东西还活着、还在被认真维护」的地方。
 *
 * 内容手写在 data/changelog.ts —— **绝不从 git commit 自动生成**（原因见那个文件）。
 * 公开页，无需登录；语言跟随站点，非中文一律走英文（见数据文件的取舍说明）。
 */
import { useEffect } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Sparkles, Wrench, Bug, ArrowRight } from 'lucide-react'
import { CHANGELOG, type ChangeKind } from '../data/changelog'
import { useUnseenChangelog } from '../hooks/useUnseenChangelog'

const ACCENT = '#00E0B8'

const KIND: Record<ChangeKind, { icon: React.ReactNode; cls: string; zh: string; en: string }> = {
  new: { icon: <Sparkles className="h-3.5 w-3.5" />, cls: 'bg-teal-50 text-teal-700 ring-teal-100', zh: '新功能', en: 'New' },
  improve: { icon: <Wrench className="h-3.5 w-3.5" />, cls: 'bg-sky-50 text-sky-700 ring-sky-100', zh: '改进', en: 'Improved' },
  fix: { icon: <Bug className="h-3.5 w-3.5" />, cls: 'bg-amber-50 text-amber-700 ring-amber-100', zh: '修复', en: 'Fixed' },
}

export default function ChangelogPage() {
  const { i18n } = useTranslation()
  const zh = (i18n.language || 'en').startsWith('zh')
  // 看过了 → 熄掉导航栏那颗红点
  const { markSeen } = useUnseenChangelog()
  useEffect(() => { markSeen() }, [markSeen])
  const title = zh ? '更新历史' : "What's new"
  const subtitle = zh
    ? '我们每周都在改。这里是最近的新功能、改进和修复。'
    : 'We ship every week. Here are the latest features, improvements and fixes.'

  // 同一天的合并成一组，日期只出现一次（不然一天三条会显示三个相同日期）
  const groups: { date: string; items: typeof CHANGELOG }[] = []
  for (const e of CHANGELOG) {
    const last = groups[groups.length - 1]
    if (last && last.date === e.date) last.items.push(e)
    else groups.push({ date: e.date, items: [e] })
  }

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString(zh ? 'zh-CN' : 'en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    })

  return (
    <div className="flex-1 overflow-y-auto bg-white text-slate-700">
      <Helmet>
        <title>{title} | Pinzos</title>
        <meta name="description" content={subtitle} />
        <link rel="canonical" href="https://www.pinzos.com/changelog" />
      </Helmet>

      <div className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <div className="mb-2 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
            <Sparkles className="h-5 w-5" />
          </span>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        </div>
        <p className="mb-10 text-sm leading-relaxed text-slate-500">{subtitle}</p>

        <div className="relative">
          {/* 时间线竖线：只在有 2 组以上时才画，单条时一根线很怪 */}
          {groups.length > 1 && (
            <div className="absolute bottom-2 start-[7px] top-2 w-px bg-slate-100" aria-hidden />
          )}

          <ol className="space-y-8">
            {groups.map((g) => (
              <li key={g.date} className="relative ps-8">
                <span
                  className="absolute start-0 top-1.5 h-3.5 w-3.5 rounded-full ring-4 ring-white"
                  style={{ background: ACCENT }}
                  aria-hidden
                />
                <time dateTime={g.date} className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {fmtDate(g.date)}
                </time>
                <ul className="mt-3 space-y-3">
                  {g.items.map((e, i) => {
                    const k = KIND[e.kind]
                    return (
                      <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                        <span className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${k.cls}`}>
                          {k.icon}
                          {zh ? k.zh : k.en}
                        </span>
                        <p className="text-[15px] leading-relaxed text-slate-700">{zh ? e.zh : e.en}</p>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-8">
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

        <p className="mt-8 text-xs leading-relaxed text-slate-400">
          {zh
            ? '发现问题或想要某个功能？写信到 support@pinzos.com —— 这一页上不少条目就是客户提出来的。'
            : 'Found a bug, or want something added? Email support@pinzos.com — a good number of the items on this page came from customers.'}
        </p>
      </div>
    </div>
  )
}
