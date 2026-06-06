/**
 * Luna Tour — agent "生成导览" tab (route: /luna/agent/tour).
 *
 * Generates a new tour from CLIENT INFO + a searched/selected (or AI-matched)
 * set of projects (share code + title auto-generated); lists the agent's
 * sessions with engagement rollups; and drills into a session's behaviour
 * timeline OR its tour flow (per-beat narration + title, editable). No auth yet
 * — backend operates on the demo agent. Delete luna-tour/ + the routes to remove.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '../../lib/config'
import GenerationProgress from './GenerationProgress'

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

interface ProjectHit {
  id: string
  project_name: string
  area: string | null
  developer: string | null
  primary_image: string | null
  min_price: number | string | null
  max_price: number | string | null
}

interface FlowBeat {
  id: string
  group: string
  kind: string
  narration: string
  seconds?: number
  camera?: string[]
  overlays?: { label: string; at: number; dur: number }[]
  transition?: string
}

const API = `${API_BASE_URL}/api/luna/agent`

export default function AgentTours() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  const [eventsId, setEventsId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])

  // create form
  const [clientName, setClientName] = useState('')
  const [oneLiner, setOneLiner] = useState('')
  const [picked, setPicked] = useState<ProjectHit[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProjectHit[]>([])
  const [searching, setSearching] = useState(false)
  const [matching, setMatching] = useState(false)
  const [matchMsg, setMatchMsg] = useState('')
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')
  // generation progress + tour-structure node diagram
  const [genPhase, setGenPhase] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [genStage, setGenStage] = useState(0)
  const [genStops, setGenStops] = useState<string[]>([])
  const [genShareCode, setGenShareCode] = useState<string | null>(null)
  const [audioReady, setAudioReady] = useState(0)
  const [audioTotal, setAudioTotal] = useState(0)
  const [genError, setGenError] = useState('')
  const stageTimer = useRef<number | null>(null)
  const audioTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (stageTimer.current) window.clearInterval(stageTimer.current)
      if (audioTimer.current) window.clearInterval(audioTimer.current)
    },
    []
  )

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

  // ── project search (debounced) ────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim()
    if (q.length < 1) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/projects/search?q=${encodeURIComponent(q)}`)
        const d = await r.json()
        setResults(d.projects || [])
      } catch {
        setResults([])
      }
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const addProject = (p: ProjectHit) => {
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur : [...cur, p]))
    setQuery('')
    setResults([])
  }
  const removeProject = (id: string) => {
    setPicked((cur) => cur.filter((x) => x.id !== id))
    setReasons((cur) => {
      const { [id]: _drop, ...rest } = cur
      return rest
    })
  }
  const moveProject = (idx: number, dir: -1 | 1) =>
    setPicked((cur) => {
      const j = idx + dir
      if (j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })

  const aiMatch = async () => {
    setMatching(true)
    setMatchMsg('')
    try {
      const r = await fetch(`${API}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: clientName.trim() ? { name: clientName.trim() } : {},
          one_liner: oneLiner,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        setMatchMsg(`❌ ${d.error || '匹配失败'}`)
      } else if (!d.matches?.length) {
        setMatchMsg('没有匹配到合适的楼盘,试试补充一句画像。')
      } else {
        const hits: ProjectHit[] = d.matches.map((m: { id: string; project_name: string; area: string | null }) => ({
          id: m.id,
          project_name: m.project_name,
          area: m.area,
          developer: null,
          primary_image: null,
          min_price: null,
          max_price: null,
        }))
        setPicked(hits)
        setReasons(Object.fromEntries(d.matches.map((m: { id: string; reason: string }) => [m.id, m.reason])))
        setMatchMsg(`✨ AI 匹配了 ${hits.length} 个,可继续增删`)
      }
    } catch (e) {
      setMatchMsg(`❌ ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setMatching(false)
  }

  const stopTimers = useCallback(() => {
    if (stageTimer.current) {
      window.clearInterval(stageTimer.current)
      stageTimer.current = null
    }
    if (audioTimer.current) {
      window.clearInterval(audioTimer.current)
      audioTimer.current = null
    }
  }, [])

  // poll the backend generation job: building → ready (with structure) → audio backfill
  const pollGen = useCallback(
    (code: string) => {
      if (audioTimer.current) window.clearInterval(audioTimer.current)
      let switchedToReady = false
      const tick = async () => {
        try {
          const r = await fetch(`${API}/sessions/${encodeURIComponent(code)}/gen-status`)
          if (!r.ok) return
          const d = (await r.json()) as {
            status: 'generating' | 'ready' | 'failed'
            stops: string[] | null
            audioTotal: number | null
            audioReady: number
            error: string | null
          }
          if (d.status === 'failed') {
            stopTimers()
            setGenPhase('error')
            setGenError(d.error || '生成失败')
            return
          }
          if (d.status === 'ready') {
            if (!switchedToReady) {
              switchedToReady = true
              if (stageTimer.current) {
                window.clearInterval(stageTimer.current)
                stageTimer.current = null
              }
              setGenPhase('ready')
              setGenStops(Array.isArray(d.stops) ? d.stops : [])
              setAudioTotal(d.audioTotal || 0)
              load() // refresh "我的导览" list
            }
            setAudioReady(d.audioReady || 0)
            if ((d.audioTotal || 0) > 0 && (d.audioReady || 0) >= (d.audioTotal || 0)) {
              stopTimers()
            }
          }
        } catch {
          /* best-effort poll */
        }
      }
      void tick()
      audioTimer.current = window.setInterval(tick, 2500)
    },
    [load, stopTimers]
  )

  const create = async () => {
    if (picked.length < 2) return
    setCreating(true)
    setCreateMsg('')
    setGenError('')
    setGenStops([])
    setGenShareCode(null)
    setAudioReady(0)
    setAudioTotal(0)
    setGenPhase('building')
    setGenStage(0)
    stopTimers()
    // cosmetic build-stage advance (confirm → real data → AI script) while the
    // backend job runs; the REAL milestone (structure ready) comes from polling.
    stageTimer.current = window.setInterval(() => setGenStage((s) => Math.min(s + 1, 2)), 3500)
    try {
      const r = await fetch(`${API}/sessions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_ids: picked.map((p) => p.id),
          client: clientName.trim() ? { name: clientName.trim() } : {},
          one_liner: oneLiner,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        stopTimers()
        setGenPhase('error')
        setGenError(d.error || '生成失败')
      } else {
        // generation runs in the background — poll for structure + audio.
        setGenShareCode(d.shareCode || null)
        if (d.shareCode) pollGen(d.shareCode)
        setClientName('')
        setOneLiner('')
        setPicked([])
        setReasons({})
        setMatchMsg('')
      }
    } catch (e) {
      stopTimers()
      setGenPhase('error')
      setGenError(e instanceof Error ? e.message : '网络错误')
    }
    setCreating(false)
  }

  const openEvents = async (id: string) => {
    if (eventsId === id) {
      setEventsId(null)
      return
    }
    setEventsId(id)
    setEvents([])
    try {
      const r = await fetch(`${API}/sessions/${id}/events`)
      const d = await r.json()
      setEvents(d.events || [])
    } catch {
      setEvents([])
    }
  }

  const fmtDwell = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`)
  const canMatch = !!(clientName.trim() || oneLiner.trim())

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">生成导览</h1>
      <p className="text-sm text-slate-500 mb-6">填客户信息 → 搜索或 AI 匹配楼盘 → 一键生成（分享码 / 标题自动生成）</p>

      {/* create */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-8 shadow-sm">
        <div className="font-semibold mb-3">生成新导览</div>

        {/* client info */}
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="客户名字 (如 陈先生)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
          <input
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="客户一句话画像 (如「香港投资客, 预算300万, 重回报」)"
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
          />
        </div>

        {/* AI match */}
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            disabled={!canMatch || matching}
            onClick={aiMatch}
            className="border border-emerald-300 text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            title={canMatch ? '' : '先填客户名字或一句话画像'}
          >
            {matching ? 'AI 匹配中…' : '✨ AI 智能匹配房源'}
          </button>
          {matchMsg && <span className="text-sm text-slate-600">{matchMsg}</span>}
        </div>

        {/* project search + chips */}
        <div className="mt-3">
          <div className="relative">
            <input
              className="border rounded-lg px-3 py-2 text-sm w-full"
              placeholder="或手动搜索楼盘 (名字 / 区域 / 开发商)，点选加入 →"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(searching || results.length > 0) && query.trim() && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {searching && results.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">搜索中…</div>
                ) : results.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">没有匹配的楼盘</div>
                ) : (
                  results.map((p) => {
                    const already = picked.some((x) => x.id === p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={already}
                        onClick={() => addProject(p)}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed border-b border-slate-50 last:border-0"
                      >
                        {p.primary_image ? (
                          <img src={p.primary_image} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded bg-slate-100 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{p.project_name}</div>
                          <div className="text-xs text-slate-400 truncate">
                            {[p.area, p.developer].filter(Boolean).join(' · ') || 'Dubai'}
                          </div>
                        </div>
                        {already && <span className="text-xs text-emerald-600 shrink-0">已加入</span>}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* selected chips, in tour order */}
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {picked.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full pl-2.5 pr-1.5 py-1 text-sm"
                >
                  <span className="text-emerald-700 font-medium text-xs tabular-nums">{i + 1}</span>
                  <span className="truncate max-w-[160px]">{p.project_name}</span>
                  <button type="button" onClick={() => moveProject(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 px-0.5" title="前移">
                    ↑
                  </button>
                  <button type="button" onClick={() => moveProject(i, 1)} disabled={i === picked.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 px-0.5" title="后移">
                    ↓
                  </button>
                  <button type="button" onClick={() => removeProject(p.id)} className="text-slate-400 hover:text-red-500 px-0.5" title="移除">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* AI reasons (why each fits) */}
          {picked.some((p) => reasons[p.id]) && (
            <ul className="mt-3 space-y-1.5">
              {picked.map((p, i) =>
                reasons[p.id] ? (
                  <li key={p.id} className="text-xs text-slate-600 flex gap-2">
                    <span className="text-emerald-600 font-medium shrink-0">{i + 1}. {p.project_name}</span>
                    <span className="text-slate-500">— {reasons[p.id]}</span>
                  </li>
                ) : null
              )}
            </ul>
          )}

          <div className="text-xs text-slate-400 mt-2">
            已选 {picked.length} 个楼盘{picked.length < 2 ? '（至少 2 个才能生成）' : ' · 顺序即导览顺序'}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button disabled={creating || genPhase === 'building' || picked.length < 2} onClick={create} className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {genPhase === 'building' ? '生成中…' : genPhase === 'ready' ? '再生成一个' : '生成导览'}
          </button>
          {createMsg && <span className="text-sm">{createMsg}</span>}
        </div>

        {genPhase !== 'idle' && (
          <GenerationProgress
            phase={genPhase}
            stage={genStage}
            stops={genStops}
            audioReady={audioReady}
            audioTotal={audioTotal}
            shareCode={genShareCode}
            error={genError}
          />
        )}

        <div className="text-xs text-slate-400 mt-2">分享码与标题自动生成，生成后可在「流程」里编辑标题和文案。</div>
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
                  <a className="text-emerald-600 hover:underline" href={`/?toursession=${s.share_code}`} target="_blank" rel="noreferrer">
                    /?toursession={s.share_code} ↗
                  </a>
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
              <a
                href={`/?toursession=${s.share_code}&edit=1`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5"
                title="边看边在特定点暂停留言,回来用 AI 应用"
              >
                预览批注
              </a>
              <FlowToggle sessionId={s.id} onSaved={load} />
              <button onClick={() => openEvents(s.id)} className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5">
                {eventsId === s.id ? '收起' : '行为'}
              </button>
            </div>
            {eventsId === s.id && (
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

/** Textarea that grows to fit its content (no inner scroll). */
function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      className="border rounded-lg px-3 py-2 text-sm w-full resize-none overflow-hidden leading-relaxed"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
    />
  )
}

/** Toggle + inline editor for a session's tour flow (title + per-beat narration). */
function FlowToggle({ sessionId, onSaved }: { sessionId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState('')
  const [beats, setBeats] = useState<FlowBeat[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const loadedFor = useRef<string | null>(null)
  // E2 — per-beat comments for AI revise
  const [comments, setComments] = useState<Record<string, string>>({})
  const [revising, setRevising] = useState(false)

  const reload = async () => {
    const r = await fetch(`${API}/sessions/${sessionId}/script`)
    const d = await r.json()
    setTitle(d.title || '')
    setBeats(d.flow || [])
  }

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setMsg('')
    if (loadedFor.current === sessionId) return
    setLoading(true)
    try {
      await reload()
      loadedFor.current = sessionId
    } catch {
      setBeats([])
    }
    setLoading(false)
  }

  // Apply per-beat comments with AI: posts each comment, calls /revise, reloads.
  const reviseWithAI = async () => {
    const entries = Object.entries(comments).filter(([, v]) => v.trim())
    if (!entries.length) {
      setMsg('先在某段下面写一句修改意见,例如「短一点」「强调海景」')
      return
    }
    setRevising(true)
    setMsg('')
    try {
      await Promise.all(
        entries.map(([beat_id, body]) =>
          fetch(`${API}/sessions/${sessionId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ beat_id, body: body.trim() }),
          })
        )
      )
      const r = await fetch(`${API}/sessions/${sessionId}/revise`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) setMsg(`❌ ${d.error || '改稿失败'}`)
      else if (!d.applied) setMsg(`ℹ️ ${d.message || 'AI 未产生改动'}`)
      else {
        setComments({})
        await reload()
        setMsg(`✅ AI 改了 ${d.applied} 段（语音正在后台重生成）`)
        onSaved()
      }
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setRevising(false)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const narration: Record<string, string> = {}
      for (const b of beats) narration[b.id] = b.narration
      const r = await fetch(`${API}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, narration }),
      })
      const d = await r.json()
      if (!r.ok) setMsg(`❌ ${d.error || '保存失败'}`)
      else {
        setMsg('✅ 已保存')
        onSaved()
      }
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : '网络错误'}`)
    }
    setSaving(false)
  }

  return (
    <>
      <button onClick={toggle} className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5">
        {open ? '收起' : '流程'}
      </button>
      {open && (
        <div className="w-full border-t border-slate-100 mt-2 pt-4">
          {loading ? (
            <div className="text-sm text-slate-400">加载流程中…</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">标题</label>
                <input className="border rounded-lg px-3 py-2 text-sm w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {beats.length === 0 ? (
                <div className="text-sm text-slate-400">没有可编辑的脚本。</div>
              ) : (
                beats.map((b, i) => {
                  const prevGroup = i > 0 ? beats[i - 1].group : null
                  return (
                    <div key={b.id}>
                      {b.transition && (
                        <div className="my-2 flex items-center gap-2 text-[11px] text-indigo-500">
                          <span className="flex-1 border-t border-dashed border-indigo-200" />
                          🎬 {b.transition}
                          <span className="flex-1 border-t border-dashed border-indigo-200" />
                        </div>
                      )}
                      {b.group !== prevGroup && <div className="text-xs font-semibold text-emerald-700 mb-1.5 mt-1">{b.group}</div>}
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 mt-1.5 shrink-0 w-12 text-center">
                          {KIND_ZH[b.kind] || b.kind}
                        </span>
                        <div className="flex-1 min-w-0">
                          {/* storyboard chips: what the camera does + which cards show + timing */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            {(b.camera || []).map((c, ci) => (
                              <span key={`c${ci}`} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                                {c}
                              </span>
                            ))}
                            {(b.overlays || []).map((o, oi) => (
                              <span key={`o${oi}`} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                                🃏 {o.label}
                                {o.at > 0 ? ` @${o.at}s` : ''}
                                {o.dur > 0 ? `·${o.dur}s` : ''}
                              </span>
                            ))}
                            {b.seconds ? <span className="text-[10px] text-slate-400">⏱ ~{b.seconds}s</span> : null}
                          </div>
                          <AutoTextarea value={b.narration} onChange={(v) => setBeats((cur) => cur.map((x) => (x.id === b.id ? { ...x, narration: v } : x)))} />
                          <input
                            className="mt-1 w-full text-xs border border-dashed border-slate-300 rounded-md px-2 py-1.5 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
                            placeholder="💬 给 AI 的修改意见（如 短一点 / 强调海景 / 这个数字改成…）"
                            value={comments[b.id] || ''}
                            onChange={(e) => setComments((c) => ({ ...c, [b.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <button disabled={saving || revising} onClick={save} className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                  {saving ? '保存中…' : '保存修改'}
                </button>
                <button
                  disabled={saving || revising}
                  onClick={reviseWithAI}
                  className="bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {revising ? 'AI 改稿中…' : '✨ 用 AI 应用评论'}
                </button>
                {msg && <span className="text-sm">{msg}</span>}
              </div>
              <span className="text-xs text-slate-400">
                直接改文字＝手动改；或在每段下写一句意见,点「用 AI 应用评论」让 AI 重写那几段（改动可在保存的版本里回滚）。改文案后该段语音会自动重生成。
              </span>
            </div>
          )}
        </div>
      )}
    </>
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

const KIND_ZH: Record<string, string> = {
  intro: '开场',
  arrival: '到达',
  life: '生活',
  numbers: '数字',
  outro: '结尾',
  beat: '段落',
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
