/**
 * Luna Tour — agent "概览" tab (route: /agent).
 *
 * Aggregate engagement across the agent's tours + the hottest leads, with a
 * shortcut into the generator. Read-only; reuses /api/luna/agent/sessions.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Radio, Sparkles, ArrowRight } from 'lucide-react'
import { lunaFetch } from '../lunaApi'

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

export default function AgentOverview() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await lunaFetch(`/sessions`)
        const d = await r.json()
        setSessions(d.sessions || [])
      } catch {
        setSessions([])
      }
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
  const hot = [...sessions].sort((a, b) => b.lead_score - a.lead_score).slice(0, 5)

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold mb-1">经纪台</h1>
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

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500">整体表现</h2>
      </div>

      {/* aggregate cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Card label="导览数" v={loading ? '…' : sessions.length} />
        <Card label="总打开" v={loading ? '…' : tot.opens} />
        <Card label="完看" v={loading ? '…' : tot.completes} />
        <Card label="联系经纪" v={loading ? '…' : tot.cta} accent />
        <Card label="❤️ 收藏" v={loading ? '…' : tot.loves} />
      </div>

      {/* hottest leads */}
      <div className="font-semibold mb-3">最热客户</div>
      {loading ? (
        <div className="text-sm text-slate-400">加载中…</div>
      ) : hot.length === 0 ? (
        <div className="text-sm text-slate-400">
          还没有导览。<Link to="/agent/tour" className="text-emerald-600 hover:underline">去生成一个 →</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {hot.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white shadow-sm p-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.title}</div>
                <div className="text-xs text-slate-500 truncate">
                  {s.client_name ? `客户 ${s.client_name} · ` : ''}
                  <a className="text-emerald-600 hover:underline" href={`/?toursession=${s.share_code}`} target="_blank" rel="noreferrer">
                    /?toursession={s.share_code} ↗
                  </a>
                </div>
              </div>
              <div className="text-xs text-slate-500 shrink-0">打开 {s.opens} · 联系 {s.cta_clicks}</div>
              <div className="text-center shrink-0 w-14">
                <div className="text-lg font-bold text-emerald-600">{Math.round(s.lead_score)}</div>
                <div className="text-[11px] text-slate-400">热度</div>
              </div>
            </div>
          ))}
        </div>
      )}
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
