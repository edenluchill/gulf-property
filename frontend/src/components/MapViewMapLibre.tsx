/**
 * MapLibre GL JS 地图组件 - 简洁高效版
 */

import { useState, useRef, useMemo, useCallback, memo, useEffect, forwardRef, useImperativeHandle } from 'react'
import Map, {
  Source,
  Layer,
  MapRef
} from 'react-map-gl/maplibre'
import { type MapLayerMouseEvent, type Map as MaplibreMap, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import { Globe, Ruler, X, Box, Eye, EyeOff } from 'lucide-react'
import { DubaiArea, DubaiLandmark } from '../types'
import { Poi } from '../hooks/useDubaiPois'
import { MapPinProject, TransportGeoJSON } from '../lib/api'
import { lat2tileY, haversineKm } from '../lib/map/tiles'
import {
  type AreaMetric,
  getCentroid, getPolygonSpan, getMinZoomForRank,
  formatMetricValue, getMetricRawValue, calculatePercentiles, getHeatmapColor
} from '../lib/map/metrics'
import { CATEGORY_CONFIG, DEFAULT_CATEGORY_CONFIG, addCustomIcons } from '../lib/map/icons'
import { ProjectCardMarker, LandmarkMarker } from './map/MapMarkers'
// Luna Tour cinematic handle (isolated; lets the tour drive THIS map). Delete
// the import + useImperativeHandle below + luna-tour/ to remove.
import { createMapTourHandle, type MapTourHandle } from '../luna-tour/map/mapTourHandle'

// Re-export so existing importers (MapPage) keep working unchanged.
export type { AreaMetric } from '../lib/map/metrics'

// CARTO 无标签风格：选中指标时用，画热力图干净不被街道名干扰
const MAP_STYLE_CLEAN = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
// CARTO 带标签风格：未选指标时用，显示街道/地名等细节方便探索
const MAP_STYLE_LABELED = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
// CARTO 夜景风格：电影沉浸底图（与 Luna Tour demo 同款 dark-matter）。
// 数据图层（热力/POI/区域/交通）叠加其上不变；只是底图变深色。
const MAP_STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

// 卫星底图风格 = Esri World Imagery(免费、无 key)。
// 迪拜实测:Esri 对迪拜通常比 MapTiler satellite-v2 的全球拼接图更新(后者部分区域
// 落后好几年,看着像"多年前的空地")。Esri 免费无 key、迪拜市区约 2–3 年内,取舍上
// 新鲜度 > 高DPI锐度(256 瓦片在高分屏略软,可接受)。任何免费源对迪拜都会滞后 1–3 年,
// 真·当月最新只有付费 Maxar/Airbus。
const SATELLITE_SOURCE = {
  type: 'raster' as const,
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  maxzoom: 19,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics'
}

// glyphs 指向免费字体服务，保证切换后 area/指标 的文字标签仍能渲染。
const SATELLITE_STYLE = {
  version: 8 as const,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: { 'satellite-tiles': SATELLITE_SOURCE },
  layers: [
    { id: 'sat-bg', type: 'background' as const, paint: { 'background-color': '#0b1722' } },
    { id: 'satellite', type: 'raster' as const, source: 'satellite-tiles' }
  ]
}

type BaseMap = 'vector' | 'satellite' | 'dark'

// Initial camera. The map runs UNCONTROLLED (initialViewState only) — we never
// mirror the view into React state, so panning/zooming triggers no component
// re-render. Camera reads happen imperatively via mapRef.getMap(); programmatic
// moves go through map.flyTo. (Per the project's own map perf rule.)
const INITIAL_VIEW = { longitude: 55.089, latitude: 25.019, zoom: 10.115216007819594, pitch: 0, bearing: 0 }

// ============================================================================
// Main Component
// ============================================================================

// Transport station info for click handling
export interface TransportStation {
  id: string
  name: string
  nameAr?: string
  category: 'metro_stations' | 'tram_stations' | 'monorail_stations'
  color: string
  lng: number
  lat: number
  line?: string
  network?: string
  operator?: string
}

interface MapViewMapLibreProps {
  clusters?: any[]
  projects?: MapPinProject[]
  /** Project IDs to pulse on the map (so the customer sees which one Luna means). */
  flashProjectIds?: string[]
  onBoundsChange?: (bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, zoom: number) => void
  /** Fired once the map's first frame has settled (idle) — for a load overlay. */
  onReady?: () => void
  /** Fired once with the live maplibre Map instance after load. Used by the
   *  collab co-presence layer to drive the camera imperatively (getMap). Optional
   *  — normal callers don't pass it; behaviour is identical when omitted. */
  onMapReady?: (map: MaplibreMap) => void
  onClusterClick?: (cluster: any) => void
  onProjectClick?: (project: MapPinProject) => void
  onAreaClick?: (area: DubaiArea) => void
  onPoiClick?: (poi: Poi) => void
  onStationClick?: (station: TransportStation) => void
  onLandmarkClick?: (landmark: DubaiLandmark) => void
  areaMetric?: AreaMetric
  dubaiAreas?: DubaiArea[]
  dubaiLandmarks?: DubaiLandmark[]
  pois?: Poi[]
  showDubaiLayer?: boolean
  showPois?: boolean
  flyToLocation?: { lat: number; lng: number; zoom?: number; bounds?: [[number, number], [number, number]] } | null
  transportGeoJSON?: TransportGeoJSON | null
  showTransport?: boolean
  /** 由语音助手/导览触发的测距：传入点序列即进入测距模式并画线。
   *  noFit=true 时不自动缩放（导览用，避免抢电影运镜的镜头）。 */
  voiceMeasure?: { points: [number, number][]; noFit?: boolean } | null
  /** 测距点变化时回调(collab 同步用):经纪测距 → 广播 → 客户端 voiceMeasure 渲染 */
  onMeasureChange?: (points: [number, number][] | null) => void
  /** 由语音助手触发的「区域配套放射图」：从区域中心向最近配套画连线+距离 */
  voiceAmenities?: {
    center: [number, number]; centerName: string; score: number; tier: string
    spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number }[]
  } | null
  /** Keep the amenity spokes on the map but hide the standalone score panel
   *  (used during the guided tour, where the dock already shows the score). */
  hideAmenityPanel?: boolean
  /** Luna Tour: hide all map UI controls (basemap/3D/measure buttons, panels)
   *  so the tour plays full-screen immersive. The map canvas + pins stay. */
  chromeless?: boolean
  /** Luna Tour: make the map UNCONTROLLED so the imperative cinematic camera
   *  (flyTo/orbit/setBearing) runs smoothly — the controlled viewState would
   *  otherwise lag a frame behind and fight it (teleport/jitter). */
  tourActive?: boolean
  /** Persistent-map support: the map is kept mounted across route changes and
   *  hidden via display:none on non-map routes. When it becomes visible again we
   *  must resize maplibre (a hidden container reports 0×0). Defaults to true so
   *  non-persistent callers are unaffected. */
  visible?: boolean
  /** Collab markup: while a draw/markup tool is active, swallow map feature clicks
   *  so tapping to draw/place a mark doesn't ALSO open a POI/area/project panel
   *  (and so dismissing a panel doesn't re-select the feature underneath). */
  disableFeatureClicks?: boolean
  /** 相机深链:URL ?v= 解析出的初始相机(只在首挂载生效,地图非受控)。 */
  initialView?: { longitude: number; latitude: number; zoom: number; pitch?: number; bearing?: number }
  /** 相机停稳后回调一次(与 onBoundsChange 同一个 150ms debounce,不新增高频
   *  路径)。MapPage 用它把相机写进 URL(history.replaceState,零重渲染)。 */
  onCameraIdle?: (cam: { lng: number; lat: number; zoom: number; pitch: number; bearing: number }) => void
}

function MapViewMapLibre({
  projects = [],
  flashProjectIds,
  onBoundsChange,
  onReady,
  onMapReady,
  onProjectClick,
  onAreaClick,
  onPoiClick,
  onStationClick,
  onLandmarkClick,
  areaMetric = 'none',
  dubaiAreas = [],
  dubaiLandmarks = [],
  pois = [],
  showDubaiLayer = false,
  showPois = false,
  flyToLocation = null,
  transportGeoJSON = null,
  showTransport = false,
  voiceMeasure = null,
  onMeasureChange,
  voiceAmenities = null,
  hideAmenityPanel = false,
  chromeless = false,
  tourActive = false,
  visible = true,
  disableFeatureClicks = false,
  initialView,
  onCameraIdle
}: MapViewMapLibreProps, ref: React.Ref<MapTourHandle>) {
  const { i18n } = useTranslation()
  // 地图自有控件的双语文案(原来中文硬编码,英文界面也显示中文——2026-07-08 修)
  const isZhUi = (i18n.language || 'en').startsWith('zh')
  const mapRef = useRef<MapRef>(null)

  // Persistent map: when the container un-hides (display:none → shown), maplibre
  // still thinks it's 0×0 until told otherwise. Resize on the next frame (after
  // layout) so the map fills the box without a blank/letterboxed flash.
  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(id)
  }, [visible])

  const [mapLoaded, setMapLoaded] = useState(false)
  // True while the map is actively ZOOMING / rotating / pitching. We hide the DOM
  // marker layer (pins/clusters/landmarks) during those gestures only: each marker
  // is a composited layer over the WebGL canvas, and re-rasterizing dozens of them
  // as the map RE-SCALES forces a GPU read-back path that froze zoom to ~1fps on
  // real GPUs (proven by headed CPU profiling). A plain pan (drag) just translates
  // the layers — cheap — so markers stay visible while dragging. They reappear
  // ~180ms after the camera settles.
  const [mapMoving, setMapMoving] = useState(false)
  const moveShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [baseMap, setBaseMapState] = useState<BaseMap>(
    () => ((localStorage.getItem('map-base') as BaseMap) || 'satellite')
  )
  const setBaseMap = (v: BaseMap | ((p: BaseMap) => BaseMap)) => {
    setBaseMapState(prev => {
      const next = typeof v === 'function' ? (v as (p: BaseMap) => BaseMap)(prev) : v
      try { localStorage.setItem('map-base', next) } catch { /* ignore */ }
      return next
    })
  }

  // 卡片显示开关(右侧工具卡里切换,持久化)。关掉后地图只剩圆点,更清爽;
  // 点圆点仍能弹出单张卡。默认开。
  const [showCards, setShowCardsState] = useState<boolean>(
    () => localStorage.getItem('map-cards') !== '0'
  )
  const toggleShowCards = () => {
    setShowCardsState(prev => {
      const next = !prev
      try { localStorage.setItem('map-cards', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }
  const [measureMode, setMeasureMode] = useState(false)
  const [measurePoints, setMeasurePoints] = useState<{ lng: number; lat: number }[]>([])

  // 放射模式:第 0 个点=中心,其余每点到中心各一段
  const measureSpokeKms = useMemo(() => {
    if (measurePoints.length < 2) return [] as number[]
    const hub = measurePoints[0]
    return measurePoints.slice(1).map(p => haversineKm(hub, p))
  }, [measurePoints])

  const measureGeoJson = useMemo(() => {
    const fmt = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`)
    if (measurePoints.length === 0) {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      return { segments: empty, points: empty }
    }
    const hub = measurePoints[0]
    // 中心 → 每个目标点,各一条带距离标签的 LineString(放射状)
    const segments = {
      type: 'FeatureCollection' as const,
      features: measurePoints.slice(1).map(p => ({
        type: 'Feature' as const,
        properties: { label: fmt(haversineKm(hub, p)) },
        geometry: { type: 'LineString' as const, coordinates: [[hub.lng, hub.lat], [p.lng, p.lat]] }
      }))
    }
    return {
      segments,
      points: {
        type: 'FeatureCollection' as const,
        features: measurePoints.map((p, i) => ({
          type: 'Feature' as const,
          properties: { kind: i === 0 ? 'hub' : 'spoke' },
          geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] }
        }))
      }
    }
  }, [measurePoints])

  const exitMeasure = useCallback(() => {
    setMeasureMode(false)
    setMeasurePoints([])
  }, [])

  // Surface measure points so collab can broadcast them (presenter) / a viewer can
  // mirror them. Ref-held callback so this effect only depends on the points.
  const onMeasureChangeRef = useRef(onMeasureChange)
  onMeasureChangeRef.current = onMeasureChange
  // Points written programmatically from `voiceMeasure` (Luna voice OR a peer's
  // mirrored ruler arriving over collab) must NOT be re-broadcast — otherwise two
  // broadcasting nodes in one room (e.g. the `?host=` URL opened as presenter in a
  // second tab) ping-pong the same points forever: the ruler flickers wildly and
  // refuses to exit. Only LOCAL user edits (map clicks / clear / exit) are emitted.
  const measureFromExternalRef = useRef(false)
  useEffect(() => {
    if (measureFromExternalRef.current) { measureFromExternalRef.current = false; return }
    onMeasureChangeRef.current?.(measurePoints.length ? measurePoints.map((p) => [p.lng, p.lat] as [number, number]) : null)
  }, [measurePoints])

  // 测距模式：Esc 退出并清空
  useEffect(() => {
    if (!measureMode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitMeasure() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [measureMode, exitMeasure])

  // 测距模式：地图光标改为十字
  useEffect(() => {
    const canvas = mapRef.current?.getMap()?.getCanvas()
    if (canvas) canvas.style.cursor = measureMode ? 'crosshair' : ''
  }, [measureMode, mapLoaded])

  // 语音助手/导览触发测距：进入测距模式、落点、(可选)自动缩放到这些点
  useEffect(() => {
    if (!voiceMeasure || !voiceMeasure.points?.length) {
      // 清空：退出测距模式并移除连线（导览结束/语音清除时调用）
      measureFromExternalRef.current = true
      setMeasureMode(false)
      setMeasurePoints([])
      return
    }
    const pts = voiceMeasure.points.map(([lng, lat]) => ({ lng, lat }))
    measureFromExternalRef.current = true
    setMeasureMode(true)
    setMeasurePoints(pts)
    const map = mapRef.current?.getMap()
    if (map && mapLoaded && pts.length >= 2 && !voiceMeasure.noFit) {
      const lngs = pts.map(p => p.lng)
      const lats = pts.map(p => p.lat)
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 120, maxZoom: 13, duration: 1500 }
      )
    }
  }, [voiceMeasure, mapLoaded])

  // 语音助手「配套放射图」：每来一份新数据就重新显示面板
  const [amenityClosed, setAmenityClosed] = useState(false)
  useEffect(() => { setAmenityClosed(false) }, [voiceAmenities])
  const amenityGeoJson = useMemo(() => {
    if (!voiceAmenities) return { lines: null, points: null }
    const [clng, clat] = voiceAmenities.center
    return {
      lines: {
        type: 'FeatureCollection' as const,
        features: voiceAmenities.spokes.map(s => ({
          type: 'Feature' as const,
          properties: { label: `${s.label} ${s.distanceKm}km` },
          geometry: { type: 'LineString' as const, coordinates: [[clng, clat], [s.lng, s.lat]] }
        }))
      },
      points: {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { kind: 'center', label: voiceAmenities.centerName },
            geometry: { type: 'Point' as const, coordinates: [clng, clat] }
          },
          ...voiceAmenities.spokes.map(s => ({
            type: 'Feature' as const,
            // name = the REAL nearby POI (e.g. "Canadian University Dubai"), so the
            // line clearly lands on a real place, not seemingly-empty land.
            properties: { kind: 'amenity', label: `${s.label} ${s.distanceKm}km`, name: s.name },
            geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] }
          }))
        ]
      }
    }
  }, [voiceAmenities])
  const showAmenities = !!voiceAmenities && !amenityClosed

  // hover 的区域走独立 hover 图层 + setFilter(命令式,只重算那一层),
  // 不进 React state —— 见 area-fills Layer 上的注释。
  const hoverAreaRef = useRef<string | number | null>(null)
  const boundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 圆点 hover 名字提示:单个小 DOM 元素命令式定位/显隐(mousemove 每次只写
  // 这一个元素的 style/text,与指北针同款范式,零 React 重渲染)。
  const dotTipRef = useRef<HTMLDivElement>(null)
  // 该项目的卡片已经在屏上时不出提示(名字重复)——recomputeCards 的结果
  // 存一份 ref 供高频 mousemove 读,不订阅 state。
  const visibleCardIdsRef = useRef<string[]>([])


  // 3D 倾斜视角：独立于底图(地图/卫星/夜景都可用)。开启后相机俯角看,
  // 配合电影 flyTo 俯冲。pitchedRef 供 flyTo effect 读取(避免把 pitched 放进
  // effect deps 而触发重复飞行)。
  const CINEMATIC_PITCH = 60
  // (指北针已并入左上筛选卡,见 MapCompassButton)
  // 旧注释保留下面这段是为了说明范式:高频相机值一律走命令式 DOM,不进 state。
  // 铁律「高频相机值禁入 React state」)。单个小合成层元素的 transform 写入
  // 零 layout 零 React 重渲染,2D/3D 通用。
  // 深链恢复的相机自带俯角时,3D 按钮状态要对得上(否则显示"3D"实际已倾斜)
  const [pitched, setPitched] = useState(() => (initialView?.pitch ?? 0) >= 30)
  const pitchedRef = useRef((initialView?.pitch ?? 0) >= 30)
  const toggle3D = () => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const next = !pitched
    setPitched(next)
    pitchedRef.current = next
    map.easeTo({ pitch: next ? CINEMATIC_PITCH : 0, duration: 700, essential: true })
  }

  // Expose a cinematic handle so the Luna Tour engine can drive THIS map
  // (camera + lt- overlays). Stable across renders; closes over mapRef.
  useImperativeHandle(
    ref,
    () =>
      createMapTourHandle({
        getMap: () => mapRef.current?.getMap(),
        accent: '#00E0B8',
        darkStyle: MAP_STYLE_DARK,
        defaultStyle: MAP_STYLE_LABELED,
      }),
    []
  )

  // Fly to location or fitBounds when flyToLocation changes
  useEffect(() => {
    if (!flyToLocation || !mapRef.current || !mapLoaded) return

    const map = mapRef.current.getMap()
    if (!map) return

    if (flyToLocation.bounds) {
      // fitBounds for multi-point results
      map.fitBounds(flyToLocation.bounds, {
        padding: { top: 80, bottom: 120, left: 40, right: 80 },
        maxZoom: 13,
        duration: 2000
      })
    } else {
      // 3D 开启时来一段带俯角的电影俯冲;平视时维持原行为
      const dive = pitchedRef.current
      map.flyTo({
        center: [flyToLocation.lng, flyToLocation.lat],
        zoom: flyToLocation.zoom ?? 11,
        pitch: dive ? CINEMATIC_PITCH : 0,
        duration: dive ? 2400 : 2000,
        curve: dive ? 2.0 : 1.8,
        essential: true
      })
    }
  }, [flyToLocation, mapLoaded])

  // 地图加载完成后再渲染 layers
  const handleMapLoad = useCallback(async () => {
    const map = mapRef.current?.getMap()
    if (!map) return

    /**
     * 调试钩子 —— 让自动化脚本能读到相机(frontend/scripts/_*.mjs)。
     *
     * owner:「你要设计得能你自己跑 来测试和优化」。没有这个,我就只能靠肉眼猜
     * 「地图为什么在开场平移」—— 而猜是错的来源。只读引用,不改任何行为。
     */
    ;(window as unknown as { __pinzosMap?: unknown }).__pinzosMap = map

    await addCustomIcons(map)

    // 底图切换后 style 重建，重新注入自定义图标
    map.on('style.load', () => { addCustomIcons(map) })

    // 🔴 天空 + 大气雾 —— **地平线永远不能裸露**。
    //
    // Luna Tour 的开场是高空俯瞰(pitch 高、zoom 远),而 MapLibre 默认不画天空:
    // 地图就是一块**悬在黑色虚空里的、边缘呈锯齿状的平面**(瓦片没加载完的地方直接是洞)。
    // 那一眼就把整个产品出卖了 —— 它看起来像个没做完的 demo。
    // 加了 sky 之后地图与天空自然衔接,锯齿边被雾吃掉。
    // ⚠️ MapLibre v5 里天空是**style 属性(map.setSky)**,不是图层。
    //    我一开始写成了 addLayer({ type: 'sky' }) —— MapLibre 每次加载都吐两条
    //    console error（"layers.lt-sky.type: expected one of [fill, line, …]"）,
    //    而且**天空压根没画出来**:我以为修好了的锯齿地平线,其实一次都没生效过。
    const ensureSky = () => {
      try {
        map.setSky({
          'sky-color': '#0d1b2a',
          'sky-horizon-blend': 0.6,
          'horizon-color': '#2a4a5e',
          'horizon-fog-blend': 0.7,
          'fog-color': '#1a2c3a',
          'fog-ground-blend': 0.35,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 10, 0.5, 14, 0],
        })
      } catch { /* 不支持就算了 —— 不能因为装饰把地图搞挂 */ }
    }
    ensureSky()
    map.on('style.load', ensureSky)   // 换底图后 style 重建 → 天空也要重新设

    // Landmark cutouts scale with zoom so they feel painted on the map (not a
    // fixed-size overlay floating above it). Update the CSS var only on ZOOMEND,
    // not every zoom frame: the var is inherited, so writing it to the map
    // container restyles every marker subtree — doing that per frame janked zoom
    // hard (50ms+ frames). A CSS transition on the landmarks smooths the resize
    // once the zoom settles. Gentle + clamped (shrink on zoom-out without
    // vanishing, don't dominate on zoom-in).
    const updateLandmarkScale = () => {
      const s = Math.min(2.2, Math.max(0.5, Math.pow(1.4, map.getZoom() - 12)))
      map.getContainer().style.setProperty('--lm-scale', s.toFixed(3))
    }
    updateLandmarkScale()
    // jumpTo fires `zoomend` every frame during a tour; rewriting the inherited
    // --lm-scale var each time restyles the whole overlay subtree (jank). The
    // landmarks are a GL layer during a tour, so the var is unused then — only
    // track zoom in normal mode.
    if (!tourActive) map.on('zoomend', updateLandmarkScale)

    // Hide DOM markers only during ZOOM / ROTATE / PITCH — the gestures that
    // re-scale and froze the GPU. NOT on plain pan (drag): translating the marker
    // layers is cheap, so pins/landmarks stay visible while you drag. Reveal a
    // beat after the gesture settles so a multi-step wheel zoom doesn't flicker.
    // Skip in tour mode (few pins; the cinematic camera moves constantly).
    if (!tourActive) {
      const hideMarkers = () => {
        if (moveShowTimerRef.current) clearTimeout(moveShowTimerRef.current)
        setMapMoving(true)
      }
      const revealMarkersSoon = () => {
        if (moveShowTimerRef.current) clearTimeout(moveShowTimerRef.current)
        moveShowTimerRef.current = setTimeout(() => setMapMoving(false), 180)
      }
      map.on('zoomstart', hideMarkers)
      map.on('zoomend', revealMarkersSoon)
      map.on('rotatestart', hideMarkers)
      map.on('rotateend', revealMarkersSoon)
      map.on('pitchstart', hideMarkers)
      map.on('pitchend', revealMarkersSoon)
    }

    // (指北针的相机跟随已搬到 components/MapCompassButton —— 它自己订阅 rotate/pitch,
    //  同样是命令式 DOM transform,不进 React。)

    setMapLoaded(true)

    // DEV-only 调试句柄:perf/hover 自测脚本(scripts/_verify-*.mjs)用它直接
    // 查 feature-state / queryRenderedFeatures,别在生产暴露。
    if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = map

    // Signal "ready" once the first frame has actually settled (tiles + layers),
    // so the parent can fade out the load overlay. Fallback timer guarantees the
    // overlay never sticks even if 'idle' is slow on a flaky network.
    if (onReady) {
      let done = false
      const fire = () => { if (!done) { done = true; onReady() } }
      map.once('idle', fire)
      setTimeout(fire, 3500)
    }

    // 延迟触发 bounds change
    setTimeout(() => {
      if (mapRef.current && onBoundsChange) {
        const bounds = map.getBounds()
        onBoundsChange({
          minLat: bounds.getSouth(),
          minLng: bounds.getWest(),
          maxLat: bounds.getNorth(),
          maxLng: bounds.getEast(),
        }, map.getZoom())
      }
    }, 100)
  }, [onBoundsChange, onReady, tourActive])

  // Hand the live map instance to the collab layer whenever onMapReady becomes
  // available. The map's load handler runs ONCE; if collab attaches afterwards
  // (presenter clicks "开始带看" on an already-loaded map), that one-shot can't
  // fire again — so deliver the instance here on the onMapReady ↦ defined edge.
  useEffect(() => {
    if (!mapLoaded || !onMapReady) return
    const map = mapRef.current?.getMap()
    if (map) onMapReady(map)
  }, [mapLoaded, onMapReady])

  // ─── Tour: landmarks as a GL symbol layer (anti-jitter) ───────────────────
  // During a tour the camera is driven frame-by-frame via jumpTo(). DOM markers
  // (the normal-mode <LandmarkMarker>) are repositioned by react-map-gl one frame
  // LATE, so they jitter under the cinematic camera — and moving ~15 of them per
  // frame drags the framerate (the camera looks shaky, the recording stutters).
  // A symbol layer renders in the SAME GL frame as the camera → zero jitter, zero
  // per-frame DOM work. We mirror the cutout look: icon = /landmarks/<slug>.png,
  // text = localized name. Active only while a tour owns the camera; the normal
  // map keeps the richer DOM cutouts (hover, settled-only, so they never jitter).
  useEffect(() => {
    if (!mapLoaded || !tourActive || !dubaiLandmarks.length) return
    const map = mapRef.current?.getMap()
    if (!map) return
    let cancelled = false
    const SRC = 'host-landmarks'
    const LAYER = 'host-landmarks-sym'
    const addedIcons: string[] = []
    const langKey = i18n.language?.split('-')[0]
    const slugOf = (name: string) =>
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    const build = async () => {
      if (cancelled) return
      if (!map.isStyleLoaded()) { map.once('styledata', build); return }
      const features: GeoJSON.Feature[] = []
      await Promise.all(dubaiLandmarks.map(async lm => {
        const slug = slugOf(lm.name)
        const iconId = `lmk-${slug}`
        let h = 120
        if (!map.hasImage(iconId)) {
          const img = await loadLandmarkImg(`/landmarks/${slug}.png`)
          if (cancelled) return
          if (img) {
            try { map.addImage(iconId, img); addedIcons.push(iconId); h = img.naturalHeight || 120 } catch { /* race */ }
          }
        }
        const hasIcon = map.hasImage(iconId)
        const targetH = lm.size === 'xlarge' ? 132 : lm.size === 'large' ? 66 : lm.size === 'small' ? 44 : 54
        const baseScale = hasIcon && h ? +(targetH / h).toFixed(3) : 0
        const name = (langKey && lm.translations?.[langKey]?.name) || lm.name
        features.push({
          type: 'Feature',
          properties: { icon: hasIcon ? iconId : '', name, baseScale },
          geometry: { type: 'Point', coordinates: [lm.location.lng, lm.location.lat] },
        })
      }))
      if (cancelled) return
      const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
      const existing = map.getSource(SRC) as GeoJSONSource | undefined
      if (existing) { existing.setData(data); return }
      map.addSource(SRC, { type: 'geojson', data })
      map.addLayer({
        id: LAYER,
        type: 'symbol',
        source: SRC,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['get', 'baseScale'],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-optional': true,
          'symbol-z-order': 'viewport-y',
          // Keep names flat & upright under the cinematic orbit (match area labels)
          'text-rotation-alignment': 'viewport',
          'text-pitch-alignment': 'viewport',
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 12],
          'text-anchor': 'top',
          'text-offset': [0, 0.35],
          // Skip the collision pass: MapLibre re-runs symbol placement on every
          // camera rotation, which was a periodic hitch while orbiting a property.
          // Few landmarks, well spread → overlap is rare and smoothness wins.
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-optional': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.4,
        },
      })
    }
    void build()
    return () => {
      cancelled = true
      const m = mapRef.current?.getMap()
      if (m) {
        if (m.getLayer(LAYER)) m.removeLayer(LAYER)
        if (m.getSource(SRC)) m.removeSource(SRC)
        addedIcons.forEach(id => { try { if (m.hasImage(id)) m.removeImage(id) } catch { /* ignore */ } })
      }
    }
  }, [mapLoaded, tourActive, dubaiLandmarks, i18n.language])

  // ─── 项目双层展示(ARO 式) ─────────────────────────────────────────────
  // 真值层:GL 圆点,所有项目任何缩放级别永不消失(WebGL circle layer,零 DOM
  // 零 React,平移缩放随 GL 帧走,天然丝滑)。在售=品牌青,售罄=灰。
  // 信息层:照片卡片(ProjectCardMarker),屏幕空间放得下才显示(下方碰撞检测,
  // moveEnd 150ms debounce 时算一次),点圆点必弹卡,点卡进详情。
  const projectDotsGeoJson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: projects.map(p => ({
      type: 'Feature' as const,
      properties: { id: p.id, name: p.name, soldOut: p.status === 'sold-out' ? 1 : 0 },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })),
  }), [projects])

  // 注意:react-map-gl 的 <Map> 组件遮蔽了内置 Map,这里用 globalThis.Map
  const projectById = useMemo(() => {
    const m = new globalThis.Map<string, MapPinProject>()
    projects.forEach(p => m.set(p.id, p))
    return m
  }, [projects])

  // 点圆点弹出的卡(始终强制显示,优先级最高);点空白地图清除
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  // 断点:手机(<768)用紧凑卡(小图+名+价,盒≈本体尺寸,一屏能塞更多);
  // 桌面/pad 用完整卡。响应窗口变化。
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setNarrowScreen(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // 屏幕空间贪心碰撞:优先 选中卡 > Luna正在讲的 > 起价高的(贵盘更值得展示),
  // 放得下就摆,挤了就藏。只在相机停稳后跑(和 bounds 同一个 debounce),
  // 每次手势最多一次,16~几百个项目都只是常数个 map.project 调用。
  const [visibleCardIds, setVisibleCardIds] = useState<string[]>([])
  // 翻到圆点下方的卡 id(recompute 决定,渲染读取切换锚点/尾巴方向)
  const belowIdsRef = useRef<Record<string, true>>({})
  const flashKey = flashProjectIds?.join(',') ?? ''
  const recomputeCards = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    // 卡片开关关掉时:只显示用户点开的那一张(selected),其余只剩 GL 圆点。
    if (!showCards) {
      const only = selectedProjectId ? [selectedProjectId] : []
      visibleCardIdsRef.current = only
      setVisibleCardIds(prev => (prev.length === only.length && prev.every((v, i) => v === only[i]) ? prev : only))
      return
    }
    const canvas = map.getCanvas()
    const W = canvas.clientWidth, H = canvas.clientHeight
    const isNarrow = W < 768
    // 碰撞盒 = 卡片本体的「最大可能尺寸」+ 小间隙,任何语言都不许 overlap(用户硬要求)。
    // 卡名被 maxWidth(桌面128/手机96)+ellipsis 钳制,所以卡宽有确定上限:
    //   桌面 = 边框2 + 左pad5 + 缩略图44 + gap10 + (name128+pad1) + 右pad13 = 203
    //   手机 = 边框2 + 左pad4 + 缩略图36 + gap8  + (name96 +pad1) + 右pad11 = 158
    // 盒取此上限 + ~9px 间隙 → 无论中英/长短名,实际卡(居中于圆点,永不超上限)都塞得进盒内。
    // 高含尾巴(桌面 body56+尾8≈64 / 手机 46+8≈54)。放不下上方就试下方,躲开顶部/右上面板。
    const CARD_W = isNarrow ? 166 : 212
    const CARD_H = isNarrow ? 58 : 68
    const MAX_CARDS = 40
    // UI 禁区:卡片不钻到这些不透明浮层底下(否则被遮一半很难看)。按断点给出
    // 各浮层的粗略footprint——顶部搜索/筛选、右上指标卡、右侧工具竖卡、右下 Luna 球。
    // 只挡最影响观感的顶部浮层(搜索栏 + 右上指标卡,都不透明、面积大,卡钻底下
    // 像坏了)。右侧工具竖卡、右下 Luna 球不挡——卡片跟它们轻微交叠可接受(用户
    // 说稍挤没关系),换取多显示卡片。
    const uiBlocks: { x0: number; y0: number; x1: number; y1: number }[] = isNarrow
      ? [
          // 手机布局(2026-07-11):左边一竖列筛选图标钮、底部一条搜索 dock、左下指北针。
          // 三者都不透明,卡钻底下等于看不见。
          { x0: 0, y0: 0, x1: 52, y1: 260 },          // 左侧筛选卡(w-36 + left-2;指北针 + 5 项)
          { x0: W - 156, y0: 0, x1: W, y1: 170 },     // 指标卡(固定 148 宽 + 右 8)
          // 底部搜索 dock + 指北针都是 fixed(贴可见视口),而这里的 H 是地图容器高度
          // (100vh,比可见区高一截)→ 禁区往上多留一点,吸收这个差值。
          { x0: 0, y0: H - 96, x1: W - 60, y1: H },   // 底部搜索 dock
          { x0: 0, y0: H - 130, x1: 60, y1: H - 90 }, // (指北针已并入左卡;这块留给底部搜索图标的呼吸区)
        ]
      : [
          { x0: 0, y0: 0, x1: 560, y1: 56 },          // 搜索+筛选行
          { x0: W - 270, y0: 0, x1: W, y1: 235 },      // 指标卡
        ]
    const flash = new Set(flashProjectIds ?? [])
    const sorted = [...projects].sort((a, b) => {
      if (a.id === selectedProjectId) return -1
      if (b.id === selectedProjectId) return 1
      const fa = flash.has(a.id) ? 1 : 0, fb = flash.has(b.id) ? 1 : 0
      if (fa !== fb) return fb - fa
      const sa = a.status === 'sold-out' ? 1 : 0, sb = b.status === 'sold-out' ? 1 : 0
      if (sa !== sb) return sa - sb // 售罄的靠后
      return (b.minPrice ?? -1) - (a.minPrice ?? -1)
    })
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = []
    const ids: string[] = []
    const below: Record<string, true> = {}   // 记录哪些卡翻到了圆点下方(渲染要用)
    const overlaps = (r: { x0: number; y0: number; x1: number; y1: number }) =>
      placed.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)
        || uiBlocks.some(q => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)
    for (const p of sorted) {
      if (ids.length >= MAX_CARDS) break
      const isSelected = p.id === selectedProjectId
      const pt = map.project([p.lng, p.lat])
      // 只要圆点在视口内(留一点边距)就考虑摆卡——卡片贴边可轻微裁切
      const dotIn = pt.x >= -10 && pt.x <= W + 10 && pt.y >= 8 && pt.y <= H + 10
      if (!dotIn && !isSelected) continue
      const half = CARD_W / 2
      const above = { x0: pt.x - half, y0: pt.y - 8 - CARD_H, x1: pt.x + half, y1: pt.y - 8 }
      const belowRect = { x0: pt.x - half, y0: pt.y + 8, x1: pt.x + half, y1: pt.y + 8 + CARD_H }
      let rect = above
      if (overlaps(above)) {
        // 上方被面板/邻卡占了 → 试下方
        if (!overlaps(belowRect)) { rect = belowRect; below[p.id] = true }
        else if (!isSelected) continue // 上下都放不下 → 只留圆点(选中卡强制上方)
      }
      placed.push(rect)
      ids.push(p.id)
    }
    visibleCardIdsRef.current = ids
    belowIdsRef.current = below
    // 集合没变就不 setState,省一次整棵 marker 子树的 re-render
    setVisibleCardIds(prev => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids))
    // flashKey(字符串)代替 flashProjectIds(每次 render 新数组)进 deps,
    // 避免父层无关渲染反复重建本回调
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, selectedProjectId, flashKey, showCards])

  useEffect(() => {
    if (mapLoaded && !tourActive) recomputeCards()
  }, [mapLoaded, tourActive, recomputeCards])

  // Warm the browser HTTP cache with the satellite tiles for the NEXT 1-2 zoom
  // levels over the current viewport, so a subsequent zoom-in shows sharp tiles
  // instantly instead of the blocky upscaled-parent → pop-in-one-by-one look.
  // MapLibre 5 has no prefetch API; warming via Image() is basemap-agnostic.
  // IMPORTANT: this is scheduled (debounced) for AFTER the user goes idle, and
  // the image requests are dripped out a few at a time — firing a 64-image burst
  // on every moveEnd janked continuous zoom hard (it competed with rendering).
  const prefetchedRef = useRef<Set<string>>(new Set())
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchSatelliteAhead = useCallback(() => {
    if (baseMap !== 'satellite' || tourActive) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const b = map.getBounds()
    const z0 = Math.round(map.getZoom())
    const seen = prefetchedRef.current
    if (seen.size > 1500) seen.clear()
    const urls: string[] = []
    // 面板外的一圈瓦片(pan-ahead ring)——向左/右/上/下拖到 edge 时最先需要的就是它们。
    // 之前只 warm 了当前视口的更深 zoom(zoom-in 用),从不 warm 同级相邻瓦片,
    // 所以每次拖到边缘都撞冷瓦片、"load 方块然后卡几下"。把当前视口按 ~0.9 屏
    // 向四周扩一圈,同级(z0)预取,是消除边缘卡顿的关键。
    const dLng = b.getEast() - b.getWest()
    const dLat = b.getNorth() - b.getSouth()
    const west = b.getWest() - dLng * 0.9
    const east = b.getEast() + dLng * 0.9
    const north = Math.min(85, b.getNorth() + dLat * 0.9)
    const south = Math.max(-85, b.getSouth() - dLat * 0.9)
    // 各 pass:[zoom, 经度左, 经度右, 纬度北, 纬度南, 该 pass 瓦片上限]
    const passes: Array<[number, number, number, number, number, number]> = [
      [z0, west, east, north, south, 80],            // 同级四周一圈(pan-ahead,主力)
      [z0 + 1, b.getWest(), b.getEast(), b.getNorth(), b.getSouth(), 24], // 下一级视口内(zoom-in 锐化)
    ]
    for (const [z, wLng, eLng, nLat, sLat, cap] of passes) {
      if (z < 1 || z > 19) continue
      const n = 2 ** z
      const xMin = Math.floor(((wLng + 180) / 360) * n)
      const xMax = Math.floor(((eLng + 180) / 360) * n)
      const yMin = lat2tileY(nLat, z)
      const yMax = lat2tileY(sLat, z)
      if ((xMax - xMin + 1) * (yMax - yMin + 1) > cap * 2) continue
      let added = 0
      for (let x = xMin; x <= xMax && added < cap; x++) {
        for (let y = yMin; y <= yMax && added < cap; y++) {
          if (y < 0 || y >= n) continue
          const xx = ((x % n) + n) % n
          // Esri World Imagery tile order is {z}/{y}/{x}
          const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${xx}`
          if (seen.has(url)) continue
          seen.add(url)
          urls.push(url)
          added++
        }
      }
    }
    // Drip a few requests per tick so warming never blocks a frame.
    let i = 0
    const step = () => {
      for (let k = 0; k < 4 && i < urls.length; k++) {
        const img = new Image()
        img.decoding = 'async'
        img.src = urls[i++]
      }
      if (i < urls.length) setTimeout(step, 60)
    }
    step()
  }, [baseMap, tourActive])

  // Schedule a prefetch only once the user has been idle ~600ms — never during a
  // continuous zoom/pan gesture.
  const schedulePrefetch = useCallback(() => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = setTimeout(prefetchSatelliteAhead, 600)
  }, [prefetchSatelliteAhead])

  // Warm tiles once after load + whenever the basemap changes to satellite.
  useEffect(() => {
    if (mapLoaded) schedulePrefetch()
  }, [mapLoaded, schedulePrefetch])

  // ref-held so 换了个 onCameraIdle 回调不用重建 handleMoveEnd(与
  // onMeasureChangeRef 同款范式)
  const onCameraIdleRef = useRef(onCameraIdle)
  onCameraIdleRef.current = onCameraIdle

  const handleMoveEnd = useCallback(() => {
    // The cinematic tour drives the camera via jumpTo EVERY FRAME, and jumpTo
    // fires `moveend` each time — so without this guard the supercluster recompute
    // + prefetch + bounds-change below would run ~60×/sec, stuttering the camera
    // on a regular beat ("the map shakes"). The tour shows fixed GL pins (no
    // clusters) and doesn't need bounds/prefetch, so skip all of it during a tour.
    if (tourActive) return
    // DEBOUNCE everything (recompute + prefetch + bounds): a remote-driven collab
    // camera or an inertial fling also fires moveend repeatedly, so collapse to a
    // single run ~150ms after the camera settles — the supercluster query never
    // runs per-frame during continuous motion, and normal pan/zoom is unaffected
    // (markers stay hidden until ~180ms after a gesture settles anyway).
    if (boundsTimeoutRef.current) clearTimeout(boundsTimeoutRef.current)
    boundsTimeoutRef.current = setTimeout(() => {
      recomputeCards()
      schedulePrefetch()
      const map = mapRef.current?.getMap()
      if (!map) return
      // 相机停稳快照(深链写 URL 用):与 bounds 同一节拍,每次手势最多一次
      if (onCameraIdleRef.current) {
        const c = map.getCenter()
        onCameraIdleRef.current({
          lng: c.lng, lat: c.lat, zoom: map.getZoom(),
          pitch: map.getPitch(), bearing: map.getBearing(),
        })
      }
      if (!onBoundsChange) return
      const bounds = map.getBounds()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, map.getZoom())
    }, 150)
  }, [onBoundsChange, recomputeCards, schedulePrefetch, tourActive])

  // Area polygons GeoJSON - 支持热力图
  const areasGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded) return null

    // 计算分位数用于热力图
    let percentiles = { p25: 0, p50: 0, p75: 0 }
    if (areaMetric !== 'none') {
      const values = dubaiAreas
        .map(area => getMetricRawValue(area, areaMetric))
        .filter((v): v is number => v !== null)
      percentiles = calculatePercentiles(values)
    }

    const features = dubaiAreas
      .filter(area => area.boundary?.type === 'Polygon')
      .map((area, i) => {
        // 如果选择了指标，使用热力图颜色
        let fillColor = area.color || '#3b82f6'
        if (areaMetric !== 'none') {
          const rawValue = getMetricRawValue(area, areaMetric)
          fillColor = getHeatmapColor(rawValue, areaMetric, percentiles)
        }

        return {
          type: 'Feature' as const,
          // ⚠️ feature-state(hover 高亮)的渲染路径只认「数字」feature id ——
          // uuid 字符串(含 promoteId 提升)时 getFeatureState 查得到但 paint
          // 永远不命中,高亮静默失效(2026-07-05 排查半天的坑)。uuid 保留在
          // properties.id 供点击查表。
          id: i + 1,
          properties: {
            id: area.id,
            name: area.name,
            color: fillColor,
            opacity: area.opacity ?? 0.5
          },
          geometry: area.boundary
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, areaMetric])

  // Area labels GeoJSON - 区域名称 + 指标值（同一图层）
  // 指标值和名称必须在同一个 symbol，否则两个 layer 的碰撞检测会互相
  // 淘汰：看指标时区域名就消失了（客户反馈）。合并后名字+数值永远一起显示。
  const areaLabelsGeoJson = useMemo(() => {
    if (!showDubaiLayer || !dubaiAreas.length || !mapLoaded) return null

    const langKey = i18n.language?.split('-')[0]
    const lang = i18n.language || 'en'

    // 计算分位数用于指标值着色
    let percentiles = { p25: 0, p50: 0, p75: 0 }
    if (areaMetric !== 'none') {
      const values = dubaiAreas
        .map(area => getMetricRawValue(area, areaMetric))
        .filter((v): v is number => v !== null)
      percentiles = calculatePercentiles(values)
    }

    // Importance ranking for progressive disclosure: sort by transaction count
    // (busiest first). Each area's rank drives WHEN its label is revealed, so the
    // low-zoom view is a clean, curated set of the most relevant markets instead
    // of a random subset the collision engine happened to keep.
    const rankById: Record<string, number> = {}
    ;[...dubaiAreas]
      .sort((a, b) => (b.transactionCount ?? -1) - (a.transactionCount ?? -1))
      .forEach((area, i) => {
        rankById[area.id] = area.transactionCount != null ? i : Infinity
      })

    const features = dubaiAreas
      .filter(area => {
        if (area.boundary?.type !== 'Polygon') return false
        const coords = (area.boundary as any).coordinates?.[0]
        return Array.isArray(coords) && coords.length >= 3
      })
      .map(area => {
        const coords = (area.boundary as any).coordinates[0]
        const centroid = getCentroid(coords)
        const span = getPolygonSpan(coords)
        // Reveal threshold driven purely by importance (transaction rank), so the
        // overview shows only the busiest markets and the rest unfold on zoom.
        const rank = rankById[area.id] ?? Infinity
        const minZoom = getMinZoomForRank(rank)
        const translatedName = langKey ? area.translations?.[langKey]?.name : undefined

        // 单行本地化名称：中文界面只显示中文（原来英中两行 ×100+ 区域是地图
        // 拥挤的最大来源；客户反馈"挤着很乱"后改为单行）
        const displayName = translatedName || area.name

        let metricValue = ''
        let metricColor = '#94a3b8'
        if (areaMetric !== 'none') {
          metricValue = formatMetricValue(area, areaMetric, lang)
          const rawValue = getMetricRawValue(area, areaMetric)
          metricColor = getHeatmapColor(rawValue, areaMetric, percentiles)
        }

        return {
          type: 'Feature' as const,
          properties: {
            name: area.name,
            translatedName: translatedName || '',
            span,
            minZoom,
            displayName,
            metricValue,
            metricColor
          },
          geometry: { type: 'Point' as const, coordinates: centroid }
        }
      })

    return { type: 'FeatureCollection' as const, features }
  }, [dubaiAreas, showDubaiLayer, mapLoaded, i18n.language, areaMetric])

  // POI GeoJSON for WebGL rendering (no limit needed - symbol layers are fast)
  const poiGeoJson = useMemo(() => {
    if (!showPois || !pois.length || !mapLoaded) {
      return { type: 'FeatureCollection' as const, features: [] }
    }

    const features = pois.map(poi => {
      const config = CATEGORY_CONFIG[poi.category] || DEFAULT_CATEGORY_CONFIG

      return {
        type: 'Feature' as const,
        id: poi.id,
        properties: {
          id: poi.id,
          name: poi.name,
          category: poi.category,
          color: config.color,
          icon: `poi-${poi.category}`,  // e.g. "poi-hospital", "poi-police"
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [poi.lng, poi.lat]
        }
      }
    })

    return { type: 'FeatureCollection' as const, features }
  }, [pois, showPois, mapLoaded])

  // Hover handlers for areas and POIs。feature-state 版:零 React 重渲染,
  // 只改上一个/当前 feature 的状态。
  const setAreaHover = useCallback((map: MaplibreMap, id: string | number | null) => {
    if (hoverAreaRef.current === id) return
    if (!map.getLayer('area-fill-hover')) { hoverAreaRef.current = null; return }
    // 只过滤 hover 图层里的一个 feature —— 不触碰 area-fills 的 paint,
    // 不触发 React 渲染;id 为空时用 -1(永不匹配)清空。
    map.setFilter('area-fill-hover', ['==', ['id'], id == null ? -1 : id])
    hoverAreaRef.current = id
  }, [])

  // 圆点名字提示的显隐(命令式,不进 React)
  const setDotTip = useCallback((name: string | null, x?: number, y?: number) => {
    const el = dotTipRef.current
    if (!el) return
    if (!name) { el.style.display = 'none'; return }
    el.textContent = name
    el.style.display = 'block'
    el.style.transform = `translate(${Math.round(x! - 0)}px, ${Math.round(y! - 34)}px) translateX(-50%)`
  }, [])

  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    // 拖动/缩放中不做 hover:地图在光标下滑动时区域边界会连续穿过光标,
    // 高亮闪烁没意义还白做功
    if (map.isMoving()) { setDotTip(null); return }

    if (e.features?.length) {
      const layerId = e.features[0].layer?.id
      // Change cursor for clickable layers
      map.getCanvas().style.cursor = 'pointer'

      if (layerId === 'project-dots') {
        // 悬停圆点出项目名(该项目卡片已在屏上就不重复出)
        const props = e.features[0].properties || {}
        const pid = String(props.id ?? '')
        if (pid && !visibleCardIdsRef.current.includes(pid)) {
          setDotTip(String(props.name ?? ''), e.point.x, e.point.y)
        } else {
          setDotTip(null)
        }
      } else {
        setDotTip(null)
        if (layerId === 'area-fills') {
          // 数字 feature.id(见 areasGeoJson 注释),uuid 在 properties.id
          setAreaHover(map, e.features[0].id ?? null)
        }
      }
    } else {
      // 空命中只复位光标,不清高亮:重绘瞬间 hit-test 会偶发 miss,光标扫过
      // 区域间隙也会空命中——立即清除等于高亮闪烁。高亮保持到 hover 下一个
      // 区域(setAreaHover 自动清上一个)或移出地图(handleMouseLeave)。
      map.getCanvas().style.cursor = ''
      setDotTip(null)
    }
  }, [setAreaHover, setDotTip])

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    map.getCanvas().style.cursor = ''
    setAreaHover(map, null)
    setDotTip(null)
  }, [setAreaHover, setDotTip])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    // 测距模式：每次点击落一个点，不触发区域/POI 选择
    if (measureMode) {
      setMeasurePoints(prev => [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }])
      return
    }

    // 画笔/标记工具激活时：完全吞掉要素点击，画画不误开 POI/区域/项目面板
    if (disableFeatureClicks) return

    // 点空白地图:收起展开的卡/选中态
    if (!e.features?.length) {
      setSelectedProjectId(null)
      return
    }

    // Prioritize: Project dot > POI > Station > Area
    // 点圆点(真值层)= 选中该项目:手机展开成照片卡,桌面弹浮动卡
    const dotFeature = e.features.find(f => f.layer?.id === 'project-dots')
    if (dotFeature) {
      const pid = dotFeature.properties?.id
      if (pid) {
        // 触屏 tap 会先合成一次 mousemove 弹出悬停名字提示,随后卡片也带名字
        // → 名字重复。选中即弹卡,提示冗余,立刻清掉(桌面 hover 仍照常)。
        setDotTip(null)
        setSelectedProjectId(String(pid))
        return
      }
    }

    const poiFeature = e.features.find(f => f.layer?.id === 'poi-circles')
    const stationFeature = e.features.find(f => f.layer?.id === 'transport-stations-bg')
    const areaFeature = e.features.find(f => f.layer?.id === 'area-fills')

    // Handle POI click (highest priority)
    if (poiFeature && onPoiClick) {
      const poiId = poiFeature.properties?.id
      const poi = pois.find(p => p.id === poiId)
      if (poi) {
        onPoiClick(poi)
        return
      }
    }

    // Handle station click
    if (stationFeature && onStationClick) {
      const props = stationFeature.properties || {}
      const coords = (stationFeature.geometry as any)?.coordinates
      if (coords) {
        const station: TransportStation = {
          id: props.id || `station-${Date.now()}`,
          name: props.name || 'Unknown Station',
          nameAr: props.nameAr || undefined,
          category: props.category as TransportStation['category'],
          color: props.color || '#E31837',
          lng: coords[0],
          lat: coords[1],
          line: props.line || undefined,
          network: props.network || undefined,
          operator: props.operator || undefined,
        }
        onStationClick(station)
        return
      }
    }

    // Handle area click (lowest priority)
    if (areaFeature && onAreaClick) {
      const areaId = areaFeature.properties?.id
      const area = dubaiAreas.find(a => a.id === areaId)
      if (area) onAreaClick(area)
    }
  }, [dubaiAreas, pois, onAreaClick, onPoiClick, onStationClick, measureMode, disableFeatureClicks, setDotTip])

  return (
    <div className={`relative h-full w-full ${disableFeatureClicks ? 'lt-draw-active' : ''}`}>
      {/* 圆点 hover 名字提示(命令式定位,坐标 = e.point 相对地图容器) */}
      <div
        ref={dotTipRef}
        className="pointer-events-none absolute left-0 top-0 z-[900] whitespace-nowrap rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ring-1 ring-white/15 backdrop-blur-sm"
        style={{ display: 'none', willChange: 'transform' }}
      />
      {/* While a markup tool is active, DOM markers (projects/clusters/landmarks)
          must not eat the pointer — otherwise a tap over a pin opens its panel
          instead of drawing, and you can't draw over a pin. GL-layer features
          (POI/area/station) are already gated in handleMapClick above. */}
      {disableFeatureClicks && (
        <style>{`.lt-draw-active .maplibregl-marker{pointer-events:none !important}`}</style>
      )}
      <Map
        ref={mapRef}
        initialViewState={initialView ?? INITIAL_VIEW}
        onMoveEnd={handleMoveEnd}
        onLoad={handleMapLoad}
        attributionControl={false}
        // Keep more raster tiles cached so zooming in/out and back doesn't refetch
        // (and re-pixelate) tiles already seen this session.
        maxTileCacheSize={600}
        // CJK (Chinese area/POI names) render locally with a system font instead
        // of being fetched from the glyph server — fast, and the openmaptiles
        // glyph server doesn't carry CJK anyway. Latin/symbols still come from
        // the style's glyphs URL (now a fontstack the server actually serves).
        localIdeographFontFamily="'PingFang SC', 'Microsoft YaHei', sans-serif"
        style={{ width: '100%', height: '100%' }}
        mapStyle={
          // 🔴 **Luna Tour 必须用卫星底图。** owner 已经说过很多次了 —— 不要再改。
          //    我先后改成过 dark 和亮色矢量,两次都是错的。tour 期间强制 satellite,
          //    不管用户自己的底图偏好是什么。
          tourActive
            ? SATELLITE_STYLE
            : baseMap === 'satellite'
            ? SATELLITE_STYLE
            : baseMap === 'dark'
            ? MAP_STYLE_DARK
            : (areaMetric === 'none' ? MAP_STYLE_LABELED : MAP_STYLE_CLEAN)
        }
        interactiveLayerIds={mapLoaded ? [
          ...(projectDotsGeoJson.features.length ? ['project-dots'] : []),
          ...(areasGeoJson ? ['area-fills'] : []),
          ...(showTransport && transportGeoJSON ? ['transport-stations-bg'] : []),
          ...(poiGeoJson.features.length ? ['poi-circles'] : [])
        ] : []}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleMapClick}
      >
        {/* Area Polygons — always shown (soft default colours give customers
            orientation via area names; the tour toggles a metric to reveal value)。
            ⚠️ hover 高亮走 feature-state(命令式),千万别把 hover id 塞进 paint
            表达式:那会在每次 hover 变化时全量重估 fill-opacity + 重传所有区域的
            paint buffer + 整个组件重渲染——拖动时地图在光标下滑过区域边界就会
            打出 100-600ms 长帧(2026-07-05 实锤的"一卡一卡"根因)。 */}
        {mapLoaded && areasGeoJson && (
          <Source id="areas" type="geojson" data={areasGeoJson}>
            <Layer
              id="area-fills"
              type="fill"
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': ['*', ['get', 'opacity'], 0.4]  // soft (matches production)
              }}
            />
            {/* hover 高亮:独立图层 + setAreaHover 里 setFilter 切换,只画命中的
                那一个区域(叠加 0.3x ≈ 原 hover 0.7x 的观感)。filter 初始 -1 =
                不画任何东西。 */}
            <Layer
              id="area-fill-hover"
              type="fill"
              filter={['==', ['id'], -1]}
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': ['*', ['get', 'opacity'], 0.3]
              }}
            />
          </Source>
        )}

        {/* Area Labels - 区域名称 (始终显示；选指标时数值以 format 段追加在名称下方,
            同一 symbol 保证名字和数值要么一起显示要么一起隐藏) */}
        {mapLoaded && areaLabelsGeoJson && (
          <Source id="area-labels" type="geojson" data={areaLabelsGeoJson}>
            <Layer
              id="area-label-text"
              type="symbol"
              filter={['<=', ['get', 'minZoom'], ['zoom']]}
              layout={{
                'text-field': areaMetric === 'none'
                  ? ['get', 'displayName']
                  : (areaMetric === 'medianUnitPrice' || areaMetric === 'medianPriceSqft')
                  // 金额指标：数值前嵌迪拉姆官方符号——固定中性色（像 ¥/$），
                  // 与数字隔一个空格；没有数值的区域用透明占位图（不显示符号）
                  ? ['format',
                      ['get', 'displayName'], {},
                      '\n', {},
                      ['image', ['concat', 'dirham-',
                        ['case', ['==', ['get', 'metricValue'], ''], 'none',
                          (baseMap === 'satellite' || baseMap === 'dark') ? 'light' : 'dark']
                      ]], {},
                      ['case', ['==', ['get', 'metricValue'], ''], '', ' '], {},
                      ['get', 'metricValue'], {
                        'text-color': ['get', 'metricColor'],
                        'font-scale': 1.25
                      }
                    ]
                  : ['format',
                      ['get', 'displayName'], {},
                      '\n', {},
                      ['get', 'metricValue'], {
                        'text-color': ['get', 'metricColor'],
                        'font-scale': 1.25
                      }
                    ],
                'text-font': ['Open Sans Bold'],
                // Keep labels flat-on-screen + upright no matter the bearing/pitch,
                // so the cinematic orbit doesn't tilt or rotate the area names.
                'text-rotation-alignment': 'viewport',
                'text-pitch-alignment': 'viewport',
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 8,    // 更小的字体
                  10, 9,
                  12, 10,
                  14, 11,
                  16, 12
                ],
                'text-anchor': 'center',
                // Elegant declutter: NEVER force overlap. Let MapLibre's collision
                // engine drop labels that would collide and show them again once the
                // user zooms in far enough for them to breathe. The old `zoom>=12 →
                // allow-overlap:true` is exactly what crammed every badge on top of
                // each other. symbol-sort-key (lower minZoom = more prominent area)
                // decides who wins a collision, so the important areas always show.
                // During a TOUR, skip collision (allow-overlap + ignore-placement):
                // the placement pass re-runs on every camera rotation → a periodic
                // hitch while orbiting. At tour zoom only a few labels are in view,
                // so overlap is minimal. Normal browsing keeps full collision.
                'text-allow-overlap': tourActive,
                'text-ignore-placement': tourActive,
                'text-padding': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 2,    // very tight so the collision engine packs in the most names
                  11, 2,
                  14, 2,
                  16, 2
                ],
                'symbol-sort-key': ['get', 'minZoom']
              }}
              paint={{
                // Dark basemaps (satellite/dark) → light text + dark halo so the
                // area name stays readable; light vector → original dark-on-white.
                'text-color': (baseMap === 'satellite' || baseMap === 'dark') ? '#ffffff' : '#334155',
                'text-halo-color': (baseMap === 'satellite' || baseMap === 'dark') ? 'rgba(0,0,0,0.85)' : '#ffffff',
                'text-halo-width': 2
              }}
            />
          </Source>
        )}

        {/* Transport Lines - Metro/Tram only */}
        {mapLoaded && showTransport && transportGeoJSON && transportGeoJSON.features.length > 0 && (
          <Source
            id="transport-lines"
            type="geojson"
            data={transportGeoJSON}
          >
            {/* White casing for visibility */}
            <Layer
              id="transport-lines-casing"
              type="line"
              filter={['in', ['get', 'category'], ['literal', ['metro_lines', 'tram_lines', 'monorail']]]}
              layout={{
                'line-cap': 'butt',
                'line-join': 'round'
              }}
              paint={{
                'line-color': '#ffffff',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 4,
                  12, 5,
                  16, 6
                ],
                'line-opacity': 0.9
              }}
            />
            {/* Main colored line - use color property from GeoJSON */}
            <Layer
              id="transport-lines-main"
              type="line"
              filter={['in', ['get', 'category'], ['literal', ['metro_lines', 'tram_lines', 'monorail']]]}
              layout={{
                'line-cap': 'butt',
                'line-join': 'round'
              }}
              paint={{
                'line-color': ['coalesce', ['get', 'color'], '#6b7280'],
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  8, 2,
                  12, 3,
                  16, 4
                ],
                'line-opacity': 1
              }}
            />

            {/* Station icons - icon based on line/type property */}
            <Layer
              id="transport-stations-bg"
              type="symbol"
              filter={['in', ['get', 'category'], ['literal', ['metro_stations', 'tram_stations', 'monorail_stations']]]}
              layout={{
                'icon-image': [
                  'concat',
                  'station-',
                  ['get', 'line']
                ],
                'icon-size': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 0.8,
                  13, 1.0,
                  16, 1.2,
                  18, 1.4
                ],
                'icon-allow-overlap': true
              }}
            />

            {/* Station labels - show at higher zoom. Hidden during cinematic tour
                playback (chromeless): the seeded names are placeholders ("New Stop
                N") and read as debug noise over the immersive view. Station dots +
                route lines stay; names return on pause. */}
            {!chromeless && (
            <Layer
              id="transport-stations-labels"
              type="symbol"
              filter={['all',
                ['in', ['get', 'category'], ['literal', ['metro_stations', 'tram_stations', 'monorail_stations']]],
                ['>=', ['zoom'], 13]
              ]}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  13, 10,
                  15, 12,
                  17, 14
                ],
                'text-offset': [0, 1.5],
                'text-anchor': 'top',
                // Tour: skip collision (re-placed on every camera rotation → orbit hitch)
                'text-allow-overlap': tourActive,
                'text-ignore-placement': tourActive,
                'text-optional': true
              }}
              paint={{
                'text-color': ['get', 'color'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 2
              }}
            />
            )}

          </Source>
        )}

        {/* POI Icons - Symbol Layer */}
        {mapLoaded && poiGeoJson.features.length > 0 && (
          <Source
            id="pois"
            type="geojson"
            data={poiGeoJson}
          >
            <Layer
              id="poi-circles"
              type="symbol"
              layout={{
                'icon-image': ['get', 'icon'],
                'icon-size': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 0.8,
                  13, 1.0,
                  16, 1.2,
                  18, 1.4
                ],
                // Gradual clustering: 11-13 with decreasing padding, 14+ show all
                'icon-allow-overlap': [
                  'step',
                  ['zoom'],
                  false,  // zoom < 14: hide overlapping
                  14, true   // zoom >= 14: show all
                ],
                'icon-padding': [
                  'step',
                  ['zoom'],
                  6,   // zoom < 11: large padding
                  11, 4,  // zoom 11: medium-large padding
                  12, 2,  // zoom 12: medium padding
                  13, 1,  // zoom 13: small padding
                  14, 0   // zoom >= 14: no padding
                ]
              }}
            />
            {/* POI names — only at high zoom so they don't crowd the map. Lets the
                AI demo point at a real named place ("GEMS School") instead of a bare
                icon. text-optional drops labels that would collide. */}
            <Layer
              id="poi-labels"
              type="symbol"
              minzoom={14.5}
              layout={{
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10, 17, 13],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-max-width': 8,
                'text-allow-overlap': false,
                'text-optional': true
              }}
              paint={{
                'text-color': ['get', 'color'],
                'text-halo-color': '#ffffff',
                'text-halo-width': 1.8
              }}
            />
          </Source>
        )}

        {/* 项目真值层:GL 圆点,所有项目永不消失(在售=品牌青,售罄=灰)。
            WebGL 层零 DOM,缩放平移随 GL 帧,任何手势中都稳定可见——这正是
            「点永远都在,卡片才是 optional」的分层。点击在 handleMapClick。 */}
        {mapLoaded && projectDotsGeoJson.features.length > 0 && (
          <Source id="project-dots-src" type="geojson" data={projectDotsGeoJson}>
            {/* 柔光底(在售项目才发光,售罄不发光):比主点大一圈 + circle-blur,
                营造"发光宝石"质感,取代之前一个廉价扁平绿点。 */}
            <Layer
              id="project-dots-glow"
              type="circle"
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 12, 12, 16, 17],
                'circle-color': ['case', ['==', ['get', 'soldOut'], 1], '#94a3b8', '#2DD4BF'],
                'circle-blur': 1,
                'circle-opacity': ['case', ['==', ['get', 'soldOut'], 1], 0, 0.35]
              }}
            />
            {/* 主点:实心青 + 2px 白环 + 一圈极淡深描边收边,像高级地图的定位珠。 */}
            <Layer
              id="project-dots"
              type="circle"
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4.5, 12, 6, 16, 8.5],
                'circle-color': ['case', ['==', ['get', 'soldOut'], 1], '#94a3b8', '#0FB5A4'],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 2.2],
                'circle-opacity': 1
              }}
            />
          </Source>
        )}

        {/* Landmarks 永远显示——tour 和首页必须是同一张地图（客户要求）。
            只有 ~15 个，运镜逐帧重定位它们开销可忽略，不触发 Perf rule R2。
            Clusters（可能几百个）才是会抖动 flyTo 的 marker 海，tour 时仍隐藏；
            项目 pin 在 tour 模式下本来就只有 2-3 个 tour 房源。 */}
        {/* Normal mode only: rich DOM cutouts, hidden mid-gesture (mapMoving) so
            they never jitter. During a tour the GL symbol layer above renders the
            landmarks instead (DOM markers lag the per-frame cinematic camera). */}
        {!tourActive && !mapMoving && dubaiLandmarks.map(lm => (
          <LandmarkMarker key={lm.id} landmark={lm} onClick={onLandmarkClick} />
        ))}
        {/* 信息层:照片卡片(可选层)。tour 模式 2-3 个 tour 房源全展示;
            普通模式只显示 recomputeCards 碰撞检测选出的那批(挤了就藏,
            点圆点强制弹出)。手势中(mapMoving)隐藏,与地标同一规则——
            真值层圆点是 GL 的,手势中依然全程可见,项目"点"永不丢失。 */}
        {tourActive
          ? projects.map(project => (
              <ProjectCardMarker key={project.id} project={project} onClick={onProjectClick} flashing={flashProjectIds?.includes(project.id)} />
            ))
          : !mapMoving && visibleCardIds.map(id => {
              const project = projectById.get(id)
              if (!project) return null
              return (
                <ProjectCardMarker
                  key={id}
                  project={project}
                  onClick={onProjectClick}
                  flashing={flashProjectIds?.includes(id)}
                  selected={id === selectedProjectId}
                  compact={narrowScreen}
                  below={!!belowIdsRef.current[id]}
                />
              )
            })}

        {/* 测距：连线 + 顶点 */}
        {mapLoaded && measurePoints.length > 0 && (
          <>
            <Source id="measure-line" type="geojson" data={measureGeoJson.segments}>
              <Layer
                id="measure-line-layer"
                type="line"
                paint={{ 'line-color': '#2563eb', 'line-width': 3, 'line-dasharray': [2, 1] }}
              />
              <Layer
                id="measure-seg-label"
                type="symbol"
                layout={{
                  'symbol-placement': 'line-center',
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold'],
                  'text-size': 13,
                  'text-allow-overlap': true,
                  'text-ignore-placement': true
                }}
                paint={{ 'text-color': '#1d4ed8', 'text-halo-color': '#ffffff', 'text-halo-width': 2.5 }}
              />
            </Source>
            <Source id="measure-points" type="geojson" data={measureGeoJson.points}>
              <Layer
                id="measure-points-layer"
                type="circle"
                paint={{
                  'circle-radius': ['case', ['==', ['get', 'kind'], 'hub'], 8, 5],
                  'circle-color': ['case', ['==', ['get', 'kind'], 'hub'], '#dc2626', '#2563eb'],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2
                }}
              />
            </Source>
          </>
        )}

        {/* 语音助手：区域配套放射图（中心→最近 医院/学校/商场/地铁/超市） */}
        {mapLoaded && showAmenities && amenityGeoJson.lines && amenityGeoJson.points && (
          <>
            <Source id="amenity-lines" type="geojson" data={amenityGeoJson.lines}>
              <Layer
                id="amenity-lines-layer"
                type="line"
                paint={{ 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [2, 1.5] }}
              />
              <Layer
                id="amenity-lines-label"
                type="symbol"
                layout={{
                  'symbol-placement': 'line-center',
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold'],
                  'text-size': 12
                }}
                paint={{ 'text-color': '#b45309', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
            </Source>
            <Source id="amenity-points" type="geojson" data={amenityGeoJson.points}>
              <Layer
                id="amenity-points-layer"
                type="circle"
                paint={{
                  'circle-radius': ['case', ['==', ['get', 'kind'], 'center'], 8, 5],
                  'circle-color': ['case', ['==', ['get', 'kind'], 'center'], '#059669', '#f59e0b'],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2
                }}
              />
              <Layer
                id="amenity-center-label"
                type="symbol"
                filter={['==', ['get', 'kind'], 'center']}
                layout={{
                  'text-field': ['get', 'label'],
                  'text-font': ['Open Sans Bold'],
                  'text-size': 13,
                  'text-offset': [0, 1.4],
                  'text-anchor': 'top'
                }}
                paint={{ 'text-color': '#065f46', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
              {/* real POI name at each amenity endpoint — so "学校 0.42km" visibly
                  lands on "Canadian University Dubai", not seemingly-empty land */}
              <Layer
                id="amenity-poi-label"
                type="symbol"
                filter={['==', ['get', 'kind'], 'amenity']}
                layout={{
                  'text-field': ['get', 'name'],
                  'text-font': ['Open Sans Bold'],
                  'text-size': 11,
                  'text-offset': [0, 1.1],
                  'text-anchor': 'top',
                  'text-max-width': 9,
                  'text-allow-overlap': false,
                  'text-optional': true
                }}
                paint={{ 'text-color': '#b45309', 'text-halo-color': '#ffffff', 'text-halo-width': 2 }}
              />
            </Source>
          </>
        )}
      </Map>

      {!chromeless && (<>
      {/* 底图/3D/测距:合并成一张与右上控制卡同风格的竖排小卡(rounded-2xl 白卡
          + 内部 rounded-lg 按钮),全断点通用。原来三颗独立 pill 宽度参差,
          右缘不齐显乱(用户反馈)。
          top 规则:控制卡常开(手机 ~145px / md+ ~148px,top-3 起算)→ 164px。
          控制卡再改高度这里要跟着挪,且改完必须 414/1180/1440 三档截图验证
          (2026-07-03 用户反馈两次撞坑)。 */}
      {/* 手机(<md):屏幕窄,收成 36px 一条纯图标 bar(和左边筛选 bar 同宽)。
          md+(pad/桌面):维持原来的「图标+文字」横排 pill 卡 —— 2026-07-11 用户明确
          只要改手机,桌面/pad 不许跟着缩。
          top 规则:控制卡常开(手机 ~112px / md+ ~148px,各自 top 起算)→ 124 / 164。
          控制卡再改高度这里要跟着挪,且改完必须 414/1180/1440 三档截图验证。 */}
      <div data-testid="map-mobile-tools" className="absolute right-2 top-[124px] z-[1000] w-9 md:right-3 md:top-[164px] md:w-auto">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-white/95 p-1 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm md:items-stretch md:gap-0.5">
          <button
            type="button"
            onClick={() => setBaseMap(prev => (prev === 'vector' ? 'satellite' : prev === 'satellite' ? 'dark' : 'vector'))}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 md:h-auto md:w-auto md:justify-start md:gap-1.5 md:px-2.5 md:py-1.5 md:text-xs md:font-semibold ${
              baseMap === 'dark' ? 'bg-slate-800 text-slate-100 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
            aria-label="切换底图"
          >
            <Globe size={15} className={`shrink-0 md:h-3.5 md:w-3.5 ${baseMap === 'satellite' ? 'text-emerald-600' : baseMap === 'dark' ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span className="hidden whitespace-nowrap md:inline">
              {baseMap === 'vector' ? (isZhUi ? '地图' : 'Map') : baseMap === 'satellite' ? (isZhUi ? '卫星' : 'Satellite') : (isZhUi ? '夜景' : 'Dark')}
            </span>
          </button>
          <button
            type="button"
            onClick={toggle3D}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 md:h-auto md:w-auto md:justify-start md:gap-1.5 md:px-2.5 md:py-1.5 md:text-xs md:font-semibold ${
              pitched ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/40' : 'text-slate-600 hover:bg-slate-100'
            }`}
            aria-label="切换 3D 倾斜视角"
          >
            <Box size={15} className={`shrink-0 md:h-3.5 md:w-3.5 ${pitched ? 'text-white' : 'text-slate-500'}`} />
            <span className="hidden whitespace-nowrap md:inline">{pitched ? (isZhUi ? '平视' : '2D') : '3D'}</span>
          </button>
          <button
            type="button"
            onClick={() => (measureMode ? exitMeasure() : setMeasureMode(true))}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 md:h-auto md:w-auto md:justify-start md:gap-1.5 md:px-2.5 md:py-1.5 md:text-xs md:font-semibold ${
              measureMode ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/40' : 'text-slate-600 hover:bg-slate-100'
            }`}
            aria-label="测距工具"
          >
            <Ruler size={15} className={`shrink-0 md:h-3.5 md:w-3.5 ${measureMode ? 'text-white' : 'text-slate-500'}`} />
            <span className="hidden whitespace-nowrap md:inline">{measureMode ? (isZhUi ? '退出' : 'Exit') : (isZhUi ? '测距' : 'Measure')}</span>
          </button>
          {/* 项目卡片显示/隐藏开关:眼睛图标 = 可见性语义,一眼就懂。
              显示态=青底睁眼「项目」;隐藏态=灰底闭眼「已隐藏」,地图只剩圆点。 */}
          <button
            type="button"
            onClick={toggleShowCards}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 md:h-auto md:w-auto md:justify-start md:gap-1.5 md:px-2.5 md:py-1.5 md:text-xs md:font-semibold ${
              showCards ? 'bg-teal-500 text-white shadow-sm shadow-teal-500/40' : 'bg-slate-200 text-slate-500'
            }`}
            aria-label={showCards ? '隐藏项目卡片' : '显示项目卡片'}
          >
            {showCards
              ? <Eye size={15} className="shrink-0 text-white md:h-3.5 md:w-3.5" />
              : <EyeOff size={15} className="shrink-0 text-slate-500 md:h-3.5 md:w-3.5" />}
            <span className="hidden whitespace-nowrap md:inline">
              {showCards ? (isZhUi ? '项目' : 'Projects') : (isZhUi ? '已隐藏' : 'Hidden')}
            </span>
          </button>
        </div>
      </div>

      {/* 指北针已并进左上筛选卡(components/MapCompassButton),不再单独浮在地图上 —— 2026-07-11 */}

      {/* 测距状态条(极简,距离已画在地图线上) */}
      {measureMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 whitespace-nowrap rounded-full bg-white/95 px-3.5 py-1.5 text-xs shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <span className="font-medium text-slate-700">
            {measurePoints.length === 0
              ? (isZhUi ? '点地图设中心点' : 'Tap map to set center')
              : measurePoints.length === 1
                ? (isZhUi ? '已设中心 · 点击添加地点' : 'Center set · tap to add places')
                : (isZhUi ? `中心 + ${measureSpokeKms.length} 个地点` : `Center + ${measureSpokeKms.length} places`)}
          </span>
          {measurePoints.length > 0 && (
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              className="font-semibold text-blue-600"
            >
              {isZhUi ? '清除' : 'Clear'}
            </button>
          )}
        </div>
      )}

      {/* 语音助手：配套便利度评分面板 */}
      {showAmenities && voiceAmenities && !hideAmenityPanel && (
        <div className="absolute left-3 bottom-24 md:bottom-6 z-[1000] w-[256px] rounded-2xl bg-white/95 p-3.5 shadow-xl ring-1 ring-slate-200 backdrop-blur">
          <button
            type="button"
            onClick={() => setAmenityClosed(true)}
            className="absolute right-2 top-2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
          <div className="text-xs font-medium text-slate-500">{voiceAmenities.centerName} · 生活便利度</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className={`text-3xl font-bold ${
              voiceAmenities.tier === '优秀' ? 'text-emerald-600'
                : voiceAmenities.tier === '良好' ? 'text-sky-600'
                : voiceAmenities.tier === '一般' ? 'text-amber-600' : 'text-slate-500'
            }`}>{voiceAmenities.score}</span>
            <span className="text-sm text-slate-400">/100</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${
              voiceAmenities.tier === '优秀' ? 'bg-emerald-50 text-emerald-700'
                : voiceAmenities.tier === '良好' ? 'bg-sky-50 text-sky-700'
                : voiceAmenities.tier === '一般' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
            }`}>{voiceAmenities.tier}</span>
          </div>
          <div className="mt-2.5 space-y-1.5">
            {voiceAmenities.spokes.map(s => (
              <div key={s.category} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-center">{s.emoji}</span>
                <span className="text-slate-600">{s.label}</span>
                <span className="ml-auto truncate font-medium text-slate-800" title={s.name}>{s.distanceKm} km</span>
              </div>
            ))}
          </div>
        </div>
      )}

      </>)}
    </div>
  )
}

export default memo(forwardRef<MapTourHandle, MapViewMapLibreProps>(MapViewMapLibre))

/** Load a same-origin landmark cutout PNG as an <img> for map.addImage (GL symbol
 *  icon). Resolves null on 404/error so a missing cutout falls back to text only. */
function loadLandmarkImg(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}
