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
import { compileCameraTrack, finalState, type CameraTrack, type CameraState } from './cameraTrack'

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
  /** current beat's narration text (for the optional subtitle track) */
  narration: string
  /** raw current beat id (for agent edit-mode comments, matches the script) */
  beatId: string
  /** ms elapsed within the current beat (for time-anchored comments) */
  atMs: number
}

/** Min visual dwell so a near-silent beat doesn't flash by (ms). */
const MIN_BEAT_MS = 1500
/** Gentle, CONSISTENT cinematic rotation. The engine drives bearing itself at
 *  this fixed rate (real time, NOT time-warped) and carries it across beats, so
 *  every property rotates at the same calm speed regardless of audio length or
 *  the AI's authored orbit `degrees` (which ranged 24°–180° → dizzy + uneven),
 *  and the bearing NEVER snaps between beats (fixes the "blink/jump" on the
 *  numbers beat). Authored camera still controls center/zoom/pitch. */
/**
 * 🔴 0 —— **不要强制旋转。**
 *
 * 原值 0.003（3°/秒）会**每一帧覆盖掉剧本里的 bearing**,整场 tour 匀速自转,永不停。
 * 我在剧本层锁死 bearing、删掉所有 orbit —— 全被这一行盖掉了,所以 owner 一直在说
 *「乱飘」「到了目的点还在旋转」,而我一直以为自己修好了。
 *
 * 保留常量（而不是删掉整条链路）是因为它同时负责「bearing 不在拍与拍之间跳变」——
 * 现在 bearing 直接来自剧本,而剧本层已经把它锁成常量,所以也不会跳。
 */
const ROTATE_DEG_PER_MS = 0 // 不转。客户到了目的地要读信息,不是继续晕。
/** Safety backstop FLOOR: pre-metadata / no-audio cap for one beat (ms). */
const MAX_BEAT_MS = 60000
/** Once real audio length is known, backstop = clipLen + this pad, floored at
 * MAX_BEAT_MS. Guarantees the backstop can NEVER fire before a line finishes. */
const AUDIO_BACKSTOP_PAD_MS = 5000

const STICKY_OVERLAYS = new Set(['progress_dots', 'cta', 'favorite_picker'])
const MAP_OVERLAYS = new Set(['distance_line', 'amenity_spokes', 'highlight_all_pins'])

/** Overlay cue scheduled within a beat. Camera is NOT a cue anymore — it's the
 *  sampled cameraTrack. */
interface IntraCue {
  at_ms: number
  fired: boolean
  kind: 'overlay'
  overlay: Overlay
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

  // --- current-beat machinery (ALL driven by one clock = beatElapsed) ---
  private raf: number | null = null
  private beatCues: IntraCue[] = []
  private beatElapsed = 0
  private beatClockStart = 0
  // single-clock camera: a pure track the clock samples every frame → jumpTo.
  // No second rAF anywhere. Pause = clock frozen = camera frozen, in lock-step
  // with audio + overlays.
  private camTrack: CameraTrack | null = null
  private camEntry: CameraState | null = null // where the camera is now (chains beats)
  // Time-warp factor: camera track is stretched so its motion runs for exactly
  // the narration (audio) length. 1 until the real audio duration is known.
  private camScale = 1
  // running absolute bearing, advanced at ROTATE_DEG_PER_MS and CARRIED across
  // beats (never reset mid-tour) so rotation is one continuous, even glide.
  private camBearingBase = 0
  // gates
  private narrationDone = false
  private minTimeDone = false
  private resolveBeat: (() => void) | null = null
  // Safety backstop as a beatElapsed THRESHOLD (not a wall-clock timer): it's
  // checked inside the rAF tick, so it freezes with the clock on pause and can
  // never advance a beat while paused / while the customer talks to Luna.
  private backstopMs = MAX_BEAT_MS

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
    // an act's anchor coords = its property's coords, OR a place stop's coords.
    const actCoords = (act: TourScript['acts'][number]): LngLat | undefined =>
      (act.property_id && this.properties.get(act.property_id)?.coords) || act.place?.coords
    const add = (
      beat: Segment['beat'],
      actIndex: number,
      propertyId: string | undefined,
      focusCoords: LngLat | undefined,
      preCam?: Camera
    ) => {
      segs.push({ key: segKey(beat, actIndex), beat, start_ms: 0, actIndex, propertyId, focusCoords })
      pre.push(preCam)
    }
    add(this.script.intro, -1, undefined, undefined)
    this.script.acts.forEach((act, ai) => {
      const coords = actCoords(act)
      act.beats.forEach((b, bi) => {
        let preCam: Camera | undefined
        if (bi === 0 && ai > 0) {
          const from = actCoords(this.script.acts[ai - 1])
          const to = coords
          if (from && to) {
            const prevAct = this.script.acts[ai - 1]
            preCam = { type: 'flyover', at_ms: 0, from, to, duration_ms: prevAct.transition_out?.duration_ms ?? 2500 }
          }
        }
        add(b, ai, act.property_id, coords, preCam)
      })
    })
    add(this.script.outro, -1, undefined, undefined)
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
      this.setState(this.computeState(this.curIndex))
      const seg = this.segments[this.curIndex]
      if (this.audio.resumePlayback()) {
        // mp3/wav resumed EXACTLY where it paused → continue the SAME clock from
        // the frozen elapsed; camera, overlays and audio stay in perfect
        // lock-step. The line finishes naturally and the camera keeps moving.
        this.beatClockStart = performance.now() - this.beatElapsed
      } else if (seg && !this.narrationDone) {
        // TTS (or a cancelled clip) can't resume mid-utterance → restart THIS
        // beat from 0 so re-spoken narration + camera + overlays run together on
        // the one clock (no frozen camera, no desync). camScale is recomputed
        // when the real clip length re-loads.
        this.restartBeatClock(seg)
        this.audio.play(
          seg.beat.narration,
          seg.beat.audio_url,
          () => {
            this.narrationDone = true
            this.checkBeatDone()
          },
          (durationMs) => {
            this.armBackstop(Math.max(MAX_BEAT_MS, durationMs + AUDIO_BACKSTOP_PAD_MS))
            if (this.camTrack && this.camTrack.duration > 0) {
              this.camScale = Math.max(0.05, durationMs / this.camTrack.duration)
            }
          }
        )
      } else {
        // narration already finished (silent / muted / clip ended) → just keep
        // the clock running so the camera completes its move.
        this.beatClockStart = performance.now() - this.beatElapsed
      }
      this.startClock()
      this.emit()
    } else if (!this.started) {
      this.start()
    }
  }

  pause() {
    if (this.state === 'ended' || this.paused) return // idempotent
    this.paused = true
    // Freeze the ONE clock → camera stops sampling, overlays freeze, the backstop
    // threshold freezes — all together. checkBeatDone() also refuses to advance
    // while paused, so the beat is preserved no matter how long the pause lasts
    // (e.g. a full Live Q&A conversation).
    this.stopClock()
    this.beatElapsed = performance.now() - this.beatClockStart
    // Pause audio in place when it's a resumable clip (mp3/wav); cancel TTS.
    this.audio.pausePlayback()
    this.setState('paused')
    this.emit()
  }

  /** Restart the current beat's clock from 0 (TTS narration must be re-spoken on
   *  resume): re-snap the camera to its start, un-fire cues, drop this beat's
   *  transient overlays — so narration + camera + overlays run together again. */
  private restartBeatClock(seg: Segment) {
    this.beatElapsed = 0
    this.beatClockStart = performance.now()
    this.minTimeDone = false
    for (const c of this.beatCues) c.fired = false
    this.activeOverlays = this.activeOverlays.filter(
      (o) => STICKY_OVERLAYS.has(o.overlay.type) || !o.key.startsWith(seg.key + ':')
    )
    if (this.camTrack?.initial) this.map.jumpTo(this.camTrack.initial)
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
    this.camEntry = null // re-establish camera from the new beat
    void this.playFrom(i, true)
  }

  replay() {
    this.paused = false
    this.camEntry = null
    this.camBearingBase = 0
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

      // Compose this beat's camera = optional inter-act flyover (prepended) + the
      // beat's own cues, all on ONE track sampled by the beat clock. No separate
      // awaited camera animation → nothing can run while the clock is paused.
      const pre = this.preCamera[i]
      const cues: Camera[] = []
      if (pre && !(skipFirstPreCamera && i === startIndex)) cues.push(pre)
      cues.push(...seg.beat.camera)

      await this.playBeat(seg, cues)
      if (this.disposed) return
    }
    this.finishToEnded()
  }

  /** Resolves only when narration done AND camera track done AND min-time. */
  private playBeat(seg: Segment, cameraCues: Camera[]): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resolveBeat = resolve

      // enter-segment side effects on the host map
      this.map.clearOverlays()
      this.activeOverlays = this.activeOverlays.filter((o) => STICKY_OVERLAYS.has(o.overlay.type))
      this.applyBeatFeatures(seg)
      this.map.pulseAt(this.focusOf(seg) ?? null)

      // compile the camera track for this beat (single clock samples it)
      this.camTrack = compileCameraTrack(cameraCues, this.camEntry)
      this.camScale = 1 // until audio length is known (set in onMeta below)
      // snap to its initial state instantly so the first frame is correct — but
      // keep the carried bearing (don't reset rotation at a beat boundary).
      if (this.camTrack.initial) this.map.jumpTo({ ...this.camTrack.initial, bearing: this.camBearingBase })

      // gates
      this.narrationDone = false
      this.minTimeDone = false

      // overlay cues only (camera is now the track, not cues)
      this.beatCues = seg.beat.overlays
        .map((ov) => ({ at_ms: ov.at_ms, fired: false, kind: 'overlay' as const, overlay: ov }))
        .sort((a, b) => a.at_ms - b.at_ms)

      // narration (event-driven; muted/empty resolves immediately). The beat
      // ONLY advances once this fires (audio `ended`) — never on a guessed time.
      // When the real clip length loads, EXTEND the backstop past it so the
      // safety net can never cut a sentence; it only ever bounds a stall.
      this.audio.play(
        seg.beat.narration,
        seg.beat.audio_url,
        () => {
          this.narrationDone = true
          this.checkBeatDone()
        },
        (durationMs) => {
          // Real narration length known → (1) extend the safety backstop past it
          // so it can never cut a line, and (2) time-warp the camera so its
          // motion spans exactly the narration (no early stop, no overrun).
          this.armBackstop(Math.max(MAX_BEAT_MS, durationMs + AUDIO_BACKSTOP_PAD_MS))
          if (this.camTrack && this.camTrack.duration > 0) {
            this.camScale = Math.max(0.05, durationMs / this.camTrack.duration)
          }
        }
      )

      // start the single pausable clock
      this.beatElapsed = 0
      this.beatClockStart = performance.now()
      this.startClock()

      // safety backstop (pre-metadata floor; extended once clip length is known)
      this.armBackstop(MAX_BEAT_MS)
    })
  }

  /** (Re)arm the single safety backstop (a beatElapsed threshold) for this beat. */
  private armBackstop(ms: number) {
    this.backstopMs = ms
  }

  private startClock() {
    this.stopClock()
    const seg = this.segments[this.curIndex]
    if (!seg) return
    const tick = () => {
      if (this.disposed || this.paused) return
      this.beatElapsed = performance.now() - this.beatClockStart
      // 1) camera — sample the (time-warped) track for center/zoom/pitch, but
      //    drive BEARING ourselves at a constant gentle rate (carried across
      //    beats) so rotation is even and never snaps.
      if (this.camTrack) {
        const cs = this.camTrack.sampleAt(this.beatElapsed / this.camScale)
        if (cs) {
          cs.bearing = this.camBearingBase + ROTATE_DEG_PER_MS * this.beatElapsed
          this.map.jumpTo(cs)
        }
      }
      // 2) overlay cues at their at_ms
      for (const c of this.beatCues) {
        if (!c.fired && c.at_ms <= this.beatElapsed) {
          c.fired = true
          this.dispatchCue(c, seg)
        }
      }
      this.expireOverlays(this.beatElapsed, seg)
      // 3) gates: min-time + camera-track finished (its full duration elapsed)
      if (!this.minTimeDone && this.beatElapsed >= MIN_BEAT_MS) {
        this.minTimeDone = true
        this.checkBeatDone()
      }
      if (this.camTrack && this.beatElapsed >= this.camTrack.duration * this.camScale) {
        // camera track exhausted — contributes to "beat done" via checkBeatDone
        this.checkBeatDone()
      }
      // 4) safety backstop — same clock, so it can't fire while paused. Bounds a
      //    stall (audio never reports `ended`); never cuts a finished line.
      if (this.beatElapsed >= this.backstopMs) {
        this.narrationDone = true
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
    if (this.paused || !this.resolveBeat) return // never advance a beat while paused
    const cameraDone = !this.camTrack || this.beatElapsed >= this.camTrack.duration * this.camScale
    if (this.narrationDone && this.minTimeDone && cameraDone) {
      // chain the next beat's camera entry from where this one ended
      if (this.camTrack) this.camEntry = finalState(this.camTrack) ?? this.camEntry
      // carry the bearing forward so the next beat continues the same glide
      this.camBearingBase = this.camBearingBase + ROTATE_DEG_PER_MS * this.beatElapsed
      const r = this.resolveBeat
      this.abortBeat(true)
      r()
    }
  }

  /** Cancel current-beat machinery without resolving (or after resolving). */
  private abortBeat(resolved = false) {
    this.stopClock()
    this.backstopMs = MAX_BEAT_MS
    if (!resolved) this.audio.stop()
    this.resolveBeat = null
  }

  // ---- overlay cue dispatch (camera is the sampled track, not a cue) ----
  private dispatchCue(c: IntraCue, seg: Segment) {
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
    return seg.focusCoords ?? (seg.propertyId ? this.properties.get(seg.propertyId)?.coords : undefined)
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
      narration: seg?.beat.narration ?? '',
      beatId: seg?.beat.id ?? '',
      atMs: Math.round(this.beatElapsed),
    })
  }
}

function segKey(beat: { id: string }, actIndex: number): string {
  return actIndex < 0 ? beat.id : `a${actIndex}-${beat.id}`
}
