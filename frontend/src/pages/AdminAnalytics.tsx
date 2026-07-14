/**
 * Owner-only analytics dashboard. Assembles reusable analytics components; the
 * page itself only fetches + lays out. Access is gated by the owner email
 * allow-list: this page checks isOwnerEmail (UX), and every /api/admin/analytics
 * call is enforced server-side via requireOwner against the verified Supabase
 * token. No secret key. See docs/analytics-dashboard-spec.md §3 / §12.
 *
 * 2026-07-09 重构(docs/admin-dashboard-refactor-plan-2026-07-09.md):12→9 tab。
 * 客户(访客+流失合并)/ 功能记录(Luna导览/对话/带看/SalesOffer/报告合并)/
 * 订阅(谁付费,原经纪审批弱化)。删「经纪客户」。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Lock, LogIn, Users, Search as SearchIcon, Building2, Mic, Flame, LayoutDashboard, AlertTriangle, Activity, Heart, Phone, ShieldCheck, Handshake, CreditCard, Sparkles, Crown, Clock, Gift, BadgeCheck, Wifi, Cpu } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { isOwnerEmail } from '../lib/config'
import {
  fetchOverview, fetchSearches, fetchLuna, fetchTutorial, fetchLeads, fetchTimeseries, fetchSubscribers,
  ForbiddenError,
  Overview, DailyPoint, Counted, LunaStats, FunnelStep, Lead, RecentSearch, Timeseries, Granularity, SubscriptionSummary,
} from '../lib/analyticsApi'
import StatCard from '../components/analytics/StatCard'
import TrendChart from '../components/analytics/TrendChart'
import TopList from '../components/analytics/TopList'
import Funnel from '../components/analytics/Funnel'
import Customers from '../components/analytics/Customers'
import FeatureLog from '../components/analytics/FeatureLog'
import AgentApprovals from '../components/analytics/AgentApprovals'
import ErrorMonitor from '../components/analytics/ErrorMonitor'
import PerfMonitor from '../components/analytics/PerfMonitor'
import LiveTourTelemetry from '../components/analytics/LiveTourTelemetry'
import OpsTelemetry from '../components/analytics/OpsTelemetry'
import AgentRuns from '../components/analytics/AgentRuns'
import RevenueShare from '../components/analytics/RevenueShare'
import DeveloperVerification from '../components/analytics/DeveloperVerification'
import { fetchActiveAlerts, ActiveAlert } from '../lib/analyticsApi'

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
  { id: 'customers', label: '客户', Icon: Users },
  { id: 'search', label: '搜索 & 项目', Icon: SearchIcon },
  { id: 'features', label: '功能记录', Icon: Sparkles },
  { id: 'subscriptions', label: '订阅', Icon: CreditCard },
  { id: 'devverify', label: '开发商验证', Icon: BadgeCheck },
  { id: 'revenue', label: '分成对账', Icon: Handshake },
  { id: 'errors', label: '错误监控', Icon: AlertTriangle },
  { id: 'guardian', label: '看护', Icon: ShieldCheck },
  { id: 'perf', label: '性能负载', Icon: Activity },
  { id: 'livetour', label: '实时带看', Icon: Wifi },
  { id: 'ops', label: 'AI & 管线', Icon: Cpu },
] as const

type TabId = typeof TABS[number]['id']

interface DashData {
  overview: Overview
  daily: DailyPoint[]
  terms: Counted[]
  projects: Counted[]
  recent: RecentSearch[]
  luna: LunaStats
  funnel: FunnelStep[]
  leads: Lead[]
}

export default function AdminAnalytics() {
  const { user, loading: authLoading } = useAuth()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [gran, setGran] = useState<Granularity>('day')
  const [searchSeries, setSearchSeries] = useState<Timeseries | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [perfAlerts, setPerfAlerts] = useState<ActiveAlert[]>([])
  const [subSummary, setSubSummary] = useState<SubscriptionSummary | null>(null)

  const isOwner = isOwnerEmail(user?.email)

  useEffect(() => {
    if (!isOwner) return
    let alive = true
    setLoading(true)
    Promise.all([
      fetchOverview(days), fetchSearches(days), fetchLuna(days), fetchTutorial(days), fetchLeads(),
    ])
      .then(([ov, se, lu, tu, le]) => {
        if (!alive) return
        setData({
          overview: ov.overview, daily: ov.daily,
          terms: se.terms, projects: se.projects, recent: se.recent,
          luna: lu, funnel: tu, leads: le,
        })
        setLoading(false)
      })
      .catch((err) => {
        if (!alive) return
        if (err instanceof ForbiddenError) setForbidden(true)
        setLoading(false)
      })
    return () => { alive = false }
  }, [days, isOwner])

  // 订阅 summary(概览商业化 KPI + 订阅 tab 共用口径),与大盘独立加载。
  useEffect(() => {
    if (!isOwner) return
    let alive = true
    fetchSubscribers()
      .then((r) => alive && setSubSummary(r.summary))
      .catch(() => { /* keep null */ })
    return () => { alive = false }
  }, [isOwner])

  useEffect(() => {
    if (!isOwner) return
    let alive = true
    fetchTimeseries('search', gran, days)
      .then((ts) => alive && setSearchSeries(ts))
      .catch(() => alive && setSearchSeries(null))
    return () => { alive = false }
  }, [days, gran, isOwner])

  // Poll active perf alerts for the red banner (independent of the selected tab).
  useEffect(() => {
    if (!isOwner) return
    let alive = true
    const load = () =>
      fetchActiveAlerts()
        .then((r) => alive && setPerfAlerts(r.alerts))
        .catch(() => alive && setPerfAlerts([]))
    load()
    const id = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [isOwner])

  const visitorTrend = useMemo(
    () => (data?.daily || []).map((d) => ({ day: d.day, value: d.visitors })),
    [data]
  )
  const searchTrend = useMemo(
    () => (searchSeries?.points || []).map((p) => ({ day: p.bucket, value: p.count })),
    [searchSeries]
  )

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <LogIn className="h-8 w-8 text-slate-500" />
          </div>
          <h2 className="mb-1 text-xl font-semibold text-slate-900">需要登录</h2>
          <p className="mb-5 text-sm text-slate-500">请用所有者账户登录以查看客户数据。</p>
          <Link to="/login" className="inline-block w-full rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 py-2.5 text-sm font-medium text-white">
            去登录
          </Link>
        </div>
      </div>
    )
  }

  if (!isOwner || forbidden) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-900/[0.06]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <Lock className="h-8 w-8 text-slate-500" />
          </div>
          <h2 className="mb-1 text-xl font-semibold text-slate-900">无权限</h2>
          <p className="text-sm text-slate-500">当前账户（{user.email}）无权查看此页面。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/85 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">客户行为 · Dashboard</h1>
              <p className="truncate text-xs text-slate-400">仅 {user?.email} 可见</p>
            </div>
            <div className="inline-flex shrink-0 rounded-xl bg-slate-200/70 p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setDays(r.days)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    days === r.days ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  tab === tb.id ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <tb.Icon className="h-4 w-4" />
                {tb.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {perfAlerts.length > 0 && (
        <button
          onClick={() => setTab('perf')}
          className="block w-full bg-rose-600 px-4 py-2.5 text-left text-sm text-white hover:bg-rose-700"
        >
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" />
            <span className="font-semibold">性能告警 {perfAlerts.length} 项进行中</span>
            <span className="truncate text-rose-100">· {perfAlerts[0].message}</span>
            <span className="ml-auto shrink-0 text-rose-100">查看 →</span>
          </div>
        </button>
      )}

      <main className="mx-auto max-w-6xl px-4 py-5">
      {loading || !data ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-teal-500" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ── 概览 ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="space-y-5">
              {/* 商业化:一眼看到订阅盘子(详情在「订阅」tab) */}
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <CreditCard className="h-3.5 w-3.5" /> 商业化 · 订阅
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard label="已订阅" value={subSummary?.subscribed ?? '—'} icon={<CreditCard className="h-4 w-4" />} hint={`共 ${subSummary?.total_accounts ?? '—'} 个经纪账户`} />
                  <StatCard label="真付费" value={subSummary?.paid ?? '—'} icon={<Crown className="h-4 w-4" />} hint="走 Stripe 扣款" />
                  <StatCard label="试用 / 赠送" value={subSummary ? `${subSummary.trialing} / ${subSummary.comp}` : '—'} icon={<Gift className="h-4 w-4" />} />
                  <StatCard label="待审批" value={subSummary?.pending_approval ?? '—'} icon={<Clock className="h-4 w-4" />} hint="付费即自动准入" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                <StatCard label="独立访客" value={data.overview.visitors} icon={<Users className="h-4 w-4" />} hint={`共 ${data.overview.events} 次事件 · 去重`} />
                <StatCard label="项目浏览" value={data.overview.property_views} icon={<Building2 className="h-4 w-4" />} />
                <StatCard label="搜索" value={data.overview.searches} icon={<SearchIcon className="h-4 w-4" />} />
                <StatCard label="Luna 会话" value={data.overview.luna_sessions} icon={<Mic className="h-4 w-4" />} hint={`${data.overview.luna_opens} 次打开`} />
                <StatCard label="热 Leads" value={data.overview.leads_total} icon={<Flame className="h-4 w-4" />} hint={`本期新增 ${data.overview.leads_new}`} />
                <StatCard label="收藏" value={data.overview.favorites} icon={<Heart className="h-4 w-4" />} />
                <StatCard label="尝试联系" value={data.overview.contacts} icon={<Phone className="h-4 w-4" />} />
              </div>
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

          {/* ── 客户(访客明细 + 流失 合并)─────────────────────────────── */}
          {tab === 'customers' && <Customers days={days} leads={data.leads} />}

          {/* ── 搜索 & 项目 ───────────────────────────────────────────── */}
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

          {/* ── 功能记录(Luna导览/对话/带看/SalesOffer/报告)──────────── */}
          {tab === 'features' && <FeatureLog />}

          {/* ── 订阅(谁付费,原经纪审批弱化)──────────────────────────── */}
          {tab === 'subscriptions' && <AgentApprovals />}

          {/* ── 开发商验证(批准 → 30 天 / 600 积分试用)────────────────── */}
          {tab === 'devverify' && <DeveloperVerification />}

          {/* ── 分成对账 ──────────────────────────────────────────────── */}
          {tab === 'revenue' && <RevenueShare />}

          {/* ── 错误监控 ──────────────────────────────────────────────── */}
          {tab === 'errors' && <ErrorMonitor days={days} />}

          {/* ── 看护(cx-guardian 自治巡检记录)──────────────────────── */}
          {tab === 'guardian' && <AgentRuns days={days} />}

          {/* ── 性能负载 ──────────────────────────────────────────────── */}
          {tab === 'perf' && <PerfMonitor />}

          {/* ── 实时带看(WS 遥测 / 容量 / 进房漏斗 / 客户端体感 / Agora 成本)── */}
          {tab === 'livetour' && <LiveTourTelemetry />}

          {/* ── AI 成本 / PDF 管线 / 钱门 / Tour 漏斗 ────────────────── */}
          {tab === 'ops' && <OpsTelemetry />}
        </div>
      )}
      </main>
    </div>
  )
}
