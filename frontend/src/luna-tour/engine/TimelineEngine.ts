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
/**
 * ⚠️ 这里曾经有 `ROTATE_DEG_PER_MS = 0.003`(3°/秒)—— 引擎**每一帧覆盖掉剧本的 bearing**,
 *    整场 tour 匀速自转,永不停。我在剧本层锁死 bearing、删光 orbit,全被那一行盖掉,
 *    所以 owner 一直说「乱飘」「到了目的点还在旋转」,而我一直以为自己修好了。
 *
 *    **bearing 现在只有一个来源:剧本。** 别再往这里加「一点点转动」。
 */
/** Safety backstop FLOOR: pre-metadata / no-audio cap for one beat (ms). */
const MAX_BEAT_MS = 60000
/** Once real audio length is known, backstop = clipLen + this pad, floored at
 * MAX_BEAT_MS. Guarantees the backstop can NEVER fire before a line finishes. */
const AUDIO_BACKSTOP_PAD_MS = 5000

/**
 * 🔴 单帧位移上限（屏幕像素）—— 「疯狂颤抖」的最后一道闸。
 *
 * 相机是**按时间采样**的：`camera = f(clock)`。所以只要有一帧迟到（手机上瓦片解码、
 * GC、合成器一忙就迟到 300~1000ms），下一帧就会把这段时间的位移**一次性补完** ——
 * 实测单帧跳 230px。运镜本身是丝滑的，眼睛看到的却是一记猛拽。**掉一帧 = 一次猛拽**，
 * 连着掉就是「疯狂颤抖」。
 *
 * 所以画面**永远不许一帧跨过这么多像素**：迟到就慢慢追（每帧最多这么多），
 * 追平之前画面只是稍微落后于时钟 —— 而落后是看不出来的，猛拽是看得出来的。
 *
 * 正常运镜有多快？实测 60fps 下 p95 只有 7px/帧，12fps 下约 35px/帧。
 * 45px 高于任何正常运镜，只会削掉病态的那一跳。
 */
const MAX_STEP_PX = 45
/** 落后超过这么多屏宽 → 不是掉帧，是真的换机位（跳拍/换幕）→ 直接切过去。 */
const SNAP_IF_BEHIND_SCREENS = 3

/**
 * ⚠️ 这里试过一版「**自适应匀速节拍**」(EMA 测帧耗时 → 主动降到 45/30/20fps 匀速下发),
 *    理由是「均匀的 20fps 比忽快忽慢的 8~30fps 好看」。**实测不成立,已删。**
 *
 *    cpu×6 下:移动频率从 58.8Hz 掉到 30.3Hz,而不均匀度只从 2.41 到 2.24 ——
 *    **把运动频率砍掉一半,几乎没换到均匀。** 因为长帧不是「我们要得太勤」造成的,
 *    是卫星瓦片解码/上纹理这类**外部工作**,少要几次重绘并不会让它变快。
 *
 *    结论:相机就该每一个 rAF 都下发。要更顺只能继续砍每帧成本,不能靠降频装顺。
 */

/**
 * 地图图钉的品类样式。**颜色必须和左上那张聚光灯卡同源**（OverlayLayer 的 POI_STYLE）——
 * 卡片是红的、图上的点是灰的，客户就得自己在两者之间连线。
 * `fallback`:名字过不了地名防线时（阿语专名不给中文客户看）图钉只写品类。
 */
const POI_MARKER: Record<string, { emoji: string; color: string; fallback: string }> = {
  hospital: { emoji: '🏥', color: '#dc2626', fallback: 'Hospital' },
  school: { emoji: '🏫', color: '#ea580c', fallback: 'School' },
  metro_station: { emoji: '🚇', color: '#2563eb', fallback: 'Metro' },
  mall: { emoji: '🛍️', color: '#9333ea', fallback: 'Mall' },
  supermarket: { emoji: '🛒', color: '#059669', fallback: 'Supermarket' },
}

const STICKY_OVERLAYS = new Set(['progress_dots', 'cta', 'favorite_picker'])

/**
 * 剧本没写 `duration_ms` 时的默认停留时长。
 *
 * 🔴 `title` 必须有默认值。没有 duration 的 overlay 会**留到这一拍结束**,而开场那一拍
 * 长达旁白全长(demo 里 20 秒)—— 于是那张大标题卡在三个项目 pin 上面挂了 20 秒,
 * 客户想看的东西全被它压着(owner:「要集中中间屏幕能看到重要信息」)。
 * 标题是**片头字幕**,不是水印:亮几秒,然后把画面交回给房子。
 */
const DEFAULT_OVERLAY_MS: Record<string, number> = { title: 5500 }
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
  /**
   * Time-warp target: the camera track is stretched so its motion spans exactly the
   * narration (audio) length. 0 until the real audio duration is known (= no warp).
   * ⚠️ 只有**停留**被拉长，赶路按剧本秒数走 —— 见 cameraTrack.ts 的 `rigid`。
   */
  private camTargetMs = 0
  /** 上一帧真正交给地图的机位（单帧位移限幅用；null = 下一帧直接切过去） */
  private camShown: CameraState | null = null
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
        // the one clock (no frozen camera, no desync). camTargetMs is recomputed
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
            if (this.camTrack && this.camTrack.duration > 0) this.camTargetMs = durationMs
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
    if (this.camTrack?.initial) this.cutTo(this.camTrack.initial)
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
    this.camShown = null // 跳拍是真的「切」,不要被单帧限幅拖成一段平移
    void this.playFrom(i, true)
  }

  replay() {
    this.paused = false
    this.camEntry = null
    this.camShown = null
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
    this.map.setPoiMarker(null)
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

      /**
       * 🔴 接管相机之前,先问地图「你现在在哪」。
       *
       * camEntry 是 null 时(开场、或跳拍之后),cameraTrack 以前会回落到一个
       * **写死的迪拜市中心** —— 于是每场 tour 都从 20km 外平移过来。
       * 欢迎页明明已经把相机停在正确机位上了。
       *
       * 执行层不该**猜**位置,它该**读**位置。
       */
      if (!this.camEntry) this.camEntry = this.map.getCamera?.() ?? null

      // compile the camera track for this beat (single clock samples it)
      // 第三个参数:这一拍大概多长 —— 氛围环绕据此换算成角速度(固定角度在长拍上会慢到看不见)
      this.camTrack = compileCameraTrack(cameraCues, this.camEntry, seg.beat.duration_ms)
      this.camTargetMs = 0 // no time-warp until the audio length is known (onMeta below)
      // snap to its initial state instantly so the first frame is correct — but
      // keep the carried bearing (don't reset rotation at a beat boundary).
      if (this.camTrack.initial) this.cutTo(this.camTrack.initial)

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
          // motion spans exactly the narration (no early stop, no overrun) —
          // stretching only the DWELL, never the travel (cameraTrack `rigid`).
          this.armBackstop(Math.max(MAX_BEAT_MS, durationMs + AUDIO_BACKSTOP_PAD_MS))
          if (this.camTrack && this.camTrack.duration > 0) this.camTargetMs = durationMs
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
      // 1) camera — sample the (time-warped) track. bearing 来自剧本,引擎不加戏。
      //    唯一的保护:单帧位移限幅(见 MAX_STEP_PX)。
      if (this.camTrack) {
        const cs = this.camTrack.sampleAt(this.camTrack.remap(this.beatElapsed, this.camTargetMs))
        if (cs) this.applyCamera(cs)
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
      if (this.camTrack && this.beatElapsed >= this.camTrack.wallDuration(this.camTargetMs)) {
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

  /**
   * 把采样出来的机位交给地图 —— 但**一帧最多走 MAX_STEP_PX 个屏幕像素**。
   *
   * 相机是时间的函数，所以一帧迟到 500ms，下一帧就会想一次性补完 500ms 的位移
   * （实测 230px 的猛拽）。这里把那一跳摊到接下来几帧上：画面短暂落后于时钟，
   * 但**永远是连续的**。落后看不出来，猛拽看得出来。
   *
   * 真·换机位（跳拍、换幕、暂停后重开）走 `cutTo()` —— 那时候就该是「切」。
   */
  private applyCamera(target: CameraState) {
    const prev = this.camShown
    if (!prev) return this.cutTo(target)
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
    const dist = screenDistPx(prev, target, vw)
    if (dist > vw * SNAP_IF_BEHIND_SCREENS) return this.cutTo(target) // 不是掉帧,是换机位
    if (dist <= MAX_STEP_PX) return this.cutTo(target)
    const f = MAX_STEP_PX / dist
    this.cutTo({
      center: [prev.center[0] + (target.center[0] - prev.center[0]) * f,
               prev.center[1] + (target.center[1] - prev.center[1]) * f],
      zoom: prev.zoom + (target.zoom - prev.zoom) * f,
      pitch: prev.pitch + (target.pitch - prev.pitch) * f,
      bearing: prev.bearing + (target.bearing - prev.bearing) * f,
    })
  }

  /** 直接切到这个机位（并把限幅器的参考点对齐到它）。 */
  private cutTo(s: CameraState) {
    this.camShown = s
    this.map.jumpTo(s)
  }

  private stopClock() {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  private checkBeatDone() {
    if (this.paused || !this.resolveBeat) return // never advance a beat while paused
    const cameraDone = !this.camTrack || this.beatElapsed >= this.camTrack.wallDuration(this.camTargetMs)
    if (this.narrationDone && this.minTimeDone && cameraDone) {
      // chain the next beat's camera entry from where this one ended
      if (this.camTrack) this.camEntry = finalState(this.camTrack) ?? this.camEntry
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
    /**
     * 🔴 配套聚光灯拍 —— **只画那一条线**。
     *
     * 这是「一个一个介绍」的地图侧:一次一个目的地,线有身份(卡片写着「医院」),
     * 而不是从项目射出五条谁也认不出的射线。坐标从 snapshot 按 cat 查真值 ——
     * overlay 里没有坐标可抄。
     */
    const spot = seg.beat.overlays.find((o) => o.type === 'poi_spotlight') as
      | Extract<Overlay, { type: 'poi_spotlight' }>
      | undefined
    if (spot) {
      const d = snap?.distances?.find((x) => x.cat === spot.cat)
      this.sink.amenities(null)
      if (d && hub) this.sink.measure([hub, d.to])
      else this.sink.measure(null)
      this.sink.transit(spot.cat === 'metro_station')
      this.sink.areaMetric(null)
      /**
       * 在地图上**真的标出那个地点**(owner 要的)。之前线的那一头只有测距工具的一个
       * 小圆点 —— 客户看到一条线指向一个无名的点,不知道那是医院还是学校。
       */
      if (d) {
        const s = POI_MARKER[spot.cat]
        this.map.setPoiMarker({ coord: d.to, emoji: s.emoji, label: d.name || s.fallback, color: s.color })
      } else {
        this.map.setPoiMarker(null)
      }
      return
    }
    // 不是配套拍 → 收起图钉(它是「正在讲的那个地方」,讲完就不该留在图上)
    this.map.setPoiMarker(null)
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
      const dur = o.overlay.duration_ms ?? DEFAULT_OVERLAY_MS[o.overlay.type] ?? 0
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

/**
 * 两个机位之间画面大约移动多少像素 —— 平移 + 旋转（画面边缘的位移最大）+ 缩放。
 * 只用来判断「这一步是不是跨得太远」，所以要的是量级，不是投影精度。
 */
function screenDistPx(a: CameraState, b: CameraState, vw: number): number {
  const pxPerDeg = (256 * Math.pow(2, a.zoom)) / 360
  const cos = Math.max(0.1, Math.cos((a.center[1] * Math.PI) / 180))
  const pan = Math.hypot((b.center[0] - a.center[0]) * pxPerDeg, ((b.center[1] - a.center[1]) * pxPerDeg) / cos)
  const rot = (Math.abs(b.bearing - a.bearing) * Math.PI * (vw / 2)) / 180
  const zoom = Math.abs(b.zoom - a.zoom) * (vw / 2) * Math.LN2
  const tilt = (Math.abs(b.pitch - a.pitch) * Math.PI * (vw / 2)) / 180
  return pan + rot + zoom + tilt
}
