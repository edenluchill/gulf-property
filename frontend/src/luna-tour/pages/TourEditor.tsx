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
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import AiEditPanel from '../ui/AiEditPanel'
import StoryboardReview from '../ui/StoryboardReview'
import { lunaFetch } from '../lunaApi'
import { errText } from '../../lib/errText'
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

/** Beat kinds are an ENUM, not display text — the label comes from `editor.kind.*`
 *  (an unknown kind falls through to the raw value rather than rendering blank). */
const KINDS = new Set(['intro', 'arrival', 'life', 'numbers', 'outro', 'beat'])
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
  const { t: tRaw, i18n } = useTranslation('lunaTour')
  const t = tRaw as (k: string, o?: Record<string, unknown>) => string
  const zh = !!i18n.language?.startsWith('zh')
  const kindLabel = (k: string) => (KINDS.has(k) ? t(`editor.kind.${k}`) : k)
  const [title, setTitle] = useState('')
  const [shareCode, setShareCode] = useState('')
  const [isPublished, setIsPublished] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [preview, setPreview] = useState(false)
  const [nodes, setNodes] = useState<Node[]>([])
  /**
   * 🔴 **统一布局(owner 2026-07-17 要求):编辑器直接显示,AI 辅助进右侧常驻栏。**
   *
   * 历史:曾把时间线整个藏进「高级」,默认只留一个 AI 对话框(因为「经纪是销售不是剪辑师」)。
   * 但那样点「编辑」只看到一个对话框,看不到自己在改什么 —— owner 明确要「直接进编辑器」。
   * 现在两者并存:时间线是主画布(always),AI 辅助(StoryboardReview + AiEditPanel)
   * 常驻右侧栏顶部,下面是选中拍的精修。不想碰轨道的经纪照样只用上面那个 AI 框。
   */
  // 「让 Luna 改」→ 把那句建议直接交给 AI 编辑器执行(nonce:同一条能点第二次)
  const [injected, setInjected] = useState<{ text: string; nonce: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [selId, setSelId] = useState<string | null>(null)
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
    setIsPublished(d.is_published !== false)
    setNodes(d.flow || [])
  }, [id])

  // 发布草稿(草稿对客户 404,必须发布)。voice=false → 无配音,客户静默看字幕。
  const publish = async (voice: boolean) => {
    setPublishing(true)
    try {
      const r = await lunaFetch(`/sessions/${id}/render`, { method: 'POST', body: JSON.stringify({ voice }) })
      if (r.ok) { await reload(); flash(voice ? (zh ? '✅ 已发布 · Luna 配音生成中(约 1-2 分钟)' : '✅ Published · Luna voice generating (~1-2 min)') : (zh ? '✅ 已发布 · 无配音(客户看字幕)' : '✅ Published · silent (subtitles)')) }
      else flash(`❌ ${t('editor.saveFailed')}`)
    } catch { flash(`❌ ${t('editor.networkError')}`) }
    setPublishing(false)
  }

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
    const timer = setTimeout(async () => {
      try {
        const r = await lunaFetch(`/place-search?q=${encodeURIComponent(q)}`)
        if (r.ok) setPlaceResults((await r.json()).places || [])
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(timer)
  }, [placeQ])

  // ── layout: absolute time for each beat + overlay ──────────────────────────
  let acc = 0
  const laid: Laid[] = nodes.map((n) => {
    const dur = estSec(n.narration) // live from current text
    const start = acc
    acc += dur
    return { ...n, start, dur }
  })
  const totalSec = Math.max(acc, 30)
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
      flash(r.ok ? `✅ ${t('editor.saved')}` : `❌ ${t('editor.saveFailed')}`)
    } catch { flash(`❌ ${t('editor.networkError')}`) }
    setBusy(false)
  }
  const setCameraStyle = async (beatId: string, style: string) => {
    const r = await lunaFetch(`/sessions/${id}/beat-camera`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, style }) })
    if (r.ok) { const d = await r.json(); setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, cameraLabel: d.cameraLabel ?? d.camera, cameraStyle: d.cameraStyle } : n))); flash(`✅ ${t('editor.cameraUpdated')}`) }
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
        if (!up.ok || !ud.url) { flash(errText(ud, 'lunaTour:editor.uploadFailed')); setMediaBusy(false); return }
        url = ud.url; kind = ud.media_kind
      } else if (url) { kind = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url) ? 'image' : 'video' }
      if (!url) return
      const r = await lunaFetch(`/sessions/${id}/beat-media`, { method: 'POST', body: JSON.stringify({ beat_id: beatId, media_kind: kind, url, caption: mediaCap.trim() || undefined }) })
      if (r.ok) { const d = await r.json(); setNodes((cur) => cur.map((n) => (n.id === beatId ? { ...n, overlays: d.overlays } : n))); setMediaUrl(''); setMediaCap(''); flash(`✅ ${t('editor.mediaAdded')}`) }
    } catch { flash(`❌ ${t('editor.mediaFailed')}`) }
    setMediaBusy(false)
  }
  const [transEdit, setTransEdit] = useState<number | null>(null)
  const setTransition = async (prevActIndex: number, type: 'flyover' | 'cut', duration_ms: number) => {
    const r = await lunaFetch(`/sessions/${id}/stop-transition`, { method: 'POST', body: JSON.stringify({ act_index: prevActIndex, type, duration_ms }) })
    if (r.ok) { setTransEdit(null); await reload() }
  }
  const moveStop = async (actIndex: number, dir: -1 | 1) => { const r = await lunaFetch(`/sessions/${id}/move-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex, dir }) }); if (r.ok) await reload() }
  const deleteStop = async (actIndex: number, name: string) => { if (!window.confirm(t('editor.confirmDeleteStop', { name }))) return; const r = await lunaFetch(`/sessions/${id}/delete-stop`, { method: 'POST', body: JSON.stringify({ act_index: actIndex }) }); if (r.ok) { setSelId(null); await reload() } }
  const addStop = async (p: { name: string; lng: number; lat: number }) => { setBusy(true); const r = await lunaFetch(`/sessions/${id}/add-stop`, { method: 'POST', body: JSON.stringify(p) }); if (r.ok) { setPlaceQ(''); setPlaceResults([]); await reload(); flash(`✅ ${t('editor.stopAdded', { name: p.name })}`) } setBusy(false) }

  if (loading) return <div className="p-8 text-slate-400">{t('editor.loading')}</div>

  const W = totalSec * px
  const ruler: number[] = []
  const step = px < 10 ? 20 : px < 20 ? 10 : 5
  for (let s = 0; s <= totalSec; s += step) ruler.push(s)
  const bandColor = (b: { actIndex: number; isPlace: boolean }) =>
    b.actIndex < 0 ? 'bg-slate-700/40 border-slate-600' : b.isPlace ? 'bg-indigo-500/25 border-indigo-400' : 'bg-emerald-500/20 border-emerald-400'

  const Track = ({ label, h, children }: { label: string; h: number; children: React.ReactNode }) => (
    <div className="flex border-b border-slate-800" style={{ height: h }}>
      <div className="shrink-0 flex items-center justify-center text-[11px] text-slate-400 border-e border-slate-800 bg-slate-900" style={{ width: GUTTER }}>{label}</div>
      <div className="relative" style={{ width: W }}>{children}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-slate-100">
      {/* top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-white shrink-0">
        <Link to="/agent/tour" className="text-slate-500 hover:text-slate-800 text-sm">← {t('editor.back')}</Link>
        <input className="flex-1 border rounded-lg px-3 py-1.5 text-sm font-medium" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex items-center gap-1 text-slate-500">
          <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.max(6, p - 4))}>−</button>
          <span className="text-xs w-10 text-center">{px}px/s</span>
          <button className="px-2 text-lg leading-none hover:text-slate-800" onClick={() => setPx((p) => Math.min(48, p + 4))}>+</button>
        </div>
        <button onClick={() => setPreview(true)} disabled={!shareCode} className="bg-slate-800 text-white rounded-lg px-3 py-1.5 text-sm disabled:opacity-50">▶ {t('editor.preview')}</button>
        <button onClick={saveNarration} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50 hover:bg-slate-50">{t('editor.save')}</button>
        {/* 草稿:客户点开是 404 → 必须发布。带配音 / 无配音两种。已发布则不显示。 */}
        {!isPublished && (
          <div className="flex items-center gap-1.5">
            <button onClick={() => void publish(true)} disabled={publishing || !shareCode} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50" title={zh ? '烧 Luna 配音再发布(约 1-2 分钟)' : 'Generate Luna voice, then publish'}>
              {publishing ? (zh ? '发布中…' : 'Publishing…') : (zh ? '发布·带配音' : 'Publish · voice')}
            </button>
            <button onClick={() => void publish(false)} disabled={publishing || !shareCode} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50" title={zh ? '直接发布,无配音,客户看字幕' : 'Publish silent — client reads subtitles'}>
              {zh ? '无配音' : 'Silent'}
            </button>
          </div>
        )}
        {msg && <span className="text-sm">{msg}</span>}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* TIMELINE */}
        <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
          <div className="flex-1 overflow-auto">
            <div style={{ width: W + GUTTER }}>
              {/* ruler */}
              <div className="flex sticky top-0 z-10">
                <div className="shrink-0 bg-slate-900 border-e border-b border-slate-800" style={{ width: GUTTER, height: 30 }} />
                <div className="relative bg-slate-900 border-b border-slate-800" style={{ width: W, height: 30 }}>
                  {ruler.map((s) => (
                    <div key={s} className="absolute top-0 h-full border-s border-slate-700/60 text-[11px] text-slate-400 ps-1 pt-1" style={{ left: s * px }}>{s}s</div>
                  ))}
                </div>
              </div>

              {/* transition nodes (between stops) */}
              <Track label={t('editor.track.transition')} h={34}>
                {bands.filter((b) => b.actIndex > 0 && b.transition).map((b, i) => {
                  const prevAct = b.actIndex - 1
                  const isCut = b.transitionType === 'cut'
                  return (
                    <div key={i} className="absolute top-1 bottom-1 flex items-center" style={{ left: b.start * px - 44, width: 88 }}>
                      <button onClick={() => setTransEdit(transEdit === prevAct ? null : prevAct)}
                        className={`w-full h-full rounded-full border text-[10px] flex items-center justify-center gap-1 ${isCut ? 'bg-slate-700 border-slate-500 text-slate-200' : 'bg-indigo-600/80 border-indigo-400 text-white'}`}
                        title={t('editor.transition.editTitle')}>
                        {isCut ? `✂ ${t('editor.transition.cut')}` : `🎬 ${t('editor.transition.flyover')}`}
                      </button>
                      {transEdit === prevAct && (
                        <div className="absolute top-9 start-0 z-30 bg-white text-slate-700 rounded-lg shadow-lg border p-2 w-44">
                          <div className="text-[11px] font-semibold mb-1">{t('editor.transition.kind')}</div>
                          <div className="flex gap-1 mb-2">
                            <button onClick={() => setTransition(prevAct, 'flyover', 2500)} className={`flex-1 text-[11px] rounded px-1 py-1 border ${!isCut ? 'bg-indigo-50 border-indigo-300' : ''}`}>🎬 {t('editor.transition.flyover')}</button>
                            <button onClick={() => setTransition(prevAct, 'cut', 0)} className={`flex-1 text-[11px] rounded px-1 py-1 border ${isCut ? 'bg-slate-100 border-slate-300' : ''}`}>✂ {t('editor.transition.cut')}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </Track>

              {/* stop bands */}
              <Track label={t('editor.track.stops')} h={54}>
                {bands.map((b, i) => (
                  <div key={i} className={`absolute top-1.5 bottom-1.5 rounded-lg border ${bandColor(b)} flex items-center px-2 gap-2 overflow-hidden`} style={{ left: b.start * px, width: (b.end - b.start) * px }}>
                    {b.image ? <img src={proxied(b.image)} alt="" className="h-9 w-12 object-cover rounded shrink-0" /> : <span className="text-lg shrink-0">{b.isPlace ? '📍' : '🏠'}</span>}
                    <span className="text-sm font-medium text-slate-100 truncate">{b.name}</span>
                    {b.actIndex >= 0 && (
                      <span className="ms-auto flex items-center gap-1 shrink-0">
                        {/* ⚠️ 不加 rtl 镜像:整条时间线靠 inline `left: start*px` 定位,
                            dir=rtl 下也不翻 → 箭头指的物理方向始终成立。
                            文案按「更早/更晚」写(而不是左/右),换语言才说得通。 */}
                        <button className="text-slate-300 hover:text-white px-1 text-sm" title={t('editor.moveEarlier')} onClick={() => moveStop(b.actIndex, -1)}>←</button>
                        <button className="text-slate-300 hover:text-white px-1 text-sm" title={t('editor.moveLater')} onClick={() => moveStop(b.actIndex, 1)}>→</button>
                        <button className="text-rose-300 hover:text-rose-500 px-1 text-sm" title={t('editor.delete')} onClick={() => deleteStop(b.actIndex, b.name)}>✕</button>
                      </span>
                    )}
                  </div>
                ))}
              </Track>

              {/* 旁白 track (beats) */}
              <Track label={t('editor.track.narration')} h={104}>
                {laid.map((b) => (
                  <button key={b.id} onClick={() => setSelId((cur) => (cur === b.id ? null : b.id))} className={`absolute top-1.5 bottom-1.5 rounded-lg border text-start px-2.5 py-2 overflow-hidden transition ${selId === b.id ? 'ring-2 ring-indigo-300 z-10' : ''} ${(b.actIndex ?? -1) < 0 ? 'bg-slate-700 border-slate-600' : b.isPlace ? 'bg-indigo-600/70 border-indigo-400' : 'bg-emerald-700/70 border-emerald-500'}`} style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <div className="text-[11px] font-medium text-white/80 mb-0.5">{kindLabel(b.kind)} · ~{b.dur}s</div>
                    <div className="text-[13px] text-white leading-snug line-clamp-4">{b.narration || '—'}</div>
                  </button>
                ))}
              </Track>

              {/* 镜头 track */}
              <Track label={t('editor.track.camera')} h={38}>
                {laid.map((b) => (
                  <div key={b.id} className="absolute top-1 bottom-1 rounded-md bg-slate-700/60 border border-slate-600 flex items-center px-2 overflow-hidden" style={{ left: b.start * px + 1, width: Math.max(8, b.dur * px - 2) }}>
                    <span className="text-[11px] text-slate-300 truncate">🎥 {b.cameraLabel || t('editor.camera.orbit')}</span>
                  </div>
                ))}
              </Track>

              {/* 卡片 track — overlays positioned by absolute time, draggable/trim.
                  System cards (进度点/高亮全部) are hidden — not author content. */}
              <Track label={t('editor.track.cards')} h={Math.max(60, (laid.reduce((m, b) => Math.max(m, (b.overlays || []).filter((o) => !OV_HIDE.has(o.type)).length), 0)) * 48 + 12)}>
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
                        className={`absolute rounded-lg border bg-white shadow-sm flex items-center gap-2 ps-2.5 pe-2 cursor-grab active:cursor-grabbing overflow-hidden ${isDrag ? 'z-20 ring-2 ring-amber-300' : 'border-slate-300'}`}
                        style={{ left: (b.start + at) * px + 1, width: Math.max(hasImg ? 110 : 76, dur * px - 2), top: 6 + lane * 48, height: 42 }}
                        title={t('editor.cardDragHint', { label: o.label })}
                      >
                        {/* left colour stripe = type */}
                        <div className={`absolute start-0 top-0 bottom-0 w-1.5 ${o.type === 'property_card' ? 'bg-emerald-500' : o.type === 'roi_card' ? 'bg-blue-500' : isMedia ? 'bg-violet-500' : 'bg-amber-500'}`} />
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
                        <div onMouseDown={(e) => startDrag(e, b, o, 'trim')} className={`absolute end-0 top-0 bottom-0 w-2 cursor-ew-resize ${isMedia ? 'bg-violet-300' : 'bg-amber-300'}`} />
                      </div>
                    )
                  })
                })}
              </Track>
            </div>
          </div>
          {/* add place stop */}
          <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">➕ {t('editor.addStop')}</span>
            <input className="text-xs bg-slate-800 text-slate-100 border border-slate-700 rounded px-2 py-1 w-56" placeholder={t('editor.searchPlace')} value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} />
            <div className="flex gap-1 overflow-x-auto">
              {placeResults.map((p, i) => (
                <button key={i} disabled={busy} onClick={() => addStop(p)} className="text-xs bg-slate-800 text-slate-200 border border-slate-700 hover:border-indigo-400 rounded px-2 py-1 whitespace-nowrap disabled:opacity-50">+ {p.name}</button>
              ))}
            </div>
          </div>
        </div>

        {/* side panel: 选中拍精修(上,可滚)+ ✨ Luna 辅助(钉右下) */}
        <div className="w-[380px] shrink-0 border-s bg-slate-100 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {!sel ? (
            <div className="text-sm text-slate-400 mt-4 text-center">{t('editor.emptyPanel.title')}<br />{t('editor.emptyPanel.what')}<br /><span className="text-xs">{t('editor.emptyPanel.hint')}</span></div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs font-semibold text-emerald-700">{sel.isPlace ? '📍 ' : ''}{sel.group} · {kindLabel(sel.kind)} · {sel.dur}s</div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('editor.track.narration')}</label>
                <textarea className="w-full border rounded-lg px-3 py-2 text-sm leading-relaxed" rows={6} value={sel.narration} onChange={(e) => setNodes((cur) => cur.map((n) => (n.id === sel.id ? { ...n, narration: e.target.value } : n)))} />
                {/* ⚠️ 数字改不了 —— 卡片上的价格/涨幅/成交量全来自真实 DLD 数据。
                    想让 Luna 改这段文案 → 用右下角的 Luna 助手(会自动只改选中这段)。 */}
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  {t('editor.numbersLocked')}
                </p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">{t('editor.cameraStyleLabel')}</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[{ k: 'orbit', icon: '🔄' }, { k: 'push', icon: '🔍' }, { k: 'aerial', icon: '🦅' }].map((s) => (
                    <button key={s.k} onClick={() => setCameraStyle(sel.id, s.k)}
                      className={`text-xs rounded-lg border px-1 py-2 ${sel.cameraStyle === s.k ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600'}`}>
                      {s.icon} {t(`editor.camera.${s.k}`)}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-1 mb-3">{t('editor.cameraStyleHint')}</div>

                <label className="block text-xs text-slate-400 mb-1">{t('editor.cardsLabel')}</label>
                {(sel.overlays || []).filter((o) => !OV_HIDE.has(o.type)).length === 0 && <div className="text-xs text-slate-300">{t('editor.none')}</div>}
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
                <label className="block text-xs text-slate-400 mb-1">{t('editor.mediaLabel')}</label>
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder={t('editor.mediaUrlPlaceholder')} value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
                <input className="w-full text-xs border rounded px-2 py-1 mb-1" placeholder={t('editor.mediaCaptionPlaceholder')} value={mediaCap} onChange={(e) => setMediaCap(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button disabled={mediaBusy || !/^https?:\/\/\S+/i.test(mediaUrl.trim())} onClick={() => addMedia(sel.id, { url: mediaUrl })} className="text-xs bg-indigo-500 text-white rounded px-2.5 py-1 disabled:opacity-50">{t('editor.addLink')}</button>
                  <label className="text-xs bg-white border border-indigo-300 text-indigo-600 rounded px-2.5 py-1 cursor-pointer">
                    {mediaBusy ? t('editor.uploading') : t('editor.orUploadFile')}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp" className="hidden" disabled={mediaBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) addMedia(sel.id, { file: f }); e.currentTarget.value = '' }} />
                  </label>
                </div>
              </div>
            </div>
          )}
          </div>
          {/* ✨ Luna 助手 —— 独立切割区,钉右下始终可见。选中某拍=只改那拍;没选=整体改 */}
          <div className={`shrink-0 border-t-4 bg-slate-50 overflow-y-auto ${sel ? 'border-indigo-300' : 'border-slate-200'}`} style={{ maxHeight: '55%' }}>
            <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-slate-50/95 px-3 py-2 text-xs font-bold text-slate-500 backdrop-blur">
              <span>✨</span> Luna 助手
            </div>
            <div className="px-3 pb-3">
            <StoryboardReview sessionId={id} onApplyFix={(fix) => setInjected({ text: fix, nonce: Date.now() })} />
            <AiEditPanel
              sessionId={id}
              onChanged={reload}
              injected={injected}
              scopeBeatId={selId}
              scopeLabel={sel ? `${sel.group} · ${kindLabel(sel.kind)}` : ''}
              onClearScope={() => setSelId(null)}
            />
            </div>
          </div>
        </div>
      </div>

      {/* in-editor preview — plays the real tour in an iframe */}
      {preview && shareCode && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl" style={{ width: 'min(1100px,92vw)', height: 'min(680px,86vh)' }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setPreview(false)} className="absolute top-2 end-2 z-10 bg-white/90 rounded-full w-8 h-8 text-slate-700 text-lg leading-none">✕</button>
            <iframe title={t('editor.preview')} src={`/?toursession=${shareCode}`} className="w-full h-full border-0" allow="autoplay; fullscreen" />
          </div>
        </div>
      )}
    </div>
  )
}
