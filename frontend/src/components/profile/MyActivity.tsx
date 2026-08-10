/**
 * 买家个人页的「我的东西」—— 收藏 · 看过的房源 · 联系过的顾问 · 对比。
 *
 * owner 2026-08-09:「买家 profile 也可以有点用的工具,优化一下」。
 *
 * 这三块的数据**早就在采**,只是买家自己看不到 —— 他收藏了、逛了十几个盘、
 * 找过顾问,回到个人页却只有一张资料卡和一个「成为经纪」入口。
 *
 * 🔴 **对比是「选中的收藏」并排,不是自动全塞。** 收藏 12 个的话自动并排等于一张
 *    看不懂的表;让他勾 2–4 个才有"对比"的意思。
 * 🔴 **空态要说清楚下一步在哪**,别只写「暂无」——「去地图逛逛」才是他要的。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Heart, Clock, UserRound, Columns3, Loader2, MapPin, Check } from 'lucide-react'
import { fetchMyActivity, type MyActivity as Data, type ActivityProject } from '../../lib/myActivityApi'
import { formatMoneyCompact } from '../../lib/money'

function Money({ v }: { v: number | null }) {
  const { i18n } = useTranslation()
  if (!v) return <span className="text-slate-400">—</span>
  return <span className="font-semibold text-slate-900">{formatMoneyCompact(v, i18n.language)}</span>
}

function Empty({ text, cta }: { text: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center">
      <p className="text-sm text-slate-400">{text}</p>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  )
}

function ProjectRow({ p, right, onToggle, picked }: {
  p: ActivityProject; right?: React.ReactNode
  onToggle?: () => void; picked?: boolean
}) {
  return (
    <li className={`flex items-center gap-3 rounded-xl bg-white p-3 ring-1 transition ${
      picked ? 'ring-2 ring-teal-500' : 'ring-slate-200'
    }`}>
      {onToggle && (
        <button type="button" onClick={onToggle} aria-label="select"
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
            picked ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300'
          }`}>
          {picked && <Check className="h-3 w-3" />}
        </button>
      )}
      <Link to={`/project/${p.id}`} className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800">{p.project_name}</div>
        <div className="truncate text-xs text-slate-400">
          {[p.developer, p.area].filter(Boolean).join(' · ')}
        </div>
      </Link>
      <div className="shrink-0 text-end text-sm">{right ?? <Money v={p.starting_price} />}</div>
    </li>
  )
}

export default function MyActivity() {
  const { t, i18n } = useTranslation('misc')
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<'fav' | 'viewed' | 'advisors'>('fav')
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => { void fetchMyActivity().then(setData) }, [])

  const compare = useMemo(
    () => (data?.favorites || []).filter((p) => picked.includes(p.id)),
    [data, picked]
  )

  if (!data) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
  }

  const counts = { fav: data.favorites.length, viewed: data.viewed.length, advisors: data.advisors.length }
  // 三块全空就整个不渲染 —— 一个新用户不该先看到三个空盒子
  if (!counts.fav && !counts.viewed && !counts.advisors) return null

  const TABS = [
    { id: 'fav' as const, icon: Heart, label: t('activity.tabFav'), n: counts.fav },
    { id: 'viewed' as const, icon: Clock, label: t('activity.tabViewed'), n: counts.viewed },
    { id: 'advisors' as const, icon: UserRound, label: t('activity.tabAdvisors'), n: counts.advisors },
  ]
  const toMap = <Link to="/" className="text-xs font-medium text-teal-600 underline-offset-2 hover:underline">{t('activity.goExplore')}</Link>

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.06]">
      <h2 className="text-sm font-bold text-slate-900">{t('activity.title')}</h2>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TABS.map((x) => (
          <button key={x.id} type="button" onClick={() => setTab(x.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              tab === x.id ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100'
            }`}>
            <x.icon className="h-3.5 w-3.5" />{x.label}
            <span className="tabular-nums opacity-60">{x.n}</span>
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'fav' && (
          counts.fav ? (
            <>
              <p className="mb-2 text-[11px] text-slate-400">{t('activity.pickToCompare')}</p>
              <ul className="space-y-2">
                {data.favorites.map((p) => (
                  <ProjectRow key={p.id} p={p} picked={picked.includes(p.id)}
                    onToggle={() => setPicked((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id].slice(-4))} />
                ))}
              </ul>
            </>
          ) : (
            <Empty text={data.signed_in ? t('activity.emptyFav') : t('activity.emptyFavAnon')} cta={toMap} />
          )
        )}

        {tab === 'viewed' && (
          counts.viewed ? (
            <ul className="space-y-2">
              {data.viewed.map((p) => (
                <ProjectRow key={p.id} p={p}
                  right={<span className="text-xs text-slate-400">
                    {new Date(p.viewed_at!).toLocaleDateString(i18n.language, { month: 'numeric', day: 'numeric' })}
                  </span>} />
              ))}
            </ul>
          ) : <Empty text={t('activity.emptyViewed')} cta={toMap} />
        )}

        {tab === 'advisors' && (
          counts.advisors ? (
            <ul className="space-y-2">
              {data.advisors.map((a) => (
                <li key={a.match_id} className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
                  {a.photo_url
                    ? <img src={a.photo_url} alt="" className="h-10 w-10 rounded-full object-cover ring-1 ring-slate-200" />
                    : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 ring-1 ring-slate-200"><UserRound className="h-5 w-5" /></span>}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{a.display_name}</div>
                    <div className="truncate text-xs text-slate-400">
                      {[a.title, a.project_name].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                    a.revealed ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {a.revealed ? t('activity.contacted') : t('activity.notContacted')}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty text={t('activity.emptyAdvisors')} />
        )}
      </div>

      {/* ── 对比:只并排他勾中的 2–4 个 ────────────────────────────────────── */}
      {tab === 'fav' && compare.length >= 2 && (
        <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            <Columns3 className="h-3.5 w-3.5 text-slate-400" />{t('activity.compare')}
          </div>
          <table className="w-full min-w-[420px] text-sm">
            <tbody>
              {([
                ['activity.rowDeveloper', (p: ActivityProject) => p.developer || '—'],
                ['activity.rowArea', (p: ActivityProject) => p.area || '—'],
                ['activity.rowPrice', (p: ActivityProject) => p.starting_price
                  ? formatMoneyCompact(p.starting_price, i18n.language) : '—'],
                ['activity.rowHandover', (p: ActivityProject) => p.completion_date
                  ? new Date(p.completion_date).toLocaleDateString(i18n.language, { year: 'numeric', month: 'short' }) : '—'],
              ] as const).map(([k, get]) => (
                <tr key={k} className="border-b border-slate-50 last:border-0">
                  <th className="w-24 px-3 py-2 text-start text-xs font-medium text-slate-400">{t(k)}</th>
                  {compare.map((p) => (
                    <td key={p.id} className="px-3 py-2 text-xs text-slate-700">{get(p)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th className="px-3 py-2 text-start text-xs font-medium text-slate-400">
                  <MapPin className="inline h-3 w-3" />
                </th>
                {compare.map((p) => (
                  <td key={p.id} className="px-3 py-2">
                    <Link to={`/project/${p.id}`} className="text-xs font-medium text-teal-600 underline-offset-2 hover:underline">
                      {p.project_name}
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
