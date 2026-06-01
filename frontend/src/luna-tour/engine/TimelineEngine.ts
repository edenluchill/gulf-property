/**
 * Luna Tour — cinematic playback engine (event-driven sequencer).
 *
 * Plays beats STRICTLY in order. A beat hands off to the next only when ALL of:
 *   • narration actually finished (mp3 `ended` / TTS `onend`), and
 *   • every camera move of the beat actually finished (executeCamera Promises), and
 *   • a small min-dwell elapsed (so a near-silent beat doesn't flash by).
 * So a line is never cut off and a flyTo never starts early — independent of
 * language / TTS / speed. The authored `duration_ms` is NOT used for handoff.
 *
 * Within a beat, a pausable rAF clock schedules intra-beat cues (overlays / extra
 * camera keyframes at their `at_ms`). Beat-to-beat progression is the await-chain
 * in playFrom(); the clock only paces cues + min-time inside the current beat.
 */
import type { MapTourHandle } from '../map/mapTourHandle'
import type {
  Camera,
  Overlay,
  Segment,
  TourScript,
  PropertySnapshot,
  LngLat,
  AmenityPayload,
} from '../types'
import { AudioTrack } from './audioTrack'

export type EngineState =
  | 'loading'
  | 'reveal'
  | 'playing'
  | 'paused'
  | 'asking'
  | 'outro'
  | 'ended'

export interface RenderOverlay {
  key: string
  overlay: Overlay
}

export interface EngineSnapshot {
  state: EngineState
  /** beats completed — progress proxy for the bar (elapsed/total ≈ fraction) */
  elapsed_ms: number
  /** total beats */
  total_ms: number
  segmentKey: string
  actIndex: number
  actCount: number
  overlays: RenderOverlay[]
  muted: boolean
}

/** Min visual dwell so a near-silent beat doesn't flash by (ms). */
const MIN_BEAT_MS = 1500
/** Safety backstop: never wait longer than this for one beat (ms). */
const MAX_BEAT_MS = 60000

const STICKY_OVERLAYS = new Set(['progress_dots', 'cta', 'favorite_picker'])
const MAP_OVERLAYS = new Set(['distance_line', 'amenity_spokes', 'highlight_all_pins'])

interface IntraCue {
  at_ms: number
  fired: boolean
  kind: 'camera' | 'overlay'
  camera?: Camera
  overlay?: Overlay
}

export interface TourMapFeatureSink {
  measure: (points: LngLat[] | null) => void
  amenities: (payload: AmenityPayload | null) => void
  transit: (on: boolean) => void
  areaMetric: (metric: string | null) => void
}

export interface EngineDeps {
  script: TourScript
  properties: Map<string, PropertySnapshot>
  map: MapTourHandle
  onUpdate: (s: EngineSnapshot) => void
  sink?: TourMapFeatureSink
  amenityById?: Map<string, AmenityPayload>
}

export class TimelineEngine {
  private script: TourScript
  private properties: Map<string, PropertySnapshot>
  private map: MapTourHandle
  private onUpdate: (s: EngineSnapshot) => void
  private sink?: TourMapFeatureSink
  private amenityById?: Map<string, AmenityPayload>
  private audio: AudioTrack

  private segments: Segment[] = []
  /** camera to run BEFORE a segment's own beat (inter-act flyover); index-aligned */
  private preCamera: (Camera | undefined)[] = []

  private state: EngineState = 'loading'
  private muted = false
  private started = false
  private disposed = false
  private paused = false

  private curIndex = -1
  private activeOverlays: RenderOverlay[] = []

  // --- current-beat machinery ---
  private raf: number | null = null
  private beatCues: IntraCue[] = []
  private beatElapsed = 0
  private beatClockStart = 0
  // gates
  private narrationDone = false
  private minTimeDone = false
  private pendingCameraCues = 0 // camera cues not yet dispatched
  private runningCameras = 0 // camera promises in flight
  private resolveBeat: (() => void) | null = null
  private backstop: number | null = null

  constructor(deps: EngineDeps) {
    this.script = deps.script
    this.properties = deps.properties
    this.map = deps.map
    this.onUpdate = deps.onUpdate
    this.sink = deps.sink
    this.amenityById = deps.amenityById
    this.audio = new AudioTrack(deps.script.language)
    this.build()
  }

  // ---- build ordered beat list (order only; no absolute timeline) ----
  private build() {
    const segs: Segment[] = []
    const pre: (Camera | undefined)[] = []
    const add = (beat: Segment['beat'], actIndex: number, propertyId: string | undefined, preCam?: Camera) => {
      segs.push({ key: segKey(beat, actIndex), beat, start_ms: 0, actIndex, propertyId })
      pre.push(preCam)
    }
    add(this.script.intro, -1, undefined)
    this.script.acts.forEach((act, ai) => {
      act.beats.forEach((b, bi) => {
        let preCam: Camera | undefined
        if (bi === 0 && ai > 0) {
          const prevAct = this.script.acts[ai - 1]
          const from = this.properties.get(prevAct.property_id)?.coords
          const to = this.properties.get(act.property_id)?.coords
          if (from && to) {
            preCam = { type: 'flyover', at_ms: 0, from, to, duration_ms: prevAct.transition_out?.duration_ms ?? 2500 }
          }
        }
        add(b, ai, act.property_id, preCam)
      })
    })
    add(this.script.outro, -1, undefined)
    this.segments = segs
    this.preCamera = pre
  }

  // ---- public controls (API stable for TourOverlay) ----
  start() {
    if (this.started) return
    this.started = true
    this.setState('reveal')
    void this.playFrom(0)
  }

  play() {
    if (this.state === 'ended') return this.replay()
    if (this.paused) {
      this.paused = false
      this.map.drift(false)
      this.audio.resume()
      this.setState(this.computeState(this.curIndex))
      this.beatClockStart = performance.now() - this.beatElapsed
      this.startClock()
      this.emit()
    } else if (!this.started) {
      this.start()
    }
  }

  pause() {
    if (this.state === 'ended') return
    this.paused = true
    this.stopClock()
    this.beatElapsed = performance.now() - this.beatClockStart
    this.audio.pause()
    this.map.drift(true)
    this.setState('paused')
    this.emit()
  }

  enterAsking() {
    this.pause()
    this.setState('asking')
    this.emit()
  }

  toggleMute() {
    this.muted = !this.muted
    this.audio.setMuted(this.muted)
    if (this.muted && !this.narrationDone) {
      // muted mid-beat → narration onend won't fire; release that gate
      this.narrationDone = true
      this.checkBeatDone()
    }
    this.emit()
  }

  seekToSegment(index: number) {
    const i = Math.max(0, Math.min(index, this.segments.length - 1))
    this.paused = false
    this.map.drift(false)
    void this.playFrom(i, true)
  }

  replay() {
    this.paused = false
    this.map.drift(false)
    void this.playFrom(0)
  }

  dispose() {
    this.disposed = true
    this.abortBeat()
    this.stopClock()
    this.sink?.measure(null)
    this.sink?.amenities(null)
    this.sink?.transit(false)
    this.sink?.areaMetric(null)
    this.map.pulseAt(null)
    this.map.clearOverlays()
    this.audio.dispose()
  }

  getSegments() {
    return this.segments
  }

  // ---- sequencer ----
  private async playFrom(startIndex: number, skipFirstPreCamera = false) {
    // tear down any in-flight beat
    this.abortBeat()
    this.audio.stop()
    this.map.clearOverlays()
    this.activeOverlays = startIndex === 0 ? [] : this.activeOverlays.filter((o) => STICKY_OVERLAYS.has(o.overlay.type))

    for (let i = startIndex; i < this.segments.length; i++) {
      if (this.disposed) return
      const seg = this.segments[i]
      this.curIndex = i
      this.setState(this.computeState(i))

      // inter-act flyover before this beat (real travel; awaited)
      const pre = this.preCamera[i]
      if (pre && !(skipFirstPreCamera && i === startIndex)) {
        await this.runCamera(pre, this.focusOf(seg))
        await this.waitWhilePaused()
        if (this.disposed) return
      }

      await this.playBeat(seg)
      if (this.disposed) return
    }
    this.finishToEnded()
  }

  /** Resolves only when narration + cameras + min-time are all really done. */
  private playBeat(seg: Segment): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveBeat = resolve

      // enter-segment side effects on the host map
      this.map.clearOverlays()
      this.activeOverlays = this.activeOverlays.filter((o) => STICKY_OVERLAYS.has(o.overlay.type))
      this.applyBeatFeatures(seg)
      this.map.pulseAt(this.focusOf(seg) ?? null)

      // gates
      this.narrationDone = false
      this.minTimeDone = false
      this.pendingCameraCues = seg.beat.camera.length
      this.runningCameras = 0

      // build intra-beat cues
      this.beatCues = [
        ...seg.beat.camera.map((cam) => ({ at_ms: cam.at_ms, fired: false, kind: 'camera' as const, camera: cam })),
        ...seg.beat.overlays.map((ov) => ({ at_ms: ov.at_ms, fired: false, kind: 'overlay' as const, overlay: ov })),
      ].sort((a, b) => a.at_ms - b.at_ms)

      // narration (event-driven; muted/empty resolves immediately)
      this.audio.play(seg.beat.narration, seg.beat.audio_url, () => {
        this.narrationDone = true
        this.checkBeatDone()
      })

      // start the pausable clock (fires cues, tracks min-time + camera completion)
      this.beatElapsed = 0
      this.beatClockStart = performance.now()
      this.startClock()

      // safety backstop
      this.backstop = window.setTimeout(() => {
        this.narrationDone = true
        this.minTimeDone = true
        this.pendingCameraCues = 0
        this.runningCameras = 0
        this.checkBeatDone()
      }, MAX_BEAT_MS)
    })
  }

  private startClock() {
    this.stopClock()
    const seg = this.segments[this.curIndex]
    if (!seg) return
    const tick = () => {
      if (this.disposed || this.paused) return
      this.beatElapsed = performance.now() - this.beatClockStart
      for (const c of this.beatCues) {
        if (!c.fired && c.at_ms <= this.beatElapsed) {
          c.fired = true
          this.dispatchCue(c, seg)
        }
      }
      this.expireOverlays(this.beatElapsed, seg)
      if (!this.minTimeDone && this.beatElapsed >= MIN_BEAT_MS) {
        this.minTimeDone = true
        this.checkBeatDone()
      }
      this.maybeEmit()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private stopClock() {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  private checkBeatDone() {
    const camerasDone = this.pendingCameraCues === 0 && this.runningCameras === 0
    if (this.narrationDone && this.minTimeDone && camerasDone && this.resolveBeat) {
      const r = this.resolveBeat
      this.abortBeat(true)
      r()
    }
  }

  /** Cancel current-beat machinery without resolving (or after resolving). */
  private abortBeat(resolved = false) {
    this.stopClock()
    if (this.backstop) {
      clearTimeout(this.backstop)
      this.backstop = null
    }
    if (!resolved) this.audio.stop()
    this.resolveBeat = null
  }

  private waitWhilePaused(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise((res) => {
      const check = () => {
        if (this.disposed || !this.paused) res()
        else setTimeout(check, 80)
      }
      check()
    })
  }

  // ---- camera ----
  private async runCamera(cam: Camera, focus?: LngLat): Promise<void> {
    this.runningCameras++
    try {
      await this.map.executeCamera(cam, focus)
    } catch {
      /* ignore */
    } finally {
      this.runningCameras = Math.max(0, this.runningCameras - 1)
      this.checkBeatDone()
    }
  }

  private dispatchCue(c: IntraCue, seg: Segment) {
    if (c.kind === 'camera' && c.camera) {
      this.pendingCameraCues = Math.max(0, this.pendingCameraCues - 1)
      void this.runCamera(c.camera, this.focusOf(seg))
      return
    }
    if (c.kind === 'overlay' && c.overlay) {
      const ov = c.overlay
      if (MAP_OVERLAYS.has(ov.type)) this.dispatchMapOverlay(ov, this.focusOf(seg))
      else this.addReactOverlay(ov, seg)
    }
  }

  private applyBeatFeatures(seg: Segment) {
    if (!this.sink) return
    const hub = seg.propertyId ? this.properties.get(seg.propertyId)?.coords : undefined
    const hasAmenity = seg.beat.overlays.some((o) => o.type === 'amenity_spokes')
    const realAmenity = seg.propertyId ? this.amenityById?.get(seg.propertyId) : undefined
    const lines = seg.beat.overlays.filter((o) => o.type === 'distance_line') as Extract<
      Overlay,
      { type: 'distance_line' }
    >[]
    const snap = seg.propertyId ? this.properties.get(seg.propertyId) : undefined
    if (hasAmenity && realAmenity) {
      this.sink.amenities(realAmenity)
      this.sink.measure(null)
    } else {
      const tos = lines.length
        ? lines.map((l) => l.to)
        : hasAmenity && snap?.distances?.length
        ? snap.distances.map((d) => d.to)
        : []
      if (tos.length && hub) this.sink.measure([hub, ...tos])
      else this.sink.measure(null)
      this.sink.amenities(null)
    }
    this.sink.transit(seg.beat.kind === 'life')
    this.sink.areaMetric(seg.beat.kind === 'numbers' ? 'medianUnitPrice' : null)
  }

  private dispatchMapOverlay(ov: Overlay, focus?: LngLat) {
    if (ov.type === 'distance_line') {
      if (this.sink) return
      const from = (ov.property_id && this.properties.get(ov.property_id)?.coords) || focus
      if (from) this.map.drawDistanceLine({ from, to: ov.to, label: ov.label })
    } else if (ov.type === 'amenity_spokes') {
      if (this.sink) return
      this.map.showAmenitySpokes({ center: ov.center, spokes: ov.spokes ?? [], score: ov.score, tier: ov.tier })
    } else if (ov.type === 'highlight_all_pins') {
      this.map.highlightPins(ov.property_ids)
    }
  }

  private addReactOverlay(ov: Overlay, seg: Segment) {
    const key = `${seg.key}:${ov.type}:${ov.at_ms}`
    this.activeOverlays = this.activeOverlays.filter((o) => o.key !== key)
    this.activeOverlays.push({ key, overlay: ov })
  }

  private expireOverlays(beatElapsed: number, seg: Segment) {
    const next = this.activeOverlays.filter((o) => {
      if (STICKY_OVERLAYS.has(o.overlay.type)) return true
      if (!o.key.startsWith(seg.key + ':')) return true
      const dur = o.overlay.duration_ms ?? 0
      if (dur <= 0) return true // persist to end of beat (cleared on next beat enter)
      return beatElapsed < o.overlay.at_ms + dur
    })
    if (next.length !== this.activeOverlays.length) this.activeOverlays = next
  }

  private finishToEnded() {
    this.abortBeat()
    this.activeOverlays = this.activeOverlays.filter(
      (o) => o.overlay.type === 'cta' || o.overlay.type === 'favorite_picker'
    )
    this.setState('ended')
    this.emit()
  }

  private focusOf(seg: Segment): LngLat | undefined {
    return seg.propertyId ? this.properties.get(seg.propertyId)?.coords : undefined
  }

  private computeState(index: number): EngineState {
    const seg = this.segments[index]
    if (!seg) return 'reveal'
    if (seg.actIndex < 0 && index === 0) return 'reveal'
    if (seg.actIndex < 0 && index === this.segments.length - 1) return 'outro'
    return 'playing'
  }

  private setState(s: EngineState) {
    this.state = s
  }

  private lastSig = ''
  private lastEmitAt = 0
  private maybeEmit() {
    const sig = `${this.state}|${this.curIndex}|${this.muted}|${this.activeOverlays.map((o) => o.key).join(',')}`
    const now = performance.now()
    if (sig !== this.lastSig || now - this.lastEmitAt >= 80) {
      this.lastSig = sig
      this.lastEmitAt = now
      this.emit()
    }
  }

  private emit() {
    const seg = this.segments[this.curIndex]
    this.onUpdate({
      state: this.state,
      elapsed_ms: Math.max(0, this.curIndex),
      total_ms: Math.max(1, this.segments.length - 1),
      segmentKey: seg?.key ?? '',
      actIndex: seg?.actIndex ?? -1,
      actCount: this.script.acts.length,
      overlays: [...this.activeOverlays],
      muted: this.muted,
    })
  }
}

function segKey(beat: { id: string }, actIndex: number): string {
  return actIndex < 0 ? beat.id : `a${actIndex}-${beat.id}`
}
