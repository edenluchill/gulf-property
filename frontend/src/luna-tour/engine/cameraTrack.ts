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
 * 🔴 **永远不许出现「完全静止」的一拍。**（owner 2026-07-29 明确要求)
 *
 * 原话:「这个 demo 的 script 有时候介绍 project 时**地图完全没有在动**。核心就两点:
 * 永远保持他在舒服的 smooth 的运动、带客户看看附近环境;然后移动时不能出现任何抖动。」
 *
 * 怎么会静止的:剧本里 `weakness` / 部分 `numbers` 拍写的是「关键帧到当前机位」——
 * from 和 to 完全一样。而引擎会把这一拍的相机轨道拉伸到旁白长度,于是变成
 * **十几秒在两个相同机位之间插值 = 死画面**。
 *
 * ⚠️ 这条曾经反过来:早先有个 `AMBIENT_ORBIT_DEG = 24` 给每个静止关键帧加旋转,
 *    被我删掉了(理由是「到了目的地要读信息,不是继续晕」)。**owner 现在明确否了那个判断。**
 *    但要记住他当时嫌晕的是**快**,不是**动** —— 所以这里给的是很慢的一圈
 *    (14° 摊到整段旁白 ≈ 0.7~1°/秒),客户读数字时不会被抢注意力,画面又始终活着。
 *    别把它调大。
 */
const AMBIENT_ORBIT_DEG = 14
/** 一段的屏幕位移小于这么多像素,就当它是「死住了」。 */
const STATIC_SEG_EPS_PX = 6
/** A flyover whose target is within ~this (deg ≈ 80m) of us is a no-op → drop. */
const NOOP_MOVE_EPS = 0.0008
/** Floor so a 0-duration cue still occupies a sliver of the track. */
const MIN_CUE_MS = 800

/** 窄屏(手机)。一处判定,下面几个上下限都跟着它走。 */
export const isNarrowViewport = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth < 700

/** Don't let the camera pull wider than this — AI sometimes authors zoom 9 wide
 *  establishing shots that, compressed into a short narration, read as a dizzying
 *  zoom-out-then-in. Keep the framing tight + steady.
 *
 *  🔴 手机必须放宽:同样的 zoom 在窄屏上横向可见范围小得多,10.8 的下限会把
 *  establishing 里两侧的项目直接挤出画面(owner:「一开始没办法看到全貌」)。
 *  窄屏下调下限,让 establishing 能退到装得下所有项目的 zoom。桌面不变。
 *
 *  2026-07-28 两端都放宽(手机 8.6 / 桌面 9.4)。owner 要求开场「**高一点**,围着迪拜
 *  缓慢旋转」,而这个下限正好卡在那个高度上:
 *   • 手机「装得下所有项目」的 zoom 约 9.9,再抛高一点就撞 9.4;
 *   • 桌面更糟 —— 后端算的建立机位是 10.2,**一直被 10.8 悄悄夹紧**,
 *     所以桌面从来没真正拍到过那张城市全景。
 *  这个下限原本是为了防「AI 写个 zoom 9 的大广角,压在短旁白里变成一拉一推」。
 *  现在**开场机位由 openingShot.ts 按几何算死、不再由 AI 决定**,那个风险没了,
 *  下限只需要留着当一道兜底护栏。 */
const MIN_TOUR_ZOOM = isNarrowViewport() ? 8.6 : 9.4

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
  /** 匀速（不做 easeInOut）—— 氛围环绕必须匀速，否则开头结尾看起来是静止的 */
  linear?: boolean
  /** flyover travels with a pull-back arc (zoom out mid-flight, then in) */
  arc?: boolean
  /** lowest zoom reached at mid-flight for an arc */
  midZoom?: number
  /**
   * 🔴 RIGID = **不许被旁白拉长**。
   *
   * 引擎会把整条相机轨道 time-warp 到旁白长度(「镜头动多久 = Luna 说多久」)。
   * 那对**停留**(orbit/push/crane)完全正确,对**赶路**(flyover)是灾难:
   * 一段本该 2.5 秒到位的飞行,配上 20 秒的旁白就被拉成 **11 秒的空中平移** ——
   * 画面里没有任何信息(owner:「travel is dead time」),而且正是这几秒在手机上
   * 疯狂拉新 zoom 的卫星瓦片。
   *
   * 所以:赶路按剧本的秒数走,**多出来的时间全部给停留吸收**(到了目的地慢慢看)。
   */
  rigid?: boolean
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
/** 抛高的硬上限。再高客户就只看见沙漠了，而那几秒画面里没有任何信息。
 *
 *  🔴 手机压到 1.2:抛高 2.2 级 = 途中把**整整两级新 zoom 的卫星瓦片**全拉一遍,
 *  落地再拉回来。这是手机上最贵的一段(实测每次跨 zoom 都是一次 30+ 瓦片的爆发),
 *  而画面上什么信息都没有。 */
const MAX_ARC_PULL = isNarrowViewport() ? 1.2 : 2.2

const ARRIVAL_ZOOM = 15
/** Cap the cinematic tilt. A steep pitch (55°+) makes the camera see toward the
 *  horizon, so a SLOW orbit streams a huge, ever-changing fan of satellite tiles
 *  (incl. low-zoom far-field tiles) — the periodic "still fetching while rotating"
 *  hitch. ~45° keeps a clear 3D feel while cutting the visible footprint (and the
 *  POIs/labels in view) a lot. Applies to authored pitch too.
 *
 *  🔴 手机 38°:俯角每高一度,画面里就多一片朝地平线延伸的远景瓦片。窄屏本来就窄,
 *  45° 换来的「立体感」很有限,换走的却是每帧的瓦片量。顺带也更符合 owner 要的
 *  「高一点」的俯瞰感。 */
const MAX_TOUR_PITCH = isNarrowViewport() ? 38 : 48
const ARRIVAL_PITCH = isNarrowViewport() ? 38 : 45

export interface CameraTrack {
  /** total ms this track spans (0 if no camera) */
  readonly duration: number
  /** camera state at ms t within the beat (clamped) */
  sampleAt(t: number): CameraState | null
  /** the state the camera should hold at the very start (for instant seek) */
  readonly initial: CameraState | null
  /** ms of RIGID (travel) motion — never stretched to fit the narration */
  readonly rigidDuration: number
  /**
   * 把「墙上时钟走了多久」换算成「轨道时间」，使整条轨道刚好铺满 targetMs 毫秒 ——
   * 但**赶路段保持原速**，只有停留段被拉长/压短。targetMs<=0 → 不做时间伸缩。
   */
  remap(wallMs: number, targetMs: number): number
  /** 这条轨道在 targetMs 的伸缩下，墙上时钟总共要走多久 */
  wallDuration(targetMs: number): number
}

/**
 * Compile a beat's camera cues + the entry state into a samplable track.
 * `entry` = where the camera is when the beat begins (prev beat's final state),
 * so keyframes that omit fields inherit smoothly. Cues are laid out SEQUENTIALLY
 * (gap-free); authored at_ms is not used for layout.
 */
export function compileCameraTrack(cues: Camera[], entry: CameraState | null): CameraTrack {
  const fallback: CameraState = { center: [55.27, 25.2], zoom: 11, pitch: 45, bearing: 0 }
  if (!cues.length) return emptyTrack(entry)

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

    if ('type' in cam && cam.type === 'push') {
      // dolly —— 原地推近/拉远。最便宜也最有效的动能:画面一直在"呼吸"。
      const to: CameraState = {
        ...cur,
        zoom: Math.max(MIN_TOUR_ZOOM, Math.min(20, cur.zoom + cam.zoom_delta)),
      }
      segs.push({ start: t, end: t + dur, from: cur, to })
      cur = to
      t += dur
    } else if ('type' in cam && cam.type === 'crane') {
      // crane —— 原地升降。讲"这栋楼有多高/这片地有多大"时用。
      const to: CameraState = {
        ...cur,
        pitch: cam.pitch != null ? Math.min(MAX_TOUR_PITCH, cam.pitch) : cur.pitch,
        zoom: cam.zoom != null ? Math.max(MIN_TOUR_ZOOM, cam.zoom) : cur.zoom,
      }
      segs.push({ start: t, end: t + dur, from: cur, to })
      cur = to
      t += dur
    } else if ('type' in cam && cam.type === 'orbit') {
      const center = cam.center
      const from: CameraState = { ...cur }
      const to: CameraState = { ...cur, center, bearing: cur.bearing + cam.degrees }
      // 环绕一律**匀速**。easeInOut 的环绕在开头和结尾几乎不动 —— 而一段 20 秒的开场
      // 环绕被 ease 之后,前后各三四秒看起来就是「地图没在动」(owner 的原话)。
      // 无人机绕着一栋楼飞本来也是匀速的。
      segs.push({ start: t, end: t + dur, from, to, orbitDegrees: cam.degrees, linear: true })
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
        segs.push({ start: t, end: t + flyDur, from: cur, to, arc: true, midZoom, rigid: true })
      } else {
        // 两点本来就在一个画面里（POI、同项目内的小移动）→ 直接平移过去。
        segs.push({ start: t, end: t + flyDur, from: cur, to, rigid: moved })
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
      // 换了地方的关键帧也是**赶路** → 按剧本的秒数走，别被旁白拉成慢动作平移。
      const travelled = Math.hypot(to.center[0] - cur.center[0], to.center[1] - cur.center[1])
      segs.push({ start: t, end: t + dur, from: cur, to, rigid: dur > 0 && travelled >= NOOP_MOVE_EPS })
      cur = to
      t += dur
    }
  }

  /**
   * 一个 cue 都没剩(全是 no-op)→ 以前是「原地冻住」。给它一段缓慢环绕。
   * （时长写多少都行:引擎会把它拉伸到旁白长度,真正决定快慢的是角度。）
   */
  if (!segs.length) {
    const base = entry ?? cur
    segs.push({
      start: 0,
      end: 6000,
      from: base,
      to: { ...base, bearing: base.bearing + AMBIENT_ORBIT_DEG },
      orbitDegrees: AMBIENT_ORBIT_DEG,
      linear: true,
    })
    t = 6000
  }

  /**
   * 🔴 把「死住的段」变成缓慢环绕。
   *
   * `weakness` 那类拍写的是「关键帧到当前机位」——from 和 to 一模一样,再被拉伸到
   * 十几秒旁白,就是十几秒静止画面。这里逐段量屏幕位移,几乎没动的段就挂上环绕。
   * (真的有运动的段一律不碰 —— 剧本要 push 就 push,要 crane 就 crane。)
   *
   * `linear: true` —— 氛围环绕必须**匀速**。用 easeInOut 的话开头结尾几乎不动,
   * 而「开头不动」正是 owner 抱怨的那个感觉。
   */
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1000
  for (const s of segs) {
    if (s.orbitDegrees != null || s.arc) continue
    const pxPerDeg = (256 * Math.pow(2, s.from.zoom)) / 360
    const moved =
      Math.hypot((s.to.center[0] - s.from.center[0]) * pxPerDeg, (s.to.center[1] - s.from.center[1]) * pxPerDeg) +
      Math.abs(s.to.zoom - s.from.zoom) * (vw / 2) * Math.LN2 +
      (Math.abs(s.to.bearing - s.from.bearing) * Math.PI * (vw / 2)) / 180 +
      (Math.abs(s.to.pitch - s.from.pitch) * Math.PI * (vw / 2)) / 180
    if (moved >= STATIC_SEG_EPS_PX) continue
    s.orbitDegrees = AMBIENT_ORBIT_DEG
    s.linear = true
    s.to = { ...s.to, bearing: s.from.bearing + AMBIENT_ORBIT_DEG }
  }

  const duration = t
  const initial = segs[0].from
  const rigidDuration = segs.reduce((s, g) => s + (g.rigid ? g.end - g.start : 0), 0)
  const elasticDuration = duration - rigidDuration

  /**
   * 停留段的伸缩倍数。赶路段固定不动，多出来（或少掉）的时间全部由停留段吸收。
   * 旁白比赶路本身还短（少见）→ 退回整体等比压缩，不然轨道会盖不住旁白。
   */
  const elasticScale = (targetMs: number): number => {
    if (targetMs <= 0) return 1
    if (elasticDuration <= 0) return Math.max(0.05, targetMs / duration)
    return Math.max(0.15, (targetMs - rigidDuration) / elasticDuration)
  }
  /** 旁白连赶路都装不下 → 整体等比压缩（赶路也一起压）。 */
  const uniform = (targetMs: number): boolean =>
    targetMs > 0 && (elasticDuration <= 0 || targetMs <= rigidDuration * 1.05)

  const wallDuration = (targetMs: number): number => {
    if (targetMs <= 0) return duration
    if (uniform(targetMs)) return duration * Math.max(0.05, targetMs / duration)
    return rigidDuration + elasticDuration * elasticScale(targetMs)
  }

  const remap = (wallMs: number, targetMs: number): number => {
    if (targetMs <= 0) return wallMs
    if (uniform(targetMs)) return wallMs / Math.max(0.05, targetMs / duration)
    const k = elasticScale(targetMs)
    let wall = 0
    for (const s of segs) {
      const span = s.end - s.start
      const wallSpan = s.rigid ? span : span * k
      if (wallMs < wall + wallSpan || s === segs[segs.length - 1]) {
        const local = wallSpan > 0 ? (wallMs - wall) / wallSpan : 1
        return s.start + span * local
      }
      wall += wallSpan
    }
    return duration
  }

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
    const clamped = Math.min(1, Math.max(0, local))
    // linear = 匀速（氛围环绕）；否则 easeInOut（剧本写的运镜要有起伏）
    const e = active.linear ? clamped : EASE(clamped)
    if (active.orbitDegrees != null) {
      // glide centre in over the first 40%, rotate bearing across the whole span
      const cp = active.linear ? Math.min(1, local / 0.4) : EASE(Math.min(1, local / 0.4))
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

  return { duration, sampleAt, initial, rigidDuration, remap, wallDuration }
}

function emptyTrack(initial: CameraState | null): CameraTrack {
  return {
    duration: 0,
    sampleAt: () => null,
    initial,
    rigidDuration: 0,
    remap: (w) => w,
    wallDuration: () => 0,
  }
}

/** Final state of a track (for chaining the next beat's entry). */
export function finalState(track: CameraTrack): CameraState | null {
  return track.duration > 0 ? track.sampleAt(track.duration) : track.initial
}
