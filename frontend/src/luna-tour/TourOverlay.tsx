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
import GreetingScreen from './overlays/GreetingScreen'
import EvidenceCard from './overlays/EvidenceCard'
import { TimelineEngine, EngineSnapshot } from './engine/TimelineEngine'
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
}) {
  const navigate = useNavigate()
  const { enter, exit, setToolsRevealed } = useTourMode()
  const engineRef = useRef<TimelineEngine | null>(null)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [snap, setSnap] = useState<EngineSnapshot | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  // explore-on-pause: which property the customer tapped to inspect (project_id)
  const [exploreId, setExploreId] = useState<string | null>(null)
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

  // Before the tour starts, slowly orbit over Dubai (centred on the picked homes)
  // behind the lightly-blurred greeting so the cover feels alive. Stops on start.
  useEffect(() => {
    if (snap || !data) return // snap becomes non-null once the engine starts
    const coords = data.properties
      .map((p) => p.snapshot.coords)
      .filter((c): c is [number, number] => Array.isArray(c))
    const center: [number, number] = coords.length
      ? [
          coords.reduce((s, c) => s + c[0], 0) / coords.length,
          coords.reduce((s, c) => s + c[1], 0) / coords.length,
        ]
      : [55.2, 25.12]
    let bearing = 0
    let raf = 0
    const tick = () => {
      const map = mapRef.current
      if (map) {
        bearing = (bearing + 0.05) % 360
        map.jumpTo({ center, zoom: 10.2, pitch: 55, bearing })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, data])

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
    const engine = new TimelineEngine({
      script: data.script,
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
          <div className="ti">{(data!.agent.brand?.title as string) || '认证顾问'}</div>
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

      {/* subtitle track — current narration while Luna is speaking */}
      {started && subtitlesOn && snap?.narration && (state === 'playing' || state === 'reveal' || state === 'outro') && (
        <div className="lt-subtitle" aria-live="polite">
          <span>{snap.narration}</span>
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

      {/* paused: a single property's info card the customer pulled up */}
      {(state === 'asking' || state === 'paused') && exploreId && propertyMap.get(exploreId) && (
        <div className="lt-explore-card">
          <button className="lt-explore-back" onClick={() => setExploreId(null)}>← 返回</button>
          {(() => {
            const s = propertyMap.get(exploreId)!
            const metro = s.distances?.find((d) => d.label.includes('地铁'))
            return (
              <>
                {s.image && <div className="lt-card-img"><img src={s.image} alt={s.name} /></div>}
                {s.area && <div className="lt-card-area">📍 {s.area}</div>}
                <div className="lt-card-name">{s.name}</div>
                {s.developer && <div className="lt-card-dev">{s.developer}</div>}
                {s.min_price != null && (
                  <div className="lt-card-price">{formatAedShort(s.min_price)}<span className="lt-card-price-unit"> 起</span></div>
                )}
                <div className="lt-card-stats">
                  {s.amenity_score != null && (
                    <div className="lt-card-stat"><b style={{ color: accent }}>{s.amenity_score}</b><span>便利度{s.amenity_tier ? ` · ${s.amenity_tier}` : ''}</span></div>
                  )}
                  {metro && (
                    <div className="lt-card-stat"><b style={{ color: accent }}>{metro.distance_km}km</b><span>🚇 最近地铁</span></div>
                  )}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Beautiful click-to-start greeting (the tap unlocks audio). */}
      {!started && data && (
        <GreetingScreen
          agentName={data.agent.name}
          agentPhoto={data.agent.photo_url ?? undefined}
          agentTitle={(data.agent.brand?.title as string) || '认证顾问'}
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
