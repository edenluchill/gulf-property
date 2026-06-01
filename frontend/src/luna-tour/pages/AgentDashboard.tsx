/**
 * Luna Tour — agent dashboard (Phase 2 MVP).
 *
 * Route: /luna/agent (inside the normal app shell). No auth yet — backend
 * operates on the demo agent. Lists the agent's sessions with engagement
 * rollups, lets you generate a new tour for given project ids (with an optional
 * one-liner brief → AI auto-config), and drills into a session's behaviour
 * timeline. Delete this file + the route + luna-tour/ to remove.
 */
import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'

interface SessionRow {
  id: string
  title: string
  share_code: string
  status: string
  is_published: boolean
  created_at: string
  client_name: string | null
  opens: number
  plays: number
  completes: number
  cta_clicks: number
  loves: number
  total_dwell_ms: number
  lead_score: number
}

interface EventRow {
  event_type: string
  visitor_id: string
  project_id: string | null
  project_name: string | null
  dwell_ms: number | null
  created_at: string
}

const API = `${API_BASE_URL}/api/luna/agent`

export default function AgentDashboard() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])

  // create form
  const [shareCode, setShareCode] = useState('')
  const [projectIds, setProjectIds] = useState('')
  const [title, setTitle] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`${API}/sessions`)
      const d = await r.json()
      setSessions(d.sessions || [])
    } catch {
      setSessions([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openTimeline = async (id: string) => {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    setEvents([])
    try {
      const r = await fetch(`${API}/sessions/${id}/events`)
      const d = await r.json()
      setEvents(d.events || [])
    } catch {
      setEvents([])
    }
  }

  const create = async () => {
    setCreating(true)
    setCreateMsg('')
    try {
      const ids = projectIds.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
      const r = await fetch(`${API}/sessions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_code: shareCode, project_ids: ids, title, one_liner: oneLiner }),
      })
      const d = await r.json()
      if (!r.ok) {
        setCreateMsg(`❌ ${d.error || '生成失败'}`)
      } else {
        setCreateMsg(`✅ 已生成 · ${d.watch_url}`)
        setShareCode('')
        setProjectIds('')
        setTitle('')
        setOneLiner('')
        load()
      }
    } catch (e) {
      setCreateMsg(`❌ ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setCreating(false)
  }

  const fmtDwell = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`)

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-1">Luna Tour · 经纪后台</h1>
      <p className="text-sm text-slate-500 mb-6">导览列表、客户行为、一键生成（MVP，暂用 demo 经纪账户）</p>

      {/* create */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-8 shadow-sm">
        <div className="font-semibold mb-3">生成新导览</div>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="border rounded-lg px-3 py-2 text-sm" placeholder="分享码 (如 sarah-marina)" value={shareCode} onChange={(e) => setShareCode(e.target.value)} />
          <input className="border rounded-lg px-3 py-2 text-sm" placeholder="标题 (可选)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="楼盘 ID, 逗号分隔 (≥2)" value={projectIds} onChange={(e) => setProjectIds(e.target.value)} />
          <input className="border rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="一句话 (可选, 如「香港投资客, 重回报, 3分钟」→ AI 自动配置)" value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button disabled={creating} onClick={create} className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {creating ? '生成中… (~10s)' : '生成导览'}
          </button>
          {createMsg && <span className="text-sm">{createMsg}</span>}
        </div>
      </div>

      {/* sessions */}
      <div className="font-semibold mb-3">我的导览 {loading ? '…' : `(${sessions.length})`}</div>
      <div className="space-y-3">
        {sessions.map((s) => (
          <div key={s.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold">{s.title}</div>
                <div className="text-xs text-slate-500">
                  {s.client_name ? `客户 ${s.client_name} · ` : ''}
                  <a className="text-emerald-600 hover:underline" href={`/?toursession=${s.share_code}`} target="_blank" rel="noreferrer">/?toursession={s.share_code} ↗</a>
                </div>
              </div>
              <Stat label="打开" v={s.opens} />
              <Stat label="完看" v={s.completes} />
              <Stat label="联系" v={s.cta_clicks} />
              <Stat label="❤️" v={s.loves} />
              <Stat label="停留" v={fmtDwell(s.total_dwell_ms)} />
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-600">{Math.round(s.lead_score)}</div>
                <div className="text-[11px] text-slate-400">热度</div>
              </div>
              <button onClick={() => openTimeline(s.id)} className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5">
                {openId === s.id ? '收起' : '行为'}
              </button>
            </div>
            {openId === s.id && (
              <div className="border-t border-slate-100 p-4 bg-slate-50/50 max-h-72 overflow-y-auto">
                {events.length === 0 ? (
                  <div className="text-sm text-slate-400">暂无行为数据</div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {events.map((e, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-slate-400 tabular-nums">{new Date(e.created_at).toLocaleString()}</span>
                        <span className="font-medium">{EVENT_ZH[e.event_type] || e.event_type}</span>
                        {e.project_name && <span className="text-slate-500">· {e.project_name}</span>}
                        {e.dwell_ms != null && <span className="text-slate-400">· {fmtDwell(e.dwell_ms)}</span>}
                        <span className="text-slate-300 ml-auto">{e.visitor_id.slice(0, 8)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && sessions.length === 0 && <div className="text-sm text-slate-400">还没有导览，用上面的表单生成一个。</div>}
      </div>
    </div>
  )
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="text-center min-w-[44px]">
      <div className="text-lg font-bold">{v}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

const EVENT_ZH: Record<string, string> = {
  open: '打开链接',
  tour_play: '开始观看',
  property_dwell: '停留在楼盘',
  chart_view: '看了投资图',
  property_view: '主动查看楼盘',
  tour_complete: '看完整个导览',
  tour_replay: '重看',
  cta_whatsapp: '点击联系经纪',
  feedback: '点了 ❤️',
}
