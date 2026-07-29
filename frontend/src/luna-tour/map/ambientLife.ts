/**
 * Luna Tour — 氛围层：海上的船 + 天上的飞机。
 *
 * 让这座城市**看起来是活的**。一张静止的卫星图是一张照片；有船在海上走、有飞机
 * 掠过天空，它才是一个正在运转的城市 —— 而客户要买的正是这座城市的一部分。
 *
 * ── 设计约束（都是踩过的坑）────────────────────────────────────────────
 * • **纯 GL symbol layer，零 DOM marker。** DOM marker 会压垮 GPU
 *   （见 memory: map-perf-dom-markers-gpu）—— 这里绝不能用。
 * • **零 React。** 不进 state、不触发重渲染。运镜帧必须干净
 *   （见 memory: luna-tour-perf-rules）。
 * • 只在 **tour 期间**跑，只有一个 source、约 10 个 feature，15Hz 更新 —— 不是 60Hz。
 *   船和飞机没人盯着看，15Hz 足够流畅，而 GPU 开销几乎为零。
 * • 尊重 `prefers-reduced-motion`：直接不启动。
 * • 全部以 `lt-ambient-` 前缀命名 → `stop()` 精确移除它加过的一切。
 *
 * ISOLATION: 纯工厂函数，删掉这个文件 + TourOverlay 里那几行调用即可移除。
 */
import type { Map as MaplibreMap } from 'maplibre-gl'

export interface AmbientLife {
  start(): void
  stop(): void
}

const SRC = 'lt-ambient-src'
const LAYER = 'lt-ambient-life'
const IMG_BOAT = 'lt-ambient-boat'
const IMG_PLANE = 'lt-ambient-plane'

/**
 * 更新频率。**船和飞机没人盯着看。**
 *
 * ⚠️ 每次 tick 都是一次 `source.setData()` —— 那不是「改个坐标」，而是
 * 序列化 → 丢给 worker → 重建 geojson 索引 → 重算 symbol 布局 → 回主线程。
 * 15Hz 时它就是运镜帧的一个稳定竞争者(profile 里 worker `receive` 排到第三)。
 * 手机上尤其亏:船一秒才走 0.0016°,5Hz 和 15Hz 肉眼没有任何区别。
 */
const TICK_MS = typeof window !== 'undefined' && window.innerWidth < 700 ? 200 : 125

/**
 * 航线。全是**离岸**的真实水域 / 迪拜机场的进离场走廊方向。
 *
 * ⚠️ 迪拜的海岸线大致沿西南→东北走，海在**西北侧**。所以航线的每个点都必须
 *    在海岸线的西北方 —— 否则船会开到沙漠里去（很好笑，但客户不会觉得好笑）。
 */
interface Route {
  kind: 'boat' | 'plane'
  path: [number, number][]
  /** 度/秒 —— 船慢、飞机快 */
  speed: number
  /** 同一条航线上放几个（错开相位） */
  count: number
}

const ROUTES: Route[] = [
  // ── 海上：三条平行于海岸的离岸航道 ──
  { kind: 'boat', path: [[54.95, 25.05], [55.25, 25.42]], speed: 0.0016, count: 2 },
  { kind: 'boat', path: [[54.88, 24.95], [55.10, 25.22]], speed: 0.0012, count: 2 },
  { kind: 'boat', path: [[55.02, 25.12], [55.20, 25.34]], speed: 0.0020, count: 2 },
  // 一条反向的，免得所有船都朝同一个方向（那看起来像列队，不像海）
  { kind: 'boat', path: [[55.28, 25.46], [54.92, 25.02]], speed: 0.0014, count: 1 },

  // ── 天上：DXB（≈[55.36,25.25]）的进离场走廊。跑道朝向 ~120°/300° ──
  { kind: 'plane', path: [[55.85, 24.88], [55.36, 25.25]], speed: 0.028, count: 1 },   // 进场
  { kind: 'plane', path: [[55.36, 25.25], [54.80, 25.62]], speed: 0.030, count: 1 },   // 离场
]

/** 画一个船的小图标（俯视，白色带尾迹）。canvas 生成 → map.addImage，不依赖任何外部资源。 */
function boatIcon(): ImageData {
  const s = 24
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  // 尾迹
  const grd = g.createLinearGradient(s / 2, s, s / 2, s / 2)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(1, 'rgba(255,255,255,0.55)')
  g.fillStyle = grd
  g.beginPath()
  g.moveTo(s / 2 - 3.5, s)
  g.lineTo(s / 2 + 3.5, s)
  g.lineTo(s / 2 + 1.2, s / 2)
  g.lineTo(s / 2 - 1.2, s / 2)
  g.closePath()
  g.fill()
  // 船身（尖头朝上 = 航向）
  g.fillStyle = '#ffffff'
  g.strokeStyle = 'rgba(0,0,0,0.35)'
  g.lineWidth = 0.8
  g.beginPath()
  g.moveTo(s / 2, 3)
  g.lineTo(s / 2 + 2.6, s / 2 + 2)
  g.lineTo(s / 2, s / 2 + 4)
  g.lineTo(s / 2 - 2.6, s / 2 + 2)
  g.closePath()
  g.fill()
  g.stroke()
  return g.getImageData(0, 0, s, s)
}

/** 飞机小图标（俯视剪影 + 一点点投影感）。 */
function planeIcon(): ImageData {
  const s = 28
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.translate(s / 2, s / 2)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.strokeStyle = 'rgba(0,0,0,0.3)'
  g.lineWidth = 0.7
  g.beginPath()
  g.moveTo(0, -11)          // 机头
  g.lineTo(1.6, -4)
  g.lineTo(10, 1.5)         // 右翼
  g.lineTo(10, 3.5)
  g.lineTo(1.6, 1)
  g.lineTo(1.4, 7)
  g.lineTo(4.5, 10)         // 右尾翼
  g.lineTo(4.5, 11)
  g.lineTo(0, 9)
  g.lineTo(-4.5, 11)
  g.lineTo(-4.5, 10)
  g.lineTo(-1.4, 7)
  g.lineTo(-1.6, 1)
  g.lineTo(-10, 3.5)
  g.lineTo(-10, 1.5)
  g.lineTo(-1.6, -4)
  g.closePath()
  g.fill()
  g.stroke()
  return g.getImageData(0, 0, s, s)
}

interface Mover {
  kind: 'boat' | 'plane'
  route: Route
  /** 0..1 沿航线的位置 */
  t: number
  /** 每秒推进多少 t */
  dt: number
  bearing: number
}

function bearingOf(a: [number, number], b: [number, number]): number {
  // 屏幕上的朝向就够了（图标朝上为 0°），不需要大地测量精度
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
}

function lengthOf(path: [number, number][]): number {
  let d = 0
  for (let i = 1; i < path.length; i++) {
    d += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  }
  return d
}

export function createAmbientLife(deps: { getMap: () => MaplibreMap | null | undefined }): AmbientLife {
  let timer: ReturnType<typeof setInterval> | null = null
  let movers: Mover[] = []
  let running = false

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  function ensureLayers(map: MaplibreMap): boolean {
    if (!map.isStyleLoaded()) return false
    if (!map.hasImage(IMG_BOAT)) map.addImage(IMG_BOAT, boatIcon())
    if (!map.hasImage(IMG_PLANE)) map.addImage(IMG_PLANE, planeIcon())
    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
    if (!map.getLayer(LAYER)) {
      map.addLayer({
        id: LAYER,
        type: 'symbol',
        source: SRC,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // 固定尺寸。**layout 属性一旦依赖 zoom,运镜每帧都要重算这一层的 symbol
          // 布局**(zoom 每帧都在变) —— 为一艘船付这个钱不值。它是氛围,不是主角。
          'icon-size': 0.7,
        },
        paint: {
          /**
           * 只在**中远景**出现。凑到项目跟前（zoom>15）时,天上飞过一架和楼一样大的
           * 飞机是很荒谬的 —— 而且那时候客户该看的是房子。
           */
          'icon-opacity': [
            'interpolate', ['linear'], ['zoom'],
            8.5, 0,
            10, 0.85,
            14, 0.85,
            15.5, 0,
          ],
        },
      })
    }
    return true
  }

  function build() {
    movers = []
    for (const route of ROUTES) {
      const len = lengthOf(route.path) || 1
      for (let i = 0; i < route.count; i++) {
        movers.push({
          kind: route.kind,
          route,
          // 错开相位,不然同一条航线上的船会叠在一起
          t: (i + 0.17 * (i + 1)) / route.count,
          dt: route.speed / len,
          bearing: bearingOf(route.path[0], route.path[route.path.length - 1]),
        })
      }
    }
  }

  function posAt(route: Route, t: number): [number, number] {
    const p = route.path
    if (p.length === 2) {
      return [p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t]
    }
    const seg = Math.min(p.length - 2, Math.floor(t * (p.length - 1)))
    const local = t * (p.length - 1) - seg
    return [
      p[seg][0] + (p[seg + 1][0] - p[seg][0]) * local,
      p[seg][1] + (p[seg + 1][1] - p[seg][1]) * local,
    ]
  }

  /**
   * 🔴 看不见的时候**一次 setData 都不要发。**
   *
   * `icon-opacity` 在 zoom>15.5 时是 0（凑到项目跟前不该有飞机掠过），但计时器照旧
   * 每 tick 调一次 `setData` —— 而 setData 会让 MapLibre 重建这个 geojson 源、
   * **重跑一次 symbol placement**。placement 是**所有 symbol 图层一起排**的，
   * 于是项目 pin 和地标名字每秒被重排好几次：owner 说的「围着项目转/停留时还在疯狂抖动」
   * 正好落在整段 zoom 15~16 的项目环节上，而这段时间它一帧都不该干活。
   */
  const VISIBLE_MAX_ZOOM = 15.5

  function tick() {
    const map = deps.getMap()
    if (!map || !running) return
    if (map.getZoom() > VISIBLE_MAX_ZOOM) return // 完全透明 → 不重建源，不触发重排
    if (!ensureLayers(map)) return

    const dtSec = TICK_MS / 1000
    const features = movers.map((m) => {
      m.t += m.dt * dtSec
      if (m.t > 1) m.t -= 1 // 循环:开出画面就从头再来
      const c = posAt(m.route, m.t)
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: c },
        properties: {
          icon: m.kind === 'boat' ? IMG_BOAT : IMG_PLANE,
          bearing: m.bearing,
        },
      }
    })

    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'FeatureCollection', features })
  }

  return {
    start() {
      if (running || reduced) return   // 用户要求减少动效 → 干脆不启动
      running = true
      build()
      tick()
      timer = setInterval(tick, TICK_MS)
    },
    stop() {
      running = false
      if (timer) { clearInterval(timer); timer = null }
      const map = deps.getMap()
      if (!map) return
      try {
        if (map.getLayer(LAYER)) map.removeLayer(LAYER)
        if (map.getSource(SRC)) map.removeSource(SRC)
      } catch { /* style 已经换掉了 —— 无所谓,图层跟着没了 */ }
    },
  }
}
