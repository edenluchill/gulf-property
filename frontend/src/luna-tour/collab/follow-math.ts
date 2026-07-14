/**
 * Luna Collaborative Tour — camera interpolation math (§3 netcode).
 *
 * Pure, dependency-free functions. This is the "why it feels smooth" layer:
 * viewers store only a `target` camera from incoming `cam` packets and lerp the
 * locally-rendered camera toward it every frame (exponential / critically-damped
 * smoothing). Send/receive frequency is fully decoupled from render rate, so a
 * 20Hz packet stream still looks like 60fps cinematic motion and tolerates
 * dropped packets.
 *
 * ISOLATION: zero imports beyond the Cam type. Trivially unit-testable.
 */
import type { Cam } from './protocol'

/** Mutable camera the rAF loop drives toward a target. */
export interface CamState {
  c: [number, number]
  z: number
  b: number
  p: number
}

/**
 * 客户该在经纪的 zoom 上偏移多少 —— **让他「看清」,而不是「看全」。**
 *
 * 可视地理宽度 ∝ 视口宽 / 2^zoom。要让客户看到和经纪**一样多**的东西:
 *   zv = zp + log2(myW / presW)
 *
 * ── ⚠️ 「一点不少」是个错误的目标 ────────────────────────────────────────
 * 原来这里取两轴的 **min**,让客户视口成为经纪视口的**超集**(一点内容都不能少)。
 * 数学没错,但目标错了:
 *
 *   经纪 iPad 横屏 1180 宽,客户手机 390 宽 → min 比值 0.33 → **客户要缩小 1.6 级**。
 *   于是「一点不少」的代价是 —— **全都看不清**。
 *   owner 实测:「我用电脑 share,我看地图 ok,不过**客户手机看的巨小**」。
 *
 * **客户要的不是「看到全部」,是「看清你在讲的那个东西」。**
 * 经纪讲的东西几乎总在画面中央;宁可让客户少看到一点边角,也不能让他什么都看不清。
 *
 * 所以:算出「看全」需要的偏移,然后**卡住收缩量**。
 *   • 最多缩小 MAX_SHRINK 级 —— 再小就不认字了
 *   • 最多放大 MAX_GROW 级   —— (经纪在手机、客户在电脑时,该放大追上同样的比例)
 *
 * 拿不到经纪视口(老客户端)或数据离谱 → 返回 0(退回「不补偿」,绝不给个坏 zoom)。
 */
/** 客户最多比经纪缩小这么多级。1 级 = 内容线性尺寸减半 —— 半级已经很明显了。 */
const MAX_SHRINK = 0.5
/** 客户最多比经纪放大这么多级(经纪在手机、客户在大屏时用得上)。 */
const MAX_GROW = 1.5

export function zoomOffsetForViewport(
  presenter: { vw?: number; vh?: number } | null | undefined,
  myW: number,
  myH: number
): number {
  const pw = presenter?.vw
  const ph = presenter?.vh
  if (!pw || !ph || !myW || !myH || pw <= 0 || ph <= 0 || myW <= 0 || myH <= 0) return 0
  const wantSuperset = Math.log2(Math.min(myW / pw, myH / ph))
  // 视口塌陷(隐藏容器报 ~0)时会算出离谱的值 —— 一个疯掉的 zoom 比不补偿糟得多。
  if (!Number.isFinite(wantSuperset) || Math.abs(wantSuperset) > 4) return 0
  return Math.max(-MAX_SHRINK, Math.min(MAX_GROW, wantSuperset))
}

/** Default smoothing factor per frame — critically-damped feel at ~60fps. */
export const DEFAULT_K = 0.18

// shouldSendCam thresholds. The center threshold is in degrees and is chosen so
// that — at Dubai's latitude (~25°N) and a mid zoom — a move of less than about
// half a screen pixel is ignored. 1e-5° ≈ 1.1m on the ground; at z≈13 a tile
// pixel covers a few metres, so this is sub-pixel. Cheap and good enough; the
// presenter samples at 20Hz so missed micro-moves are picked up next tick.
export const SEND_EPS = {
  center: 1e-5,
  zoom: 0.01,
  bearing: 0.2,
  pitch: 0.2,
} as const

// classifyMove thresholds — when one sample-to-sample step is "cross-district"
// big it should travel as a discrete `goto` (cinematic flyTo), not as a `cam`
// stream that would lerp-skim across half of Dubai. A bearing/pitch swing alone
// never forces a jump (rotating in place is fine to stream).
export const JUMP_EPS = {
  zoom: 1.5,
  /** fraction of the current viewport span a center move must exceed to jump */
  panViewportFrac: 0.9,
} as const

/** Linear interpolation. */
export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/**
 * Angular lerp that always travels the SHORT way around the 0/360 wrap.
 * e.g. from 359° toward 1° steps in the +2° direction, never -358°.
 * Result is normalized to [0, 360).
 */
export function lerpAngle(a: number, b: number, k: number): number {
  let diff = ((b - a + 540) % 360) - 180 // shortest signed delta in (-180, 180]
  const out = a + diff * k
  return ((out % 360) + 360) % 360
}

/** Shortest absolute angular distance between two bearings, in [0, 180]. */
export function angleDelta(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180)
}

/**
 * One smoothing step from `current` toward `target` (Cam). center/zoom/pitch use
 * lerp, bearing uses the short-arc lerpAngle. k defaults to DEFAULT_K.
 */
export function stepCamera(current: CamState, target: CamState, k: number = DEFAULT_K): CamState {
  return {
    c: [lerp(current.c[0], target.c[0], k), lerp(current.c[1], target.c[1], k)],
    z: lerp(current.z, target.z, k),
    b: lerpAngle(current.b, target.b, k),
    p: lerp(current.p, target.p, k),
  }
}

/**
 * True once `current` is within `eps` of `target` on every component (bearing by
 * short arc) — used to stop the rAF loop and save power until the next packet.
 */
export function cameraConverged(
  current: CamState,
  target: CamState,
  eps: { center?: number; zoom?: number; bearing?: number; pitch?: number } = {}
): boolean {
  const ec = eps.center ?? 1e-6
  const ez = eps.zoom ?? 1e-3
  const eb = eps.bearing ?? 0.05
  const ep = eps.pitch ?? 0.05
  return (
    Math.abs(current.c[0] - target.c[0]) < ec &&
    Math.abs(current.c[1] - target.c[1]) < ec &&
    Math.abs(current.z - target.z) < ez &&
    angleDelta(current.b, target.b) < eb &&
    Math.abs(current.p - target.p) < ep
  )
}

/**
 * Should the presenter emit a `cam` packet? True when any component moved past
 * its threshold (see SEND_EPS). A null `prev` (first sample) always sends.
 */
export function shouldSendCam(prev: Cam | CamState | null, next: Cam | CamState): boolean {
  if (!prev) return true
  return (
    Math.abs(prev.c[0] - next.c[0]) > SEND_EPS.center ||
    Math.abs(prev.c[1] - next.c[1]) > SEND_EPS.center ||
    Math.abs(prev.z - next.z) > SEND_EPS.zoom ||
    angleDelta(prev.b, next.b) > SEND_EPS.bearing ||
    Math.abs(prev.p - next.p) > SEND_EPS.pitch
  )
}

/**
 * Classify a presenter camera step as a continuous `'stream'` (→ cam packet,
 * viewer interpolates) or a discrete `'jump'` (→ goto event, viewer flyTo).
 * A jump is a cross-district pan (center moved more than ~90% of the current
 * viewport's lng/lat span) OR a big zoom change (> JUMP_EPS.zoom). A null `prev`
 * is a jump (the very first camera the viewer sees should fly, not lerp from 0).
 */
export function classifyMove(prev: Cam | CamState | null, next: Cam | CamState): 'stream' | 'jump' {
  if (!prev) return 'jump'
  if (Math.abs(prev.z - next.z) > JUMP_EPS.zoom) return 'jump'
  // Approximate the visible lng/lat span from zoom. Web-mercator: the world is
  // 360° wide at z0, halving each zoom level; a viewport is ~1 tile-row tall, so
  // span ≈ 360 / 2^z is a serviceable order-of-magnitude estimate for "how much
  // ground is on screen". We only need it to separate in-view pans from
  // cross-district jumps, not to be pixel-accurate.
  const span = 360 / Math.pow(2, next.z)
  const thresh = span * JUMP_EPS.panViewportFrac
  const dLng = Math.abs(prev.c[0] - next.c[0])
  const dLat = Math.abs(prev.c[1] - next.c[1])
  if (dLng > thresh || dLat > thresh) return 'jump'
  return 'stream'
}
