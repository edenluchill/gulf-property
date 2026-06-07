/**
 * Luna Tour — NLE-style storyboard EDITOR (route /agent/tour/:id/edit).
 *
 * A video-editor timeline: a time ruler + horizontal tracks (镜头 / 旁白 / 卡片)
 * where every beat and every overlay card is a CLIP positioned by absolute time,
 * vertically aligned. Overlay clips drag to move / trim (→ beat-overlays at_ms /
 * duration_ms). Stop bands above the tracks reorder / delete / add place. A right
 * panel edits the selected beat (narration / AI comment / cards / media).
 * Reuses every agent edit endpoint via lunaFetch.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { lunaFetch } from '../lunaApi'
import { API_BASE_URL } from '../../lib/config'

/** R2 images need the CORS proxy to render in the editor canvas. */
const proxied = (u?: string) =>
  u && /^https:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(u) ? `${API_BASE_URL}/api/luna/public/img?u=${encodeURIComponent(u)}` : u

interface OverlayChip { idx: number; type: string; label: string; at: number; dur: number; image?: string; value?: string }
interface Node {
  id: string
  group: string
  kind: string
  narration: string
  seconds?: number
  camera?: string[]
  overlays?: OverlayChip[]
  transition?: string
  transitionType?: string
  actIndex?: number
  isPlace?: boolean
}
interface Laid extends Node { start: number; dur: number }
interface Band { actIndex: number; name: string; isPlace: boolean; start: number; end: number; transition?: string; transitionType?: string; image?: string }

const KIND_ZH: Record<string, string> = { intro: '开场', arrival: '到达', life: '生活', numbers: '数字', outro: '结尾', beat: '段落' }
// plain-language labels for the SIMPLE mode (non-professional agents)
const KIND_FRIENDLY: Record<string, string> = { intro: '开场介绍', arrival: '登场亮相', life: '生活与配套', numbers: '投资数字', outro: '结尾邀约', beat: '片段' }
const OV_FRIENDLY: Record<string, string> = { title: '标题文字', property_card: '房源信息卡', roi_card: '投资回报', distance_line: '到某地的距离', amenity_spokes: '周边配套', media: '实拍视频/图片', cta: '联系按钮' }
const OV_HIDE = new Set(['progress_dots', 'highlight_all_pins']) // system overlays — hide from non-pros
const DEFAULT_BEAT_S = 10
const GUTTER = 56 // left track-label column width (px)

type DragState = {
  beatId: string
  idx: number
  mode: 'move' | 'trim'
  startX: number
  origAt: number
  origDur: number
  beatStart: number
  beatDur: number
  liveAt: number
  liveDur: number
}

export default function TourEditor() {
  const { id = '' } = useParams<{ id: string }>()
  const [title, setTitle] = useState('')
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [mode, setMode] = useState<'simple' | 'timeline'>('simple')
  const [px, setPx] = useState(16) // pixels per second (zoom)
  const [placeQ, setPlaceQ] = useState('')
  const [placeResults, setPlaceResults] = useState<{ name: string; category: string; lng: number; lat: number }[]>([])
  const [mediaUrl, setMediaUrl] = useState('')
  const [mediaCap, setMediaCap] = useState('')
  const [mediaBusy, setMediaBusy] = useState(false)
  const drag = useRef<DragState | null>(null)
  const [, force] = useState(0)

  const reload = useCallback(async () => {
    const r = await lunaFetch(`/sessions/${id}/script`)
    const d = await r.json()
    setTitle(d.title || '')
    setNodes(d.flow || [])
  }, [id])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try { await reload() } catch { /* ignore */ }
      setLoading(false)
    })()
  }, [reload])

  useEffect(() => {
    const q = placeQ.trim()
    if (q.length < 2) return setPlaceResults([])
    const t = setTimeout(async () => {
      try {
        const r = await lunaFetch(`/place-search?q=${encodeURIComponent(q)}`)
        if (r.ok) setPlaceResults((await r.json()).places || [])
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(t)
  }, [placeQ])

  // ── layout: absolute time for each beat + overlay ──────────────────────────
  let t = 0
  const laid: Laid[] = nodes.map((n) => {
    const dur = n.seconds && n.seconds > 0 ? n.seconds : DEFAULT_BEAT_S
    const start = t
    t += dur
    return { ...n, start, dur }
  })
  const totalSec = Math.max(t, 30)
  const bands: Band[] = []
  for (const b of laid) {
    const ai = b.actIndex ?? -1
    const last = bands[bands.length - 1]
    const beatImg = (b.overlays || []).find((o) => o.image)?.image
    if (!last || last.actIndex !== ai || (ai === -1 && last.name !== b.group)) {
      bands.push({ actIndex: ai, name: b.group, isPlace: !!b.isPlace, start: b.start, end: b.start + b.dur, transition: b.transition, transitionType: b.transitionType, image: beatImg })
    } else {
      last.end = b.start + b.dur
      if (!last.image && beatImg) last.image = beatImg
    }
  }
  const sel = laid.find((n) => n.id === selId) || null
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  // ── overlay drag (move / trim) → beat-overlays ─────────────────────────────
  const onDragMove = (e: MouseEvent) => {
    const d = drag.current
    if (!d) return
    const dSec = (e.clientX - d.startX) / px
    if (d.mode === 'move') {
      d.liveAt = Math.max(0, Math.min(d.beatDur - d.liveDur, d.origAt + dSec))
    } else {
      d.liveDur = Math.max(1, Math.min(d.beatDur - d.origAt, d.origDur + dSec))
    }
    force((n) => n + 1)
  }
  const onDragUp = async () => {
    const d = drag.current
    window.removeEventListener('mousemove', onDragMove)
    window.removeEventListener('mouseup', onDragUp)
    drag.current = null
    if (!d) return
    const edit = d.mode === 'move'
      ? { index: d.idx, at_ms: Math.round(d.liveAt * 1000) }
      : { index: d.idx, duration_ms: Math.round(d.liveDur * 1000) }
    try {
      const r = await lunaFetch(`/sessions/${id}/beat-overlays`, { method: 'POST', body: JSON.stringify({ beat_id: d.beatId, edits: [edit] }) })
      if (r.ok) {
        const j = await r.json()
        setNodes((cur) => cur.map((n) => (n.id === d.beatId ? { ...n, overlays: j.overlays } : n)))
      }
    } catch { /* ignore */ }
    force((n) => n + 1)
  }
  const startDrag = (e: React.MouseEvent, beat: Laid, ov: OverlayChip, mode: 'move' | 'trim') => {
    e.stopPropagation()
    e.preventDefault()
    const dur = ov.dur > 0 ? ov.dur : Math.max(2, beat.dur - ov.at)
    drag.current = { beatId: beat.id, idx: ov.idx, mode, startX: e.clientX, origAt: ov.at, origDur: dur, beatStart: beat.start, beatDur: beat.dur, liveAt: ov.at, liveDur: dur }
    setSelId(beat.id)
    window.addEventListener('mousemove', onDragMove)
    window.addEventListener('mouseup', onDragUp)
  }

  // ── edit ops (reuse endpoints) ─────────────────────────────────────────────
  const saveNarration = async () => {
    setBusy(true)
    try {
      const narration: Record<string, string> = {}
      for (const n of nodes) narration[n.id] = n.narration
      const r = await lunaFetch(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title, narration }) })
      flash(r.ok ? '✅ 已保存' : '❌ 保存失败')
    } catch { flash('❌ 网络错误') }
    setBusy(false)
  }
  // simple-mode: improve ONE beat with AI (post its comment, then revise)
  const reviseBeat = async (beatId: string) => {
    const body = (comments[beatId] || '').trim()
    if (!body) return
    setBusy(true)
    try {
      await lunaFetch(`/sessions/${id}/comments`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, body }) })
      const r = await lunaFetch(`/sessions/${id}/revise`, { method: 'POST' })
      const d = await r.json()
      if (d.applied) { setComments((c) => ({ ...c, [beatId]: '' })); await reload(); flash('✅ AI 已改写这段') }
      else flash(`ℹ️ ${d.message || 'AI 未改动'}`)
    } catch { flash('❌ 改写失败') }
    setBusy(false)
  }

  const applyComments = async () => {
    const entries = Object.entries(comments).filter(([, v]) => v.trim())
    if (!entries.length) return flash('先在某个片段写一句给 AI 的意见')
    setBusy(true)
    try {
      await Promise.all(entries.map(([beat_id, body]) => lunaFetch(`/sessions/${id}/comments`, { method: 'POST', body: JSON.stringify({ beat_id, body: body.trim() }) })))
      const r = await lunaFetch(`/sessions/${id}/revise`, { method: 'POST' })
      const d = await r.json()
      if (d.applied) { setComments({}); await reload(); flash(`✅ AI 改了 ${d.applied} 段`) } else flash(`ℹ️ ${d.message || 'AI 未产生改动'}`)
    } catch { flash('❌ 改稿失败') }
    setBusy(false)
  }
  const editOverlays = async (beatId: string, edits: { index: number; duration_ms?: number; remove?: boolean }[]) => {
    const r = await lunaFetch(`/sessions/${id}/beat-overlays`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, edits }) })
    if (r.ok) { const d = await r.json(); setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, overlays: d.overlays } : n))) }
  }
  const addMedia = async (beatId: string, opts: { url?: string; file?: File }) => {
    setMediaBusy(true)
    try {
      let url = opts.url?.trim(); let kind = 'video'
      if (opts.file) {
        const fd = new FormData(); fd.append('file', opts.file)
        const up = await lunaFetch(`/media-upload`, { method: 'POST', body: fd }); const ud = await up.json()
        if (!up.ok || !ud.url) { flash(ud.error || '上传失败'); setMediaBusy(false); return }
        url = ud.url; kind = ud.media_kind
      } else if (url) { kind = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) ? 'image' : 'video' }
      if (!url) return
      const r = await lunaFetch(`/sessions/${id}/beat-media`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, media_kind: kind, url, caption: mediaCap.trim() || undefined }) })
      if (r.ok) { const d = await r.json(); setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, overlays: d.overlays } : n))); setMediaUrl(''); setMediaCap(''); flash('✅ 已加入媒体') }
    } catch { flash('❌ 媒体失败') }
    setMediaBusy(false)
  }
  const [transEdit, setTransEdit] = useState<number | null>(null)
  const setTransition = async (prevActIndex: number, type: 'flyover' | 'cut', duration_ms: number) => {
    const r = await lunaFetch(`/sessions/${id}/stop-transition`, { method: 'POST', body: JSON.stringify({ act_index: prevActIndex, type, duration_ms }) })
    if (r.ok) { setTransEdit(null); await reload() }
  }
  const moveStop = async (actIndex: number, dir: -1 | 1) => { const r = await lunaFetch(`/sessions/${id}/move-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex, dir }) }); if (r.ok) await reload() }
  const deleteStop = async (actIndex: number, name: string) => { if (!window.confirm(`删除停靠点「${name}」?`)) return; const r = await lunaFetch(`/sessions/${id}/delete-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex }) }); if (r.ok) { setSelId(null); await reload() } }
  const addStop = async (p: { name: string; lng: number; lat: number }) => { setBusy(true); const r = await lunaFetch(`/sessions/${id}/add-stop`, { method: 'POST', body: JSON.stringify(p) }); if (r.ok) { setPlaceQ(''); setPlaceResults([]); await reload(); flash(`✅ 已加入「${p.name}」`) } setBusy(false) }

  if (loading) return <div className="p-8 text-slate-400">加载编辑器…</div>

  const W = totalSec * px
  const ruler: number[] = []
  const step = px < 10 ? 20 : px < 20 ? 10 : 5
  for (let s = 0; s <= totalSec; s += step) ruler.push(s)
  const bandColor = (b: { actIndex: number; isPlace: boolean }) =>
    b.actIndex < 0 ? 'bg-slate-700/40 border-slate-600' : b.isPlace ? 'bg-indigo-500/25 border-indigo-400' : 'bg-emerald-500/20 border-emerald-400'

  const Track = ({ label, h, children }: { label: string; h: number; children: React.ReactNode }) => (
    <div className="flex border-b border-slate-800" style={{ height: h }}>
      <div className="shrink-0 flex items-center justify-center text-[11px] text-slate-400 border-r border-slate-800 bg-slate-900" style={{ width: GUTTER }}>{label}</div>
      <div className="relative" style={{ width: W }}>{children}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-white shrink-0">
        <Link to="/agent/tour" className="text-slate-500 hover:text-slate-800 text-sm">← 返回</Link>
        <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-medium" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex rounded-lg border overflow-hidden text-sm">
          <button onClick={() => setMode('simple')} className={`px-3 py-1.5 ${mode === 'simple' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>简单</button>
          <button onClick={() => setMode('timeline')} className={`px-3 py-1.5 ${mode === 'timeline' ? 'bg-emerald-500 text-white' : 'text-slate-500'}`}>时间线</button>
        </div>
        {mode === 'timeline' && (
          <div className="flex items-center gap-1 text-slate-500">
            <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.max(6, p - 4))}>−</button>
            <span className="text-xs w-10 text-center">{px}px/s</span>
            <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.min(48, p + 4))}>+</button>
          </div>
        )}
        <button onClick={applyComments} disabled={busy} className="bg-indigo-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">✨ 用 AI 应用评论</button>
        <button onClick={saveNarration} disabled={busy} className="bg-emerald-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">保存</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>

      {mode === 'simple' ? (
        <SimpleView
          nodes={nodes}
          comments={comments}
          setComments={setComments}
          setNodes={setNodes}
          onSaveNarration={saveNarration}
          onReviseBeat={reviseBeat}
          onRemoveOverlay={(beatId, idx) => editOverlays(beatId, [{ index: idx, remove: true }])}
          onAddMedia={addMedia}
          onMoveStop={moveStop}
          onDeleteStop={deleteStop}
          mediaUrl={mediaUrl} setMediaUrl={setMediaUrl} mediaCap={mediaCap} setMediaCap={setMediaCap} mediaBusy={mediaBusy}
          placeQ={placeQ} setPlaceQ={setPlaceQ} placeResults={placeResults} onAddStop={addStop} busy={busy}
        />
      ) : (
      <div className="flex-1 flex min-h-0">
        {/* TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
          <div className="flex-1 overflow-auto">
            <div style={{ width: W + GUTTER }}>
              {/* ruler */}
              <div className="flex sticky top-0 z-10">
                <div className="shrink-0 bg-slate-900 border-r border-b border-slate-800" style={{ width: GUTTER, height: 24 }} />
                <div className="relative bg-slate-900 border-b border-slate-800" style={{ width: W, height: 24 }}>
                  {ruler.map((s) => (
                    <div key={s} className="absolute top-0 h-full border-l border-slate-700/60 text-[10px] text-slate-500 pl-1" style={{ left: s * px }}>{s}s</div>
                  ))}
                </div>
              </div>

              {/* transition nodes (between stops) */}
              <Track label="转场" h={34}>
                {bands.filter((b) => b.actIndex > 0 && b.transition).map((b, i) => {
                  const prevAct = b.actIndex - 1
                  const isCut = b.transitionType === 'cut'
                  return (
                    <div key={i} className="absolute top-1 bottom-1 flex items-center" style={{ left: b.start * px - 44, width: 88 }}>
                      <button onClick={() => setTransEdit(transEdit === prevAct ? null : prevAct)}
                        className={`w-full h-full rounded-full border text-[10px] flex items-center justify-center gap-1 ${isCut ? 'bg-slate-700 border-slate-500 text-slate-200' : 'bg-indigo-600/80 border-indigo-400 text-white'}`}
                        title="点击编辑转场">
                        {isCut ? '✂ 直切' : '🎬 挑高抛远'}
                      </button>
                      {transEdit === prevAct && (
                        <div className="absolute top-9 left-0 z-30 bg-white text-slate-700 rounded-lg shadow-lg border p-2 w-44">
                          <div className="text-[11px] font-semibold mb-1">转场方式</div>
                          <div className="flex gap-1 mb-2">
                            <button onClick={() => setTransition(prevAct, 'flyover', 2500)} className={`flex-1 text-[11px] rounded px-1 py-1 border ${!isCut ? 'bg-indigo-50 border-indigo-300' : ''}`}>🎬 挑高抛远</button>
                            <button onClick={() => setTransition(prevAct, 'cut', 0)} className={`flex-1 text-[11px] rounded px-1 py-1 border ${isCut ? 'bg-slate-100 border-slate-300' : ''}`}>✂ 直切</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </Track>

              {/* stop bands */}
              <Track label="停靠点" h={36}>
                {bands.map((b, i) => (
                  <div key={i} className={`absolute top-1 bottom-1 rounded border ${bandColor(b)} flex items-center px-1.5 gap-1.5 overflow-hidden`} style={{ left: b.start * px, width: (b.end - b.start) * px }}>
                    {b.image ? <img src={proxied(b.image)} alt="" className="h-5 w-7 object-cover rounded shrink-0" /> : <span className="shrink-0">{b.isPlace ? '📍' : '🏠'}</span>}
                    <span className="text-[11px] text-slate-100 truncate">{b.name}</span>
                    {b.actIndex >= 0 && (
                      <span className="ml-auto flex items-center gap-0.5 shrink-0">
                        <button className="text-slate-300 hover:text-white px-0.5 text-xs" title="左移" onClick={() => moveStop(b.actIndex, -1)}>←</button>
                        <button className="text-slate-300 hover:text-white px-0.5 text-xs" title="右移" onClick={() => moveStop(b.actIndex, 1)}>→</button>
                        <button className="text-rose-300 hover:text-rose-500 px-0.5 text-xs" title="删除" onClick={() => deleteStop(b.actIndex, b.name)}>✕</button>
                      </span>
                    )}
                  </div>
                ))}
              </Track>

              {/* 旁白 track (beats) */}
              <Track label="旁白" h={64}>
                {laid.map((b) => (
                  <button key={b.id} onClick={() => setSelId(b.id)} className={`absolute top-1 bottom-1 rounded-md border text-left px-2 py-1 overflow-hidden transition ${selId === b.id ? 'ring-2 ring-indigo-400 z-10' : ''} ${(b.actIndex ?? -1) < 0 ? 'bg-slate-700 border-slate-600' : b.isPlace ? 'bg-indigo-600/70 border-indigo-400' : 'bg-emerald-700/70 border-emerald-500'}`} style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <div className="text-[10px] text-slate-200/80">{KIND_ZH[b.kind] || b.kind} · {b.dur}s</div>
                    <div className="text-[11px] text-white leading-snug line-clamp-2">{b.narration || '—'}</div>
                  </button>
                ))}
              </Track>

              {/* 镜头 track */}
              <Track label="镜头" h={30}>
                {laid.map((b) => (
                  <div key={b.id} className="absolute top-1 bottom-1 rounded bg-slate-700/60 border border-slate-600 flex items-center px-1.5 overflow-hidden" style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <span className="text-[10px] text-slate-300 truncate">{(b.camera || []).join(' · ') || '缓慢环绕'}</span>
                  </div>
                ))}
              </Track>

              {/* 卡片 track — overlays positioned by absolute time, draggable/trim */}
              <Track label="卡片" h={Math.max(44, (laid.reduce((m, b) => Math.max(m, (b.overlays || []).length), 0)) * 26 + 8)}>
                {laid.flatMap((b) =>
                  (b.overlays || []).map((o, lane) => {
                    const isDrag = drag.current?.beatId === b.id && drag.current?.idx === o.idx
                    const at = isDrag ? drag.current!.liveAt : o.at
                    const dur = isDrag ? drag.current!.liveDur : (o.dur > 0 ? o.dur : Math.max(2, b.dur - o.at))
                    return (
                      <div
                        key={`${b.id}-${o.idx}`}
                        onMouseDown={(e) => startDrag(e, b, o, 'move')}
                        className={`absolute rounded border border-amber-400 bg-amber-500/80 text-[10px] text-amber-950 flex items-center px-1.5 cursor-grab active:cursor-grabbing overflow-hidden ${isDrag ? 'z-20 ring-2 ring-amber-300' : ''}`}
                        style={{ left: (b.start + at) * px + 1, width: Math.max(10, dur * px - 2), top: 4 + lane * 26, height: 22 }}
                        title="拖动移动 · 拖右端裁剪时长"
                      >
                        {o.image && <img src={proxied(o.image)} alt="" className="h-full w-7 object-cover rounded-l shrink-0 -ml-1.5 mr-1" />}
                        {o.value && <span className="font-bold text-emerald-900 mr-1 shrink-0">{o.value}</span>}
                        <span className="truncate">{o.label}</span>
                        <span className="ml-auto pr-0.5 opacity-60 shrink-0">{Math.round(dur)}s</span>
                        <div onMouseDown={(e) => startDrag(e, b, o, 'trim')} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-amber-700/50" />
                      </div>
                    )
                  })
                )}
              </Track>
            </div>
          </div>
          {/* add place stop */}
          <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">➕ 加地点停靠</span>
            <input className="text-xs bg-slate-800 text-slate-100 border border-slate-700 rounded px-2 py-1 w-56" placeholder="搜地点(JBR / 海滩 / 地标)" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} />
            <div className="flex gap-1 overflow-x-auto">
              {placeResults.map((p, i) => (
                <button key={i} disabled={busy} onClick={() => addStop(p)} className="text-xs bg-slate-800 text-slate-200 border border-slate-700 hover:border-indigo-400 rounded px-2 py-1 whitespace-nowrap disabled:opacity-50">+ {p.name}</button>
              ))}
            </div>
          </div>
        </div>

        {/* side edit panel */}
        <div className="w-[340px] shrink-0 border-l bg-white overflow-y-auto p-4">
          {!sel ? (
            <div className="text-sm text-slate-400 mt-8 text-center">点时间线上的片段来编辑<br />旁白 · 卡片 · 媒体 · AI 改稿<br /><span className="text-xs">卡片可在轨道上拖动移动 / 裁剪时长</span></div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-emerald-700">{sel.isPlace ? '📍 ' : ''}{sel.group} · {KIND_ZH[sel.kind] || sel.kind} · {sel.dur}s</div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">旁白</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm leading-relaxed" rows={5} value={sel.narration} onChange={(e) => setNodes((cur) => cur.map((n) => (n.id === sel.id ? { ...n, narration: e.target.value } : n)))} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">给 AI 的修改意见</label>
                <input className="w-full border border-dashed border-slate-300 rounded-lg px-2 py-1.5 text-sm" placeholder="短一点 / 强调海景 / 这个数字改成…" value={comments[sel.id] || ''} onChange={(e) => setComments((c) => ({ ...c, [sel.id]: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">卡片(也可在轨道上拖动)</label>
                {(sel.overlays || []).length === 0 && <div className="text-xs text-slate-300">无</div>}
                <div className="flex flex-col gap-1">
                  {(sel.overlays || []).map((o) => (
                    <div key={o.idx} className="flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      <span className="flex-1 truncate">🃏 {o.label}{o.at > 0 ? ` @${o.at}s` : ''}</span>
                      <button className="px-1 disabled:opacity-30" disabled={o.dur <= 0} onClick={() => editOverlays(sel.id, [{ index: o.idx, duration_ms: Math.max(0, o.dur - 1) * 1000 }])}>−</button>
                      <span className="tabular-nums w-7 text-center">{o.dur}s</span>
                      <button className="px-1" onClick={() => editOverlays(sel.id, [{ index: o.idx, duration_ms: (o.dur + 1) * 1000 }])}>+</button>
                      <button className="px-1 text-rose-400 hover:text-rose-600" onClick={() => editOverlays(sel.id, [{ index: o.idx, remove: true }])}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">加媒体(海景/室内视频或图)</label>
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder="直链 https://…/clip.mp4" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder="说明(可选)" value={mediaCap} onChange={(e) => setMediaCap(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button disabled={mediaBusy || !/^https?:\/\/\S+/i.test(mediaUrl.trim())} onClick={() => addMedia(sel.id, { url: mediaUrl })} className="text-xs bg-indigo-500 text-white rounded px-2.5 py-1 disabled:opacity-50">加链接</button>
                  <label className="text-xs bg-white border border-indigo-300 text-indigo-600 rounded px-2.5 py-1 cursor-pointer">
                    {mediaBusy ? '上传中…' : '或上传文件'}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" className="hidden" disabled={mediaBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) addMedia(sel.id, { file: f }); e.currentTarget.value = '' }} />
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

/** SIMPLE mode — a friendly, jargon-free card list for non-professional agents:
 *  one card per scene with a photo, the spoken text (+ AI rewrite), plain "shows"
 *  chips, media, duration; stop headers with reorder/delete; add a stop at the end. */
function SimpleView(props: {
  nodes: Node[]
  comments: Record<string, string>
  setComments: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  onSaveNarration: () => void
  onReviseBeat: (beatId: string) => void
  onRemoveOverlay: (beatId: string, idx: number) => void
  onAddMedia: (beatId: string, opts: { url?: string; file?: File }) => void
  onMoveStop: (actIndex: number, dir: -1 | 1) => void
  onDeleteStop: (actIndex: number, name: string) => void
  mediaUrl: string; setMediaUrl: (s: string) => void; mediaCap: string; setMediaCap: (s: string) => void; mediaBusy: boolean
  placeQ: string; setPlaceQ: (s: string) => void; placeResults: { name: string; category: string; lng: number; lat: number }[]
  onAddStop: (p: { name: string; lng: number; lat: number }) => void; busy: boolean
}) {
  const { nodes, comments, setComments, setNodes } = props
  const [mediaFor, setMediaFor] = useState<string | null>(null)
  // group beats by stop
  const groups: { actIndex: number; name: string; isPlace: boolean; image?: string; nodes: Node[] }[] = []
  for (const n of nodes) {
    const ai = n.actIndex ?? -1
    const last = groups[groups.length - 1]
    const img = (n.overlays || []).find((o) => o.image)?.image
    if (!last || last.actIndex !== ai || (ai === -1 && last.name !== n.group)) groups.push({ actIndex: ai, name: n.group, isPlace: !!n.isPlace, image: img, nodes: [n] })
    else { last.nodes.push(n); if (!last.image) last.image = img }
  }
  let sceneNo = 0

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="max-w-2xl mx-auto p-5 space-y-4">
        <p className="text-sm text-slate-500">每一段就是导览里的一个画面。改文字、让 AI 润色、加照片/视频都在这里。顺序从上到下播放。</p>
        {groups.map((g, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="text-center text-xs text-indigo-400 my-2">↓ 镜头飞到下一处</div>}
            {/* stop header */}
            <div className="flex items-center gap-2 mb-2">
              {g.image ? <img src={proxied(g.image)} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center text-xl">{g.isPlace ? '📍' : g.actIndex < 0 ? '🎬' : '🏠'}</div>}
              <div className="flex-1">
                <div className="font-semibold text-slate-800">{g.isPlace ? '📍 ' : ''}{g.name}</div>
                <div className="text-xs text-slate-400">{g.actIndex < 0 ? '固定段落' : g.isPlace ? '地点停靠' : '房源停靠'}</div>
              </div>
              {g.actIndex >= 0 && (
                <div className="flex items-center gap-1">
                  <button className="text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border rounded" title="上移" onClick={() => props.onMoveStop(g.actIndex, -1)}>↑</button>
                  <button className="text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border rounded" title="下移" onClick={() => props.onMoveStop(g.actIndex, 1)}>↓</button>
                  <button className="text-rose-400 hover:text-rose-600 px-1.5 py-0.5 border border-rose-200 rounded" title="删除这一站" onClick={() => props.onDeleteStop(g.actIndex, g.name)}>删除</button>
                </div>
              )}
            </div>
            {/* scene cards */}
            <div className="space-y-3">
              {g.nodes.map((n) => {
                sceneNo += 1
                const shows = (n.overlays || []).filter((o) => !OV_HIDE.has(o.type))
                return (
                  <div key={n.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-bold text-white bg-slate-700 rounded-full w-5 h-5 flex items-center justify-center">{sceneNo}</span>
                      <span className="text-sm font-medium text-slate-700">{KIND_FRIENDLY[n.kind] || n.kind}</span>
                      <span className="text-xs text-slate-300 ml-auto">约 {n.seconds || 0} 秒</span>
                    </div>
                    {/* spoken text */}
                    <label className="block text-xs text-slate-400 mb-1">这一段说的话</label>
                    <textarea className="w-full border rounded-lg px-3 py-2 text-sm leading-relaxed" rows={3} value={n.narration}
                      onChange={(e) => setNodes((cur) => cur.map((x) => (x.id === n.id ? { ...x, narration: e.target.value } : x)))}
                      onBlur={props.onSaveNarration} />
                    {/* AI rewrite */}
                    <div className="flex gap-2 mt-1.5">
                      <input className="flex-1 text-sm border border-dashed border-indigo-200 rounded-lg px-2 py-1.5" placeholder="想怎么改?如 短一点 / 更亲切 / 强调海景"
                        value={comments[n.id] || ''} onChange={(e) => setComments((c) => ({ ...c, [n.id]: e.target.value }))} />
                      <button disabled={props.busy || !(comments[n.id] || '').trim()} onClick={() => props.onReviseBeat(n.id)} className="text-sm bg-indigo-500 text-white rounded-lg px-3 disabled:opacity-50">✨ 让 AI 改</button>
                    </div>
                    {/* what it shows */}
                    <div className="mt-2.5">
                      <div className="text-xs text-slate-400 mb-1">这一段会展示</div>
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {shows.length === 0 && <span className="text-xs text-slate-300">(只有画面)</span>}
                        {shows.map((o) => (
                          <span key={o.idx} className="inline-flex items-center gap-1 text-xs bg-amber-50 border border-amber-200 rounded-full pl-1 pr-2 py-0.5">
                            {o.image ? <img src={proxied(o.image)} alt="" className="w-5 h-5 rounded-full object-cover" /> : <span>🃏</span>}
                            {OV_FRIENDLY[o.type] || o.label}{o.value ? ` ${o.value}` : ''}
                            <button className="text-rose-300 hover:text-rose-600 ml-0.5" title="去掉" onClick={() => props.onRemoveOverlay(n.id, o.idx)}>✕</button>
                          </span>
                        ))}
                        <button onClick={() => setMediaFor(mediaFor === n.id ? null : n.id)} className="text-xs text-indigo-600 border border-dashed border-indigo-300 rounded-full px-2 py-0.5">➕ 加视频/图片</button>
                      </div>
                      {mediaFor === n.id && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 bg-indigo-50/60 rounded-lg p-1.5">
                          <input className="flex-1 min-w-[160px] text-xs border rounded px-2 py-1" placeholder="视频/图直链 https://…/clip.mp4" value={props.mediaUrl} onChange={(e) => props.setMediaUrl(e.target.value)} />
                          <input className="w-24 text-xs border rounded px-2 py-1" placeholder="说明" value={props.mediaCap} onChange={(e) => props.setMediaCap(e.target.value)} />
                          <button disabled={props.mediaBusy || !/^https?:\/\/\S+/i.test(props.mediaUrl.trim())} onClick={() => { props.onAddMedia(n.id, { url: props.mediaUrl }); setMediaFor(null) }} className="text-xs bg-indigo-500 text-white rounded px-2 py-1 disabled:opacity-50">加链接</button>
                          <label className="text-xs bg-white border border-indigo-300 text-indigo-600 rounded px-2 py-1 cursor-pointer">
                            {props.mediaBusy ? '上传中…' : '上传文件'}
                            <input type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" className="hidden" disabled={props.mediaBusy}
                              onChange={(e) => { const f = e.target.files?.[0]; if (f) { props.onAddMedia(n.id, { file: f }); setMediaFor(null) } e.currentTarget.value = '' }} />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* add a stop */}
        <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3">
          <div className="text-sm font-semibold text-indigo-700 mb-1.5">➕ 加一站(海滩 / 地标 / 任意地点)</div>
          <input className="w-full text-sm border rounded-lg px-3 py-2" placeholder="搜地点名,如 JBR / Marina Beach / Burj Khalifa" value={props.placeQ} onChange={(e) => props.setPlaceQ(e.target.value)} />
          {props.placeResults.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {props.placeResults.map((p, i) => (
                <button key={i} disabled={props.busy} onClick={() => props.onAddStop(p)} className="text-sm bg-white border border-indigo-200 hover:border-indigo-400 rounded-full px-3 py-1 disabled:opacity-50">+ {p.name} <span className="text-slate-400 text-xs">· {p.category}</span></button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
