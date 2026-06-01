/**
 * Luna Tour — cinematic playback engine (§4.3).
 *
 * One master clock (requestAnimationFrame) drives three tracks:
 *   • Audio   → AudioTrack (mp3 or browser TTS)
 *   • Camera  → MapTourHandle.executeCamera (per script camera cue)
 *   • Overlay → on-map overlays via MapTourHandle, or React overlays via onUpdate
 *
 * State machine: loading → reveal → playing → (paused ↔ asking) → outro → ended.
 *
 * The engine is framework-agnostic; React subscribes via onUpdate(snapshot) and
 * renders the active overlay list. Timing is deterministic off the authored beat
 * durations, NOT actual audio length, so the three tracks never drift apart.
 */
import type { MapTourHandle } from '../map/mapTourHandle'
import type {
  Camera,
  CameraKeyframe,
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
  /** unique per cue instance */
  key: string
  overlay: Overlay
}

export interface EngineSnapshot {
  state: EngineState
  elapsed_ms: number
  total_ms: number
  segmentKey: string
  actIndex: number // -1 intro/outro, else 0-based
  actCount: number
  overlays: RenderOverlay[]
  muted: boolean
}

interface Cue {
  absTime: number
  fired: boolean
  kind: 'camera' | 'overlay'
  segmentKey: string
  camera?: Camera
  overlay?: Overlay
  /** centre of the property in focus, for camera flyover `from` + line origin */
  focusCoord?: LngLat
}

/**
 * Drives the host map's REAL features (the same ones the voice AI uses) instead
 * of custom tour overlays — § user: 地图本身所有功能客户能用 ai 也能而且要用.
 */
export interface TourMapFeatureSink {
  /** real measure tool: hub = points[0], spokes to the rest (km labels). null clears. */
  measure: (points: LngLat[] | null) => void
  /** real radial amenity viz (voiceAmenities). null clears. */
  amenities: (payload: AmenityPayload | null) => void
  /** real transit layer (metro/tram lines) on/off. */
  transit: (on: boolean) => void
  /** area-value heatmap metric (e.g. 'medianUnitPrice'). null = hide blocks. */
  areaMetric: (metric: string | null) => void
}

export interface EngineDeps {
  script: TourScript
  /** id → snapshot, for resolving distance-line origins & pin highlights */
  properties: Map<string, PropertySnapshot>
  map: MapTourHandle
  onUpdate: (s: EngineSnapshot) => void
  /** when present, distance/amenity/transit drive the REAL map features */
  sink?: TourMapFeatureSink
  /** real amenity radial per property id (prefetched from nearby POIs) */
  amenityById?: Map<string, AmenityPayload>
}

const STICKY_OVERLAYS = new Set([
  'progress_dots',
  'cta',
  'favorite_picker',
])

/** Overlays handled directly by the map ref (not React-rendered). */
const MAP_OVERLAYS = new Set(['distance_line', 'amenity_spokes', 'highlight_all_pins'])

export class TimelineEngine {
  private script: TourScript
  private properties: Map<string, PropertySnapshot>
  private map: MapTourHandle
  private onUpdate: (s: EngineSnapshot) => void
  private sink?: TourMapFeatureSink
  private amenityById?: Map<string, AmenityPayload>
  private audio: AudioTrack

  private segments: Segment[] = []
  private cues: Cue[] = []
  private total = 0

  private state: EngineState = 'loading'
  private raf: number | null = null
  private masterStart = 0 // performance.now() baseline
  private elapsed = 0
  private curSegmentKey = ''
  private activeOverlays: RenderOverlay[] = []
  private muted = false
  private started = false

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

  /**
   * Minimum ms needed to actually SPEAK a narration, so a beat isn't cut off
   * mid-sentence (the #1 glitch with browser TTS). Rough but safe: CJL chars are
   * slower than latin words. Adds a small tail so the next beat doesn't clip the
   * last word. Used to extend (never shrink) the authored beat duration.
   */
  private speakMs(text: string): number {
    if (!text) return 0
    const cjk = (text.match(/[一-鿿぀-ヿ]/g) || []).length
    const latinWords = (text.replace(/[一-鿿぀-ヿ]/g, ' ').match(/\b\w+\b/g) || []).length
    // ~4.2 CJK chars/sec, ~2.6 latin words/sec, + 700ms breathing tail.
    return Math.round((cjk / 4.2 + latinWords / 2.6) * 1000) + 700
  }

  // ---- build flat timeline ----
  private build() {
    const segs: Segment[] = []
    let t = 0
    const push = (beat: Segment['beat'], actIndex: number, propertyId?: string) => {
      // Ensure the beat lasts at least long enough to finish its narration.
      const need = this.speakMs(beat.narration)
      if (need > beat.duration_ms) beat.duration_ms = need
      segs.push({ key: segKey(beat, actIndex), beat, start_ms: t, actIndex, propertyId })
      t += beat.duration_ms
    }
    // synthetic camera cues for inter-act transitions (the "fly over the city"
    // between properties) — without these the next act's arrival just teleports.
    const transitionCues: Cue[] = []
    push(this.script.intro, -1)
    this.script.acts.forEach((act, ai) => {
      act.beats.forEach((b) => push(b, ai, act.property_id))
      const tr = act.transition_out
      if (tr && tr.duration_ms > 0) {
        const next = this.script.acts[ai + 1]
        const from = this.properties.get(act.property_id)?.coords
        const to = next ? this.properties.get(next.property_id)?.coords : undefined
        if (from && to) {
          transitionCues.push({
            absTime: t, // at the gap right after this act's last beat
            fired: false,
            kind: 'camera',
            segmentKey: `transition-${ai}`,
            camera: { type: 'flyover', at_ms: 0, from, to, duration_ms: tr.duration_ms },
          })
        }
        t += tr.duration_ms
      }
    })
    push(this.script.outro, -1)
    this.segments = segs
    this.total = Math.max(t, this.script.total_ms)

    // flatten cues with absolute times
    const cues: Cue[] = [...transitionCues]
    for (const seg of segs) {
      const focus = seg.propertyId
        ? this.properties.get(seg.propertyId)?.coords
        : undefined
      for (const cam of seg.beat.camera) {
        cues.push({
          absTime: seg.start_ms + cam.at_ms,
          fired: false,
          kind: 'camera',
          segmentKey: seg.key,
          camera: cam,
          focusCoord: focus,
        })
      }
      for (const ov of seg.beat.overlays) {
        cues.push({
          absTime: seg.start_ms + ov.at_ms,
          fired: false,
          kind: 'overlay',
          segmentKey: seg.key,
          overlay: ov,
          focusCoord: focus,
        })
      }
    }
    cues.sort((a, b) => a.absTime - b.absTime)
    this.cues = cues
  }

  // ---- public controls ----
  start() {
    if (this.started) return
    this.started = true
    this.masterStart = performance.now()
    this.elapsed = 0
    this.setState('reveal')
    this.loop()
  }

  play() {
    if (this.state === 'ended') return this.replay()
    if (this.state === 'paused' || this.state === 'asking') {
      this.masterStart = performance.now() - this.elapsed
      this.map.drift(false)
      this.audio.resume()
      this.setState(this.computeState(this.elapsed))
      this.loop()
    } else if (!this.started) {
      this.start()
    }
  }

  pause() {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    this.audio.pause()
    this.map.drift(true)
    this.setState('paused')
    this.emit()
  }

  /** Enter Live Q&A mode (§4.6). Same as pause but flagged 'asking'. */
  enterAsking() {
    this.pause()
    this.setState('asking')
    this.emit()
  }

  toggleMute() {
    this.muted = !this.muted
    this.audio.setMuted(this.muted)
    this.emit()
  }

  seekToSegment(index: number) {
    const seg = this.segments[index]
    if (!seg) return
    this.seekTo(seg.start_ms)
  }

  seekTo(targetMs: number) {
    const clamped = Math.max(0, Math.min(targetMs, this.total - 1))
    this.elapsed = clamped
    this.masterStart = performance.now() - clamped
    // reset cue fired flags relative to new position
    for (const c of this.cues) c.fired = c.absTime < clamped
    // wipe overlays + map overlays, jump camera to the active segment start
    this.activeOverlays = []
    this.map.clearOverlays()
    this.curSegmentKey = ''
    const seg = this.segmentAt(clamped)
    if (seg) this.snapCameraToSegment(seg)
    this.map.drift(false)
    this.audio.resume()
    if (!this.raf) {
      this.setState(this.computeState(clamped))
      this.loop()
    }
    this.emit()
  }

  replay() {
    this.seekTo(0)
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = null
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

  // ---- internals ----
  private snapCameraToSegment(seg: Segment) {
    // jump to the first keyframe of the segment for an instant seek
    const firstKf = seg.beat.camera.find((c) => !('type' in c)) as
      | CameraKeyframe
      | undefined
    if (firstKf) {
      this.map.jumpTo({
        center: firstKf.center,
        zoom: firstKf.zoom,
        pitch: firstKf.pitch,
        bearing: firstKf.bearing,
      })
    } else if (seg.propertyId) {
      const c = this.properties.get(seg.propertyId)?.coords
      if (c) this.map.jumpTo({ center: c, zoom: 15, pitch: 55 })
    }
  }

  private loop = () => {
    const now = performance.now()
    this.elapsed = now - this.masterStart

    if (this.elapsed >= this.total) {
      this.elapsed = this.total
      this.finishToEnded()
      return
    }

    const seg = this.segmentAt(this.elapsed)
    if (seg && seg.key !== this.curSegmentKey) {
      this.onEnterSegment(seg)
    }

    // fire due cues
    for (const c of this.cues) {
      if (!c.fired && c.absTime <= this.elapsed) {
        c.fired = true
        this.dispatchCue(c)
      }
    }

    // expire React overlays
    this.expireOverlays(this.elapsed)

    // keep state in sync (reveal→playing→outro)
    const want = this.computeState(this.elapsed)
    if (
      want !== this.state &&
      this.state !== 'paused' &&
      this.state !== 'asking'
    ) {
      this.setState(want)
    }

    this.maybeEmit()
    this.raf = requestAnimationFrame(this.loop)
  }

  private onEnterSegment(seg: Segment) {
    this.curSegmentKey = seg.key
    // clear previous beat's on-map overlays (distance lines/spokes/score chips)
    this.map.clearOverlays()
    // drop non-sticky React overlays from the previous segment
    this.activeOverlays = this.activeOverlays.filter((o) =>
      STICKY_OVERLAYS.has(o.overlay.type)
    )
    // Drive the host map's REAL features for this beat (§ 地图功能 AI 也用):
    //  • amenity_spokes → real radial (nearest POIs + score), if prefetched
    //  • else distance_line → real measure tool (hub→spokes, km labels)
    //  • transit layer (metro/tram) on for "life" beats, off otherwise
    if (this.sink) {
      const hub = seg.propertyId ? this.properties.get(seg.propertyId)?.coords : undefined
      const hasAmenity = seg.beat.overlays.some((o) => o.type === 'amenity_spokes')
      const realAmenity = seg.propertyId ? this.amenityById?.get(seg.propertyId) : undefined
      const lines = seg.beat.overlays.filter((o) => o.type === 'distance_line') as Extract<
        Overlay,
        { type: 'distance_line' }
      >[]

      const snap = seg.propertyId ? this.properties.get(seg.propertyId) : undefined
      if (hasAmenity && realAmenity) {
        // real radial covers the distances — use it, clear the measure tool
        this.sink.amenities(realAmenity)
        this.sink.measure(null)
      } else {
        // fallback: draw the measure tool from script distance_lines, or (when the
        // beat only has amenity_spokes but the radial isn't ready) the property's
        // real snapshot distances — so evidence always backs the narration.
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
      // reveal the area-value heatmap while talking numbers/ROI, hide otherwise
      this.sink.areaMetric(seg.beat.kind === 'numbers' ? 'medianUnitPrice' : null)
    }
    // pulse a focus ring on the current property's pin (clears on intro/outro)
    const focusCoord = seg.propertyId ? this.properties.get(seg.propertyId)?.coords : undefined
    this.map.pulseAt(focusCoord ?? null)
    // play this beat's narration
    this.audio.play(seg.beat.narration, seg.beat.audio_url)
  }

  private dispatchCue(c: Cue) {
    if (c.kind === 'camera' && c.camera) {
      void this.map.executeCamera(c.camera, c.focusCoord)
      return
    }
    if (c.kind === 'overlay' && c.overlay) {
      const ov = c.overlay
      if (MAP_OVERLAYS.has(ov.type)) {
        this.dispatchMapOverlay(ov, c.focusCoord)
      } else {
        this.addReactOverlay(c)
      }
    }
  }

  private dispatchMapOverlay(ov: Overlay, focus?: LngLat) {
    if (ov.type === 'distance_line') {
      // When a sink is present the real measure tool already drew all spokes at
      // beat start (see onEnterSegment); skip the custom lt- line to avoid double.
      if (this.sink) return
      const from =
        (ov.property_id && this.properties.get(ov.property_id)?.coords) ||
        focus
      if (from) this.map.drawDistanceLine({ from, to: ov.to, label: ov.label })
    } else if (ov.type === 'amenity_spokes') {
      // sink present → real radial drawn at beat start (onEnterSegment); skip custom
      if (this.sink) return
      this.map.showAmenitySpokes({
        center: ov.center,
        spokes: ov.spokes ?? [],
        score: ov.score,
        tier: ov.tier,
      })
    } else if (ov.type === 'highlight_all_pins') {
      this.map.highlightPins(ov.property_ids)
    }
  }

  private addReactOverlay(c: Cue) {
    const ov = c.overlay!
    const key = `${c.segmentKey}:${ov.type}:${c.absTime}`
    // replace any same-key overlay
    this.activeOverlays = this.activeOverlays.filter((o) => o.key !== key)
    this.activeOverlays.push({ key, overlay: ov })
  }

  private expireOverlays(elapsed: number) {
    const next = this.activeOverlays.filter((o) => {
      if (STICKY_OVERLAYS.has(o.overlay.type)) return true
      const seg = this.segments.find((s) => o.key.startsWith(s.key + ':'))
      const at = seg ? seg.start_ms + o.overlay.at_ms : 0
      const dur = o.overlay.duration_ms ?? 0
      if (dur <= 0) {
        // persist to end of its segment
        const segEnd = seg ? seg.start_ms + seg.beat.duration_ms : elapsed
        return elapsed < segEnd
      }
      return elapsed < at + dur
    })
    if (next.length !== this.activeOverlays.length) this.activeOverlays = next
  }

  private finishToEnded() {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    // keep outro sticky overlays (cta / favorite_picker) on screen
    this.activeOverlays = this.activeOverlays.filter(
      (o) => o.overlay.type === 'cta' || o.overlay.type === 'favorite_picker'
    )
    this.setState('ended')
    this.emit()
  }

  private segmentAt(ms: number): Segment | undefined {
    let found: Segment | undefined
    for (const s of this.segments) {
      if (ms >= s.start_ms) found = s
      else break
    }
    return found
  }

  private computeState(ms: number): EngineState {
    const seg = this.segmentAt(ms)
    if (!seg) return 'reveal'
    if (seg.key === segKey(this.script.intro, -1)) return 'reveal'
    if (seg.key === segKey(this.script.outro, -1)) return 'outro'
    return 'playing'
  }

  private setState(s: EngineState) {
    this.state = s
  }

  // Throttle React pushes: emit immediately when state/segment/overlays/mute
  // change, otherwise at most ~12fps. This keeps the heavy React re-render off
  // the map's per-frame camera animation (which has its own rAF) so flyTo stays
  // buttery instead of stuttering.
  private lastSig = ''
  private lastEmitAt = 0
  private maybeEmit() {
    const sig = `${this.state}|${this.curSegmentKey}|${this.muted}|${this.activeOverlays
      .map((o) => o.key)
      .join(',')}`
    const now = performance.now()
    if (sig !== this.lastSig || now - this.lastEmitAt >= 80) {
      this.lastSig = sig
      this.lastEmitAt = now
      this.emit()
    }
  }

  private emit() {
    const seg = this.segmentAt(this.elapsed)
    this.onUpdate({
      state: this.state,
      elapsed_ms: this.elapsed,
      total_ms: this.total,
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
