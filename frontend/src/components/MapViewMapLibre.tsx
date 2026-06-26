/**
 * MapLibre GL JS 地图组件 - 简洁高效版
 */

import { useState, useRef, useMemo, useCallback, memo, useEffect, forwardRef, useImperativeHandle } from 'react'
import Map, {
  Source,
  Layer,
  MapRef
} from 'react-map-gl/maplibre'
import Supercluster from 'supercluster'
import { type MapLayerMouseEvent, type Map as MaplibreMap, type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTranslation } from 'react-i18next'
import { Globe, Ruler, X } from 'lucide-react'
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
import { ProjectPinMarker, ClusterBubble, LandmarkMarker } from './map/MapMarkers'
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

// 卫星底图风格。
// 有 VITE_MAPTILER_KEY → MapTiler satellite-v2 的 512 retina 瓦片(手机/高DPI屏清晰);
// 没有 → 退回 Esri World Imagery 256(免 key,但高 DPI 屏会偏糊)。免费 key: maptiler.com
const MAPTILER_KEY = (import.meta as any).env?.VITE_MAPTILER_KEY as string | undefined

const SATELLITE_SOURCE = MAPTILER_KEY
  ? {
      type: 'raster' as const,
      tiles: [`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`],
      tileSize: 512,
      maxzoom: 20,
      attribution: '© MapTiler © Esri, Maxar'
    }
  : {
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
}

function MapViewMapLibre({
  projects = [],
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
  voiceAmenities = null,
  hideAmenityPanel = false,
  chromeless = false,
  tourActive = false,
  visible = true
}: MapViewMapLibreProps, ref: React.Ref<MapTourHandle>) {
  const { i18n } = useTranslation()
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
      setMeasureMode(false)
      setMeasurePoints([])
      return
    }
    const pts = voiceMeasure.points.map(([lng, lat]) => ({ lng, lat }))
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

  const [hoveredAreaId, setHoveredAreaId] = useState<string | null>(null)
  const boundsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)


  // 3D 倾斜视角：独立于底图(地图/卫星/夜景都可用)。开启后相机俯角看,
  // 配合电影 flyTo 俯冲。pitchedRef 供 flyTo effect 读取(避免把 pitched 放进
  // effect deps 而触发重复飞行)。
  const CINEMATIC_PITCH = 60
  const [pitched, setPitched] = useState(false)
  const pitchedRef = useRef(false)
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

    await addCustomIcons(map)

    // 底图切换后 style 重建，重新注入自定义图标
    map.on('style.load', () => { addCustomIcons(map) })

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

    setMapLoaded(true)

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
        const targetH = lm.size === 'xlarge' ? 90 : lm.size === 'large' ? 66 : lm.size === 'small' ? 44 : 54
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

  // ─── Project pin clustering (supercluster) ────────────────────────────────
  // Group overlapping project pins into a count bubble so the back pins stay
  // reachable; clicking a bubble zooms in to split them apart. Recomputed only
  // when the camera settles (moveEnd) — markers are geo-anchored so they pan
  // correctly without per-frame work.
  const superclusterIndex = useMemo(() => {
    // Aggregate the price RANGE across each cluster so the bubble shows
    // "min–max" (minPrice=Infinity / maxPrice=0 = no priced project in the group).
    const idx = new Supercluster<{ project: MapPinProject }, { minPrice: number; maxPrice: number }>({
      radius: 56, maxZoom: 16,
      map: (props) => ({
        minPrice: props.project?.minPrice ?? Infinity,
        maxPrice: props.project?.maxPrice ?? props.project?.minPrice ?? 0,
      }),
      reduce: (acc, props) => {
        if (props.minPrice < acc.minPrice) acc.minPrice = props.minPrice
        if (props.maxPrice > acc.maxPrice) acc.maxPrice = props.maxPrice
      },
    })
    idx.load(projects.map(p => ({
      type: 'Feature' as const,
      properties: { project: p },
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    })))
    return idx
  }, [projects])

  const [clusterFeatures, setClusterFeatures] = useState<any[]>([])
  const recomputeClusters = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const b = map.getBounds()
    const zoom = Math.round(map.getZoom())
    setClusterFeatures(
      superclusterIndex.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], zoom)
    )
  }, [superclusterIndex])

  useEffect(() => {
    if (mapLoaded) recomputeClusters()
  }, [mapLoaded, recomputeClusters])

  const zoomToCluster = useCallback((clusterId: number, lng: number, lat: number) => {
    const expansionZoom = Math.min(superclusterIndex.getClusterExpansionZoom(clusterId), 18)
    mapRef.current?.getMap()?.flyTo({ center: [lng, lat], zoom: expansionZoom, duration: 600 })
  }, [superclusterIndex])

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
    if (baseMap !== 'satellite' || !MAPTILER_KEY || tourActive) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const b = map.getBounds()
    const z0 = Math.round(map.getZoom())
    const seen = prefetchedRef.current
    if (seen.size > 1500) seen.clear()
    const urls: string[] = []
    for (const z of [z0 + 1, z0 + 2]) {
      if (z < 1 || z > 20) continue
      const n = 2 ** z
      const xMin = Math.floor(((b.getWest() + 180) / 360) * n)
      const xMax = Math.floor(((b.getEast() + 180) / 360) * n)
      const yMin = lat2tileY(b.getNorth(), z)
      const yMax = lat2tileY(b.getSouth(), z)
      if ((xMax - xMin + 1) * (yMax - yMin + 1) > 40) continue
      for (let x = xMin; x <= xMax && urls.length < 40; x++) {
        for (let y = yMin; y <= yMax && urls.length < 40; y++) {
          if (y < 0 || y >= n) continue
          const xx = ((x % n) + n) % n
          const url = `https://api.maptiler.com/tiles/satellite-v2/${z}/${xx}/${y}.jpg?key=${MAPTILER_KEY}`
          if (seen.has(url)) continue
          seen.add(url)
          urls.push(url)
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
      recomputeClusters()
      schedulePrefetch()
      if (!onBoundsChange) return
      const map = mapRef.current?.getMap()
      if (!map) return
      const bounds = map.getBounds()
      onBoundsChange({
        minLat: bounds.getSouth(),
        minLng: bounds.getWest(),
        maxLat: bounds.getNorth(),
        maxLng: bounds.getEast(),
      }, map.getZoom())
    }, 150)
  }, [onBoundsChange, recomputeClusters, schedulePrefetch, tourActive])

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
      .map(area => {
        // 如果选择了指标，使用热力图颜色
        let fillColor = area.color || '#3b82f6'
        if (areaMetric !== 'none') {
          const rawValue = getMetricRawValue(area, areaMetric)
          fillColor = getHeatmapColor(rawValue, areaMetric, percentiles)
        }

        return {
          type: 'Feature' as const,
          id: area.id,
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

  // Hover handlers for areas and POIs
  const handleMouseMove = useCallback((e: MapLayerMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return

    if (e.features?.length) {
      const layerId = e.features[0].layer?.id
      // Change cursor for clickable layers
      map.getCanvas().style.cursor = 'pointer'

      if (layerId === 'area-fills') {
        setHoveredAreaId(e.features[0].properties?.id || null)
      }
    } else {
      map.getCanvas().style.cursor = ''
      setHoveredAreaId(null)
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (map) map.getCanvas().style.cursor = ''
    setHoveredAreaId(null)
  }, [])

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    // 测距模式：每次点击落一个点，不触发区域/POI 选择
    if (measureMode) {
      setMeasurePoints(prev => [...prev, { lng: e.lngLat.lng, lat: e.lngLat.lat }])
      return
    }

    if (!e.features?.length) return

    // Prioritize: POI > Station > Area
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
  }, [dubaiAreas, pois, onAreaClick, onPoiClick, onStationClick, measureMode])

  return (
    <div className="h-full w-full">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
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
          baseMap === 'satellite'
            ? SATELLITE_STYLE
            : baseMap === 'dark'
            ? MAP_STYLE_DARK
            : (areaMetric === 'none' ? MAP_STYLE_LABELED : MAP_STYLE_CLEAN)
        }
        interactiveLayerIds={mapLoaded ? [
          ...(areasGeoJson ? ['area-fills'] : []),
          ...(showTransport && transportGeoJSON ? ['transport-stations-bg'] : []),
          ...(poiGeoJson.features.length ? ['poi-circles'] : [])
        ] : []}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleMapClick}
      >
        {/* Area Polygons — always shown (soft default colours give customers
            orientation via area names; the tour toggles a metric to reveal value) */}
        {mapLoaded && areasGeoJson && (
          <Source id="areas" type="geojson" data={areasGeoJson}>
            <Layer
              id="area-fills"
              type="fill"
              paint={{
                'fill-color': ['get', 'color'],
                'fill-opacity': [
                  'case',
                  ['==', ['get', 'id'], hoveredAreaId],
                  ['*', ['get', 'opacity'], 0.7],  // hover: opacity * 0.7
                  ['*', ['get', 'opacity'], 0.4]   // normal: soft (matches production)
                ]
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
        {/* Tour mode: render the 2-3 tour pins directly (no clustering). Normal
            mode: render supercluster output — count bubbles + single pins, but
            only while the camera is settled (mapMoving guard). */}
        {tourActive
          ? projects.map(project => (
              <ProjectPinMarker key={project.id} project={project} onClick={onProjectClick} />
            ))
          : !mapMoving && clusterFeatures.map(f => {
              const [lng, lat] = f.geometry.coordinates
              if (f.properties.cluster) {
                return (
                  <ClusterBubble
                    key={`cluster-${f.properties.cluster_id}`}
                    count={f.properties.point_count}
                    minPrice={isFinite(f.properties.minPrice) ? f.properties.minPrice : null}
                    maxPrice={f.properties.maxPrice > 0 ? f.properties.maxPrice : null}
                    lng={lng}
                    lat={lat}
                    onClick={() => zoomToCluster(f.properties.cluster_id, lng, lat)}
                  />
                )
              }
              const project = f.properties.project as MapPinProject
              return (
                <ProjectPinMarker key={project.id} project={project} onClick={onProjectClick} />
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
      {/* 底图切换：地图 → 卫星 → 夜景 循环，放右上角（在指标条与 POI 按钮下方，避免重叠） */}
      <button
        type="button"
        onClick={() =>
          setBaseMap(prev =>
            prev === 'vector' ? 'satellite' : prev === 'satellite' ? 'dark' : 'vector'
          )
        }
        className={`absolute top-28 right-4 z-[1000] hidden md:flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur transition ${
          baseMap === 'dark'
            ? 'bg-slate-900/90 text-slate-100 ring-slate-700 hover:bg-slate-900'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title="切换底图：地图 / 卫星 / 夜景"
        aria-label="切换底图"
      >
        <Globe
          size={15}
          className={
            baseMap === 'satellite'
              ? 'text-emerald-600'
              : baseMap === 'dark'
              ? 'text-emerald-400'
              : 'text-slate-500'
          }
        />
        {baseMap === 'vector' ? '地图' : baseMap === 'satellite' ? '卫星' : '夜景'}
      </button>

      {/* 3D 倾斜：独立于底图，地图/卫星/夜景都可用 */}
      <button
        type="button"
        onClick={toggle3D}
        className={`absolute top-28 right-24 z-[1000] hidden md:flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold shadow-lg ring-1 backdrop-blur transition ${
          pitched
            ? 'bg-emerald-500 text-white ring-emerald-400 hover:bg-emerald-500'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title={pitched ? '切回平视 (2D)' : '3D 倾斜视角'}
        aria-label="切换 3D 倾斜视角"
      >
        3D
      </button>

      {/* 测距工具按钮 */}
      <button
        type="button"
        onClick={() => (measureMode ? exitMeasure() : setMeasureMode(true))}
        className={`absolute top-40 right-4 z-[1000] hidden md:flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium shadow-lg ring-1 backdrop-blur transition ${
          measureMode
            ? 'bg-blue-600 text-white ring-blue-700 hover:bg-blue-700'
            : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
        }`}
        title={measureMode ? '退出测距 (Esc)' : '测量两点距离'}
        aria-label="测距工具"
      >
        <Ruler size={15} className={measureMode ? 'text-white' : 'text-slate-500'} />
        {measureMode ? '退出' : '测距'}
      </button>

      {/* 移动端:底图/3D/测距 直接平铺成独立 pill(工具还少,放出来更直观;后面加工具继续往下堆)。
          right-3 与上方指标+POI 面板右对齐;top-[84px] 给它一个 gap-2(~8px)的间距,
          和左侧筛选/找房助手的纵向间距一致。样式对齐左侧 pill(rounded-full)。 */}
      <div data-testid="map-mobile-tools" className="md:hidden absolute top-[84px] right-3 z-[1000] flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setBaseMap(prev => (prev === 'vector' ? 'satellite' : prev === 'satellite' ? 'dark' : 'vector'))}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur transition ${
            baseMap === 'dark' ? 'bg-slate-900/90 text-slate-100 ring-slate-700' : 'bg-white/90 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
          }`}
          aria-label="切换底图"
        >
          <Globe size={15} className={baseMap === 'satellite' ? 'text-emerald-600' : baseMap === 'dark' ? 'text-emerald-400' : 'text-slate-500'} />
          {baseMap === 'vector' ? '地图' : baseMap === 'satellite' ? '卫星' : '夜景'}
        </button>
        <button
          type="button"
          onClick={toggle3D}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold shadow-lg ring-1 backdrop-blur transition ${
            pitched ? 'bg-emerald-500 text-white ring-emerald-400' : 'bg-white/90 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
          }`}
          aria-label="切换 3D 倾斜视角"
        >
          <span className="text-[13px] font-bold leading-none">{pitched ? '平视' : '3D'}</span>
        </button>
        <button
          type="button"
          onClick={() => (measureMode ? exitMeasure() : setMeasureMode(true))}
          className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium shadow-lg ring-1 backdrop-blur transition ${
            measureMode ? 'bg-blue-600 text-white ring-blue-700' : 'bg-white/90 text-slate-700 ring-slate-900/[0.06] hover:bg-white'
          }`}
          aria-label="测距工具"
        >
          <Ruler size={15} className={measureMode ? 'text-white' : 'text-slate-500'} />
          {measureMode ? '退出测距' : '测距'}
        </button>
      </div>

      {/* 测距状态条(极简,距离已画在地图线上) */}
      {measureMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 whitespace-nowrap rounded-full bg-white/95 px-3.5 py-1.5 text-xs shadow-lg ring-1 ring-slate-200 backdrop-blur">
          <span className="font-medium text-slate-700">
            {measurePoints.length === 0
              ? '点地图设中心点'
              : measurePoints.length === 1
                ? '已设中心 · 点击添加地点'
                : `中心 + ${measureSpokeKms.length} 个地点`}
          </span>
          {measurePoints.length > 0 && (
            <button
              type="button"
              onClick={() => setMeasurePoints([])}
              className="font-semibold text-blue-600"
            >
              清除
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
