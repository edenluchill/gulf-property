/**
 * Luna Tour — overlay that runs a shared session ON the main search map.
 *
 * Unlike the standalone TourPlayer (which owns its own TourMap), this floats
 * transparent chrome + React overlays OVER MapPage's real MapViewMapLibre and
 * drives it through the MapTourHandle ref. So the tour plays on the actual map
 * with all its live data layers (§ user request: 统一主地图).
 *
 * ISOLATION: rendered only by MapPage when the route is /v/:code. Delete the
 * luna-tour directory + MapPage's tour block to remove.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ProjectDetailDialog from './collab/ProjectDetailDialog'
import { API_BASE_URL } from '../lib/config'
import { lunaFetch } from './lunaApi'
import OverlayLayer from './overlays/OverlayLayer'
import GreetingScreen from './overlays/GreetingScreen'
import EvidenceCard from './overlays/EvidenceCard'
import { TimelineEngine, EngineSnapshot } from './engine/TimelineEngine'
import {
  establishingShot,
  introCameraCues,
  outroCameraCues,
  tourViewportPadding,
} from './engine/openingShot'
import type { MapTourHandle } from './map/mapTourHandle'
import type { WatchPayload, PropertySnapshot, AmenityPayload, MarketEvidence } from './types'
import { fetchAmenity } from './amenities'
import { useTourTelemetry } from './useTourTelemetry'
import { useTourLive } from './useTourLive'
import { useTourMode } from './TourModeContext'
import './luna-tour.css'

function formatAedShort(n: number): string {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `AED ${(n / 1000).toFixed(0)}K`
  return `AED ${n}`
}

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
}

// ── Caption chunking ───────────────────────────────────────────────────────
// Show only 1–2 short sentences at a time (the full beat narration dumped on a
// phone wrapped into a wall of text covering half the screen). We split on CJK +
// latin sentence punctuation, pair short sentences / keep long ones solo, then
// advance through the chunks with the beat clock (atMs). Speech pace is estimated
// per language (CJK ~slower per char); exact sync isn't needed for a caption.
function splitSentences(text: string): string[] {
  const parts = text.replace(/\s+/g, ' ').trim().match(/[^。！？!?…\n]+[。！？!?…]*/g)
  return parts ? parts.map(s => s.trim()).filter(Boolean) : [text.trim()].filter(Boolean)
}
function chunkCaption(text: string): string[] {
  const MAX = 58
  const chunks: string[] = []
  let cur = '', count = 0
  for (const s of splitSentences(text)) {
    const merged = cur ? `${cur} ${s}` : s
    if (cur && (count >= 2 || merged.length > MAX)) { chunks.push(cur); cur = s; count = 1 }
    else { cur = merged; count++ }
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [text]
}
function pickCaption(chunks: string[], atMs: number): string {
  if (chunks.length <= 1) return chunks[0] ?? ''
  const cjk = /[　-鿿가-힯]/
  let acc = 0
  for (const c of chunks) {
    acc += Math.max(1000, c.length * (cjk.test(c) ? 175 : 70))
    if (atMs < acc) return c
  }
  return chunks[chunks.length - 1]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: WatchPayload }

export default function TourOverlay({
  code,
  mapRef,
  onMeasure,
  onAmenities,
  onTransit,
  onAreaMetric,
  onPins,
  onPoiCategory,
  editMode,
}: {
  code: string
  mapRef: React.RefObject<MapTourHandle | null>
  /** drive the host map's REAL measure tool (hub→spokes, km labels) */
  onMeasure?: (points: [number, number][] | null) => void
  /** drive the host map's REAL amenity radial (voiceAmenities) */
  onAmenities?: (payload: AmenityPayload | null) => void
  /** toggle the host map's REAL transit layer */
  onTransit?: (on: boolean) => void
  /** toggle the host map's area-value heatmap (null = hide) */
  onAreaMetric?: (metric: string | null) => void
  /** report the tour's properties so the main map renders only these native pins */
  onPins?: (pins: import('../lib/api').MapPinProject[]) => void
  /** drive the host map's POI category filter (same filter the customer toggles) */
  onPoiCategory?: (category: string, hide?: boolean) => void
  /** agent edit/preview mode: pause shows a "comment for AI" box anchored to the beat */
  editMode?: boolean
}) {
  const navigate = useNavigate()
  const { i18n } = useTranslation()
  const { enter, exit, setToolsRevealed } = useTourMode()
  const engineRef = useRef<TimelineEngine | null>(null)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [snap, setSnap] = useState<EngineSnapshot | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  // explore-on-pause: which property the customer tapped to inspect (project_id)
  const [exploreId, setExploreId] = useState<string | null>(null)
  // agent edit-mode: comment composer anchored to the current beat
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentCount, setCommentCount] = useState(0)
  const [commentDone, setCommentDone] = useState(false)
  // subtitles (narration captions) — on by default, persisted, toggleable
  const [subtitlesOn, setSubtitlesOn] = useState(() => {
    try {
      return localStorage.getItem('lt-subtitles') !== 'off'
    } catch {
      return true
    }
  })
  const toggleSubtitles = () =>
    setSubtitlesOn((v) => {
      const next = !v
      try {
        localStorage.setItem('lt-subtitles', next ? 'on' : 'off')
      } catch {
        /* ignore */
      }
      return next
    })

  // Live Q&A (§4.6): connects to Gemini Live when the customer asks. Self-contained.
  // onPoiCategory lets the Live AI drive the same POI filter the customer toggles.
  const live = useTourLive(() => mapRef.current, onPoiCategory)

  // Caption: show 1–2 sentences at a time, advanced by the beat clock (atMs).
  const captionChunks = useMemo(() => (snap?.narration ? chunkCaption(snap.narration) : []), [snap?.narration])
  const captionText = useMemo(() => pickCaption(captionChunks, snap?.atMs ?? 0), [captionChunks, snap?.atMs])

  // enter/exit tour mode (hides app chrome via Layout)
  useEffect(() => {
    enter(code)
    return () => exit()
  }, [code, enter, exit])

  // Force the whole experience into the SESSION's language (so the demo always
  // reads Chinese, the EN copy always English) — incl. the map's area/landmark
  // labels, which otherwise follow the viewer's browser language and read mixed.
  // Restore the viewer's own language when they leave the tour.
  useEffect(() => {
    if (load.kind !== 'ready' || !load.data.language) return
    const prev = i18n.language
    if (load.data.language !== prev) i18n.changeLanguage(load.data.language)
    return () => { if (i18n.language !== prev) i18n.changeLanguage(prev) }
  }, [load, i18n])

  // reveal the real map tools whenever the tour is paused/asking
  const isPaused = snap?.state === 'paused' || snap?.state === 'asking'
  useEffect(() => {
    setToolsRevealed(isPaused)
  }, [isPaused, setToolsRevealed])

  // fetch the shared session
  useEffect(() => {
    let alive = true
    async function run() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/luna/public/v/${encodeURIComponent(code)}`)
        if (!alive) return
        if (res.status === 404) return setLoad({ kind: 'error', message: '导览不存在或已下线。' })
        if (res.status === 410) return setLoad({ kind: 'error', message: '导览链接已过期。' })
        if (!res.ok) return setLoad({ kind: 'error', message: '加载失败，请稍后再试。' })
        const data = (await res.json()) as WatchPayload
        if (!data?.script?.acts?.length) {
          return setLoad({ kind: 'error', message: '导览内容尚未生成。' })
        }
        setLoad({ kind: 'ready', data })
      } catch {
        if (alive) setLoad({ kind: 'error', message: '网络错误，请检查连接。' })
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [code])

  const data = load.kind === 'ready' ? load.data : null

  /**
   * 有没有拍子缺语音 —— 缺了就会回落到浏览器机器音。
   * 草稿(还没「确认，生成语音并发布」)就是这种情况。绝不能让它悄悄发生。
   */
  const missingVoice = (() => {
    if (!data?.script) return false
    const beats = [data.script.intro, ...data.script.acts.flatMap((a) => a.beats), data.script.outro]
    return beats.some((b) => b && !b.audio_url)
  })()
  const zh = !!i18n.language?.startsWith('zh')
  const accent =
    (data?.session.theme?.accent as string) ||
    (data?.agent.brand?.accent as string) ||
    '#00E0B8'

  // Telemetry — decoupled hook (observes snapshot, never touches the engine).
  const tel = useTourTelemetry(code, data, snap)

  // The TourScript references properties by their residential project_id (that's
  // what the seed fed the AI), NOT the session-property row id. Key everything by
  // project_id so overlays/engine resolve. Fall back to id if project_id is null.
  const pidOf = (p: { id: string; project_id: string | null }) => p.project_id ?? p.id
  const propertyMap = useMemo(() => {
    const m = new Map<string, PropertySnapshot>()
    data?.properties.forEach((p) => m.set(pidOf(p), p.snapshot))
    return m
  }, [data])

  // Prefetch REAL amenity radials (nearest POIs + score) for each property so
  // the "life" beat can drive the map's real amenity viz with no mid-tour lag.
  const amenityRef = useRef<Map<string, AmenityPayload>>(new Map())
  useEffect(() => {
    if (!data) return
    let alive = true
    Promise.all(
      data.properties.map(async (p) => {
        const c = p.snapshot.coords
        if (!Array.isArray(c)) return
        const a = await fetchAmenity(c[0], c[1], p.snapshot.name)
        if (alive && a) amenityRef.current.set(pidOf(p), a)
      })
    )
    return () => {
      alive = false
    }
  }, [data])

  // Prefetch REAL DLD market evidence (last-30d sales volume / median psf /
  // comparables) per property, so the investment beat can show sourced, verifiable
  // numbers with no mid-tour lag. Keyed by project_id. (E1 credibility layer.)
  const evidenceRef = useRef<Map<string, MarketEvidence>>(new Map())
  const [, setEvidenceTick] = useState(0)
  useEffect(() => {
    if (!data) return
    let alive = true
    Promise.all(
      data.properties.map(async (p) => {
        const s = p.snapshot
        const qs = new URLSearchParams()
        if (s.name) qs.set('project', s.name)
        if (s.area) qs.set('area', s.area)
        if (![...qs.keys()].length) return
        try {
          const r = await fetch(`${API_BASE_URL}/api/luna/public/evidence?${qs.toString()}`)
          if (!r.ok) return
          const j = (await r.json()) as { evidence: MarketEvidence | null }
          if (alive && j.evidence) {
            evidenceRef.current.set(pidOf(p), j.evidence)
            setEvidenceTick((n) => n + 1) // re-render so a visible beat picks it up
          }
        } catch {
          /* evidence is best-effort — never blocks the tour */
        }
      })
    )
    return () => {
      alive = false
    }
  }, [data])

  // Draw the tour's property pins as a GL LAYER (scales with zoom, renders in the
  // GL frame → no jitter under the per-frame cinematic camera), and SUPPRESS the
  // host map's DOM teardrop markers (which jittered + never scaled). Explore on
  // pause uses the thumbnail strip below, not map-pin taps. See perf rules R2.
  useEffect(() => {
    if (!data) return
    onPins?.([]) // no react-map-gl DOM markers during the tour
    const glPins = data.properties
      .filter((p) => Array.isArray(p.snapshot.coords))
      .map((p) => ({
        id: pidOf(p),
        coord: p.snapshot.coords as [number, number],
        label: p.snapshot.name,
        image: p.snapshot.image ?? null,
      }))
    mapRef.current?.setPropertyPins(glPins)
    return () => {
      onPins?.([])
      mapRef.current?.setPropertyPins([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  /** 所有项目坐标 —— 开场机位/构图全靠它算（不是「第一个项目」）。 */
  const tourCoords = useMemo(
    () =>
      (data?.properties ?? [])
        .map((p) => p.snapshot.coords)
        .filter((c): c is [number, number] => Array.isArray(c)),
    [data]
  )

  /** 后端算好的建立机位（中心 + zoom）—— 开场以它为基准，只会更宽不会更紧。 */
  const authoredEstablishing = useMemo(() => {
    const kf = (data?.script?.intro?.camera ?? []).find(
      (c) => !('type' in c) && Array.isArray((c as { center?: unknown }).center)
    ) as { center?: [number, number]; zoom?: number } | undefined
    return { center: kf?.center, zoom: kf?.zoom ?? 10.2 }
  }, [data])

  /**
   * 🔴 相机要对准的是「**看得见的那块**的中心」，不是画布中心。
   *
   * owner:「要集中中间屏幕能看到重要信息」。画布中心在手机上被字幕和卡片压着 ——
   * Luna 正在介绍的那栋楼恰好躺在字幕底下。MapLibre 的 padding 就是干这个的：
   * 设一次，之后每一帧 jumpTo 都自动沿用（jumpTo 不带 padding 不会覆盖它）。
   * 转屏/改窗口要重算。退出 tour 时清掉，别污染普通地图。
   */
  useEffect(() => {
    if (!data) return
    const apply = () => mapRef.current?.setViewportPadding(tourViewportPadding())
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
      mapRef.current?.setViewportPadding(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  /**
   * 🔴 欢迎页:相机**静止**停在 tour 的第一帧机位。
   *
   * 这里原本跑着一个**无限旋转**:每帧 `bearing += 0.05`，60fps → 3°/秒，永不停止。
   * 而欢迎页的遮罩是**半透明**的 —— 客户**看得见**地图在背景里缓慢打转。
   * **那就是「莫名其妙的平移」。** （顺带 60fps 空转烧 GPU。）
   *
   * 现在:用和 tour 第一帧**完全同一个** establishingShot()，jumpTo 过去，
   * **一次，不循环**。点「开始」的瞬间无缝接上那圈环绕。
   */
  useEffect(() => {
    if (snap || !data) return // snap becomes non-null once the engine starts
    const map = mapRef.current
    if (!map) return
    const shot = establishingShot(tourCoords, authoredEstablishing.zoom, authoredEstablishing.center)
    map.jumpTo(shot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, data, tourCoords, authoredEstablishing])

  const clearMapFeatures = () => {
    onMeasure?.(null)
    onAmenities?.(null)
    onTransit?.(false)
    onAreaMetric?.(null)
  }

  // dispose engine on unmount (also clears the real map features + Live)
  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
      clearMapFeatures()
      live.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exitDemo = () => {
    engineRef.current?.dispose()
    engineRef.current = null
    clearMapFeatures()
    navigate('/')
  }

  const startEngine = () => {
    if (!data || !mapRef.current || engineRef.current) return

    /**
     * 🔴 **开场和收尾的运镜由我们算，不用剧本里模型写的那两段。**
     *
     * 模型给的开场是「静止广角 + 慢慢推近 1 级 zoom」，摊到 20 秒旁白上基本是
     * 一张静止的图（owner:「一开始的动作也不好」）。而开场是第一印象，不该每次
     * 碰运气 —— 它本来就是纯几何题。见 engine/openingShot.ts：
     *   高空(比剧本更宽一点) + 一圈**缓慢环绕**，转多久由旁白长度决定。
     * 收尾同理：退到高空一起看完所有的家，继续慢慢转，而不是定格。
     *
     * 中间每一幕（到访/生活/户型/数字…）**完全按剧本走** —— 那是内容，模型说了算。
     */
    const shot = establishingShot(tourCoords, authoredEstablishing.zoom, authoredEstablishing.center)
    const script = {
      ...data.script,
      intro: { ...data.script.intro, camera: introCameraCues(shot) },
      outro: { ...data.script.outro, camera: outroCameraCues(shot) },
    }

    const engine = new TimelineEngine({
      script,
      properties: propertyMap,
      map: mapRef.current,
      onUpdate: (s) => setSnap(s),
      amenityById: amenityRef.current,
      sink: {
        // After toggling a host-map data layer (distance lines / amenity radial /
        // transit routes / area heatmap), re-assert the tour stacking so the metro
        // routes never cover the distance lines or the property pins. The host
        // layers mount async (react-map-gl), so raiseTourLayers() self-retries.
        measure: (pts) => {
          onMeasure?.(pts)
          mapRef.current?.raiseTourLayers()
        },
        amenities: (p) => {
          onAmenities?.(p)
          mapRef.current?.raiseTourLayers()
        },
        transit: (on) => {
          onTransit?.(on)
          mapRef.current?.raiseTourLayers()
        },
        areaMetric: (m) => {
          onAreaMetric?.(m)
          mapRef.current?.raiseTourLayers()
        },
      },
    })
    engineRef.current = engine
    // (re)draw the GL property pins now that the map handle is guaranteed ready
    // (the [data] effect may have run before mapRef was set).
    const glPins = data.properties
      .filter((p) => Array.isArray(p.snapshot.coords))
      .map((p) => ({
        id: pidOf(p),
        coord: p.snapshot.coords as [number, number],
        label: p.snapshot.name,
        image: p.snapshot.image ?? null,
      }))
    mapRef.current.setPropertyPins(glPins)
    engine.start()
    tel.track('tour_play')
  }

  // Click-to-start: the "开始" gesture is what unlocks audio/TTS in the browser,
  // so we start with sound ON from a real user tap. (Not autoplay-as-video.)
  const handleStart = () => {
    vibrate(20)
    startEngine()
  }

  const handleTapStage = () => {
    const eng = engineRef.current
    if (!eng) return
    const st = snap?.state
    if (st === 'playing' || st === 'reveal' || st === 'outro') {
      eng.enterAsking()
      vibrate(12)
    }
  }
  const handleResume = () => {
    live.disconnect()
    engineRef.current?.play()
  }

  // agent edit-mode: save a comment for the CURRENT beat (anchored at this moment)
  const addComment = async () => {
    const body = commentText.trim()
    const beatId = snap?.beatId
    if (!body || !beatId) return
    setCommentBusy(true)
    try {
      const r = await lunaFetch(`/sessions/${encodeURIComponent(code)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ beat_id: beatId, at_ms: snap?.atMs ?? null, body }),
      })
      if (r.ok) {
        setCommentText('')
        setCommentCount((n) => n + 1)
        setCommentDone(true)
        vibrate(10)
        setTimeout(() => setCommentDone(false), 1500)
      }
    } catch {
      /* best-effort */
    }
    setCommentBusy(false)
  }

  // start Live Q&A: connect Gemini Live with the current property + what's been said
  const askLuna = () => {
    if (!data) return
    vibrate(12)
    const seg = data.properties.find((p) => pidOf(p) === exploreId)?.snapshot
    const focused =
      seg ?? (snap?.actIndex != null && snap.actIndex >= 0 ? data.properties[snap.actIndex]?.snapshot : undefined)
    live.connect({
      shareCode: code,
      propertyName: focused?.name,
      propertyArea: focused?.area,
    })
    tel.track('ask')
  }

  const handleFavorite = (id: string) => {
    vibrate([10, 30, 10])
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        tel.track('feedback', { project_id: id, reaction: 'love' })
      }
      return next
    })
  }

  const handleCta = () => {
    if (!data) return
    vibrate(20)
    const wa = data.agent.whatsapp || (data.agent.brand?.whatsapp as string)
    const likedNames = data.properties.filter((p) => favorites.has(pidOf(p))).map((p) => p.snapshot.name)
    const liked = likedNames.length ? `我最喜欢 ${likedNames[0]}，` : ''
    const prefill = `${data.agent.name} 你好，我看完了 Luna 的导览，${liked}想约时间看房。`
    tel.track('cta_whatsapp')
    if (wa) window.open(`https://wa.me/${wa}?text=${encodeURIComponent(prefill)}`, '_blank')
    else if (data.agent.phone) window.open(`tel:${data.agent.phone}`)
  }

  // explore: tap a property while paused → fly there + show its card + record view
  const handleExplore = (projectId: string) => {
    const snapJson = propertyMap.get(projectId)
    if (!snapJson || !Array.isArray(snapJson.coords)) return
    vibrate(10)
    setExploreId(projectId)
    mapRef.current?.flyTo({ center: snapJson.coords, zoom: 15, pitch: 55, duration: 1800 })
    mapRef.current?.pulseAt(snapJson.coords)
    tel.track('property_view', { project_id: projectId })
  }
  // leaving pause clears the explore card
  useEffect(() => {
    if (!isPaused) setExploreId(null)
  }, [isPaused])

  const seekToAct = (actIndex: number) => {
    const eng = engineRef.current
    if (!eng) return
    const segs = eng.getSegments()
    const target = segs.find((s) => s.actIndex === actIndex)
    if (target) eng.seekToSegment(segs.indexOf(target))
  }

  if (load.kind === 'loading') {
    return (
      <div className="lt-tour-host">
        <div className="lt-loading" style={{ pointerEvents: 'auto' }}>
          <div className="orb" />
          <p>正在准备你的私人导览…</p>
        </div>
      </div>
    )
  }
  if (load.kind === 'error') {
    return (
      <div className="lt-tour-host">
        <div className="lt-error" style={{ pointerEvents: 'auto' }}>
          <p>{load.message}</p>
          <button className="lt-exit" style={{ position: 'static' }} onClick={exitDemo}>
            ✕
          </button>
        </div>
      </div>
    )
  }

  const state = snap?.state ?? 'idle'
  const started = !!snap

  return (
    <div className="lt-tour-host" style={{ ['--lt-accent' as string]: accent }}>
      <div className="lt-vignette" style={{ position: 'absolute', inset: 0 }} />

      {/* exit demo */}
      <button className="lt-exit" onClick={exitDemo} aria-label="退出导览">
        ✕
      </button>

      {/* stage tap = tap anywhere to PAUSE — only while actively playing. Removed
          when paused/asking so the explore strip / cards underneath are clickable. */}
      {started && (state === 'playing' || state === 'reveal' || state === 'outro') && (
        <button
          aria-label="点按暂停提问"
          onClick={handleTapStage}
          style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'transparent', border: 'none', pointerEvents: 'auto' }}
        />
      )}

      {/* React overlays */}
      {snap && (
        <OverlayLayer
          overlays={snap.overlays}
          properties={propertyMap}
          agent={data!.agent}
          accent={accent}
          favorites={favorites}
          onFavorite={handleFavorite}
          onCta={handleCta}
        />
      )}

      {/* E1 — real DLD market evidence beside the investment claim (when the
          roi_card beat is active). Sourced + verifiable; falls back silently if
          we have no evidence for this property. */}
      {(() => {
        const roi = snap?.overlays.find((o) => o.overlay.type === 'roi_card')
        if (!roi || state === 'ended') return null
        const pid =
          (roi.overlay.type === 'roi_card' && roi.overlay.property_id) ||
          (snap && snap.actIndex >= 0 ? data?.script.acts[snap.actIndex]?.property_id : undefined)
        const ev = pid ? evidenceRef.current.get(pid) : undefined
        return ev ? <EvidenceCard evidence={ev} accent={accent} /> : null
      })()}

      {/**
        * 缺配音的拍 —— 现在**不再回落机器音**(owner:宁愿无配音也不要机器人音),
        * 而是静默+字幕。这条横幅只对**经纪预览/批注**(editMode)显示,提醒他「还没配音」;
        * 无配音发布给客户看时**绝不显示**(那是刻意的静默,不是出错)。
        */}
      {editMode && started && missingVoice && state !== 'ended' && (
        <div className="lt-voice-warn">
          {zh
            ? '🔇 暂无配音 · 只有字幕 —— 发布时可选「生成 Luna 配音」或直接「无配音发布」'
            : '🔇 No voiceover · subtitles only — on publish you can add Luna’s voice or publish silent'}
        </div>
      )}

      {/* top CHAPTER bar — one chapter per home, labeled with its name. Tap to fly
          back/forward to that home. Replaces the abstract dot rows. */}
      {started && (snap?.actCount ?? 0) > 0 && state !== 'ended' && (
        <div className="lt-chapters">
          {Array.from({ length: snap?.actCount ?? 0 }).map((_, i) => {
            const cur = snap?.actIndex ?? -1
            const cls = i < cur ? 'done' : i === cur ? 'active' : ''
            const pid = data?.script.acts[i]?.property_id
            const name = (pid && propertyMap.get(pid)?.name) || `第 ${i + 1} 个家`
            return (
              <button
                key={i}
                className={`lt-chapter ${cls}`}
                onClick={() => seekToAct(i)}
                title={name}
              >
                <span className="lt-chapter-bar">
                  <span className="lt-chapter-fill" />
                </span>
                <span className="lt-chapter-name">
                  {i + 1}. {name}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* agent badge */}
      <div className="lt-agent-badge">
        {data!.agent.photo_url && <img src={data!.agent.photo_url} alt={data!.agent.name} />}
        <div>
          <div className="nm">{data!.agent.name}</div>
          <div className="ti">{(data!.agent.brand?.title as string) || '置业顾问'}</div>
        </div>
      </div>

      {/* mute (bottom-right; hidden on the replay screen) */}
      {started && state !== 'ended' && (
        <button className="lt-mute" onClick={() => engineRef.current?.toggleMute()}>
          {snap?.muted ? '🔇' : '🔊'}
        </button>
      )}

      {/* subtitles toggle (sits left of mute) */}
      {started && state !== 'ended' && (
        <button
          className={`lt-cc ${subtitlesOn ? 'on' : ''}`}
          onClick={toggleSubtitles}
          aria-label={subtitlesOn ? '关闭字幕' : '开启字幕'}
          title={subtitlesOn ? '关闭字幕' : '开启字幕'}
        >
          CC
        </button>
      )}

      {/* subtitle track — 1–2 sentences at a time while Luna is speaking */}
      {started && subtitlesOn && captionText && (state === 'playing' || state === 'reveal' || state === 'outro') && (
        <div className="lt-subtitle" aria-live="polite">
          <span key={captionText}>{captionText}</span>
        </div>
      )}

      {/* agent edit-mode banner */}
      {editMode && started && state !== 'ended' && (
        <div className="lt-edit-banner">批注模式 · 暂停后给这段留言{commentCount > 0 ? ` · 已 ${commentCount} 条` : ''}</div>
      )}

      {/* agent edit-mode: comment composer anchored to the current beat (on pause) */}
      {editMode && (state === 'asking' || state === 'paused') && (
        <div className="lt-comment">
          <div className="lt-comment-head">💬 给这段留言（供 AI 改稿）</div>
          <textarea
            className="lt-comment-input"
            rows={2}
            placeholder="例如:短一点 / 强调海景 / 这个数字改成…"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <div className="lt-comment-actions">
            <button className="lt-comment-save" disabled={commentBusy || !commentText.trim()} onClick={addComment}>
              {commentDone ? '✓ 已留言' : commentBusy ? '保存中…' : '留言'}
            </button>
            {commentCount > 0 && (
              <span className="lt-comment-count">回经纪台「流程」点「用 AI 应用评论」</span>
            )}
          </div>
        </div>
      )}

      {/* resume — replaces the old Luna pill. Tap the stage (anywhere) to pause;
          this button continues. Only shown while paused/asking. */}
      {(state === 'asking' || state === 'paused') && (
        <button className="lt-resume" style={{ pointerEvents: 'auto' }} onClick={handleResume}>
          <span className="orb" />
          <span>继续观看</span>
        </button>
      )}

      {/* paused: ask Luna (Live Q&A) */}
      {(state === 'asking' || state === 'paused') && (
        <button
          className={`lt-ask-luna ${live.phase !== 'idle' ? 'live' : ''}`}
          onClick={live.phase === 'idle' || live.phase === 'error' ? askLuna : live.disconnect}
        >
          <span className="orb" />
          {live.phase === 'idle' && '🎙 问问 Luna'}
          {live.phase === 'connecting' && '连接中…'}
          {live.phase === 'listening' && '在听… (说话即可) · 点结束'}
          {live.phase === 'speaking' && 'Luna 正在回答…'}
          {live.phase === 'error' && '重试'}
        </button>
      )}
      {live.lastReply && (state === 'asking' || state === 'paused') && (
        <div className="lt-live-caption">{live.lastReply}</div>
      )}

      {/* paused: explore strip — tap a home to inspect it yourself */}
      {(state === 'asking' || state === 'paused') && !exploreId && live.phase === 'idle' && (
        <>
          <div className="lt-ask-hint">想自己看看?点下面任意一套 · 或点继续</div>
          <div className="lt-explore-strip">
            {data!.properties.map((p) => {
              const pid = p.project_id ?? p.id
              const s = p.snapshot
              return (
                <button key={pid} className="lt-explore-chip" onClick={() => handleExplore(pid)}>
                  {s.image && <img src={s.image} alt={s.name} />}
                  <span className="lt-explore-name">{s.name}</span>
                  {s.min_price != null && (
                    <span className="lt-explore-price">{formatAedShort(s.min_price)}</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* paused: full project detail (units, floor plans, payment, investment) in
          a right drawer — the customer taps a home to inspect EVERYTHING, exactly
          like /project/:id, then closes to return to the paused tour (resume snaps
          the camera back to where it left off). Replaces the old thin info card. */}
      {(state === 'asking' || state === 'paused') && exploreId && (
        <ProjectDetailDialog projectId={exploreId} onClose={() => setExploreId(null)} />
      )}

      {/* Beautiful click-to-start greeting (the tap unlocks audio). */}
      {!started && data && (
        <GreetingScreen
          agentName={data.agent.name}
          agentPhoto={data.agent.photo_url ?? undefined}
          agentTitle={(data.agent.brand?.title as string) || '置业顾问'}
          clientName={data.session.client_name ?? undefined}
          propertyCount={data.properties.length}
          accent={accent}
          onStart={handleStart}
        />
      )}
      {state === 'ended' && (
        <button
          className="lt-bigbtn"
          style={{ pointerEvents: 'auto' }}
          onClick={() => {
            tel.track('tour_replay')
            engineRef.current?.replay()
          }}
        >
          <span className="circle">↻</span>
          <span className="label">再看一遍</span>
        </button>
      )}
    </div>
  )
}
