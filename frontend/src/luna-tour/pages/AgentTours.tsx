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
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { lunaFetch, getClients, type Client } from '../lunaApi'
import ClientProfileWizard, { type Profile } from '../ui/ClientProfileWizard'
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
  overlays?: { idx: number; type: string; label: string; at: number; dur: number }[]
  transition?: string
  actIndex?: number
  isPlace?: boolean
}

export default function AgentTours() {
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  const [eventsId, setEventsId] = useState<string | null>(null)
  const [events, setEvents] = useState<EventRow[]>([])
  const [insights, setInsights] = useState<{
    plays: number
    completes: number
    completionPct: number | null
    props: { name: string; dwell_ms: number; loves: number }[]
    suggestion: string
  } | null>(null)

  // create form
  /**
   * 客户 —— 从客户雷达选,画像**自动带出来**;或用**同一个** ClientProfileWizard 新建。
   *
   * ⚠️ 旧版是两个裸输入框(客户名字 + 「一句话画像」),要经纪**手打**
   *    「香港投资客, 预算300万, 重回报」—— 而 CRM 里早就有全套结构化画像。
   *    同一个客户,经纪要在报告页做一遍画像、再到这儿手打一遍,两边还对不上。
   *    现在导览和报告读**同一份画像**(后端按 client_id 去 lt_clients 取)。
   */
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [profile, setProfile] = useState<Profile>({})
  const [showWizard, setShowWizard] = useState(false)
  const clientName = clients.find((c) => c.id === clientId)?.name ?? ''
  // 经纪想额外补一句(画像里没有的东西)——**可选**,不是必填的那个「一句话画像」
  const [oneLiner, setOneLiner] = useState('')
  const [language, setLanguage] = useState('') // '' = AI 按客户自动判断
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

  const [usage, setUsage] = useState<{ used: number; limit: number; plan: string } | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await lunaFetch(`/sessions`)
      const d = await r.json()
      setSessions(d.sessions || [])
    } catch {
      setSessions([])
    }
    try {
      const u = await lunaFetch(`/usage`)
      if (u.ok) setUsage(await u.json())
    } catch {
      /* usage optional */
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 客户列表 + 选中客户的画像 —— 和客户雷达/报告页读的是同一份
  const loadClients = () => { void getClients().then(setClients).catch(() => {}) }
  useEffect(() => { loadClients() }, [])
  useEffect(() => {
    if (!clientId) { setProfile({}); return }
    void lunaFetch(`/clients/${clientId}/profile`)
      .then((r) => r.json())
      .then((j) => setProfile(j?.profile || {}))
      .catch(() => setProfile({}))
  }, [clientId])

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
        const r = await lunaFetch(`/projects/search?q=${encodeURIComponent(q)}`)
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
      const r = await lunaFetch(`/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId || undefined,
          client: clientName ? { name: clientName } : {},
          one_liner: oneLiner,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        setMatchMsg(`❌ ${d.error || L('匹配失败', 'Match failed')}`)
      } else if (!d.matches?.length) {
        setMatchMsg(L('没有匹配到合适的楼盘,试试补充一句画像。', 'No suitable projects matched — try adding a line about the client.'))
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
        setMatchMsg(L(`✨ AI 匹配了 ${hits.length} 个,可继续增删`, `✨ AI matched ${hits.length} project${hits.length === 1 ? '' : 's'} — add or remove as you like`))
      }
    } catch (e) {
      setMatchMsg(`❌ ${e instanceof Error ? e.message : L('网络错误', 'Network error')}`)
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
          const r = await lunaFetch(`/sessions/${encodeURIComponent(code)}/gen-status`)
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
            setGenError(d.error || L('生成失败', 'Generation failed'))
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
      const r = await lunaFetch(`/sessions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_ids: picked.map((p) => p.id),
          client_id: clientId || undefined,
          client: clientName ? { name: clientName } : {},
          one_liner: oneLiner,
          ...(language ? { language } : {}),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        stopTimers()
        setGenPhase('error')
        setGenError(d.error || L('生成失败', 'Generation failed'))
      } else {
        // generation runs in the background — poll for structure + audio.
        setGenShareCode(d.shareCode || null)
        if (d.shareCode) pollGen(d.shareCode)
        setClientId('')
        setOneLiner('')
        setPicked([])
        setReasons({})
        setMatchMsg('')
      }
    } catch (e) {
      stopTimers()
      setGenPhase('error')
      setGenError(e instanceof Error ? e.message : L('网络错误', 'Network error'))
    }
    setCreating(false)
  }

  const deleteTour = async (sid: string, t: string) => {
    if (!window.confirm(L(`删除导览「${t}」?此操作不可恢复。`, `Delete tour "${t}"? This cannot be undone.`))) return
    try {
      const r = await lunaFetch(`/sessions/${sid}`, { method: 'DELETE' })
      if (r.ok) load()
    } catch {
      /* ignore */
    }
  }

  const openEvents = async (id: string) => {
    if (eventsId === id) {
      setEventsId(null)
      return
    }
    setEventsId(id)
    setEvents([])
    setInsights(null)
    try {
      const r = await lunaFetch(`/sessions/${id}/events`)
      const d = await r.json()
      setEvents(d.events || [])
    } catch {
      setEvents([])
    }
    try {
      const ir = await lunaFetch(`/sessions/${id}/insights`)
      if (ir.ok) setInsights(await ir.json())
    } catch {
      /* insights optional */
    }
  }

  function fmtMin(ms: number): string {
    const s = Math.round(ms / 1000)
    return s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s}s`
  }

  const fmtDwell = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`)
  const canMatch = !!(clientId || oneLiner.trim())

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{L('AI 导览', 'AI Tours')}</h1>
      <p className="text-sm text-slate-500 mb-6">{L('填客户信息 → 搜索或 AI 匹配楼盘 → 一键生成（分享码 / 标题自动生成）', 'Enter client info → search or AI-match projects → generate in one click (share code / title auto-generated)')}</p>

      {/* create */}
      <div className="rounded-2xl bg-white p-4 mb-8 shadow-sm ring-1 ring-slate-900/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold">{L('生成新导览', 'Generate a new tour')}</div>
          {usage && usage.limit >= 0 && (
            <span className={`text-xs ${usage.used >= usage.limit ? 'text-rose-500' : 'text-slate-400'}`}>
              {L(`本月 ${usage.used}/${usage.limit} · ${usage.plan} 套餐`, `This month ${usage.used}/${usage.limit} · ${usage.plan} plan`)}
            </span>
          )}
        </div>

        {/* ① 客户 —— 选一位,画像自动带出来。**不用再手打「一句话画像」** */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">{L('① 客户', '① Client')}</label>
          <div className="flex gap-2">
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            >
              <option value="">{L('从客户雷达选一位…', 'Pick from client radar…')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              + <span className="hidden sm:inline">{L('新客户', 'New')}</span>
            </button>
          </div>

          {/* 画像预览 —— 经纪要看得见 Luna 拿到了什么 */}
          {clientId && (
            <div className="mt-2 rounded-xl bg-slate-50 p-3">
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(profile).length === 0 ? (
                  <span className="text-xs text-slate-400">{L('这个客户还没有画像', 'No profile yet')}</span>
                ) : (
                  <TourProfileChips profile={profile} zh={zh} />
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowWizard(true)}
                className="mt-2 text-[11px] font-semibold text-teal-700 hover:underline"
              >
                {Object.keys(profile).length === 0
                  ? L('✨ 做一份画像 —— 导览的旁白会照着他的情况讲', '✨ Build a profile — the narration will speak to their situation')
                  : L('✨ 补充画像', '✨ Refine profile')}
              </button>
            </div>
          )}

          {/* 可选补充 —— 画像之外的临时信息 */}
          <input
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
            placeholder={L('这次带看想额外强调什么？(可选)', 'Anything to emphasise this time? (optional)')}
            value={oneLiner}
            onChange={(e) => setOneLiner(e.target.value)}
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-slate-500">{L('语言', 'Language')}</span>
          <select
            className="border rounded-lg px-2 py-1.5 text-sm"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">{L('AI 按客户自动判断', 'AI auto-detect from client')}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="ru">Русский</option>
          </select>
          <span className="text-xs text-slate-400">{L('旁白 + 语音都用此语言生成', 'Narration + voice are generated in this language')}</span>
        </div>

        {/* AI match */}
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            disabled={!canMatch || matching}
            onClick={aiMatch}
            className="border border-emerald-300 text-emerald-700 bg-emerald-50 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            title={canMatch ? '' : L('先选一位客户', 'Pick a client first')}
          >
            {matching ? L('AI 匹配中…', 'AI matching…') : L('✨ AI 智能匹配房源', '✨ AI smart-match projects')}
          </button>
          {matchMsg && <span className="text-sm text-slate-600">{matchMsg}</span>}
        </div>

        {/* project search + chips */}
        <div className="mt-3">
          <div className="relative">
            <input
              className="border rounded-lg px-3 py-2 text-sm w-full"
              placeholder={L('或手动搜索楼盘 (名字 / 区域 / 开发商)，点选加入 →', 'Or search projects manually (name / area / developer), click to add →')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(searching || results.length > 0) && query.trim() && (
              <div className="absolute z-20 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {searching && results.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">{L('搜索中…', 'Searching…')}</div>
                ) : results.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">{L('没有匹配的楼盘', 'No matching projects')}</div>
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
                        {already && <span className="text-xs text-emerald-600 shrink-0">{L('已加入', 'Added')}</span>}
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
                  <button type="button" onClick={() => moveProject(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 px-0.5" title={L('前移', 'Move up')}>
                    ↑
                  </button>
                  <button type="button" onClick={() => moveProject(i, 1)} disabled={i === picked.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30 px-0.5" title={L('后移', 'Move down')}>
                    ↓
                  </button>
                  <button type="button" onClick={() => removeProject(p.id)} className="text-slate-400 hover:text-red-500 px-0.5" title={L('移除', 'Remove')}>
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
            {L(
              `已选 ${picked.length} 个楼盘${picked.length < 2 ? '（至少 2 个才能生成）' : ' · 顺序即导览顺序'}`,
              `${picked.length} project${picked.length === 1 ? '' : 's'} selected${picked.length < 2 ? ' (need at least 2 to generate)' : ' · order = tour order'}`
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button disabled={creating || genPhase === 'building' || picked.length < 2} onClick={create} className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {genPhase === 'building' ? L('生成中…', 'Generating…') : genPhase === 'ready' ? L('再生成一个', 'Generate another') : L('生成导览', 'Generate tour')}
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

        <div className="text-xs text-slate-400 mt-2">{L('分享码与标题自动生成，生成后可在「流程」里编辑标题和文案。', 'Share code and title are auto-generated; after generation you can edit the title and copy under "Flow".')}</div>
      </div>

      {/* sessions */}
      <div className="font-semibold mb-3">{L('我的导览', 'My tours')} {loading ? '…' : `(${sessions.length})`}</div>
      <div className="space-y-3">
        {sessions.map((s) => (
          <div key={s.id} className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/[0.06]">
            <div className="p-4 flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[180px]">
                <div className="font-semibold">{s.title}</div>
                <div className="text-xs text-slate-500">
                  {s.client_name ? L(`客户 ${s.client_name} · `, `Client ${s.client_name} · `) : ''}
                  <a className="text-emerald-600 hover:underline" href={`/?toursession=${s.share_code}`} target="_blank" rel="noreferrer">
                    /?toursession={s.share_code} ↗
                  </a>
                </div>
              </div>
              <Stat label={L('打开', 'Opens')} v={s.opens} />
              <Stat label={L('完看', 'Completed')} v={s.completes} />
              <Stat label={L('联系', 'Contact')} v={s.cta_clicks} />
              <Stat label="❤️" v={s.loves} />
              <Stat label={L('停留', 'Dwell')} v={fmtDwell(s.total_dwell_ms)} />
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-600">{Math.round(s.lead_score)}</div>
                <div className="text-[11px] text-slate-400">{L('热度', 'Heat')}</div>
              </div>
              <a
                href={`/?toursession=${s.share_code}&edit=1`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded-lg px-3 py-1.5"
                title={L('边看边在特定点暂停留言,回来用 AI 应用', 'Pause at specific points to leave notes, then apply them with AI')}
              >
                {L('预览批注', 'Preview & annotate')}
              </a>
              <a
                href={`/factsheet/${s.share_code}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5"
                title={L('可核验的数据事实清单(可打印/存 PDF 给客户)', 'Verifiable data fact sheet (printable / save as PDF for the client)')}
              >
                {L('事实清单', 'Fact sheet')}
              </a>
              <Link
                to={`/agent/tour/${s.id}/edit`}
                className="text-sm text-white bg-ink-700 hover:bg-ink-800 rounded-lg px-3 py-1.5"
                title={L('可视化时间线编辑器', 'Visual timeline editor')}
              >
                {L('🎬 编辑器', '🎬 Editor')}
              </Link>
              <FlowToggle sessionId={s.id} onSaved={load} />
              <button onClick={() => openEvents(s.id)} className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5">
                {eventsId === s.id ? L('收起', 'Collapse') : L('行为', 'Activity')}
              </button>
              <button onClick={() => deleteTour(s.id, s.title)} className="text-sm text-rose-400 hover:text-rose-600 border border-rose-200 rounded-lg px-3 py-1.5" title={L('删除整个导览', 'Delete the entire tour')}>
                {L('删除', 'Delete')}
              </button>
            </div>
            {eventsId === s.id && insights && (
              <div className="border-t border-slate-100 p-4 bg-indigo-50/40">
                <div className="text-xs font-semibold text-indigo-700 mb-2">{L('📊 洞察', '📊 Insights')}</div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-2">
                  <span>{L('观看', 'Views')} <b>{insights.plays}</b></span>
                  <span>{L('完看', 'Completed')} <b>{insights.completes}</b></span>
                  {insights.completionPct != null && <span>{L('完看率', 'Completion rate')} <b>{insights.completionPct}%</b></span>}
                </div>
                {insights.props.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {insights.props.map((p, i) => (
                      <span key={i} className="text-xs bg-white border border-slate-200 rounded px-2 py-0.5">
                        {p.name}: {L('停留', 'dwell')} <b>{fmtMin(p.dwell_ms)}</b>{p.loves > 0 ? ` · ❤️${p.loves}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="text-sm text-slate-700 bg-white border border-indigo-100 rounded-lg px-3 py-2">
                  💡 {insights.suggestion}
                </div>
              </div>
            )}
            {eventsId === s.id && (
              <div className="border-t border-slate-100 p-4 bg-slate-50/50 max-h-72 overflow-y-auto">
                {events.length === 0 ? (
                  <div className="text-sm text-slate-400">{L('暂无行为数据', 'No activity data yet')}</div>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {events.map((e, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="text-slate-400 tabular-nums">{new Date(e.created_at).toLocaleString()}</span>
                        <span className="font-medium">{L(EVENT_ZH[e.event_type] || e.event_type, EVENT_EN[e.event_type] || e.event_type)}</span>
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
        {!loading && sessions.length === 0 && <div className="text-sm text-slate-400">{L('还没有导览，用上面的表单生成一个。', 'No tours yet — use the form above to generate one.')}</div>}
      </div>

      {/* 画像 wizard —— 和客户雷达、客户分析报告用的是**同一个组件**(不写 duplicate) */}
      {showWizard && (
        <ClientProfileWizard
          existing={clientId ? { id: clientId, name: clients.find((c) => c.id === clientId)?.name } : null}
          onClose={() => setShowWizard(false)}
          onSaved={(id, p) => {
            setShowWizard(false)
            setClientId(id)
            setProfile(p)
            loadClients()
          }}
          ctaLabel={L('保存画像', 'Save profile')}
        />
      )}
    </div>
  )
}

/** 画像小标签 —— 让经纪看得见 Luna 拿到了什么(和报告页同一套口径)。 */
function TourProfileChips({ profile: p, zh }: { profile: Profile; zh: boolean }) {
  const out: string[] = []
  if (p.goal) out.push({ live: zh ? '自住' : 'End-use', invest: zh ? '投资' : 'Investment', both: zh ? '先租后住' : 'Rent then live' }[p.goal])
  const b = p.budget_max ?? p.budget_min
  if (b) out.push(`AED ${(b / 1_000_000).toFixed(b % 1_000_000 ? 1 : 0)}M`)
  if (p.payment) out.push({ cash: zh ? '全款' : 'Cash', installment: zh ? '分期' : 'Installments', mortgage: zh ? '贷款' : 'Mortgage' }[p.payment as string] || String(p.payment))
  if (p.horizon) out.push({ rent_long: zh ? '长期收租' : 'Long-term', flip: zh ? '3-5年转手' : 'Flip', rent_then_live: zh ? '先租后住' : 'Rent then live' }[p.horizon as string] || String(p.horizon))
  if (p.family_size) out.push(zh ? `${p.family_size} 口人` : `${p.family_size} people`)
  if (p.has_children) out.push(zh ? '有小孩' : 'Kids')
  if (p.nationality) out.push(String(p.nationality))
  if (p.golden_visa) out.push(zh ? '要黄金签证' : 'Golden visa')
  return (
    <>
      {out.filter(Boolean).map((c, i) => (
        <span key={i} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">{c}</span>
      ))}
    </>
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
  const { i18n } = useTranslation()
  const zh = !!i18n.language?.startsWith('zh')
  const L = (a: string, b: string) => (zh ? a : b)

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
  // E3 — per-beat "add media" (which beat's media input is open + its url)
  const [mediaOpen, setMediaOpen] = useState<string | null>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaCap, setMediaCap] = useState('')
  const [mediaUploading, setMediaUploading] = useState(false)
  // E3 — add a place stop (beach / landmark / any POI)
  const [placeQ, setPlaceQ] = useState('')
  const [placeResults, setPlaceResults] = useState<{ name: string; category: string; lng: number; lat: number }[]>([])
  const [addingStop, setAddingStop] = useState(false)
  useEffect(() => {
    const q = placeQ.trim()
    if (q.length < 2) {
      setPlaceResults([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const r = await lunaFetch(`/place-search?q=${encodeURIComponent(q)}`)
        if (r.ok) setPlaceResults((await r.json()).places || [])
      } catch {
        /* ignore */
      }
    }, 250)
    return () => clearTimeout(t)
  }, [placeQ])

  // E4 — reorder / delete a stop (act)
  const moveStop = async (actIndex: number, dir: -1 | 1) => {
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/move-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ act_index: actIndex, dir }),
      })
      if (r.ok) {
        await reload()
        onSaved()
      }
    } catch {
      /* ignore */
    }
  }
  const deleteStop = async (actIndex: number, name: string) => {
    if (!window.confirm(L(`删除停靠点「${name}」?(可在保存的版本里回滚)`, `Delete stop "${name}"? (can be rolled back from a saved version)`))) return
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/delete-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ act_index: actIndex }),
      })
      if (r.ok) {
        await reload()
        onSaved()
      }
    } catch {
      /* ignore */
    }
  }

  const addStop = async (p: { name: string; lng: number; lat: number }) => {
    setAddingStop(true)
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/add-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: p.name, lng: p.lng, lat: p.lat }),
      })
      if (r.ok) {
        setPlaceQ('')
        setPlaceResults([])
        await reload()
        setMsg(L(`✅ 已加入地点「${p.name}」(可在该段加海景视频/改旁白,语音后台生成)`, `✅ Added place "${p.name}" (add a sea-view video / edit narration for this beat; voice is generated in the background)`))
        onSaved()
      }
    } catch {
      /* ignore */
    }
    setAddingStop(false)
  }

  const reload = async () => {
    const r = await lunaFetch(`/sessions/${sessionId}/script`)
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

  // E4 — edit a beat's overlay cards (timing / remove). Applies immediately and
  // updates the chips from the server's fresh summary (avoids index drift).
  const editOverlays = async (beatId: string, edits: { index: number; duration_ms?: number; remove?: boolean }[]) => {
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/beat-overlays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beat_id: beatId, edits }),
      })
      if (r.ok) {
        const d = (await r.json()) as { overlays: FlowBeat['overlays'] }
        setBeats((cur) => cur.map((b) => (b.id === beatId ? { ...b, overlays: d.overlays } : b)))
        onSaved()
      }
    } catch {
      /* best-effort */
    }
  }

  // E3 — upload a clip/photo to R2, then attach it to the beat
  const uploadMedia = async (beatId: string, file: File) => {
    setMediaUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await lunaFetch(`/media-upload`, { method: 'POST', body: fd })
      const ud = await up.json()
      if (!up.ok || !ud.url) {
        alert(ud.error || L('上传失败(视频/图,≤60MB)', 'Upload failed (video/image, ≤60MB)'))
      } else {
        const r = await lunaFetch(`/sessions/${sessionId}/beat-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ beat_id: beatId, media_kind: ud.media_kind, url: ud.url, caption: mediaCap.trim() || undefined }),
        })
        if (r.ok) {
          const d = (await r.json()) as { overlays: FlowBeat['overlays'] }
          setBeats((cur) => cur.map((b) => (b.id === beatId ? { ...b, overlays: d.overlays } : b)))
          setMediaOpen(null)
          setMediaUrl('')
          setMediaCap('')
          onSaved()
        }
      }
    } catch {
      alert(L('上传出错', 'Upload error'))
    }
    setMediaUploading(false)
  }

  // E3 — attach external video/image footage to a beat
  const addMedia = async (beatId: string) => {
    const url = mediaUrl.trim()
    if (!/^https?:\/\/\S+/i.test(url)) return
    const kind = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? 'video' : /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) ? 'image' : 'video'
    try {
      const r = await lunaFetch(`/sessions/${sessionId}/beat-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beat_id: beatId, media_kind: kind, url, caption: mediaCap.trim() || undefined }),
      })
      if (r.ok) {
        const d = (await r.json()) as { overlays: FlowBeat['overlays'] }
        setBeats((cur) => cur.map((b) => (b.id === beatId ? { ...b, overlays: d.overlays } : b)))
        setMediaOpen(null)
        setMediaUrl('')
        setMediaCap('')
        onSaved()
      }
    } catch {
      /* best-effort */
    }
  }

  // Apply per-beat comments with AI: posts each comment, calls /revise, reloads.
  const reviseWithAI = async () => {
    const entries = Object.entries(comments).filter(([, v]) => v.trim())
    if (!entries.length) {
      setMsg(L('先在某段下面写一句修改意见,例如「短一点」「强调海景」', 'First write a note under a beat, e.g. "shorter" or "emphasize the sea view"'))
      return
    }
    setRevising(true)
    setMsg('')
    try {
      await Promise.all(
        entries.map(([beat_id, body]) =>
          lunaFetch(`/sessions/${sessionId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ beat_id, body: body.trim() }),
          })
        )
      )
      const r = await lunaFetch(`/sessions/${sessionId}/revise`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) setMsg(`❌ ${d.error || L('改稿失败', 'Revision failed')}`)
      else if (!d.applied) setMsg(`ℹ️ ${d.message || L('AI 未产生改动', 'AI made no changes')}`)
      else {
        setComments({})
        await reload()
        setMsg(L(`✅ AI 改了 ${d.applied} 段（语音正在后台重生成）`, `✅ AI revised ${d.applied} beat${d.applied === 1 ? '' : 's'} (voice is regenerating in the background)`))
        onSaved()
      }
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : L('网络错误', 'Network error')}`)
    }
    setRevising(false)
  }

  const save = async () => {
    setSaving(true)
    setMsg('')
    try {
      const narration: Record<string, string> = {}
      for (const b of beats) narration[b.id] = b.narration
      const r = await lunaFetch(`/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, narration }),
      })
      const d = await r.json()
      if (!r.ok) setMsg(`❌ ${d.error || L('保存失败', 'Save failed')}`)
      else {
        setMsg(L('✅ 已保存', '✅ Saved'))
        onSaved()
      }
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : L('网络错误', 'Network error')}`)
    }
    setSaving(false)
  }

  return (
    <>
      <button onClick={toggle} className="text-sm text-slate-600 hover:text-slate-900 border rounded-lg px-3 py-1.5">
        {open ? L('收起', 'Collapse') : L('流程', 'Flow')}
      </button>
      {open && (
        <div className="w-full border-t border-slate-100 mt-2 pt-4">
          {loading ? (
            <div className="text-sm text-slate-400">{L('加载流程中…', 'Loading flow…')}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">{L('标题', 'Title')}</label>
                <input className="border rounded-lg px-3 py-2 text-sm w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              {beats.length === 0 ? (
                <div className="text-sm text-slate-400">{L('没有可编辑的脚本。', 'No editable script.')}</div>
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
                      {b.group !== prevGroup && (
                        <div className="flex items-center gap-2 mb-1.5 mt-1">
                          <span className="text-xs font-semibold text-emerald-700">
                            {b.isPlace ? '📍 ' : ''}{b.group}
                          </span>
                          {(b.actIndex ?? -1) >= 0 && (
                            <span className="flex items-center gap-0.5">
                              <button className="text-[11px] text-slate-400 hover:text-slate-700 px-1" title={L('上移', 'Move up')} onClick={() => moveStop(b.actIndex!, -1)}>↑</button>
                              <button className="text-[11px] text-slate-400 hover:text-slate-700 px-1" title={L('下移', 'Move down')} onClick={() => moveStop(b.actIndex!, 1)}>↓</button>
                              <button className="text-[11px] text-rose-300 hover:text-rose-600 px-1" title={L('删除这个停靠点', 'Delete this stop')} onClick={() => deleteStop(b.actIndex!, b.group)}>✕</button>
                            </span>
                          )}
                        </div>
                      )}
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] text-slate-400 bg-slate-100 rounded px-1.5 py-0.5 mt-1.5 shrink-0 w-12 text-center">
                          {L(KIND_ZH[b.kind] || b.kind, KIND_EN[b.kind] || b.kind)}
                        </span>
                        <div className="flex-1 min-w-0">
                          {/* storyboard chips: what the camera does + which cards show + timing */}
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            {(b.camera || []).map((c, ci) => (
                              <span key={`c${ci}`} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                                {c}
                              </span>
                            ))}
                            {(b.overlays || []).map((o) => (
                              <span key={`o${o.idx}`} className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                                🃏 {o.label}
                                {o.at > 0 ? ` @${o.at}s` : ''}
                                <button className="px-0.5 hover:text-amber-900 disabled:opacity-30" disabled={o.dur <= 0} onClick={() => editOverlays(b.id, [{ index: o.idx, duration_ms: Math.max(0, o.dur - 1) * 1000 }])} title={L('缩短显示', 'Shorten display')}>−</button>
                                <span className="tabular-nums">{o.dur}s</span>
                                <button className="px-0.5 hover:text-amber-900" onClick={() => editOverlays(b.id, [{ index: o.idx, duration_ms: (o.dur + 1) * 1000 }])} title={L('延长显示', 'Extend display')}>+</button>
                                <button className="px-0.5 text-rose-400 hover:text-rose-600" onClick={() => editOverlays(b.id, [{ index: o.idx, remove: true }])} title={L('移除这张卡', 'Remove this card')}>×</button>
                              </span>
                            ))}
                            {b.seconds ? <span className="text-[10px] text-slate-400">⏱ ~{b.seconds}s</span> : null}
                            <button
                              className="text-[10px] text-indigo-500 hover:text-indigo-700 border border-dashed border-indigo-200 rounded px-1.5 py-0.5"
                              onClick={() => {
                                setMediaOpen(mediaOpen === b.id ? null : b.id)
                                setMediaUrl('')
                                setMediaCap('')
                              }}
                            >
                              {L('➕ 视频/图', '➕ Video/Image')}
                            </button>
                          </div>
                          {mediaOpen === b.id && (
                            <div className="mb-1 flex flex-wrap items-center gap-1.5 bg-indigo-50/60 border border-indigo-100 rounded-md p-1.5">
                              <input
                                className="flex-1 min-w-[180px] text-xs border border-slate-300 rounded px-2 py-1"
                                placeholder={L('视频/图片直链 (https://…/clip.mp4 或 …/photo.jpg)', 'Direct video/image link (https://…/clip.mp4 or …/photo.jpg)')}
                                value={mediaUrl}
                                onChange={(e) => setMediaUrl(e.target.value)}
                              />
                              <input
                                className="w-28 text-xs border border-slate-300 rounded px-2 py-1"
                                placeholder={L('说明(可选)', 'Caption (optional)')}
                                value={mediaCap}
                                onChange={(e) => setMediaCap(e.target.value)}
                              />
                              <button
                                className="text-xs bg-indigo-500 text-white rounded px-2.5 py-1 disabled:opacity-50"
                                disabled={mediaUploading || !/^https?:\/\/\S+/i.test(mediaUrl.trim())}
                                onClick={() => addMedia(b.id)}
                              >
                                {L('加链接', 'Add link')}
                              </button>
                              <label className="text-xs bg-white border border-indigo-300 text-indigo-600 rounded px-2.5 py-1 cursor-pointer hover:border-indigo-500">
                                {mediaUploading ? L('上传中…', 'Uploading…') : L('或上传文件', 'Or upload a file')}
                                <input
                                  type="file"
                                  accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp"
                                  className="hidden"
                                  disabled={mediaUploading}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) uploadMedia(b.id, f)
                                    e.currentTarget.value = ''
                                  }}
                                />
                              </label>
                            </div>
                          )}
                          <AutoTextarea value={b.narration} onChange={(v) => setBeats((cur) => cur.map((x) => (x.id === b.id ? { ...x, narration: v } : x)))} />
                          <input
                            className="mt-1 w-full text-xs border border-dashed border-slate-300 rounded-md px-2 py-1.5 placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none"
                            placeholder={L('💬 给 AI 的修改意见（如 短一点 / 强调海景 / 这个数字改成…）', '💬 Note for AI (e.g. shorter / emphasize sea view / change this number to…)')}
                            value={comments[b.id] || ''}
                            onChange={(e) => setComments((c) => ({ ...c, [b.id]: e.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              {/* E3 — add a place stop (beach / landmark / any POI) */}
              <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 p-2.5">
                <div className="text-xs font-semibold text-indigo-700 mb-1.5">{L('➕ 加地点停靠(海滩 / 地标 / 任意 POI)', '➕ Add a place stop (beach / landmark / any POI)')}</div>
                <input
                  className="w-full text-sm border border-slate-300 rounded px-2 py-1.5"
                  placeholder={L('搜地点名(如 JBR / Marina Beach / Burj Khalifa)…', 'Search a place name (e.g. JBR / Marina Beach / Burj Khalifa)…')}
                  value={placeQ}
                  onChange={(e) => setPlaceQ(e.target.value)}
                />
                {placeResults.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {placeResults.map((p, i) => (
                      <button
                        key={i}
                        disabled={addingStop}
                        onClick={() => addStop(p)}
                        className="text-xs bg-white border border-indigo-200 hover:border-indigo-400 rounded-full px-2.5 py-1 disabled:opacity-50"
                        title={`${p.lng.toFixed(4)},${p.lat.toFixed(4)}`}
                      >
                        + {p.name} <span className="text-slate-400">· {p.category}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="text-[11px] text-slate-400 mt-1">{L('加入后会作为一个停靠点(镜头飞过去),可在该段加海景视频、改旁白。', 'Once added it becomes a stop (the camera flies to it); you can add a sea-view video and edit the narration for that beat.')}</div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button disabled={saving || revising} onClick={save} className="bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                  {saving ? L('保存中…', 'Saving…') : L('保存修改', 'Save changes')}
                </button>
                <button
                  disabled={saving || revising}
                  onClick={reviseWithAI}
                  className="bg-indigo-500 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {revising ? L('AI 改稿中…', 'AI revising…') : L('✨ 用 AI 应用评论', '✨ Apply notes with AI')}
                </button>
                {msg && <span className="text-sm">{msg}</span>}
              </div>
              <span className="text-xs text-slate-400">
                {L('直接改文字＝手动改；或在每段下写一句意见,点「用 AI 应用评论」让 AI 重写那几段（改动可在保存的版本里回滚）。改文案后该段语音会自动重生成。', 'Edit the text directly to change it manually; or write a note under a beat and click "Apply notes with AI" to have AI rewrite those beats (changes can be rolled back from a saved version). After editing copy, that beat\'s voice regenerates automatically.')}
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

const KIND_EN: Record<string, string> = {
  intro: 'Intro',
  arrival: 'Arrival',
  life: 'Life',
  numbers: 'Numbers',
  outro: 'Outro',
  beat: 'Beat',
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

const EVENT_EN: Record<string, string> = {
  open: 'Opened link',
  tour_play: 'Started watching',
  property_dwell: 'Dwelled on project',
  chart_view: 'Viewed investment chart',
  property_view: 'Actively viewed project',
  tour_complete: 'Completed the tour',
  tour_replay: 'Replayed',
  cta_whatsapp: 'Clicked to contact agent',
  feedback: 'Tapped ❤️',
}
