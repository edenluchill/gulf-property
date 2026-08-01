/**
 * Luna Tour — 开场机位与构图（纯几何，无 React / 无地图）。
 *
 * ── 为什么这件事不能交给 AI ────────────────────────────────────────────────
 * 剧本里的开场是模型写的。prompt 明写着「cut 到建立机位，然后**缓慢高空环绕**」，
 * 而 demo 实际生成出来的是：
 *     [ keyframe zoom 10.2 (瞬切), keyframe zoom 11.2 (2.5s 推近) ]
 * —— 一个**静止的广角**，然后慢慢推近，全程 bearing 不动。旁白有 20 秒，
 * 于是这 1 级 zoom 被时间伸缩摊到 20 秒里：画面基本是**静止**的。
 * owner:「一开始的动作也不好，他要高一点，围着迪拜缓慢旋转边介绍」。
 *
 * 开场是**每一场 tour 的第一印象**，不能靠模型每次碰运气。它也本来就是纯几何题
 * （装得下几个点、留多少余量、屏幕多宽），所以这里算死：
 *   1. `establishingShot()` —— 高空、装得下所有项目、留出被 UI 挡住的部分
 *   2. `introCameraCues()`  —— 瞬切到机位 + **一圈缓慢环绕**（时长由旁白决定）
 *   3. `outroCameraCues()`  —— 收尾同样退到高空慢慢转，一起看完所有的家
 *
 * 时长交给引擎：环绕段是 elastic 的，会被拉伸到刚好等于旁白长度
 * （见 cameraTrack.ts 的 `rigid`），所以 80° 在 20 秒的旁白下就是 4°/秒 —— 缓慢。
 */
import { isNarrowViewport } from './cameraTrack'
import type { Camera, LngLat } from '../types'

export interface Shot {
  center: LngLat
  zoom: number
  pitch: number
  bearing: number
}

/**
 * 被 UI 遮住的上下边距 —— 相机要对准的是**剩下那块看得见的区域**的中心。
 *
 * 手机:顶部章节条 ≈56px,底部字幕 + 卡片 ≈170px。
 * 桌面:章节条更靠上、字幕带在下方,占得少。
 * (右侧的经纪卡片/工具卡不动构图 —— 左右留白会把城市挤扁,而横向本来就最紧。)
 *
 * `hiddenBottom` = 被**手机浏览器 UI**(地址栏/系统导航栏)吃掉的那一条。地图画布是
 * 100vh 高,比可见区域更长,所以画布底部那一段根本看不到 —— 不算进来的话,
 * 相机会把主角对准一条客户看不见的线。由 TourOverlay 用 visualViewport 量。
 */
export function tourViewportPadding(hiddenBottom = 0): { top: number; bottom: number } {
  const base = isNarrowViewport() ? { top: 56, bottom: 170 } : { top: 64, bottom: 120 }
  return { top: base.top, bottom: base.bottom + Math.max(0, hiddenBottom) }
}

/** 开场再往外退这么多级 —— owner:「他要高一点」。 */
const OPENING_PULL = 0.35

/**
 * 🔴 开场**至少**要能横向看到这么多经度 —— 也就是「看得见整个迪拜」。
 *
 * owner:「手机时能让他视野抛高一点吗 因为 desktop 的 view 一开始能看到更多东西
 * 但是手机版视野就很窄 看不完整个迪拜」。
 *
 * 为什么手机会窄:同一个 zoom 下可见经度 ∝ 屏幕宽度。桌面 1440px 能看到约 1.1°,
 * 手机 390px 只有 0.36° —— 差 3 倍。而「装得下那几个项目」这条规则在手机上算出来
 * 恰好就是紧紧框住三个 pin,周围的城市全在画面外。
 *
 * 所以再加一条**下限**:不管项目怎么分布,开场都要能看到这么宽的一片。
 * 迪拜主城区(棕榈岛 → Downtown → Deira)东西向约 0.45°,取 0.52° 留点余量。
 * ⚠️ 别再放大:再宽三个 pin 就挤到一起、名字互相压,而且沙漠占的比例开始超过城市。
 */
const MIN_VISIBLE_LNG = isNarrowViewport() ? 0.52 : 0.9

/** 恰好能横向看到 spanLng 度经度的 zoom（Web Mercator，见 zoomToFit 的注释）。 */
function zoomForVisibleLng(spanLng: number): number {
  const { w } = viewport()
  return Math.log2((360 * w) / (512 * spanLng))
}
/**
 * 🔴 环绕按**角速度**给,不按固定角度。
 *
 * 原来写死 65°:开场旁白 19 秒时是 3.4°/秒(刚好),但换个楼盘旁白只有 8 秒,
 * 同样的 65° 就变成 **8°/秒** —— 那不是「缓慢围绕」,那是甩头。
 * 反过来旁白 30 秒时又慢到看不出在动(owner:「镜头不转」)。
 * **「慢」是一个速度,不是一个角度。**
 *
 * ⚠️ 速度别调高:转得越快,每秒扫进画面的新卫星瓦片越多,而瓦片解码+上纹理是手机上
 * 唯一还在制造长帧的东西。3°/秒 是「明显在动」和「稳」之间试出来的。
 */
const INTRO_DEG_PER_SEC = 3.2
const OUTRO_DEG_PER_SEC = 2.8
/** 上下限:再少看不出在动,再多就绕过头(开场绕超过大半圈会让人失去方向感)。 */
const clampOrbit = (deg: number, lo = 24, hi = 130) => Math.max(lo, Math.min(hi, Math.round(deg)))
/**
 * 高空俯瞰的俯角。
 *
 * ⚠️ **别调高。** 45° 那种「电影感」的俯角放在城市级全景上是净损失:
 * 实测 pitch 34 / zoom 9.9 的开场,画面**下面一半多是空沙漠**(近景地面),
 * 三个项目全被挤到上面三分之一 —— 正是 owner 说的「要集中中间屏幕能看到重要信息」
 * 的反面。而且俯角越大,朝地平线铺出去的远景瓦片越多(手机上最贵的一项)。
 *
 * 20~26° 仍有明显的立体感(配上缓慢环绕更像航拍),但构图基本回到「所见即所算」:
 * 三个项目就落在画面中间。走到项目跟前再抬俯角(那时候画面里就是楼,不是沙漠)。
 */
const openingPitch = () => (isNarrowViewport() ? 20 : 26)
/** 项目群四周留的余量(1 = 贴边)。 */
const FIT_MARGIN = 1.35

function viewport(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 1280, h: 800 }
  return { w: window.innerWidth, h: window.innerHeight }
}

/**
 * 恰好能把 spanLng × spanLat 一起框进**可见区域**的 zoom。
 *
 * Web Mercator：世界宽度 = 512·2^z 像素 →
 *   可见经度 = 360·W / (512·2^z)，可见纬度 ≈ 360·H·cos(φ) / (512·2^z)
 * 反解取两者更小的那个（两个方向都要装得下）。
 * ⚠️ 高度用的是**扣掉 padding 之后**的高度 —— 不然算出来「装得下」，
 *    实际下面 1/5 被字幕盖着。
 */
export function zoomToFit(coords: LngLat[], pad = tourViewportPadding()): number | null {
  if (coords.length < 2) return null
  const { w, h } = viewport()
  const usableH = Math.max(180, h - pad.top - pad.bottom)
  const lngs = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  const spanLng = Math.max(Math.max(...lngs) - Math.min(...lngs), 1e-4) * FIT_MARGIN
  const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), 1e-4) * FIT_MARGIN
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const cos = Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  const zLng = Math.log2((360 * w) / (512 * spanLng))
  const zLat = Math.log2((360 * usableH * cos) / (512 * spanLat))
  return Math.min(zLng, zLat)
}

/**
 * 开场机位。
 *
 * `authoredZoom` = 后端按项目分布算出来的建立机位 zoom(见 tour-generator.ts)。
 * 规则:**取「剧本给的」和「当前屏幕装得下的」里更宽的那个,再往外退一点。**
 * 只往外退,不往里推 —— 宽屏那张城市全景是刻意的,不能因为「算出来能装下」就推近。
 */
export function establishingShot(coords: LngLat[], authoredZoom: number, authoredCenter?: LngLat): Shot {
  const center = authoredCenter ?? centroid(coords) ?? [55.2, 25.12]
  const fit = zoomToFit(coords)
  const base = fit != null ? Math.min(authoredZoom, fit) : authoredZoom
  // 三条一起取最外面的那个:剧本给的 / 装得下所有项目的 / 看得见整个迪拜的。
  const zoom = Math.min(base - OPENING_PULL, zoomForVisibleLng(MIN_VISIBLE_LNG))
  return {
    center,
    zoom,
    pitch: openingPitch(),
    // 正北朝上的城市看起来像一张地图；斜一点才像航拍。环绕从这里开始转。
    bearing: -25,
  }
}

/** 所有项目的中点（不是第一个项目 —— 那会让开场偏到城市一角）。 */
export function centroid(coords: LngLat[]): LngLat | null {
  if (!coords.length) return null
  const lngs = coords.map((c) => c[0])
  const lats = coords.map((c) => c[1])
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]
}

/**
 * 开场运镜 = 瞬切到机位 + 一圈缓慢环绕。
 *
 * duration_ms 只是个「相对时长」:引擎会把 elastic 段拉伸到旁白长度,所以这里写
 * 9000 还是 6000 都一样 —— 真正决定快慢的是**角度**。
 */
export function introCameraCues(shot: Shot, beatMs = 12000): Camera[] {
  return [
    { at_ms: 0, duration_ms: 0, center: shot.center, zoom: shot.zoom, pitch: shot.pitch, bearing: shot.bearing },
    {
      type: 'orbit',
      at_ms: 0,
      center: shot.center,
      // 角度 = 速度 × 这一拍多长(beatMs 是剧本对旁白长度的估计,引擎再按真实音频微调)
      degrees: clampOrbit((INTRO_DEG_PER_SEC * beatMs) / 1000),
      duration_ms: 9000,
    },
  ]
}

/**
 * 一个配套的机位 —— **必须同时看得见项目和那个地方**,否则「一个一个介绍」就没有意义:
 * 卡片写着「医院 1.7 公里」,而画面上只有项目、医院在屏幕外三倍远的地方。
 *
 * 为什么由代码算:模型不知道观众的屏幕多宽,也不该抄坐标(抄错一位就指到沙漠里)。
 * 同开场机位一个道理 —— 纯几何题就用几何解。
 *
 * 旋转安全:把两点间距塞进**较短的那一边**(手机竖屏是宽度),
 * 这样 20° 的缓慢环绕转到任何角度,两个点都还在画面里。
 */
const POI_FIT_MARGIN = 1.6
/** 配套那几拍也按角速度转 —— 同 INTRO_DEG_PER_SEC 的理由。 */
const POI_DEG_PER_SEC = 3.0
const poiPitch = () => (isNarrowViewport() ? 24 : 30)

export function poiCameraCues(project: LngLat, poi: LngLat, beatMs = 11000, entryBearing = 0): Camera[] {
  const mid: LngLat = [(project[0] + poi[0]) / 2, (project[1] + poi[1]) / 2]
  const cos = Math.max(0.2, Math.cos((mid[1] * Math.PI) / 180))
  // 纬度方向换算成「经度度数」再和经度方向合成 —— 直接勾股会把南北向的距离算小
  const span = Math.max(1e-4, Math.hypot(poi[0] - project[0], (poi[1] - project[1]) / cos)) * POI_FIT_MARGIN
  const { w, h } = viewport()
  const pad = tourViewportPadding()
  const usable = Math.min(w, Math.max(180, h - pad.top - pad.bottom))
  const zoom = Math.log2((360 * usable) / (512 * span))
  return [
    // 2.2 秒挪到「两点的中间」并调好高度(赶路段,不会被旁白拉长)
    { at_ms: 0, duration_ms: 2200, center: mid, zoom, pitch: poiPitch(), bearing: entryBearing },
    // 剩下的时间缓慢环绕 —— 画面一直活着,而两点始终在框内
    {
      type: 'orbit',
      at_ms: 0,
      center: mid,
      // 减掉 2.2 秒的飞入 —— 环绕只占剩下的时间
      degrees: clampOrbit((POI_DEG_PER_SEC * Math.max(3000, beatMs - 2200)) / 1000, 14, 60),
      duration_ms: 9000,
    },
  ]
}

/** 收尾:退回高空(比开场稍紧一点,几个家都在画面里),继续慢慢转。 */
export function outroCameraCues(shot: Shot, beatMs = 9000, entryBearing = 0): Camera[] {
  return [
    { at_ms: 0, duration_ms: 2200, center: shot.center, zoom: shot.zoom + 0.3, pitch: shot.pitch, bearing: entryBearing },
    {
      type: 'orbit',
      at_ms: 0,
      center: shot.center,
      degrees: clampOrbit((OUTRO_DEG_PER_SEC * Math.max(3000, beatMs - 2200)) / 1000, 16, 90),
      duration_ms: 8000,
    },
  ]
}
