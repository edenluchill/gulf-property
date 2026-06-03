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

/** Marks a keyframe as a gentle "orbit" segment (center glides in). Bearing is
 *  now driven by the ENGINE at a constant rate, so this value only selects the
 *  smooth-center-glide sampling branch; its magnitude no longer sets rotation. */
const AMBIENT_ORBIT_DEG = 24
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

const ARRIVAL_ZOOM = 15

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

  let cur: CameraState = entry ?? fallback
  const segs: Segment[] = []
  let t = 0

  for (const cam of cues) {
    const dur = Math.max(MIN_CUE_MS, 'duration_ms' in cam && cam.duration_ms ? cam.duration_ms : 6000)

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
      const to: CameraState = { center: cam.to, zoom: ARRIVAL_ZOOM, pitch: 55, bearing: cur.bearing }
      // Distance-aware duration so a long hop isn't a rushed streak.
      const flyDur = Math.max(dur, Math.min(6000, 2600 + distDeg * 22000))
      if (moved) {
        // Property→property hop: RISE to a high overview at mid-flight so the
        // viewer sees roughly WHERE the next home is, then descend into it —
        // never a flat low pan ("挑高再拉近,不要平移"). Bigger rise for longer
        // hops. (In-place arrivals skip the arc → straight push-in.)
        const pull = Math.min(5.5, Math.max(2.5, distDeg * 15))
        const midZoom = Math.max(9.5, Math.min(cur.zoom, to.zoom) - pull)
        segs.push({ start: t, end: t + flyDur, from: cur, to, arc: true, midZoom })
      } else {
        segs.push({ start: t, end: t + flyDur, from: cur, to })
      }
      cur = to
      t += flyDur
    } else {
      // keyframe → a gentle continuous orbit so a "static" shot never freezes.
      // Clamp zoom to the floor so AI-authored wide shots don't yo-yo the view.
      const to: CameraState = {
        center: cam.center ?? cur.center,
        zoom: Math.max(MIN_TOUR_ZOOM, cam.zoom ?? cur.zoom),
        pitch: cam.pitch ?? cur.pitch,
        bearing: (cam.bearing ?? cur.bearing) + AMBIENT_ORBIT_DEG,
      }
      segs.push({ start: t, end: t + dur, from: cur, to, orbitDegrees: AMBIENT_ORBIT_DEG })
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
