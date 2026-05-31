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
import { API_BASE_URL } from '../lib/config'
import OverlayLayer from './overlays/OverlayLayer'
import { TimelineEngine, EngineSnapshot } from './engine/TimelineEngine'
import type { MapTourHandle } from './map/mapTourHandle'
import type { WatchPayload, PropertySnapshot, AmenityPayload } from './types'
import { fetchAmenity } from './amenities'
import { createTelemetry, type TourTelemetry } from './telemetry'
import { useTourMode } from './TourModeContext'
import './luna-tour.css'

function vibrate(ms: number | number[]) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not supported */
  }
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
}) {
  const navigate = useNavigate()
  const { enter, exit, setToolsRevealed } = useTourMode()
  const engineRef = useRef<TimelineEngine | null>(null)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [snap, setSnap] = useState<EngineSnapshot | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Telemetry (FULLY DECOUPLED, fail-safe — see telemetry.ts). Lazy, stable.
  const telRef = useRef<TourTelemetry | null>(null)
  if (!telRef.current) telRef.current = createTelemetry(code)
  const tel = telRef.current

  // enter/exit tour mode (hides app chrome via Layout)
  useEffect(() => {
    enter(code)
    return () => exit()
  }, [code, enter, exit])

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
  const accent =
    (data?.session.theme?.accent as string) ||
    (data?.agent.brand?.accent as string) ||
    '#00E0B8'

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

  // ---- telemetry observers (decoupled: watch snapshot, never touch the engine) ----
  // resolve project_id + beat kind for an act segment, for behaviour events
  const resolveSeg = (segmentKey: string, actIndex: number) => {
    if (!data || actIndex < 0) return { projectId: null as string | null, kind: undefined as string | undefined }
    const act = data.script.acts[actIndex]
    if (!act) return { projectId: null as string | null, kind: undefined as string | undefined }
    const beat = act.beats.find((bb) => `a${actIndex}-${bb.id}` === segmentKey)
    return { projectId: act.property_id, kind: beat?.kind }
  }

  // open (once the session is loaded)
  const openedRef = useRef(false)
  useEffect(() => {
    if (data && !openedRef.current) {
      openedRef.current = true
      tel.track('open')
    }
  }, [data, tel])

  // per-beat dwell + chart_view (fires as the playback crosses beats)
  const lastSegRef = useRef<{ key: string; projectId: string | null; enterTs: number } | null>(null)
  useEffect(() => {
    const key = snap?.segmentKey
    if (!key) return
    const now = performance.now()
    const prev = lastSegRef.current
    if (prev && prev.key !== key && prev.projectId) {
      tel.track('property_dwell', { project_id: prev.projectId, dwell_ms: now - prev.enterTs })
    }
    if (!prev || prev.key !== key) {
      const { projectId, kind } = resolveSeg(key, snap?.actIndex ?? -1)
      lastSegRef.current = { key, projectId, enterTs: now }
      if (kind === 'numbers' && projectId) tel.track('chart_view', { project_id: projectId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.segmentKey])

  // tour_complete (once, on reaching the end)
  const prevStateRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const st = snap?.state
    if (st === 'ended' && prevStateRef.current !== 'ended') tel.track('tour_complete')
    prevStateRef.current = st
  }, [snap?.state, tel])

  const clearMapFeatures = () => {
    onMeasure?.(null)
    onAmenities?.(null)
    onTransit?.(false)
    onAreaMetric?.(null)
  }

  // dispose engine on unmount (also clears the real map features)
  useEffect(() => {
    return () => {
      engineRef.current?.dispose()
      engineRef.current = null
      clearMapFeatures()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exitDemo = () => {
    engineRef.current?.dispose()
    engineRef.current = null
    clearMapFeatures()
    navigate('/')
  }

  const handleStart = () => {
    if (!data || !mapRef.current || engineRef.current) return
    vibrate(20)
    const engine = new TimelineEngine({
      script: data.script,
      properties: propertyMap,
      map: mapRef.current,
      onUpdate: (s) => setSnap(s),
      amenityById: amenityRef.current,
      sink: {
        measure: (pts) => onMeasure?.(pts),
        amenities: (p) => onAmenities?.(p),
        transit: (on) => onTransit?.(on),
        areaMetric: (m) => onAreaMetric?.(m),
      },
    })
    engineRef.current = engine
    engine.start()
    tel.track('tour_play')
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
  const handleResume = () => engineRef.current?.play()

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
  const total = snap?.total_ms ?? data!.script.total_ms
  const progress = total ? Math.min(100, ((snap?.elapsed_ms ?? 0) / total) * 100) : 0

  return (
    <div className="lt-tour-host" style={{ ['--lt-accent' as string]: accent }}>
      <div className="lt-vignette" style={{ position: 'absolute', inset: 0 }} />

      {/* exit demo */}
      <button className="lt-exit" onClick={exitDemo} aria-label="退出导览">
        ✕
      </button>

      {/* stage tap (pause/ask) */}
      {started && state !== 'ended' && (
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

      {/* top progress */}
      <div className="lt-topline" style={{ pointerEvents: 'none' }}>
        <div className="lt-topline-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* agent badge */}
      <div className="lt-agent-badge">
        {data!.agent.photo_url && <img src={data!.agent.photo_url} alt={data!.agent.name} />}
        <div>
          <div className="nm">{data!.agent.name}</div>
          <div className="ti">{(data!.agent.brand?.title as string) || '认证顾问'}</div>
        </div>
      </div>

      {/* mute */}
      {started && (
        <button className="lt-mute" onClick={() => engineRef.current?.toggleMute()}>
          {snap?.muted ? '🔇' : '🔊'}
        </button>
      )}

      {/* act dots (jump homes) */}
      {started && state !== 'ended' && (
        <div className="lt-ov-dots" style={{ zIndex: 7, pointerEvents: 'auto' }}>
          {Array.from({ length: snap?.actCount ?? 0 }).map((_, i) => (
            <span
              key={i}
              className={i <= (snap?.actIndex ?? -1) ? 'on' : ''}
              onClick={() => seekToAct(i)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </div>
      )}

      {/* Luna pill */}
      {started && state !== 'ended' && (
        <button
          className={`lt-luna ${state === 'asking' || state === 'paused' ? 'big' : ''}`}
          style={{ pointerEvents: 'auto' }}
          onClick={state === 'playing' || state === 'reveal' || state === 'outro' ? handleTapStage : handleResume}
        >
          <span className="orb" />
          <span>{state === 'asking' || state === 'paused' ? '继续观看' : 'Luna'}</span>
        </button>
      )}

      {/* ask hint */}
      {(state === 'asking' || state === 'paused') && (
        <div className="lt-ask-hint">想问什么?(语音提问即将上线) · 点继续看下一个</div>
      )}

      {/* big play / replay */}
      {!started && (
        <button className="lt-bigbtn" style={{ pointerEvents: 'auto' }} onClick={handleStart}>
          <span className="circle">▶</span>
          <span className="label">为{data!.session.client_name || '你'}私人定制 · 点击开始</span>
        </button>
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
