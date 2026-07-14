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
  /** 一句话摘要（后端 cameraLabel）。⚠️ 别用 `camera` —— 那是**分镜 chips 数组**，
   *  给 AgentTours 的时间线用的。混用会 `.map is not a function` 白屏。 */
  cameraLabel?: string
  cameraStyle?: string
  overlays?: OverlayChip[]
  transition?: string
  transitionType?: string
  actIndex?: number
  isPlace?: boolean
}
interface Laid extends Node { start: number; dur: number }
interface Band { actIndex: number; name: string; isPlace: boolean; start: number; end: number; transition?: string; transitionType?: string; image?: string }

const KIND_ZH: Record<string, string> = { intro: '开场', arrival: '到达', life: '生活', numbers: '数字', outro: '结尾', beat: '段落' }
// system overlays the author shouldn't see/edit (engine handles them)
const OV_HIDE = new Set(['progress_dots', 'highlight_all_pins'])
// per-type icon so card clips are instantly recognisable
const OV_ICON: Record<string, string> = { title: '🅣', property_card: '🏠', roi_card: '📈', distance_line: '📏', amenity_spokes: '🌐', media: '🎞', cta: '🔗' }
const GUTTER = 64 // left track-label column width (px)
/** Estimate spoken seconds from narration (CJK ~4.2/s + latin ~2.6 words/s + 0.7
 *  tail) so the timeline duration tracks the TEXT live as you edit — no stale 20s. */
function estSec(text: string): number {
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length
  const latin = text.replace(/[一-鿿　-〿＀-￯]/g, ' ').trim()
  const words = latin ? latin.split(/\s+/).filter(Boolean).length : 0
  return Math.max(3, Math.round(cjk / 4.2 + words / 2.6 + 0.7))
}

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
  const [shareCode, setShareCode] = useState('')
  const [preview, setPreview] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
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
    setShareCode(d.share_code || '')
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
    const dur = estSec(n.narration) // live from current text
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
  const setCameraStyle = async (beatId: string, style: string) => {
    const r = await lunaFetch(`/sessions/${id}/beat-camera`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, style }) })
    if (r.ok) { const d = await r.json(); setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, cameraLabel: d.cameraLabel ?? d.camera, cameraStyle: d.cameraStyle } : n))); flash('✅ 镜头已更新') }
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
        <div className="flex items-center gap-1 text-slate-500">
          <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.max(6, p - 4))}>−</button>
          <span className="text-xs w-10 text-center">{px}px/s</span>
          <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.min(48, p + 4))}>+</button>
        </div>
        <button onClick={() => setPreview(true)} disabled={!shareCode} className="bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">▶ 预览播放</button>
        <button onClick={applyComments} disabled={busy} className="bg-indigo-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">✨ 用 AI 应用评论</button>
        <button onClick={saveNarration} disabled={busy} className="bg-emerald-500 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">保存</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
          <div className="flex-1 overflow-auto">
            <div style={{ width: W + GUTTER }}>
              {/* ruler */}
              <div className="flex sticky top-0 z-10">
                <div className="shrink-0 bg-slate-900 border-r border-b border-slate-800" style={{ width: GUTTER, height: 30 }} />
                <div className="relative bg-slate-900 border-b border-slate-800" style={{ width: W, height: 30 }}>
                  {ruler.map((s) => (
                    <div key={s} className="absolute top-0 h-full border-l border-slate-700/60 text-[11px] text-slate-400 pl-1 pt-1" style={{ left: s * px }}>{s}s</div>
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
              <Track label="停靠点" h={54}>
                {bands.map((b, i) => (
                  <div key={i} className={`absolute top-1.5 bottom-1.5 rounded-lg border ${bandColor(b)} flex items-center px-2 gap-2 overflow-hidden`} style={{ left: b.start * px, width: (b.end - b.start) * px }}>
                    {b.image ? <img src={proxied(b.image)} alt="" className="h-9 w-12 object-cover rounded shrink-0" /> : <span className="text-lg shrink-0">{b.isPlace ? '📍' : '🏠'}</span>}
                    <span className="text-sm font-medium text-slate-100 truncate">{b.name}</span>
                    {b.actIndex >= 0 && (
                      <span className="ml-auto flex items-center gap-1 shrink-0">
                        <button className="text-slate-300 hover:text-white px-1 text-sm" title="左移" onClick={() => moveStop(b.actIndex, -1)}>←</button>
                        <button className="text-slate-300 hover:text-white px-1 text-sm" title="右移" onClick={() => moveStop(b.actIndex, 1)}>→</button>
                        <button className="text-rose-300 hover:text-rose-500 px-1 text-sm" title="删除" onClick={() => deleteStop(b.actIndex, b.name)}>✕</button>
                      </span>
                    )}
                  </div>
                ))}
              </Track>

              {/* 旁白 track (beats) */}
              <Track label="旁白" h={104}>
                {laid.map((b) => (
                  <button key={b.id} onClick={() => setSelId(b.id)} className={`absolute top-1.5 bottom-1.5 rounded-lg border text-left px-2.5 py-2 overflow-hidden transition ${selId === b.id ? 'ring-2 ring-indigo-300 z-10' : ''} ${(b.actIndex ?? -1) < 0 ? 'bg-slate-700 border-slate-600' : b.isPlace ? 'bg-indigo-600/70 border-indigo-400' : 'bg-emerald-700/70 border-emerald-500'}`} style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <div className="text-[11px] font-medium text-white/80 mb-0.5">{KIND_ZH[b.kind] || b.kind} · ~{b.dur}s</div>
                    <div className="text-[13px] text-white leading-snug line-clamp-4">{b.narration || '—'}</div>
                  </button>
                ))}
              </Track>

              {/* 镜头 track */}
              <Track label="镜头" h={38}>
                {laid.map((b) => (
                  <div key={b.id} className="absolute top-1 bottom-1 rounded-md bg-slate-700/60 border border-slate-600 flex items-center px-2 overflow-hidden" style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <span className="text-[11px] text-slate-300 truncate">🎥 {b.cameraLabel || '环绕展示'}</span>
                  </div>
                ))}
              </Track>

              {/* 卡片 track — overlays positioned by absolute time, draggable/trim.
                  System cards (进度点/高亮全部) are hidden — not author content. */}
              <Track label="卡片" h={Math.max(60, (laid.reduce((m, b) => Math.max(m, (b.overlays || []).filter((o) => !OV_HIDE.has(o.type)).length), 0)) * 48 + 12)}>
                {laid.flatMap((b) => {
                  const vis = (b.overlays || []).filter((o) => !OV_HIDE.has(o.type))
                  return vis.map((o, lane) => {
                    const isDrag = drag.current?.beatId === b.id && drag.current?.idx === o.idx
                    const at = isDrag ? drag.current!.liveAt : o.at
                    const dur = isDrag ? drag.current!.liveDur : (o.dur > 0 ? o.dur : Math.max(2, b.dur - o.at))
                    const isMedia = o.type === 'media'
                    const hasImg = !!o.image
                    return (
                      <div
                        key={`${b.id}-${o.idx}`}
                        onMouseDown={(e) => startDrag(e, b, o, 'move')}
                        className={`absolute rounded-lg border bg-white shadow-sm flex items-center gap-2 pl-2.5 pr-2 cursor-grab active:cursor-grabbing overflow-hidden ${isDrag ? 'z-20 ring-2 ring-amber-300' : 'border-slate-300'}`}
                        style={{ left: (b.start + at) * px + 1, width: Math.max(hasImg ? 110 : 76, dur * px - 2), top: 6 + lane * 48, height: 42 }}
                        title={`${o.label} · 拖动移动 · 拖右端裁剪时长`}
                      >
                        {/* left colour stripe = type */}
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${o.type === 'property_card' ? 'bg-emerald-500' : o.type === 'roi_card' ? 'bg-blue-500' : isMedia ? 'bg-violet-500' : 'bg-amber-500'}`} />
                        {hasImg ? (
                          <img src={proxied(o.image)} alt="" className="h-9 w-14 object-cover rounded shrink-0" />
                        ) : (
                          <span className="text-xl shrink-0">{OV_ICON[o.type] || '🃏'}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          {o.value && <div className="text-sm font-bold text-emerald-600 leading-tight">{o.value}</div>}
                          <div className="text-[12px] text-slate-700 truncate leading-tight">{o.label}</div>
                          <div className="text-[10px] text-slate-400">{Math.round(dur)}s</div>
                        </div>
                        <div onMouseDown={(e) => startDrag(e, b, o, 'trim')} className={`absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize ${isMedia ? 'bg-violet-300' : 'bg-amber-300'}`} />
                      </div>
                    )
                  })
                })}
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
                <label className="block text-xs text-slate-400 mb-1">镜头风格(画面怎么动)</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[{ k: 'orbit', l: '🔄 环绕展示' }, { k: 'push', l: '🔍 推近' }, { k: 'aerial', l: '🦅 俯瞰' }].map((s) => (
                    <button key={s.k} onClick={() => setCameraStyle(sel.id, s.k)}
                      className={`text-xs rounded-lg border px-1 py-2 ${sel.cameraStyle === s.k ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600'}`}>
                      {s.l}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 mb-3">镜头会自动平滑环绕运动,这里选大致取景。</div>

                <label className="block text-xs text-slate-400 mb-1">这一段显示的卡片(也可在轨道上拖动)</label>
                {(sel.overlays || []).filter((o) => !OV_HIDE.has(o.type)).length === 0 && <div className="text-xs text-slate-300">无</div>}
                <div className="flex flex-col gap-1">
                  {(sel.overlays || []).filter((o) => !OV_HIDE.has(o.type)).map((o) => (
                    <div key={o.idx} className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      {o.image ? <img src={proxied(o.image)} alt="" className="w-6 h-6 rounded object-cover shrink-0" /> : <span className="shrink-0">{OV_ICON[o.type] || '🃏'}</span>}
                      <span className="flex-1 truncate">{o.value ? <b className="text-emerald-600">{o.value} </b> : ''}{o.label}{o.at > 0 ? ` @${o.at}s` : ''}</span>
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

      {/* in-editor preview — plays the real tour in an iframe */}
      {preview && shareCode && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl" style={{ width: 'min(1100px,92vw)', height: 'min(680px,86vh)' }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreview(false)} className="absolute top-2 right-2 z-10 bg-white/90 rounded-full w-8 h-8 text-slate-700 text-lg leading-none">✕</button>
            <iframe title="预览" src={`/?toursession=${shareCode}`} className="w-full h-full border-0" allow="autoplay; fullscreen" />
          </div>
        </div>
      )}
    </div>
  )
}
