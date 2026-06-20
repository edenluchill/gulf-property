/**
 * Owner-only analytics dashboard. Assembles reusable analytics components; the
 * page itself only fetches + lays out. Access is double-gated: this page checks
 * the owner allow-list (UX), and every /api/admin/analytics call is enforced
 * server-side via requireOwner. See docs/analytics-dashboard-spec.md §3 / §12.
 */
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Lock, Users, Search as SearchIcon, Building2, Mic, Flame, LayoutDashboard } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  fetchOverview, fetchSearches, fetchLuna, fetchTutorial, fetchLeads, fetchSessions, fetchTimeseries,
  getDashboardKey, setDashboardKey, ForbiddenError,
  Overview, DailyPoint, Counted, LunaStats, FunnelStep, Lead, SessionRow, RecentSearch, Timeseries, Granularity,
} from '../lib/analyticsApi'
import StatCard from '../components/analytics/StatCard'
import TrendChart from '../components/analytics/TrendChart'
import TopList from '../components/analytics/TopList'
import Funnel from '../components/analytics/Funnel'
import LeadTable from '../components/analytics/LeadTable'
import SessionViewer from '../components/analytics/SessionViewer'
import Visitors from '../components/analytics/Visitors'

const RANGES = [
  { label: '7 天', days: 7 },
  { label: '30 天', days: 30 },
  { label: '90 天', days: 90 },
]

const GRANS: { label: string; v: Granularity }[] = [
  { label: '日', v: 'day' },
  { label: '周', v: 'week' },
  { label: '月', v: 'month' },
]

const TABS = [
  { id: 'overview', label: '概览', Icon: LayoutDashboard },
  { id: 'visitors', label: '访客明细', Icon: Users },
  { id: 'search', label: '搜索 & 项目', Icon: SearchIcon },
  { id: 'luna', label: 'Luna 对话', Icon: Mic },
] as const

interface DashData {
  overview: Overview
  daily: DailyPoint[]
  terms: Counted[]
  projects: Counted[]
  recent: RecentSearch[]
  luna: LunaStats
  funnel: FunnelStep[]
  leads: Lead[]
  sessions: SessionRow[]
}

export default function AdminAnalytics() {
  const { user, loading: authLoading } = useAuth()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [openSession, setOpenSession] = useState<string | null>(null)
  // Access is gated by the dashboard key (server enforces it). Prompt for it if
  // missing/rejected; store in localStorage once entered.
  const [needKey, setNeedKey] = useState(!getDashboardKey())
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // Search-volume chart granularity (day/week/month), fetched independently so
  // toggling it doesn't refetch the whole dashboard.
  const [gran, setGran] = useState<Granularity>('day')
  const [searchSeries, setSearchSeries] = useState<Timeseries | null>(null)
  const [tab, setTab] = useState<'overview' | 'visitors' | 'search' | 'luna'>('overview')

  useEffect(() => {
    if (needKey) return
    let alive = true
    setLoading(true)
    Promise.all([
      fetchOverview(days), fetchSearches(days), fetchLuna(days),
      fetchTutorial(days), fetchLeads(), fetchSessions(),
    ])
      .then(([ov, se, lu, tu, le, ss]) => {
        if (!alive) return
        setData({
          overview: ov.overview, daily: ov.daily,
          terms: se.terms, projects: se.projects, recent: se.recent,
          luna: lu, funnel: tu, leads: le, sessions: ss,
        })
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        if (err instanceof ForbiddenError) {
          setNeedKey(true)
          setKeyError(true)
        }
        setLoading(false)
      })
    return () => { alive = false }
  }, [days, needKey, reloadTick])

  useEffect(() => {
    if (needKey) return
    let alive = true
    fetchTimeseries('search', gran, days)
      .then((ts) => alive && setSearchSeries(ts))
      .catch(() => alive && setSearchSeries(null))
    return () => { alive = false }
  }, [days, gran, needKey, reloadTick])

  const visitorTrend = useMemo(
    () => (data?.daily || []).map((d) => ({ day: d.day, value: d.visitors })),
    [data]
  )
  const searchTrend = useMemo(
    () => (searchSeries?.points || []).map((p) => ({ day: p.bucket, value: p.count })),
    [searchSeries]
  )

  function submitKey(e: React.FormEvent) {
    e.preventDefault()
    if (!keyInput.trim()) return
    setDashboardKey(keyInput.trim())
    setKeyError(false)
    setNeedKey(false)
    setReloadTick((t) => t + 1)
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    )
  }

  if (needKey) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <form onSubmit={submitKey} className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <Lock className="h-8 w-8 text-slate-500" />
          </div>
          <h2 className="mb-1 text-xl font-semibold text-slate-900">Dashboard 访问密钥</h2>
          <p className="mb-5 text-sm text-slate-500">输入所有者密钥以查看客户数据。</p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="dashboard key"
            autoFocus
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
          />
          {keyError && <p className="mt-2 text-xs text-rose-500">密钥不对,再试一次。</p>}
          <button type="submit" className="mt-4 w-full rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 py-2.5 text-sm font-medium text-white">
            进入
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">客户行为 · Dashboard</h1>
          <p className="text-xs text-slate-400">仅 {user?.email} 可见</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                days === r.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-teal-500" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Persistent KPI strip */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="独立访客" value={data.overview.visitors} icon={<Users className="h-4 w-4" />} hint={`共 ${data.overview.events} 次事件 · 去重`} />
            <StatCard label="项目浏览" value={data.overview.property_views} icon={<Building2 className="h-4 w-4" />} />
            <StatCard label="搜索" value={data.overview.searches} icon={<SearchIcon className="h-4 w-4" />} />
            <StatCard label="Luna 会话" value={data.overview.luna_sessions} icon={<Mic className="h-4 w-4" />} hint={`${data.overview.luna_opens} 次打开`} />
            <StatCard label="热 Leads" value={data.overview.leads_total} icon={<Flame className="h-4 w-4" />} hint={`本期新增 ${data.overview.leads_new}`} />
          </div>

          {/* Tab nav */}
          <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-900/[0.06]">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  tab === tb.id ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <tb.Icon className="h-4 w-4" />
                {tb.label}
              </button>
            ))}
          </div>

          {/* ── Overview ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <TrendChart title="每日访客" points={visitorTrend} className="md:col-span-2" />
                <div className="space-y-3">
                  <StatCard label="Luna 平均时长" value={`${Math.round(data.luna.avg_duration_ms / 1000)}s`} hint={`平均 ${data.luna.avg_turns} 轮 · ${data.luna.total_tool_calls} 次工具`} />
                  <StatCard label="搜索热词数" value={data.terms.length} hint={data.terms[0] ? `最热: ${data.terms[0].label}` : '暂无'} />
                </div>
              </div>
              <TopList title="最常看的项目" items={data.projects} />
            </div>
          )}

          {/* ── Visitors (the per-user view) ──────────────────────────────── */}
          {tab === 'visitors' && (
            <div className="space-y-5">
              <Visitors days={days} />
              <LeadTable leads={data.leads} />
            </div>
          )}

          {/* ── Search & projects ─────────────────────────────────────────── */}
          {tab === 'search' && (
            <div className="space-y-5">
              <TrendChart
                title="搜索量"
                points={searchTrend}
                headerRight={
                  <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    {GRANS.map((g) => (
                      <button
                        key={g.v}
                        onClick={() => setGran(g.v)}
                        className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                          gran === g.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {g.label}
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="grid gap-3 md:grid-cols-3">
                <TopList title="搜索热词" items={data.terms} />
                <TopList title="最常看的项目" items={data.projects} />
                <Funnel title="Tutorial 漏斗" steps={data.funnel} />
              </div>
              <div className="flex max-h-[320px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-800">最近搜索（搜了啥）</h3>
                </div>
                {data.recent.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-slate-400">这段时间没有搜索。</p>
                ) : (
                  <div className="divide-y divide-slate-50 overflow-y-auto">
                    {data.recent.map((s, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-4 py-2">
                        <div className="min-w-0">
                          <span className="truncate text-sm text-slate-700">{s.query}</span>
                          {s.kind && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{s.kind}</span>}
                        </div>
                        <span className="shrink-0 text-[10px] text-slate-400">{s.created_at.slice(5, 16).replace('T', ' ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Luna ──────────────────────────────────────────────────────── */}
          {tab === 'luna' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard label="会话数" value={data.luna.sessions} icon={<Mic className="h-4 w-4" />} />
                <StatCard label="平均时长" value={`${Math.round(data.luna.avg_duration_ms / 1000)}s`} />
                <StatCard label="平均轮次" value={data.luna.avg_turns} hint={`${data.luna.total_tool_calls} 次工具调用`} />
                <StatCard label="出错会话" value={data.luna.error_sessions} />
              </div>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-800">最近 Luna 对话</h3>
                </div>
                {data.sessions.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-slate-400">还没有对话记录。</p>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {data.sessions.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setOpenSession(s.session_id)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-slate-700">
                            {s.created_at.slice(0, 16).replace('T', ' ')}
                            {s.user_email ? ` · ${s.user_email}` : ' · 匿名'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {s.turn_count || 0} 句 · {s.tool_call_count || 0} 工具
                            {s.had_error ? ' · ⚠️ 有错误' : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">
                          {s.duration_ms ? `${Math.round(s.duration_ms / 1000)}s` : '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {openSession && <SessionViewer sessionId={openSession} onClose={() => setOpenSession(null)} />}
    </div>
    </div>
  )
}
