/**
 * Luna Tour — agent "工作台" tab (route: /agent).
 *
 * 两个核心动作(实时带看 / Luna 导览)+ 该追谁(客户雷达 CRM 的热度 Top5,
 * 不再用旧 tour-session 榜)+ Luna 导览表现汇总。
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Sparkles, ArrowRight, Flame, CalendarClock } from 'lucide-react'
import { lunaFetch, getClients, type Client, type PipelineStage } from '../lunaApi'

interface SessionRow {
  id: string
  title: string
  share_code: string
  client_name: string | null
  opens: number
  completes: number
  cta_clicks: number
  loves: number
  total_dwell_ms: number
  lead_score: number
}

const STAGE_CHIP: Record<string, { label: string; cls: string }> = {
  new: { label: '新客', cls: 'bg-blue-50 text-blue-600' },
  engaged: { label: '互动中', cls: 'bg-teal-50 text-teal-600' },
  viewing: { label: '看房', cls: 'bg-amber-50 text-amber-600' },
  offer: { label: '报价', cls: 'bg-purple-50 text-purple-600' },
  closed: { label: '成交', cls: 'bg-emerald-50 text-emerald-600' },
  lost: { label: '流失', cls: 'bg-slate-100 text-slate-400' },
}
const stageChip = (s?: PipelineStage | null) => (s ? STAGE_CHIP[s] : null)

const heatTone = (h: number) =>
  h >= 70 ? 'text-red-500' : h >= 40 ? 'text-amber-500' : 'text-slate-400'

const ago = (iso?: string | null) => {
  if (!iso) return ''
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  if (m < 1) return '刚刚'
  if (m < 60) return `${Math.round(m)} 分钟前`
  if (m < 1440) return `${Math.round(m / 60)} 小时前`
  return `${Math.round(m / 1440)} 天前`
}
const isOverdue = (iso?: string | null) => !!iso && new Date(iso).getTime() <= Date.now()

export default function AgentOverview() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [sess, cls] = await Promise.all([
        lunaFetch(`/sessions`).then((r) => r.json()).then((d) => d.sessions || []).catch(() => []),
        getClients({}).catch(() => []),
      ])
      setSessions(sess)
      setClients(cls)
      setLoading(false)
    })()
  }, [])

  const tot = sessions.reduce(
    (a, s) => ({
      opens: a.opens + s.opens,
      completes: a.completes + s.completes,
      cta: a.cta + s.cta_clicks,
      loves: a.loves + s.loves,
    }),
    { opens: 0, completes: 0, cta: 0, loves: 0 }
  )
  // 该追谁:客户雷达(CRM)按热度排,而不是旧 tour-session 榜
  const hot = [...clients].sort((a, b) => (b.heat ?? 0) - (a.heat ?? 0)).slice(0, 5)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold mb-1">经纪工作台</h1>
        <p className="text-sm text-slate-500">两种带客户看房的方式 — 选一个开始</p>
      </div>

      {/* The two hero actions — the heart of the agent console */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 1. Live co-presence tour */}
        <Link
          to="/?livetour=1"
          className="group relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-sm ring-1 ring-slate-900/10 transition hover:shadow-xl hover:-translate-y-0.5"
        >
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl" style={{ background: '#00E0B8' }} />
          <div className="relative">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,224,184,0.15)' }}>
              <Radio className="h-6 w-6" style={{ color: '#00E0B8' }} />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">实时带看</h2>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold" style={{ color: '#00E0B8' }}>LIVE</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              和客户实时同屏看房 — 镜头同步跟随、地图上一起圈点项目、语音通话、Luna 现场答数据。最适合一对一深度沟通。
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: '#00E0B8' }}>
              开始带看 <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>

        {/* 2. Luna async self-serve tour */}
        <Link
          to="/agent/tour"
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white shadow-sm ring-1 ring-emerald-600/20 transition hover:shadow-xl hover:-translate-y-0.5"
        >
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/20 opacity-40 blur-2xl" />
          <div className="relative">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold">Luna 智能导览</h2>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">AI</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-white/90">
              为客户生成一条可分享的自助看房导览 — AI 精选房源、语音讲解、5 年回报测算,客户随时打开自己看,行为还会回传给你。
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-white">
              生成导览 <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Link>
      </div>

      {/* 该追谁:客户雷达热度 Top5 */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">该追谁</h2>
        <Link to="/agent/clients" className="text-sm text-emerald-600 hover:underline">
          客户雷达 →
        </Link>
      </div>
      {loading ? (
        <div className="mb-8 text-sm text-slate-400">加载中…</div>
      ) : hot.length === 0 ? (
        <div className="mb-8 text-sm text-slate-400">
          还没有客户。<Link to="/agent/clients" className="text-emerald-600 hover:underline">去客户雷达建第一个 →</Link>
        </div>
      ) : (
        <div className="mb-8 space-y-2">
          {hot.map((c) => {
            const chip = stageChip(c.pipeline_stage)
            const overdue = isOverdue(c.next_followup_at)
            return (
              <Link
                key={c.id}
                to="/agent/clients"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 text-sm font-semibold text-teal-700">
                  {(c.name || '?').charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    {chip && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>}
                    {overdue && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                        <CalendarClock className="h-3 w-3" />跟进过期
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {c.budget ? `预算 ${c.budget} · ` : ''}{c.last_activity_at ? `活跃 ${ago(c.last_activity_at)}` : '暂无活动'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Flame className={`h-4 w-4 ${heatTone(c.heat ?? 0)}`} />
                  <span className={`text-lg font-bold ${heatTone(c.heat ?? 0)}`}>{Math.round(c.heat ?? 0)}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Luna 导览表现(只统计已分享导览的互动) */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500">Luna 导览表现</h2>
        {sessions.length > 0 && (
          <Link to="/agent/tour" className="text-xs text-slate-400 hover:text-emerald-600 hover:underline">全部导览 →</Link>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="导览数" v={loading ? '…' : sessions.length} />
        <Card label="总打开" v={loading ? '…' : tot.opens} />
        <Card label="完看" v={loading ? '…' : tot.completes} />
        <Card label="联系经纪" v={loading ? '…' : tot.cta} accent />
        <Card label="❤️ 收藏" v={loading ? '…' : tot.loves} />
      </div>
    </div>
  )
}

function Card({ label, v, accent }: { label: string; v: number | string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 text-center">
      <div className={`text-2xl font-bold ${accent ? 'text-emerald-600' : ''}`}>{v}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}
