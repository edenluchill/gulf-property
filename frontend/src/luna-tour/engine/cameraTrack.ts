/**
 * Luna Tour — camera track (single-clock, pure, samplable).
 *
 * Each beat's camera cues compile into a pure track you can sample at any ms —
 * `sampleAt(t)` → {center, zoom, pitch, bearing}. The engine's single clock
 * samples it every frame and calls map.jumpTo(). Pause = clock frozen = camera
 * frozen, in lock-step with audio + overlays. No second timeline anywhere.
 *
 * DESIGN (rewritten 2026-06-02 to fix "镜头不连贯"):
 *  - SEQUENTIAL & gap-free: cues play back-to-back (authored `at_ms` is ignored
 *    for layout). This kills two bugs: (a) gaps where the camera froze between a
 *    cue's end and the next cue's start, and (b) two cues sharing at_ms=0 (e.g. a
 *    transition flyover + an in-place flyover) where one shadowed the other and
 *    the fly-to "teleported".
 *  - ALWAYS MOVING: a plain keyframe (a static shot) is turned into a gentle
 *    continuous orbit so the camera is never frozen while narration plays.
 *  - NO-OP flyovers (target ≈ where we already are) are dropped.
 *  - The ENGINE time-warps this track to the real narration (audio) length, so
 *    camera motion runs for exactly as long as the voice is speaking.
 *
 * Pure module: no React, no rAF, no map. Trivially testable.
 */
import type { Camera, LngLat } from '../types'

export interface CameraState {
  center: LngLat
  zoom: number
  pitch: number
  bearing: number
}

const EASE = (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t) // easeInOut

/**
 * ⚠️ 这里曾经有 `AMBIENT_ORBIT_DEG = 24` —— **每个静止关键帧都被偷偷加上 24° 旋转**
 *    (注释理直气壮地写着「让静止镜头不至于冻住」)。但客户到了目的地要的是**读信息**,
 *    不是继续晕。已删除。**静止就是静止。**
 */
/** A flyover whose target is within ~this (deg ≈ 80m) of us is a no-op → drop. */
const NOOP_MOVE_EPS = 0.0008
/** Floor so a 0-duration cue still occupies a sliver of the track. */
const MIN_CUE_MS = 800
/** Don't let the camera pull wider than this — AI sometimes authors zoom 9 wide
 *  establishing shots that, compressed into a short narration, read as a dizzying
 *  zoom-out-then-in. Keep the framing tight + steady. */
const MIN_TOUR_ZOOM = 10.8

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
}

/** A resolved keyframe with absolute-in-beat start/end and full target state. */
interface Segment {
  start: number
  end: number
  from: CameraState
  to: CameraState
  /** orbit adds continuous bearing rotation across the segment */
  orbitDegrees?: number
  /** flyover travels with a pull-back arc (zoom out mid-flight, then in) */
  arc?: boolean
  /** lowest zoom reached at mid-flight for an arc */
  midZoom?: number
}

/**
 * 恰好能把跨度 spanDeg 一起框进画面的 zoom。
 *
 * MapLibre: zoom z 时，视口横跨的经度 ≈ 360 / 2^z × (视口宽 / 512)。
 * 反解出 z，并留 1.5 倍余量（两点不贴边）。这是**几何**，不是拍脑袋的常量。
 */
function zoomToFitSpan(spanDeg: number): number {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1000
  const need = Math.max(1e-5, spanDeg * 1.5)
  return Math.log2((360 * (w / 512)) / need)
}
/** 抛高不足这么多级就不值得抛 —— 两点本来就在一个画面里，平飞就好。 */
const MIN_ARC_PULL = 0.8
/** 抛高的硬上限。再高客户就只看见沙漠了，而那几秒画面里没有任何信息。 */
const MAX_ARC_PULL = 2.2

const ARRIVAL_ZOOM = 15
/** Cap the cinematic tilt. A steep pitch (55°+) makes the camera see toward the
 *  horizon, so a SLOW orbit streams a huge, ever-changing fan of satellite tiles
 *  (incl. low-zoom far-field tiles) — the periodic "still fetching while rotating"
 *  hitch. ~45° keeps a clear 3D feel while cutting the visible footprint (and the
 *  POIs/labels in view) a lot. Applies to authored pitch too. */
const MAX_TOUR_PITCH = 48
const ARRIVAL_PITCH = 45

export interface CameraTrack {
  /** total ms this track spans (0 if no camera) */
  readonly duration: number
  /** camera state at ms t within the beat (clamped) */
  sampleAt(t: number): CameraState | null
  /** the state the camera should hold at the very start (for instant seek) */
  readonly initial: CameraState | null
}

/**
 * Compile a beat's camera cues + the entry state into a samplable track.
 * `entry` = where the camera is when the beat begins (prev beat's final state),
 * so keyframes that omit fields inherit smoothly. Cues are laid out SEQUENTIALLY
 * (gap-free); authored at_ms is not used for layout.
 */
export function compileCameraTrack(cues: Camera[], entry: CameraState | null): CameraTrack {
  const fallback: CameraState = { center: [55.27, 25.2], zoom: 11, pitch: 45, bearing: 0 }
  if (!cues.length) {
    return { duration: 0, sampleAt: () => null, initial: entry }
  }

  /**
   * 🔴 相机的起点。
   *
   * 原来是 `entry ?? fallback`,而 fallback 是**写死的迪拜市中心 [55.27, 25.2] z11**。
   * 开场时 entry 是 null（还没有上一拍）→ 于是每场 tour 都从市中心起步,再一路
   * **插值飞到**建立镜头。欢迎页明明已经把相机停在正确机位上了,引擎却假装自己在市中心。
   * **这就是 owner 说的「一开始从一个点平移」。**（实测:开场 3.5 秒横跨 20 公里。）
   *
   * 现在:没有 entry 就**从剧本的第一个关键帧起步**（那本来就是 duration_ms:0 的瞬切,
   * 是「机位」不是「运动」）。真没有关键帧才回落到 fallback。
   */
  const firstKf = cues.find((c) => !('type' in c) && Array.isArray((c as { center?: unknown }).center)) as
    | { center: [number, number]; zoom?: number; pitch?: number; bearing?: number }
    | undefined
  let cur: CameraState =
    entry ??
    (firstKf
      ? {
          center: firstKf.center,
          zoom: Math.max(MIN_TOUR_ZOOM, firstKf.zoom ?? fallback.zoom),
          pitch: Math.min(MAX_TOUR_PITCH, firstKf.pitch ?? fallback.pitch),
          bearing: firstKf.bearing ?? 0,
        }
      : fallback)
  const segs: Segment[] = []
  let t = 0

  for (const cam of cues) {
    /**
     * `duration_ms: 0` 是**瞬切**（剧本用它表示「机位」——建立镜头就是这么写的）。
     * 原来 Math.max(MIN_CUE_MS, …) 把它拉成了 800ms 的动画 —— 一个本该「切」过去的
     * 机位,变成了一段谁也没要的运动。0 就是 0。
     */
    const authored = 'duration_ms' in cam ? cam.duration_ms : undefined
    const dur = authored === 0 ? 0 : Math.max(MIN_CUE_MS, authored || 6000)

    if ('type' in cam && cam.type === 'orbit') {
      const center = cam.center
      const from: CameraState = { ...cur }
      const to: CameraState = { ...cur, center, bearing: cur.bearing + cam.degrees }
      segs.push({ start: t, end: t + dur, from, to, orbitDegrees: cam.degrees })
      cur = to
      t += dur
    } else if ('type' in cam && cam.type === 'flyover') {
      // Distance is vs the RUNNING center, not the authored `from` (which the AI
      // often sets equal to the property).
      const distDeg = Math.hypot(cam.to[0] - cur.center[0], cam.to[1] - cur.center[1])
      const moved = distDeg >= NOOP_MOVE_EPS
      const zoomed = Math.abs(ARRIVAL_ZOOM - cur.zoom) >= 0.3
      // True no-op (already here AND already close) → skip. But keep an in-place
      // flyover that only zooms in (the "arrival" push-in after the camera is
      // already over the property).
      if (!moved && !zoomed) continue
      const to: CameraState = {
        center: cam.to,
        // 剧本给了 zoom/pitch 就用剧本的；没给才用落位默认值。
        // **执行层不该替剧本决定机位** —— 它只该决定「怎么走过去」。
        zoom: 'zoom' in cam && typeof cam.zoom === 'number' ? cam.zoom : ARRIVAL_ZOOM,
        pitch: 'pitch' in cam && typeof cam.pitch === 'number' ? Math.min(MAX_TOUR_PITCH, cam.pitch) : ARRIVAL_PITCH,
        bearing: cur.bearing,
      }
      // Distance-aware duration so a long hop isn't a rushed streak.
      const flyDur = Math.max(dur, Math.min(6000, 2600 + distDeg * 22000))

      /**
       * 🔴 抛高**只为一件事**：让客户在飞行途中同时看见「从哪来、到哪去」。
       *
       * 所以抛多高不是拍脑袋定的常量，而是**几何算出来的**：
       * 恰好能把起点和终点一起框进画面的那个 zoom，多一点都不要。
       *
       * 原来的写法是 `pull = clamp(distDeg * 15, 2.5, 5.5)` ——
       * **不管多远，最少也要抛 2.5 级**。于是挪 500 米也要先冲上天再砸下来，
       * owner 的原话:「每个 poi 都要抛高镜头然后再 zoom in 太奇怪了」。
       *
       * 现在：够短的移动（近到本来就在同一画面里）→ **平飞，不抛**。
       */
      const fitZoom = zoomToFitSpan(distDeg)
      const lowZoom = Math.min(cur.zoom, to.zoom)
      // 需要往外拉多少级，才能把两点一起看见
      const pull = lowZoom - fitZoom
      if (moved && pull > MIN_ARC_PULL) {
        const midZoom = Math.max(MIN_TOUR_ZOOM, lowZoom - Math.min(pull, MAX_ARC_PULL))
        segs.push({ start: t, end: t + flyDur, from: cur, to, arc: true, midZoom })
      } else {
        // 两点本来就在一个画面里（POI、同项目内的小移动）→ 直接平移过去。
        segs.push({ start: t, end: t + flyDur, from: cur, to })
      }
      cur = to
      t += flyDur
    } else {
      // keyframe = 一个机位。就到那个机位去,不加任何「氛围运动」。
      // zoom 仍然卡一个下限,免得 AI 写出 zoom 9 的大广角在短旁白里被压成「一拉一推」。
      const to: CameraState = {
        center: cam.center ?? cur.center,
        zoom: Math.max(MIN_TOUR_ZOOM, cam.zoom ?? cur.zoom),
        pitch: Math.min(MAX_TOUR_PITCH, cam.pitch ?? cur.pitch),
        bearing: cam.bearing ?? cur.bearing,   // 剧本说什么就是什么
      }
      segs.push({ start: t, end: t + dur, from: cur, to })
      cur = to
      t += dur
    }
  }

  if (!segs.length) {
    // every cue was a no-op → hold entry, no motion
    return { duration: 0, sampleAt: () => null, initial: entry ?? cur }
  }

  const duration = t
  const initial = segs[0].from

  const sampleAt = (tt: number): CameraState | null => {
    if (tt <= 0) return segs[0].from
    // sequential & gap-free → the active segment is the last one we've entered
    let active: Segment = segs[0]
    for (const s of segs) {
      if (tt >= s.start) active = s
      else break
    }
    if (tt >= active.end) return active.to // only true past the very last segment
    const local = (tt - active.start) / Math.max(1, active.end - active.start)
    const e = EASE(Math.min(1, Math.max(0, local)))
    if (active.orbitDegrees != null) {
      // glide centre in over the first 40%, rotate bearing across the whole span
      const cp = EASE(Math.min(1, local / 0.4))
      return {
        center: lerpLngLat(active.from.center, active.to.center, cp),
        zoom: lerp(active.from.zoom, active.to.zoom, e),
        pitch: lerp(active.from.pitch, active.to.pitch, e),
        bearing: active.from.bearing + active.orbitDegrees * e,
      }
    }
    if (active.arc && active.midZoom != null) {
      // pull-back arc: zoom dips to midZoom at mid-flight then back in (sin curve)
      const dip = Math.sin(Math.min(1, Math.max(0, local)) * Math.PI)
      const baseZoom = lerp(active.from.zoom, active.to.zoom, e)
      return {
        center: lerpLngLat(active.from.center, active.to.center, e),
        zoom: baseZoom - (baseZoom - active.midZoom) * dip,
        pitch: lerp(active.from.pitch, active.to.pitch, e),
        bearing: lerp(active.from.bearing, active.to.bearing, e),
      }
    }
    return {
      center: lerpLngLat(active.from.center, active.to.center, e),
      zoom: lerp(active.from.zoom, active.to.zoom, e),
      pitch: lerp(active.from.pitch, active.to.pitch, e),
      bearing: lerp(active.from.bearing, active.to.bearing, e),
    }
  }

  return { duration, sampleAt, initial }
}

/** Final state of a track (for chaining the next beat's entry). */
export function finalState(track: CameraTrack): CameraState | null {
  return track.duration > 0 ? track.sampleAt(track.duration) : track.initial
}
