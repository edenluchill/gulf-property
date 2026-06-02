/**
 * Luna Tour — camera track (single-clock, pure, samplable).
 *
 * THE fix for "暂停后镜头/旁白/卡片不同步": the camera is no longer a self-driven
 * rAF inside the map handle. Instead each beat's camera cues compile into a pure
 * track you can sample at any ms — `sampleAt(t)` → {center, zoom, pitch, bearing}.
 * The engine's single clock samples it every frame and calls map.jumpTo(). Pause
 * = clock frozen = no new sample = camera frozen, in lock-step with audio +
 * overlays. No second timeline anywhere.
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
}

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
 * so keyframes that omit fields inherit smoothly.
 */
export function compileCameraTrack(cues: Camera[], entry: CameraState | null): CameraTrack {
  if (!cues.length) {
    return { duration: 0, sampleAt: () => null, initial: entry }
  }

  // Resolve a running "current" state; each cue produces one Segment.
  let cur: CameraState =
    entry ?? { center: [55.27, 25.2], zoom: 12, pitch: 45, bearing: 0 }
  const segs: Segment[] = []

  for (const cam of cues) {
    if ('type' in cam && cam.type === 'orbit') {
      const center = cam.center
      const from: CameraState = { ...cur, center }
      const to: CameraState = { ...cur, center, bearing: cur.bearing + cam.degrees }
      segs.push({
        start: cam.at_ms,
        end: cam.at_ms + cam.duration_ms,
        from,
        to,
        orbitDegrees: cam.degrees,
      })
      cur = to
    } else if ('type' in cam && cam.type === 'flyover') {
      const isInPlace = Math.hypot(cam.to[0] - (cam.from?.[0] ?? cur.center[0]), cam.to[1] - (cam.from?.[1] ?? cur.center[1])) < 0.002
      const to: CameraState = { center: cam.to, zoom: 15, pitch: 55, bearing: cur.bearing }
      // an in-place flyover settles fast so the next cue (usually orbit) starts soon
      const dur = isInPlace ? Math.min(cam.duration_ms, 1200) : cam.duration_ms
      segs.push({ start: cam.at_ms, end: cam.at_ms + dur, from: cur, to })
      cur = to
    } else {
      // keyframe — inherit omitted fields from current state
      const to: CameraState = {
        center: cam.center ?? cur.center,
        zoom: cam.zoom ?? cur.zoom,
        pitch: cam.pitch ?? cur.pitch,
        bearing: cam.bearing ?? cur.bearing,
      }
      segs.push({ start: cam.at_ms, end: cam.at_ms + cam.duration_ms, from: cur, to })
      cur = to
    }
  }

  const duration = segs.reduce((m, s) => Math.max(m, s.end), 0)
  const initial = segs[0]?.from ?? entry

  const sampleAt = (t: number): CameraState | null => {
    if (!segs.length) return null
    // before first segment → hold its from
    if (t <= segs[0].start) return segs[0].from
    // find the active segment (or the last one we've passed)
    let active: Segment | null = null
    for (const s of segs) {
      if (t >= s.start) active = s
      else break
    }
    if (!active) return segs[0].from
    if (t >= active.end) {
      // between this segment's end and the next's start → hold its `to`
      return active.to
    }
    const local = (t - active.start) / Math.max(1, active.end - active.start)
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
