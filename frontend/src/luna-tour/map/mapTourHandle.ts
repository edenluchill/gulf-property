/**
 * Luna Tour — shared cinematic camera/overlay handle.
 *
 * `createMapTourHandle` turns ANY maplibre-gl map instance into something the
 * TimelineEngine can drive frame-by-frame. Used by:
 *   • the main search map (MapViewMapLibre) — so the tour runs ON the real map
 *     with all its live data layers (§ user request: 统一主地图)
 *   • the standalone demo TourMap (fallback)
 *
 * ISOLATION: pure factory, no React. Adds only `lt-` prefixed sources/layers/
 * markers so it never collides with the host map's own layers. clearOverlays()
 * removes exactly what it added. Delete the luna-tour directory to remove.
 */
import maplibregl, { Map as MaplibreMap, Marker } from 'maplibre-gl'
import type { LngLat } from '../types'
import { API_BASE_URL } from '../../lib/config'

export interface DistanceLineOpts {
  from: LngLat
  to: LngLat
  label: string
}
export interface AmenitySpokesOpts {
  center: LngLat
  spokes: { label: string; distance_km: number }[]
  score: number
  tier?: string
}

export interface MapTourHandle {
  /** smooth fly (used by explore-tap + Live answers, NOT the cinematic track) */
  flyTo(o: {
    center?: LngLat
    zoom?: number
    pitch?: number
    bearing?: number
    duration?: number
    easing?: string
  }): Promise<void>
  /** instant set — the engine's single-clock camera track calls this every frame */
  jumpTo(o: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number }): void
  /** 相机现在在哪 —— 引擎用它来接管，而不是**猜**一个起点。
   *  (执行层曾经写死过一个「迪拜市中心」当起点 → 每场 tour 都从 20km 外平移过来。) */
  getCamera(): { center: LngLat; zoom: number; pitch: number; bearing: number } | null
  /** 让相机对准「视觉上的中间」而不是画布中心 —— 上下有字幕/章节条挡着。null 清除。 */
  setViewportPadding(p: { top: number; bottom: number } | null): void
  drawDistanceLine(o: DistanceLineOpts): void
  showAmenitySpokes(o: AmenitySpokesOpts): void
  highlightPins(ids: string[]): void
  /** Draw the tour's property pins as native maplibre markers (thumbnail card +
   *  optional name). Native markers are repositioned by the map's own render loop
   *  (NOT React) → no jitter under the cinematic camera. Pass [] to clear.
   *  Persists across beats (not a per-beat overlay). */
  setPropertyPins(pins: { id: string; coord: LngLat; label?: string; image?: string | null }[]): void
  /** pulse a single focus ring at a coord (current property). null clears it. */
  pulseAt(coord: LngLat | null): void
  /** Re-assert the canonical tour stacking (pins > distance lines/labels > transit
   *  routes > area). Call after the host map toggles transit/measure/amenity (they
   *  mount on top asynchronously). Self-retries briefly to catch the async mount. */
  raiseTourLayers(): void
  clearOverlays(): void
  setStyle(style: 'dark' | 'default'): void
  resize(): void
}

export interface MapTourHandleDeps {
  getMap: () => MaplibreMap | null | undefined
  accent: string
  /** id → [lng,lat], so highlightPins can pulse rings on host-map pins */
  getCoordById?: (id: string) => LngLat | undefined
  /** style URLs for setStyle (host map may differ) */
  darkStyle?: string
  defaultStyle?: string
}

const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
}

/**
 * Canonical bottom→top stacking the tour must keep on the SHARED main map. The
 * host map (MapViewMapLibre) draws distance/amenity lines + labels via its
 * `measure-*` / `amenity-*` layers, and transit routes via `transport-*`. When
 * transit toggles on mid-tour, react-map-gl mounts it on top and covers the
 * distance lines + the GL pins. We fix it deterministically by moving these
 * layers back to the top in order whenever the host stack changes. Layers not
 * present are skipped. (The standalone TourMap has no host measure tool; its own
 * lt-dist / lt-spokes line layers are appended dynamically below.) */
const HOST_DISTANCE_LAYERS = [
  'measure-line-layer',
  'measure-seg-label',
  'measure-points-layer',
  'amenity-lines-layer',
  'amenity-lines-label',
  'amenity-points-layer',
  'amenity-center-label',
  'amenity-poi-label',
  'poi-circles',
  'poi-labels',
]

export function createMapTourHandle(deps: MapTourHandleDeps): MapTourHandle {
  const { getMap, accent } = deps
  let rafId: number | null = null
  const overlayLayerIds: string[] = []
  const labelMarkers: Marker[] = []
  const highlightMarkers = new Map<string, Marker>()
  let pulseMarker: Marker | null = null
  // GL focus ring (replaces the DOM pulse marker — DOM markers jitter under the
  // per-frame jumpTo camera). rAF drives its expanding-ring pulse.
  let pulseRaf: number | null = null
  const FOCUS_SRC = 'lt-focus'
  const PROP_SRC = 'lt-props'
  const PROP_LAYER = 'lt-props-sym'

  const stopPulse = () => {
    if (pulseRaf) {
      cancelAnimationFrame(pulseRaf)
      pulseRaf = null
    }
  }
  const removeFocus = () => {
    stopPulse()
    const map = getMap()
    if (!map) return
    if (map.getLayer('lt-focus-ring')) map.removeLayer('lt-focus-ring')
    if (map.getSource(FOCUS_SRC)) map.removeSource(FOCUS_SRC)
  }

  const cancelRaf = () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  // ---- layer stacking (pins > distance > transit > area), see HOST_DISTANCE_LAYERS ----
  let raiseTimer: number | null = null
  let raiseCoalesce: number | null = null
  /**
   * 🔴 只在顺序**真的不对**的时候才 moveLayer。
   *
   * 每次 moveLayer 都会让 MapLibre 重排整条渲染顺序 + 重新校验 style。而每进一拍,
   * 四个 sink(measure / amenities / transit / areaMetric)各调一次 raiseTourLayers,
   * 每次又自带 6 次重试 —— 一拍里 100+ 次 moveLayer,**全都发生在镜头刚要起飞的那一刻**。
   * 那正是「一开始动就顿一下」的来源。
   *
   * 顺序本来就对(绝大多数情况)→ 一次 moveLayer 都不做。
   */
  const raiseNow = () => {
    const map = getMap()
    if (!map || !map.isStyleLoaded()) return
    // bottom→top: host distance lines, then standalone lt-* lines, focus ring, pins.
    const order = [...HOST_DISTANCE_LAYERS, ...overlayLayerIds, 'lt-focus-ring', PROP_LAYER].filter((id) =>
      map.getLayer(id)
    )
    if (!order.length) return
    const styleIds = map.getStyle()?.layers?.map((l) => l.id) ?? []
    // 我们的层必须(a)按 order 的相对顺序排列,且(b)全部压在最上面。
    const tailStart = styleIds.length - order.length
    const alreadyRight = order.every((id, i) => styleIds[tailStart + i] === id)
    if (alreadyRight) return
    for (const id of order) {
      try {
        map.moveLayer(id)
      } catch {
        /* layer mid-removal — ignore */
      }
    }
  }
  /** Re-assert + briefly retry (host transit/measure layers mount async via
   *  react-map-gl, after the synchronous beat-enter that triggered them).
   *  多个 sink 在同一拍里连着调 → 合并成一次。 */
  const raiseTourLayers = () => {
    if (raiseCoalesce) return
    raiseCoalesce = window.setTimeout(() => {
      raiseCoalesce = null
      raiseNow()
      if (raiseTimer) clearTimeout(raiseTimer)
      let n = 0
      const tick = () => {
        raiseNow()
        if (++n < 3) raiseTimer = window.setTimeout(tick, 120)
        else raiseTimer = null
      }
      raiseTimer = window.setTimeout(tick, 120)
    }, 0)
  }

  function flyTo(o: {
    center?: LngLat
    zoom?: number
    pitch?: number
    bearing?: number
    duration?: number
    easing?: string
  }): Promise<void> {
    const map = getMap()
    if (!map) return Promise.resolve()
    cancelRaf()
    return new Promise((resolve) => {
      const done = () => resolve()
      map.once('moveend', done)
      map.flyTo({
        center: o.center,
        zoom: o.zoom,
        pitch: o.pitch,
        bearing: o.bearing,
        duration: o.duration ?? 2000,
        curve: 1.6,
        easing: EASINGS[o.easing ?? 'easeInOut'] ?? EASINGS.easeInOut,
        essential: true,
      })
      window.setTimeout(done, (o.duration ?? 2000) + 400)
    })
  }

  // NOTE: the cinematic camera (orbit/flyover/keyframes) is no longer driven here.
  // It's compiled into a pure track (engine/cameraTrack.ts) that the engine's
  // single clock samples every frame via jumpTo() — so pause freezes the camera
  // in lock-step with audio + overlays. This handle only exposes flyTo (explore /
  // Live answers) + jumpTo (the per-frame track apply).

  function jumpTo(o: { center?: LngLat; zoom?: number; pitch?: number; bearing?: number }) {
    const map = getMap()
    if (!map) return
    cancelRaf()
    map.jumpTo({
      center: o.center ?? map.getCenter(),
      zoom: o.zoom ?? map.getZoom(),
      pitch: o.pitch ?? map.getPitch(),
      bearing: o.bearing ?? map.getBearing(),
    })
  }

  /** 相机现在在哪。引擎接管时读它,而不是猜一个起点。 */
  function getCamera() {
    const map = getMap()
    if (!map) return null
    const c = map.getCenter()
    return {
      center: [c.lng, c.lat] as LngLat,
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    }
  }

  /**
   * 🔴 「要集中中间屏幕能看到重要信息」(owner)。
   *
   * 相机把目标放在**画布**正中,但画布的正中在手机上被挡住了:上面是章节条,
   * 下面是字幕 + 卡片。于是 Luna 正在介绍的那栋楼,恰好躺在字幕底下。
   *
   * MapLibre 的 `padding` 就是干这个的:它把「相机对准的那个点」移到**留白之后的
   * 那块可见区域的中心**。设一次,之后所有 jumpTo 自动沿用(jumpTo 不带 padding
   * 时不会覆盖它)。这比每个机位手算一个偏移可靠得多。
   */
  function setViewportPadding(p: { top: number; bottom: number } | null) {
    const map = getMap()
    if (!map) return
    try {
      map.setPadding(p ? { top: p.top, bottom: p.bottom, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 })
    } catch {
      /* 老引擎没有 setPadding —— 构图退化成画布居中,不影响可用性 */
    }
  }

  function drawDistanceLine(o: DistanceLineOpts) {
    const map = getMap()
    if (!map || !map.isStyleLoaded()) return
    const id = `lt-dist-${Math.abs(hashStr(o.label + o.to.join(',')))}`
    if (map.getSource(id)) return
    const full: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [o.from, o.to] },
    }
    map.addSource(id, { type: 'geojson', data: lineSlice(full, 0) })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': accent, 'line-width': 3, 'line-opacity': 0.9, 'line-blur': 1.5 },
    })
    overlayLayerIds.push(id)
    raiseNow()
    const start = performance.now()
    const dur = 900
    const animate = (now: number) => {
      const p = Math.min(1, (now - start) / dur)
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined
      if (!src) return
      src.setData(lineSlice(full, EASINGS.easeOut(p)))
      if (p < 1) requestAnimationFrame(animate)
      else addLabelPin(map, o.to, o.label)
    }
    requestAnimationFrame(animate)
  }

  function showAmenitySpokes(o: AmenitySpokesOpts) {
    const map = getMap()
    if (!map || !map.isStyleLoaded()) return
    const spokes = o.spokes.length ? o.spokes : []
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = spokes.map((s, i) => {
      const angle = (i / Math.max(1, spokes.length)) * Math.PI * 2
      const km = Math.max(0.3, s.distance_km)
      const end: LngLat = [
        o.center[0] + (km / (111 * Math.cos((o.center[1] * Math.PI) / 180))) * Math.sin(angle),
        o.center[1] + (km / 111) * Math.cos(angle),
      ]
      return {
        type: 'Feature',
        properties: { label: s.label },
        geometry: { type: 'LineString', coordinates: [o.center, end] },
      }
    })
    const id = `lt-spokes-${Math.abs(hashStr(o.center.join(',')))}`
    if (map.getSource(id)) return
    map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features } })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      paint: { 'line-color': accent, 'line-width': 2, 'line-opacity': 0.7, 'line-blur': 1 },
    })
    overlayLayerIds.push(id)
    raiseNow()
    const el = document.createElement('div')
    el.className = 'lt-score-chip'
    el.style.setProperty('--lt-accent', accent)
    el.innerHTML = `<b>${o.score}</b><span>${o.tier ?? ''}</span>`
    labelMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(o.center).addTo(map))
  }

  // No-op: all tour pins are already drawn as a non-jittering GL layer via
  // setPropertyPins(). (Kept for API/overlay compatibility — the old DOM-marker
  // version jittered under the per-frame camera.)
  function highlightPins(_ids: string[]) {
    /* intentionally empty — see setPropertyPins */
  }

  /**
   * GL focus ring at the current property. A circle layer (renders in the same
   * GL frame as the camera → zero jitter) with an rAF-driven expanding pulse.
   */
  function pulseAt(coord: LngLat | null) {
    const map = getMap()
    removeFocus()
    if (!map || !coord) return
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => pulseAt(coord))
      return
    }
    map.addSource(FOCUS_SRC, {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coord } },
    })
    map.addLayer({
      id: 'lt-focus-ring',
      type: 'circle',
      source: FOCUS_SRC,
      paint: {
        'circle-radius': 12,
        'circle-color': accent,
        'circle-opacity': 0.18,
        'circle-stroke-color': accent,
        'circle-stroke-width': 2.5,
        'circle-stroke-opacity': 0.9,
      },
    })
    raiseNow()
    const start = performance.now()
    /**
     * 🔴 脉冲圈 **12Hz,不是 60Hz**。
     *
     * `setPaintProperty` 不是「写个数字」——它会让 MapLibre 重建这一层的 paint 绑定、
     * 重新求值、再排一次重绘。每帧两次 × 60fps,就是白白挤在运镜帧里的一份开销,
     * 而这是一个 1.7 秒一轮的呼吸动画:12Hz 肉眼完全看不出差别。
     */
    let lastPulse = 0
    const tick = () => {
      const m = getMap()
      if (!m || !m.getLayer('lt-focus-ring')) {
        pulseRaf = null
        return
      }
      const now = performance.now()
      if (now - lastPulse >= 80) {
        lastPulse = now
        const t = ((now - start) % 1700) / 1700
        m.setPaintProperty('lt-focus-ring', 'circle-radius', 10 + t * 30)
        m.setPaintProperty('lt-focus-ring', 'circle-stroke-opacity', 0.9 * (1 - t))
      }
      pulseRaf = requestAnimationFrame(tick)
    }
    pulseRaf = requestAnimationFrame(tick)
  }

  /**
   * Tour property pins as a GL SYMBOL layer. The pin (thumbnail card + optional
   * name + stem) is pre-composed into a canvas image and added via map.addImage,
   * then drawn by a symbol layer — so it renders in the SAME GL frame as the
   * camera and CANNOT jitter (DOM markers, native or react, always lag the
   * per-frame jumpTo). Thumbnails load through the CORS image proxy so the canvas
   * isn't tainted. Persists across beats; clearOverlays does NOT remove it.
   */
  async function setPropertyPins(pins: { id: string; coord: LngLat; label?: string; image?: string | null }[]) {
    const map = getMap()
    if (!map) return
    if (!map.isStyleLoaded()) {
      map.once('styledata', () => void setPropertyPins(pins))
      return
    }
    if (!pins.length) {
      if (map.getLayer(PROP_LAYER)) map.removeLayer(PROP_LAYER)
      if (map.getSource(PROP_SRC)) map.removeSource(PROP_SRC)
      return
    }
    // build a canvas icon per pin (async: thumbnails load via the proxy)
    await Promise.all(
      pins.map(async (p) => {
        const iconId = `lt-pin-${p.id}`
        if (map.hasImage(iconId)) return
        const icon = await buildPinIcon(p.label, p.image ?? null, accent)
        if (icon && !map.hasImage(iconId)) map.addImage(iconId, icon, { pixelRatio: 2 })
      })
    )
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: pins.map((p) => ({
        type: 'Feature',
        properties: { icon: `lt-pin-${p.id}` },
        geometry: { type: 'Point', coordinates: p.coord },
      })),
    }
    const src = map.getSource(PROP_SRC) as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData(fc)
      raiseNow()
      return
    }
    map.addSource(PROP_SRC, { type: 'geojson', data: fc })
    map.addLayer({
      id: PROP_LAYER,
      type: 'symbol',
      source: PROP_SRC,
      layout: {
        'icon-image': ['get', 'icon'],
        /**
         * 🔴 **不带 zoom 插值。**
         *
         * `icon-size` 是 layout 属性:一旦它依赖 zoom,而运镜每一帧 zoom 都在变,
         * MapLibre 就得每帧重算这一层的 symbol 布局(placement)。图标本身还会跟着
         * 逐帧微缩放 —— 于是在移动的地图上,卡片自己在**抖**。
         * 固定尺寸:一帧布局都不用重算,卡片稳如钉在地上。
         */
        'icon-size': 0.85,
        'icon-anchor': 'bottom',
        // 项目 pin **永远画出来**(allow-overlap),但它**占位**(ignore-placement:false)——
        // 于是地标名字会自己让开,不会再糊在客户要看的那张房子卡片上。
        'icon-allow-overlap': true,
        'icon-ignore-placement': false,
        // 先排 pin,再排别人(数字越小越优先)。
        'symbol-sort-key': 0,
      },
    })
    raiseNow()
  }

  function addLabelPin(map: MaplibreMap, at: LngLat, label: string) {
    const el = document.createElement('div')
    el.className = 'lt-dist-label'
    el.style.setProperty('--lt-accent', accent)
    el.textContent = label
    labelMarkers.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(at).addTo(map))
  }

  function clearOverlays() {
    const map = getMap()
    if (map) {
      overlayLayerIds.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(id)) map.removeSource(id)
      })
    }
    overlayLayerIds.length = 0
    labelMarkers.forEach((m) => m.remove())
    labelMarkers.length = 0
    highlightMarkers.forEach((m) => m.remove())
    highlightMarkers.clear()
    if (pulseMarker) {
      pulseMarker.remove()
      pulseMarker = null
    }
    removeFocus()
    // NOTE: property pins (PROP_SRC) persist across beats — cleared via
    // setPropertyPins([]) on tour teardown, not here (this runs every beat).
  }

  function setStyle(style: 'dark' | 'default') {
    const map = getMap()
    if (!map) return
    const url = style === 'dark' ? deps.darkStyle : deps.defaultStyle
    if (url) map.setStyle(url)
  }

  function resize() {
    getMap()?.resize()
  }

  return {
    flyTo,
    jumpTo,
    getCamera,
    setViewportPadding,
    drawDistanceLine,
    showAmenitySpokes,
    highlightPins,
    setPropertyPins,
    pulseAt,
    raiseTourLayers,
    clearOverlays,
    setStyle,
    resize,
  }
}

function loadImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Compose a property pin (thumbnail card + optional name + stem) into ImageData
 *  for map.addImage. Thumbnails load through the CORS proxy so canvas isn't tainted. */
async function buildPinIcon(
  label: string | undefined,
  imageUrl: string | null,
  accent: string
): Promise<ImageData | null> {
  if (typeof document === 'undefined') return null
  const proxied = imageUrl ? `${API_BASE_URL}/api/luna/public/img?u=${encodeURIComponent(imageUrl)}` : null
  const img = proxied ? await loadImg(proxied) : null

  const S = 2 // supersample → addImage pixelRatio 2
  const FONT = '700 13px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
  const card = 60
  const border = 3
  const stemH = 9
  const gap = 5
  const nameH = label ? 22 : 0

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) return null
  measure.font = FONT
  let name = label ?? ''
  if (name.length > 16) name = name.slice(0, 15) + '…'
  const namePillW = label ? Math.ceil(measure.measureText(name).width) + 18 : 0

  const W = Math.max(card, namePillW)
  const H = nameH + (label ? gap : 0) + card + stemH
  const cardY = nameH + (label ? gap : 0)
  const cx = W / 2
  const cardX = cx - card / 2

  const cnv = document.createElement('canvas')
  cnv.width = Math.ceil(W * S)
  cnv.height = Math.ceil(H * S)
  const ctx = cnv.getContext('2d')
  if (!ctx) return null
  ctx.scale(S, S)

  // name pill
  if (label) {
    ctx.fillStyle = 'rgba(5,7,13,0.82)'
    roundRect(ctx, cx - namePillW / 2, 0, namePillW, nameH, 8)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = FONT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, cx, nameH / 2 + 1)
  }

  // card shadow + base
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#0b0e16'
  roundRect(ctx, cardX, cardY, card, card, 13)
  ctx.fill()
  ctx.restore()

  // thumbnail (cover) or placeholder
  ctx.save()
  roundRect(ctx, cardX, cardY, card, card, 13)
  ctx.clip()
  if (img && img.width && img.height) {
    const ar = img.width / img.height
    let dw = card,
      dh = card,
      dx = cardX,
      dy = cardY
    if (ar > 1) {
      dw = card * ar
      dx = cardX - (dw - card) / 2
    } else {
      dh = card / ar
      dy = cardY - (dh - card) / 2
    }
    ctx.drawImage(img, dx, dy, dw, dh)
  } else {
    ctx.fillStyle = '#11151f'
    ctx.fillRect(cardX, cardY, card, card)
    ctx.fillStyle = '#9fb3c8'
    ctx.font = '26px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('🏢', cx, cardY + card / 2)
  }
  ctx.restore()

  // accent border
  ctx.strokeStyle = accent
  ctx.lineWidth = border
  roundRect(ctx, cardX + border / 2, cardY + border / 2, card - border, card - border, 12)
  ctx.stroke()

  // stem
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.moveTo(cx - 6, cardY + card - 1)
  ctx.lineTo(cx + 6, cardY + card - 1)
  ctx.lineTo(cx, cardY + card + stemH)
  ctx.closePath()
  ctx.fill()

  return ctx.getImageData(0, 0, cnv.width, cnv.height)
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i)
  return h | 0
}

function lineSlice(
  full: GeoJSON.Feature<GeoJSON.LineString>,
  t: number
): GeoJSON.Feature<GeoJSON.LineString> {
  const [a, b] = full.geometry.coordinates
  const lng = a[0] + (b[0] - a[0]) * t
  const lat = a[1] + (b[1] - a[1]) * t
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [a, [lng, lat]] },
  }
}
