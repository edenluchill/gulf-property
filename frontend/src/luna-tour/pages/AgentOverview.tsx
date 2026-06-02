/**
 * Luna Tour — agent "概览" tab (route: /agent).
 *
 * Aggregate engagement across the agent's tours + the hottest leads, with a
 * shortcut into the generator. Read-only; reuses /api/luna/agent/sessions.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE_URL } from '../../lib/config'

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

const API = `${API_BASE_URL}/api/luna/agent`

export default function AgentOverview() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch(`${API}/sessions`)
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-1">概览</h1>
          <p className="text-sm text-slate-500">所有导览的整体表现与最热客户</p>
        </div>
        <Link to="/agent/tour" className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium">
          + 生成新导览
        </Link>
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
