import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import type { Map as MaplibreMap } from 'maplibre-gl'
import MapViewMapLibre, { AreaMetric, TransportStation } from '../components/MapViewMapLibre'
import type { MapTourHandle } from '../luna-tour/map/mapTourHandle'  // Luna Tour (isolated)
import { createMapTourHandle } from '../luna-tour/map/mapTourHandle'  // Luna Tour (isolated)
import TourOverlay from '../luna-tour/TourOverlay'  // Luna Tour (isolated)
import { useTourMode } from '../luna-tour/TourModeContext'  // Luna Tour (isolated)
// Luna collaborative tour (isolated co-presence layer). Delete collab/ to remove.
import { useCollab, type CollabMode } from '../luna-tour/collab/useCollab'
import CollabBar from '../luna-tour/collab/CollabBar'
import CollabFrame from '../luna-tour/collab/CollabFrame'
import ProjectDetailDialog from '../luna-tour/collab/ProjectDetailDialog'
import { useCollabVoice } from '../luna-tour/collab/useCollabVoice'
import { createCollabRoom, deriveHostCode, getCollabRoom } from '../luna-tour/collab/collabApi'
import CollabPresenterGuide from '../luna-tour/collab/CollabPresenterGuide'
import CollabCursorLayer from '../luna-tour/collab/CollabCursorLayer'
import { useCollabDraw } from '../luna-tour/collab/useCollabDraw'
import CollabDrawToolbar from '../luna-tour/collab/CollabDrawToolbar'
import { useAuth } from '../contexts/AuthContext'
import { isOwnerEmail } from '../lib/config'
import MapFilterChips from '../components/MapFilterChips'
import AreaSearch from '../components/AreaSearch'
import FilterDialog from '../components/FilterDialog'
import AreaDetailDialog from '../components/AreaDetailDialog'
import GuidedTour from '../components/GuidedTour'
import MobileBottomSheet from '../components/MobileBottomSheet'
import { getImageUrl } from '../lib/image-utils'
import { trackEvent } from '../lib/track'
import { satelliteThumbUrl, geomCenter } from '../lib/map/tiles'
import { useAreaInsights, AreaTrendGrid, AreaRecentTx } from '../components/AreaInsightsPanel'
import { MarketSegment, loadSavedSegment, saveSegment, segmentLabel } from '../lib/marketSegment'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import {
  Search, SlidersHorizontal, RefreshCw, Building2, MapPin, X,
  DollarSign, TrendingUp, BarChart3, Percent,
  Cross, GraduationCap, TrainFront, Phone, Globe, Navigation, ShoppingCart,
  Clock, Award
} from 'lucide-react'
import { useDubaiPois, PoiCategory, POI_CATEGORIES, POI_GROUPS, Poi, PoiDetails, getCategoryInfo, fetchPoiDetails } from '../hooks/useDubaiPois'
import { MapAction } from '../hooks/voice-assistant'
import { GuidedTourPayload } from '../hooks/voice-assistant/types'
import { useVoiceAssistantContext } from '../contexts/VoiceAssistantContext'
import { formatPrice } from '../lib/utils'
import { formatMoneyCompact } from '../lib/money'
import { isMapPath } from '../lib/isMapPath'
import MapMeterGuard, { readMapResumeView } from '../components/MapMeterGuard'
import {
  fetchResidentialMapPins,
  fetchResidentialProjectsBatch,
  fetchDubaiAreas,
  fetchDubaiLandmarks,
  fetchCustomRoutesGeoJSON,
  fetchDataVersion,
  TransportGeoJSON,
  MapPinProject
} from '../lib/api'

// Ray-casting point-in-ring (ring = array of [lng,lat]). Handles the single-ring
// case; polygon holes are ignored (area boundaries here have no holes).
function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
// Point-in-GeoJSON for Polygon | MultiPolygon (outer ring [0] of each polygon).
function pointInGeometry(pt: [number, number], geom?: GeoJSON.Geometry): boolean {
  if (!geom) return false
  if (geom.type === 'Polygon') return pointInRing(pt, geom.coordinates[0] as number[][])
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => pointInRing(pt, poly[0] as number[][]))
  return false
}

// Usage filter for the area dialog/sheet (默认全部). No data hidden — just segmented.
const USAGE_FILTER = [
  { v: 'all', zh: '全部', en: 'All' },
  { v: 'residential', zh: '住宅', en: 'Residential' },
  { v: 'commercial', zh: '商业', en: 'Commercial' },
  { v: 'hospitality', zh: '酒店', en: 'Hotel' },
  { v: 'industrial', zh: '工业', en: 'Industrial' },
  { v: 'other', zh: '其他', en: 'Other' },
]

const METRIC_OPTIONS = [
  { value: 'medianUnitPrice' as AreaMetric, labelKey: 'map:metric.medianUnitPrice', Icon: DollarSign },
  { value: 'medianPriceSqft' as AreaMetric, labelKey: 'map:metric.medianPriceSqft', Icon: DollarSign },
  { value: 'capitalGrowth' as AreaMetric, labelKey: 'map:metric.capitalGrowth', Icon: TrendingUp },
  { value: 'transactionCount' as AreaMetric, labelKey: 'map:metric.transactionCount', Icon: BarChart3 },
  { value: 'rentalYield' as AreaMetric, labelKey: 'map:metric.rentalYield', Icon: Percent },
  // 净回报 & 租赁稳定率不放进右上角指标切换 —— 它们要看明细才有意义(净回报=毛回报扣物业费),
  // 在 area block 详情里完整展示计算过程(用户反馈),不适合地图概览着色。
]


// ============================================================================
// MAP DATA VERSION - Increment this to force all clients to reload map data
// Format: YYYYMMDD or any string. When changed, all cached data will be cleared.
// ============================================================================
// 手动版本：代码/数据「形状」变化时 bump（schema 改字段等）
// 20260703: 曾有 bug 把计量门 429 错误对象写进 gulf_dubai_landmarks 缓存 → .map 崩整站;
// bump 一次让所有受影响浏览器在下次加载时自动清掉毒缓存。
const MAP_DATA_VERSION = '20260703-quota-cache-heal'

// 各市场口径的区域 payload 会话缓存（切口径 0ms 回切；数据版本变化时清空）。
// 只有 'all' 落 localStorage（首屏），期房/现房仅内存——避免持久层塞 3 份大 payload。
const areasSegmentCache = new Map<MarketSegment, DubaiArea[]>()

// 所有需随数据失效的客户端缓存键
const GULF_CACHE_KEYS = [
  'gulf_residential_developers', 'gulf_residential_developers_timestamp',
  'gulf_residential_areas', 'gulf_residential_areas_timestamp',
  'gulf_residential_projects', 'gulf_residential_projects_timestamp',
  'gulf_dubai_areas', 'gulf_dubai_areas_timestamp',
  'gulf_dubai_areas_v2', 'gulf_dubai_areas_v2_timestamp',
  'gulf_dubai_landmarks', 'gulf_dubai_landmarks_timestamp',
  'gulf_residential_mappins', 'gulf_residential_mappins_timestamp',
  'dubai_pois_cache',
  'transport-geojson-cache',
]
function clearGulfCache() {
  GULF_CACHE_KEYS.forEach(key => localStorage.removeItem(key))
}

// 手动常量检查（代码/形状变化）——模块加载时同步执行
function checkAndClearCache() {
  const cachedVersion = localStorage.getItem('gulf_map_data_version')
  if (cachedVersion !== MAP_DATA_VERSION) {
    console.log(`[MapPage] code version ${cachedVersion} → ${MAP_DATA_VERSION}, clearing cache`)
    clearGulfCache()
    localStorage.setItem('gulf_map_data_version', MAP_DATA_VERSION)
    return true
  }
  return false
}

// Run on module load
checkAndClearCache()

// KHDA official school rating → badge style + Chinese label.
// Scale (best→worst): Outstanding, Very Good, Good, Acceptable, Weak, Very Weak.
function getKhdaStyle(rating?: string): { bg: string; text: string; zh: string } | null {
  if (!rating) return null
  const r = rating.trim().toLowerCase()
  const map: Record<string, { bg: string; text: string; zh: string }> = {
    'outstanding': { bg: '#047857', text: '#fff', zh: '卓越' },
    'very good': { bg: '#059669', text: '#fff', zh: '优秀' },
    'good': { bg: '#2563eb', text: '#fff', zh: '良好' },
    'acceptable': { bg: '#d97706', text: '#fff', zh: '合格' },
    'weak': { bg: '#dc2626', text: '#fff', zh: '欠佳' },
    'very weak': { bg: '#991b1b', text: '#fff', zh: '很差' },
  }
  return map[r] || { bg: '#475569', text: '#fff', zh: rating }
}

export default function MapPage() {
  const { t, i18n } = useTranslation(['map', 'common'])
  const navigate = useNavigate()
  const voiceContext = useVoiceAssistantContext()
  // Luna Tour: run a shared session ON this map. Supports both /v/:code and the
  // cleaner homepage form  /?toursession=xxx  (user preference).
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  // MapPage is mounted persistently (outside the /v/:code & /t/:code routes) so
  // the WebGL map is never torn down on tab switches. That means useParams() no
  // longer sees the :code segment — derive it from the pathname instead. Matches
  // both /v/<code> (tour) and /t/<code> (collab viewer).
  const pathCode = (() => {
    const m = location.pathname.match(/^\/[vt]\/(.+)$/)
    return m ? decodeURIComponent(m[1]) : undefined
  })()
  // /t/:code is the collab co-presence route, NOT a luna-tour session. Only
  // /v/:code (and ?toursession=) drive the luna-tour overlay. Without this guard
  // a /t/ link's :code would also feed tourCode → TourOverlay shows
  // "导览不存在" on top of the collab UI.
  const isCollabViewerPath = location.pathname.startsWith('/t/')
  const tourCode = (isCollabViewerPath ? undefined : pathCode) || searchParams.get('toursession') || undefined
  // agent edit/preview mode (?edit=1): pause shows a "comment for AI" composer
  const tourEditMode = searchParams.get('edit') === '1'
  const tourMapRef = useRef<MapTourHandle>(null)
  const { toolsRevealed } = useTourMode()

  // ── Collaborative tour (co-presence) ──────────────────────────────────────
  // Three modes: 'browse' (default, unchanged), 'presenter' (owner starts a
  // tour), 'viewer' (a guest opened a /t/:code link — public, no login).
  const { user } = useAuth()
  const isOwner = isOwnerEmail(user?.email)
  // Viewer session is STICKY: captured from /t/:code, then KEPT across in-app
  // navigation (and reloads, via sessionStorage) so a client roaming the real app
  // never drops the tour. Cleared only on explicit exit. (Presenter already
  // survives nav via state + ?host, so it stays as-is.)
  const [viewerCode, setViewerCode] = useState<string | undefined>(() => {
    try { return sessionStorage.getItem('collabViewerCode') || undefined } catch { return undefined }
  })
  useEffect(() => {
    if (isCollabViewerPath && pathCode) {
      setViewerCode(pathCode)
      try { sessionStorage.setItem('collabViewerCode', pathCode) } catch { /* ignore */ }
    }
  }, [isCollabViewerPath, pathCode])
  // A session restored from storage (not a fresh /t/ visit) might point at a tour
  // that already ended — verify the room exists so we don't reconnect-loop into a
  // dead room; drop it if gone.
  const viewerValidatedRef = useRef(false)
  useEffect(() => {
    if (viewerValidatedRef.current || isCollabViewerPath) return
    viewerValidatedRef.current = true
    let restored: string | null = null
    try { restored = sessionStorage.getItem('collabViewerCode') } catch { /* ignore */ }
    if (!restored) return
    getCollabRoom(restored).then((info) => {
      if (!info.exists) {
        setViewerCode(undefined)
        try { sessionStorage.removeItem('collabViewerCode') } catch { /* ignore */ }
      }
    }).catch(() => {})
  }, [isCollabViewerPath])
  const [presenterCode, setPresenterCode] = useState<string | undefined>(undefined)
  const collabMode: CollabMode = viewerCode ? 'viewer' : presenterCode ? 'presenter' : 'browse'
  const collabCode = viewerCode || presenterCode
  const collabActive = collabMode !== 'browse'
  const [shareCopied, setShareCopied] = useState(false)
  // In-collab project detail drawer (synced presenter↔viewer; never navigates).
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [projectTab, setProjectTab] = useState('overview')
  const openProjectIdRef = useRef<string | null>(null)
  useEffect(() => { openProjectIdRef.current = openProjectId }, [openProjectId])
  // Viewer's follow state, in a ref the remote handlers can read: when the client
  // has DETACHED (Free), we don't force the presenter's panels open on them — they
  // get to explore on their own ("share everything… unless they detached").
  const followFreeRef = useRef(false)

  // Live maplibre instance for the collab hooks (set via onMapReady). The camera
  // is driven imperatively through this — never via React state (perf rule).
  const collabMapRef = useRef<MaplibreMap | null>(null)
  const getCollabMap = useCallback(() => collabMapRef.current, [])
  // One cinematic handle for the collab layer's flyTo (goto events). Built lazily.
  const collabHandleRef = useRef<MapTourHandle | null>(null)
  if (!collabHandleRef.current) {
    collabHandleRef.current = createMapTourHandle({ getMap: getCollabMap, accent: '#00E0B8' })
  }
  const collabFlyTo = useCallback(
    (a: { center: [number, number]; zoom: number; bearing: number; pitch: number }) => {
      collabHandleRef.current?.flyTo({ center: a.center, zoom: a.zoom, bearing: a.bearing, pitch: a.pitch })
    },
    []
  )
  // Senders live in a ref so the page handlers (declared above the useCollab
  // call) can broadcast without a circular dependency.
  const collabSendRef = useRef<{
    sendSelect: (kind: 'project' | 'area', id: string, tab?: string) => void
    sendMapAction: (action: unknown) => void
  }>({ sendSelect: () => {}, sendMapAction: () => {} })
  // presenter-active flag in a ref so stable handlers (handleProjectClick) can
  // branch without taking collab state as a dependency.
  const collabActiveRef = useRef(false)
  // in a collab session at all (presenter OR viewer) — viewers must also open
  // detail in-place instead of navigating (which would tear down the session).
  const collabAnyRef = useRef(false)
  // Tour mode: the overlay reports its 2-3 properties; the main map renders ONLY
  // these as native (clickable) pins — not the whole search-result marker sea.
  const [tourPins, setTourPins] = useState<MapPinProject[]>([])

  // Entering a tour → clean map (the tour toggles the area-value heatmap itself);
  // leaving → restore the user's saved metric. Never persists the tour's choice.
  useEffect(() => {
    if (tourCode) {
      setAreaMetric('none')
    } else {
      const saved = localStorage.getItem('map-area-metric') as AreaMetric | null
      if (saved) setAreaMetric(saved)
    }
  }, [tourCode])
  const [filters, setFilters] = useState<PropertyFilters>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [mapPins, setMapPins] = useState<MapPinProject[]>([])
  const [mapReady, setMapReady] = useState(false) // first map frame settled → fade out the load overlay
  const [mapBounds, setMapBounds] = useState<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null)

  // Derive filter lists from mapPins (no extra API calls needed)
  const developers = useMemo(() =>
    [...new Set(mapPins.map(p => p.developer).filter(Boolean))].sort(),
    [mapPins]
  )
  const areas = useMemo(() =>
    [...new Set(mapPins.map(p => p.area).filter(Boolean))].sort(),
    [mapPins]
  )
  const projects = useMemo(() =>
    mapPins
      .map(p => ({ project_name: p.name, developer: p.developer }))
      .sort((a, b) => a.project_name.localeCompare(b.project_name)),
    [mapPins]
  )

  // Dubai areas and landmarks state
  const [dubaiAreas, setDubaiAreas] = useState<DubaiArea[]>([])
  const [dubaiLandmarks, setDubaiLandmarks] = useState<DubaiLandmark[]>([])
  const [dubaiDataVersion, setDubaiDataVersion] = useState(0)

  // 服务端数据版本自动失效：每次后端数据导入(指纹变化)→ 自动清缓存+重拉。
  // 无需每次手动 bump MAP_DATA_VERSION。失败则不动缓存(避免误清)。
  useEffect(() => {
    let alive = true
    fetchDataVersion().then(v => {
      if (!alive || !v || v === 'unknown') return
      const stored = localStorage.getItem('gulf_server_data_version')
      if (stored !== v) {
        console.log(`[MapPage] server data version ${stored} → ${v}, clearing cache`)
        clearGulfCache()
        localStorage.setItem('gulf_server_data_version', v)
        setDubaiDataVersion(x => x + 1)  // 触发既有 fetch effect 重拉
      }
    })
    return () => { alive = false }
  }, [])

  // Loading states
  const [_isLoadingPins, setIsLoadingPins] = useState(false)
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false)

  // Area metric overlay state — persisted in localStorage
  const [areaMetric, setAreaMetric] = useState<AreaMetric>(() => {
    const saved = localStorage.getItem('map-area-metric')
    // Migrate old values
    if (saved === 'salesVolume') return 'transactionCount'
    if (saved === 'avgPrice' || saved === 'avgPriceSqft') return 'medianPriceSqft'
    if (saved === 'medianPrice') return 'medianUnitPrice'
    if (saved && ['medianUnitPrice', 'medianPriceSqft', 'capitalGrowth', 'transactionCount', 'rentalYield', 'netYield', 'none'].includes(saved)) {
      return saved as AreaMetric
    }
    return 'none'
  })
  const handleMetricToggle = (value: AreaMetric) => {
    const next = areaMetric === value ? 'none' : value
    setAreaMetric(next)
    localStorage.setItem('map-area-metric', next)
  }

  // 市场口径筛选器（全部/期房/现房）——联动整张地图区域数字/着色 + 区域弹窗。
  // 数据后端三口径全预算好按口径分 key 缓存，切换=取现成 payload，无重查询。
  const [marketSegment, setMarketSegment] = useState<MarketSegment>(loadSavedSegment)
  const lastAreasVersionRef = useRef(0)
  const handleSegmentChange = (seg: MarketSegment) => {
    setMarketSegment(seg)
    saveSegment(seg)
  }


  // POI state — persisted in localStorage (default: true)
  const [showPois] = useState(() => {
    const saved = localStorage.getItem('map-show-pois')
    return saved === null ? true : saved === 'true'
  })
  const [showPoiPanel, setShowPoiPanel] = useState(false)
  const [enabledPoiCategories, setEnabledPoiCategories] = useState<PoiCategory[]>(() => {
    const saved = localStorage.getItem('map-poi-categories')
    if (saved) {
      try {
        return JSON.parse(saved) as PoiCategory[]
      } catch { /* ignore */ }
    }
    // Default: show school
    return ['school']
  })

  // Transport layer state - single toggle for all transit (Metro/Tram/Monorail)
  const [showTransit, setShowTransit] = useState<boolean>(() => {
    return localStorage.getItem('map-show-transit') === 'true'
  })
  // Custom routes - no localStorage cache, always fetch fresh
  const [transportGeoJSON, setTransportGeoJSON] = useState<TransportGeoJSON | null>(null)
  const showTransport = showTransit

  // Quick toggle buttons - single categories
  const QUICK_BUTTONS = [
    { id: 'hospital' as PoiCategory, labelKey: 'map:poi.categories.hospital', color: '#0d9488', Icon: Cross },
    { id: 'school' as PoiCategory, labelKey: 'map:poi.categories.school', color: '#2563eb', Icon: GraduationCap },
    { id: 'supermarket' as PoiCategory, labelKey: 'map:poi.categories.supermarket', color: '#db2777', Icon: ShoppingCart },
  ] as const

  const { pois } = useDubaiPois({
    bounds: mapBounds || undefined,
    enabledCategories: enabledPoiCategories,
    enabled: showPois
  })


  const togglePoiCategory = useCallback((category: PoiCategory) => {
    setEnabledPoiCategories(prev => {
      const next = prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
      localStorage.setItem('map-poi-categories', JSON.stringify(next))
      return next
    })
  }, [])

  const toggleAllPoiCategories = useCallback((enable: boolean) => {
    const next = enable ? POI_CATEGORIES.map(c => c.id) : []
    setEnabledPoiCategories(next)
    localStorage.setItem('map-poi-categories', JSON.stringify(next))
  }, [])

  // Transit toggle - all Metro/Tram/Monorail
  const toggleTransit = useCallback(() => {
    setShowTransit(prev => {
      const next = !prev
      localStorage.setItem('map-show-transit', String(next))
      return next
    })
  }, [])

  // Fetch custom routes GeoJSON when transit is enabled (always fresh, no cache)
  useEffect(() => {
    if (showTransit) {
      // Always fetch fresh data when transit is shown
      fetchCustomRoutesGeoJSON().then(data => {
        if (data) {
          setTransportGeoJSON(data)
        }
      })
    }
  }, [showTransit])

  // Area detail dialog state
  const [showAreaDialog, setShowAreaDialog] = useState(false)
  const [selectedArea, setSelectedArea] = useState<DubaiArea | null>(null)
  // 切口径拉到新 payload 后，让打开中的区域弹窗/底部 sheet 拿到同口径的 area 对象
  useEffect(() => {
    setSelectedArea(prev => prev ? (dubaiAreas.find(a => a.id === prev.id) ?? prev) : prev)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dubaiAreas])
  const [areaProjects, setAreaProjects] = useState<any[]>([])
  const [isLoadingAreaProjects, setIsLoadingAreaProjects] = useState(false)

  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; zoom?: number; bounds?: [[number, number], [number, number]] } | null>(null)
  // Project pins to pulse (so the customer sees which projects Luna is discussing).
  const [flashProjectIds, setFlashProjectIds] = useState<string[] | undefined>(undefined)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // POI popup state
  const [selectedPoi, setSelectedPoi] = useState<Poi | null>(null)
  const [poiDetails, setPoiDetails] = useState<PoiDetails | null>(null)
  const [poiDetailsLoading, setPoiDetailsLoading] = useState(false)

  // Lazy-load full POI details (photo/description/KHDA) when a popup opens
  useEffect(() => {
    if (!selectedPoi) { setPoiDetails(null); setPoiDetailsLoading(false); return }
    let cancelled = false
    setPoiDetails(null)
    setPoiDetailsLoading(true)
    fetchPoiDetails(selectedPoi.id).then(d => {
      if (cancelled) return
      setPoiDetails(d)
      setPoiDetailsLoading(false)
    })
    return () => { cancelled = true }
  }, [selectedPoi])

  // Transport station popup state
  const [selectedStation, setSelectedStation] = useState<TransportStation | null>(null)

  // Landmark popup state
  const [selectedLandmark, setSelectedLandmark] = useState<DubaiLandmark | null>(null)
  // Presenter: mirror landmark popup open/close to viewers. One effect covers
  // every open AND close path uniformly; viewers don't broadcast (gate inside).
  useEffect(() => {
    if (!collabActiveRef.current) return
    collabSendRef.current.sendMapAction({ type: '__collab_landmark', landmark: selectedLandmark })
  }, [selectedLandmark])
  // Same mirroring for POI + transport-station popups, so "everything the agent
  // opens, the client sees" — not just landmarks. Viewers re-fetch details from
  // their own setSelected* effects, so broadcasting the bare object is enough.
  useEffect(() => {
    if (!collabActiveRef.current) return
    collabSendRef.current.sendMapAction({ type: '__collab_poi', poi: selectedPoi })
  }, [selectedPoi])
  useEffect(() => {
    if (!collabActiveRef.current) return
    collabSendRef.current.sendMapAction({ type: '__collab_station', station: selectedStation })
  }, [selectedStation])

  // Voice-triggered distance measurement
  const [voiceMeasure, setVoiceMeasure] = useState<{ points: [number, number][]; noFit?: boolean } | null>(null)
  const [voiceAmenities, setVoiceAmenities] = useState<{
    center: [number, number]; centerName: string; score: number; tier: string
    spokes: { category: string; label: string; emoji: string; name: string; lng: number; lat: number; distanceKm: number }[]
  } | null>(null)

  // Voice assistant map action handler
  const handleVoiceMapAction = useCallback((action: MapAction) => {
    console.log('[MapPage] Voice assistant map action:', action)

    switch (action.type) {
      case 'fly_to':
        if (action.lat && action.lng) {
          setFlyToLocation({ lat: action.lat, lng: action.lng, zoom: action.zoom || 14 })
        }
        break

      case 'highlight_projects':
        if (action.bounds) {
          // Multi-project: fitBounds to show all projects
          setFlyToLocation({
            lat: (action.bounds.sw[1] + action.bounds.ne[1]) / 2,
            lng: (action.bounds.sw[0] + action.bounds.ne[0]) / 2,
            bounds: [action.bounds.sw, action.bounds.ne]
          })
        } else if (action.lat && action.lng) {
          setFlyToLocation({ lat: action.lat, lng: action.lng, zoom: action.zoom || 11 })
        }
        // Pulse the discussed project pins so the customer sees which ones Luna means.
        if (Array.isArray(action.projectIds) && action.projectIds.length) {
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          setFlashProjectIds(action.projectIds)
          flashTimerRef.current = setTimeout(() => setFlashProjectIds(undefined), 6000)
        }
        break

      case 'show_pois':
        if (action.category) {
          // Toggle the SAME POI filter the customer controls (single source of
          // truth). hide=true removes the category; otherwise add it.
          const cat = action.category as PoiCategory
          setEnabledPoiCategories(prev => {
            const next = action.hide ? prev.filter(c => c !== cat) : (prev.includes(cat) ? prev : [...prev, cat])
            localStorage.setItem('map-poi-categories', JSON.stringify(next))
            return next
          })
        }
        break

      case 'toggle_transport':
        setShowTransit(action.show ?? true)
        break

      case 'show_area_info':
        // Show rental yield choropleth overlay + fly to area
        setAreaMetric('rentalYield')
        if (action.lat && action.lng) {
          setFlyToLocation({ lat: action.lat, lng: action.lng, zoom: action.zoom || 12 })
        }
        break

      case 'measure_distance':
        if (action.points && action.points.length >= 2) {
          // 新引用确保每次调用都触发 MapView 的 effect
          setVoiceMeasure({ points: action.points.map(p => [p[0], p[1]] as [number, number]) })
        }
        break

      case 'amenity_spokes':
        if (action.center && action.spokes && action.spokes.length) {
          setVoiceMeasure(null) // 与手动测距互斥
          setVoiceAmenities({
            center: action.center,
            centerName: action.centerName || '',
            score: action.score ?? 0,
            tier: action.tier || '',
            spokes: action.spokes,
          })
          // 自动取景：覆盖中心点 + 所有配套点
          const lngs = [action.center[0], ...action.spokes.map(s => s.lng)]
          const lats = [action.center[1], ...action.spokes.map(s => s.lat)]
          setFlyToLocation({
            lat: (Math.min(...lats) + Math.max(...lats)) / 2,
            lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
            bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          })
        }
        break

      case 'guided_tour':
        if (action.tour?.stops?.length) setGuidedTour(action.tour)
        break

      case 'navigate':
        if (action.path) {
          navigate(action.path)
        }
        break

      case 'reset':
        setFilters({})
        setEnabledPoiCategories([])
        setShowTransit(false)
        setVoiceAmenities(null)
        setVoiceMeasure(null)
        setFlyToLocation({ lat: 25.2048, lng: 55.2708, zoom: 11 }) // Default Dubai center
        break
    }
  }, [navigate])

  // Register voice map action handler with global context. In presenter mode we
  // also broadcast each Luna mapAction into the room (§8) so the whole room sees
  // the data appear; the local run is unchanged.
  useEffect(() => {
    const handler = (action: MapAction) => {
      handleVoiceMapAction(action)
      collabSendRef.current.sendMapAction(action)
    }
    voiceContext.registerMapActionHandler(handler)
    return () => voiceContext.unregisterMapActionHandler()
  }, [voiceContext, handleVoiceMapAction])

  // Remote collab events → reuse the existing local handlers (idempotent).
  const handleRemoteSelect = useCallback(
    (kind: 'project' | 'area', id: string, tab?: string) => {
      if (kind === 'project') {
        // empty id = presenter closed the project drawer → close ours.
        if (!id) {
          setOpenProjectId(null)
          return
        }
        if (followFreeRef.current) return // detached client explores on their own
        const isNew = openProjectIdRef.current !== id
        setOpenProjectId(id)
        if (tab) setProjectTab(tab)
        // only fly when it's a freshly opened project (tab-only updates shouldn't move the camera)
        if (isNew) {
          const pin = mapPins.find((p) => p.id === id)
          if (pin) setFlyToLocation({ lat: pin.lat, lng: pin.lng, zoom: 15 })
        }
      } else {
        // empty id = presenter closed the area panel → close ours too.
        if (!id) {
          setShowAreaDialog(false)
          setShowAreaSheet(false)
          return
        }
        if (followFreeRef.current) return // detached client explores on their own
        const area = dubaiAreas.find((a) => a.id === id)
        if (area) handleAreaClick(area)
      }
    },
    [mapPins, dubaiAreas]
  )

  // Close the area panel; presenter broadcasts a clear so viewers close in sync.
  const handleCloseArea = useCallback(() => {
    trackEvent('area_detail', { action: 'close' })
    setShowAreaDialog(false)
    setShowAreaSheet(false)
    if (collabActiveRef.current) collabSendRef.current.sendSelect('area', '')
  }, [])

  // Close the project drawer; presenter broadcasts a clear so viewers close too.
  const handleCloseProject = useCallback(() => {
    setOpenProjectId(null)
    if (collabActiveRef.current) collabSendRef.current.sendSelect('project', '')
  }, [])

  // Presenter switches a project tab → viewers follow.
  const handleProjectTabChange = useCallback((tab: string) => {
    setProjectTab(tab)
    if (collabActiveRef.current && openProjectIdRef.current) {
      collabSendRef.current.sendSelect('project', openProjectIdRef.current, tab)
    }
  }, [])
  const handleRemoteMapAction = useCallback(
    (action: unknown) => {
      // internal collab broadcast: presenter's landmark / POI / station popups.
      const a = action as {
        type?: string
        landmark?: DubaiLandmark | null
        poi?: Poi | null
        station?: TransportStation | null
        points?: [number, number][] | null
        on?: boolean
      }
      // Map drawing/markup ops are owned by useCollabDraw (its own subscription).
      if (a?.type === '__collab_draw') return
      // Presenter's distance ruler → mirror it on the viewer (renders via voiceMeasure).
      if (a?.type === '__collab_measure') {
        setVoiceMeasure(a.points && a.points.length ? { points: a.points, noFit: true } : null)
        return
      }
      // A detached (Free) viewer is exploring on their own — don't yank panels open.
      const detached = followFreeRef.current
      if (a?.type === '__collab_landmark') {
        if (!detached) setSelectedLandmark(a.landmark ?? null)
        return
      }
      if (a?.type === '__collab_poi') {
        if (!detached) setSelectedPoi(a.poi ?? null)
        return
      }
      if (a?.type === '__collab_station') {
        if (!detached) setSelectedStation(a.station ?? null)
        return
      }
      if (a?.type === '__collab_voice') {
        // presenter started/stopped voice → viewer's mic button reflects it
        setPresenterVoiceOn(!!a.on)
        return
      }
      handleVoiceMapAction(action as MapAction)
    },
    [handleVoiceMapAction]
  )

  const collab = useCollab({
    mode: collabMode,
    code: collabCode,
    name: collabMode === 'presenter' ? (user?.email?.split('@')[0] || 'Ahmed') : '访客',
    getMap: getCollabMap,
    flyTo: collabFlyTo,
    onRemoteSelect: handleRemoteSelect,
    onRemoteMapAction: handleRemoteMapAction,
  })
  useEffect(() => {
    collabSendRef.current = { sendSelect: collab.sendSelect, sendMapAction: collab.sendMapAction }
  }, [collab.sendSelect, collab.sendMapAction])
  useEffect(() => {
    collabActiveRef.current = collabMode === 'presenter'
    collabAnyRef.current = collabMode !== 'browse'
  }, [collabMode])
  useEffect(() => { followFreeRef.current = collab.followMode === 'free' }, [collab.followMode])

  // Circle "draw-to-query": circle centre → the area under it → a compact
  // multi-line readout (name + median price + yield + recent deals). Pure
  // client-side (areas + metrics are already loaded), so no backend call.
  const getAreaInfoAtPoint = useCallback((lng: number, lat: number): string | null => {
    const zh = i18n.language?.startsWith('zh')
    const area = dubaiAreas.find((a) => pointInGeometry([lng, lat], a.boundary))
    if (!area) return null
    const name = (zh && area.translations?.zh?.name) || area.name
    const lines = [name]
    if (area.medianUnitPrice) lines.push(`${zh ? '中位价' : 'Median'} ${formatMoneyCompact(area.medianUnitPrice, i18n.language)}`)
    if (area.rentalYield) lines.push(`${zh ? '租金回报' : 'Yield'} ${area.rentalYield.toFixed(1)}%`)
    if (area.transactionCount) lines.push(`${zh ? '成交' : 'Deals'} ${area.transactionCount.toLocaleString('en-US')}`)
    return lines.join('\n')
  }, [dubaiAreas, i18n.language])

  // Map drawing / markup (pen / arrow / text / pin / circle), geo-anchored +
  // broadcast to the room. Circle uses getAreaInfoAtPoint for draw-to-query.
  const draw = useCollabDraw({ getMap: getCollabMap, client: collab.client, active: collabActive, getAreaInfo: getAreaInfoAtPoint })

  // Presenter's distance-measure → broadcast so viewers see the same ruler.
  const handleMeasureChange = useCallback((points: [number, number][] | null) => {
    if (collabActiveRef.current) collabSendRef.current.sendMapAction({ type: '__collab_measure', points })
  }, [])

  // Hide the global Luna pill during a collab live tour (in-session UI replaces it).
  const setLunaHidden = voiceContext.setHidden
  useEffect(() => {
    setLunaHidden(collabActive)
    return () => setLunaHidden(false)
  }, [collabActive, setLunaHidden])

  // In-app voice (Agora) — presenter starts a call, viewer joins; cost guards
  // (30min/session, 3h/day/agent) are enforced server-side.
  const voice = useCollabVoice({
    mode: collabMode,
    roomCode: collabCode,
    agentEmail: user?.email ?? undefined,
  })
  // viewer learns the presenter has voice on (proactive "join voice" prompt)
  const [presenterVoiceOn, setPresenterVoiceOn] = useState(false)
  // presenter broadcasts when its voice goes live / ends, so viewers can join
  const prevVoiceLiveRef = useRef(false)
  useEffect(() => {
    if (collabMode !== 'presenter') return
    const live = voice.status === 'live'
    if (live !== prevVoiceLiveRef.current) {
      prevVoiceLiveRef.current = live
      collabSendRef.current.sendMapAction({ type: '__collab_voice', on: live })
    }
  }, [voice.status, collabMode])

  // The other party's display name for the session bar / Free pill.
  const collabPeerName = useMemo(() => {
    const peer = collab.participants.find((p) =>
      collabMode === 'presenter' ? p.role === 'viewer' : p.role === 'presenter'
    )
    return peer?.name
  }, [collab.participants, collabMode])

  // Start a tour (owner only): create a room, enter presenter mode.
  const handleStartTour = useCallback(async () => {
    try {
      // Stable per-agent code → the agent (and their clients) always use the SAME
      // link; the server revives that room on reconnect so old links never die.
      const seed = user?.id || user?.email || ''
      const stable = seed ? deriveHostCode(seed) : undefined
      const { code } = await createCollabRoom(user?.email?.split('@')[0] || undefined, stable)
      setPresenterCode(code)
      // Persist the room in the URL (?host=code) so a refresh re-enters presenter
      // mode and rejoins the SAME room (server reclaims the camera on reconnect).
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.set('host', code); return n }, { replace: true })
    } catch (e) {
      console.error('[collab] failed to create room', e)
    }
  }, [user?.id, user?.email, setSearchParams])

  // Presenter refresh / deep-link (?host=code): re-enter presenter mode and rejoin
  // the existing room (no new room created). Runs once.
  const hostResumedRef = useRef(false)
  useEffect(() => {
    if (hostResumedRef.current) return
    const host = searchParams.get('host')
    if (!host || !isOwner || viewerCode || presenterCode) return
    hostResumedRef.current = true
    setPresenterCode(host)
  }, [searchParams, isOwner, viewerCode, presenterCode])

  // Deep-link from the agent console (/?livetour=1): auto-start a live tour once
  // auth resolves to owner. Strip the param so refresh/back doesn't re-trigger.
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current) return
    if (searchParams.get('livetour') !== '1') return
    if (!isOwner || collabActive || presenterCode) return
    autoStartedRef.current = true
    const next = new URLSearchParams(searchParams)
    next.delete('livetour')
    setSearchParams(next, { replace: true })
    void handleStartTour()
  }, [searchParams, isOwner, collabActive, presenterCode, handleStartTour, setSearchParams])

  const collabShareUrl = presenterCode ? `${window.location.origin}/t/${presenterCode}` : undefined

  // Presenter onboarding card ("share your link") — shown until dismissed; reset
  // each time a new tour starts. A viewer joining flips it to the success state.
  const [guideDismissed, setGuideDismissed] = useState(false)
  useEffect(() => { setGuideDismissed(false) }, [presenterCode])
  const hasViewer = useMemo(
    () => collab.participants.some((p) => p.role === 'viewer'),
    [collab.participants]
  )
  const handleCopyShare = useCallback(() => {
    if (!collabShareUrl) return
    navigator.clipboard?.writeText(collabShareUrl).then(
      () => {
        setShareCopied(true)
        setTimeout(() => setShareCopied(false), 1800)
      },
      () => {}
    )
  }, [collabShareUrl])

  const handleExitCollab = useCallback(() => {
    // Confirm so a client doesn't drop the tour by a stray tap.
    const msg = viewerCode ? '确定退出这场实时带看吗?' : '确定结束这场实时带看吗?'
    if (typeof window !== 'undefined' && !window.confirm(msg)) return
    if (viewerCode) {
      setViewerCode(undefined)
      try { sessionStorage.removeItem('collabViewerCode') } catch { /* ignore */ }
      if (location.pathname.startsWith('/t/')) navigate('/')
    } else {
      setPresenterCode(undefined)
      // drop ?host so a later refresh doesn't rejoin the ended tour
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('host'); return n }, { replace: true })
    }
  }, [viewerCode, location.pathname, navigate, setSearchParams])

  // Guard against closing/refreshing the tab mid-tour — a native "Leave site?"
  // prompt. (In-app navigation no longer drops the session, so this is the main
  // accidental-exit vector left.)
  useEffect(() => {
    if (!collabActive) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [collabActive])

  // Map ready → store the live instance for the collab hooks. NOTE: we used to
  // auto-detach (→ Free) on the viewer's first map gesture. That made clients lose
  // the presenter's view by accident, so detach is now EXPLICIT only — the client
  // taps「自己看」in the session bar. No gesture→Free wiring here anymore.
  const handleCollabMapReady = useCallback((map: MaplibreMap) => {
    collabMapRef.current = map
  }, [])

  // ── 匿名地图限时(MapMeterGuard)────────────────────────────────────────
  // 命令式读当前视角(不进 state,perf 规则);登录跳转前存现场用。
  const getMeterView = useCallback(() => {
    const map = collabMapRef.current
    if (!map) return null
    const c = map.getCenter()
    return { longitude: c.lng, latitude: c.lat, zoom: map.getZoom() }
  }, [])
  // 整页刷新回来(登录跳转 / 计量锁的强制刷新)→ 一次性恢复离开时的视角
  // (卡片承诺过「你刚才看的位置会原样保留」)。SPA 内导航地图常驻,视角天然保留。
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current) return
    resumedRef.current = true
    const v = readMapResumeView()
    if (v) setFlyToLocation({ lat: v.latitude, lng: v.longitude, zoom: v.zoom })
  }, [])

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Mobile bottom sheet state
  const [showAreaSheet, setShowAreaSheet] = useState(false)
  // Luna guided walkthrough (优势/环境/成交 序列带看)
  const [guidedTour, setGuidedTour] = useState<GuidedTourPayload | null>(null)
  // Dev-only test hook so the guided tour can be driven without the live voice pipeline.
  if (import.meta.env.DEV) (window as any).__lunaGuidedTour = setGuidedTour
  // 移动端 sheet 的 usage 口径(默认全部)+ 市场/项目 tab，新区打开时重置
  const [sheetUsage, setSheetUsage] = useState('all')
  const [sheetTab, setSheetTab] = useState<'market' | 'projects'>('market')
  useEffect(() => { setSheetUsage('all'); setSheetTab('market') }, [selectedArea?.id])
  // 移动端 sheet 的区域洞察（桌面 dialog 内部自取，后端缓存去重）
  const { insights: sheetInsights, loading: sheetInsightsLoading } = useAreaInsights(
    showAreaSheet ? selectedArea?.id : undefined, sheetUsage, marketSegment
  )

  // Load Dubai areas & landmarks (with caching)
  // 区域数据按市场口径（marketSegment）取：'all' 走 localStorage 持久缓存（首屏），
  // 期房/现房只进会话内存缓存（避免 localStorage 塞 3 份 ~600KB payload）。
  // 切口径：内存命中 = 0ms；未命中拉一次（服务端按口径预渲染缓存，~200ms）。
  useEffect(() => {
    const DUBAI_CACHE_DURATION = 24 * 60 * 60 * 1000
    let stale = false

    // 数据版本变化（编辑器改动/每日刷新）→ 先清各口径缓存再取，保证拉到新数据
    if (dubaiDataVersion !== lastAreasVersionRef.current) {
      lastAreasVersionRef.current = dubaiDataVersion
      areasSegmentCache.clear()
      localStorage.removeItem('gulf_dubai_areas_v2')
      localStorage.removeItem('gulf_dubai_areas_v2_timestamp')
    }

    const mem = areasSegmentCache.get(marketSegment)
    if (mem) {
      setDubaiAreas(mem)
    } else if (marketSegment === 'all') {
      const cachedDubaiAreas = localStorage.getItem('gulf_dubai_areas_v2')
      const cachedDubaiAreasTimestamp = localStorage.getItem('gulf_dubai_areas_v2_timestamp')
      let areasFromCache: DubaiArea[] | null = null
      if (cachedDubaiAreas && cachedDubaiAreasTimestamp &&
          Date.now() - parseInt(cachedDubaiAreasTimestamp) < DUBAI_CACHE_DURATION) {
        try {
          const parsed = JSON.parse(cachedDubaiAreas)
          if (Array.isArray(parsed) && parsed.length) areasFromCache = parsed // 验形状,防毒缓存
        } catch { /* 坏 JSON 当没有缓存 */ }
      }
      if (areasFromCache) {
        areasSegmentCache.set('all', areasFromCache)
        setDubaiAreas(areasFromCache)
      } else {
        fetchDubaiAreas(undefined, 'all').then((data) => {
          if (stale || !data.length) return
          areasSegmentCache.set('all', data)
          setDubaiAreas(data)
          try {
            localStorage.setItem('gulf_dubai_areas_v2', JSON.stringify(data))
            localStorage.setItem('gulf_dubai_areas_v2_timestamp', Date.now().toString())
          } catch { /* storage full — 内存缓存已够用 */ }
        })
      }
    } else {
      fetchDubaiAreas(undefined, marketSegment).then((data) => {
        if (stale || !data.length) return
        areasSegmentCache.set(marketSegment, data)
        setDubaiAreas(data)
      })
    }
    return () => { stale = true }
  }, [dubaiDataVersion, marketSegment])

  useEffect(() => {
    const DUBAI_CACHE_DURATION = 24 * 60 * 60 * 1000
    const cachedDubaiLandmarks = localStorage.getItem('gulf_dubai_landmarks')
    const cachedDubaiLandmarksTimestamp = localStorage.getItem('gulf_dubai_landmarks_timestamp')

    // 缓存必须验形状:曾有 bug 把 429 的 {success:false} 错误对象存了进来,
    // 之后每次加载 .map 直接崩整站,刷新也救不回(毒在 localStorage)。
    let cachedOk = false
    if (cachedDubaiLandmarks && cachedDubaiLandmarksTimestamp &&
        Date.now() - parseInt(cachedDubaiLandmarksTimestamp) < DUBAI_CACHE_DURATION) {
      try {
        const landmarks = JSON.parse(cachedDubaiLandmarks)
        if (Array.isArray(landmarks) && landmarks.length) {
          setDubaiLandmarks(landmarks)
          cachedOk = true
        }
      } catch { /* 坏 JSON 当没有缓存 */ }
    }
    if (!cachedOk) {
      localStorage.removeItem('gulf_dubai_landmarks')
      fetchDubaiLandmarks().then((data) => {
        if (!Array.isArray(data)) return
        setDubaiLandmarks(data)
        // 只缓存非空成功结果:配额 429 时的空数组不该占着 24h 缓存位
        if (data.length) {
          try {
            localStorage.setItem('gulf_dubai_landmarks', JSON.stringify(data))
            localStorage.setItem('gulf_dubai_landmarks_timestamp', Date.now().toString())
          } catch { /* storage full */ }
        }
      })
    }
  }, [dubaiDataVersion])

  // Listen for Dubai data updates from editor
  useEffect(() => {
    let lastReloadTime = 0

    const triggerReload = (source: string) => {
      const now = Date.now()
      if (now - lastReloadTime > 2000) {
        console.log(`🔄 Detected Dubai data update via ${source}, reloading...`)
        lastReloadTime = now
        setDubaiDataVersion(v => v + 1)
      }
    }

    const handleFocus = () => {
      const cachedTimestamp = localStorage.getItem('gulf_dubai_areas_timestamp')
      const cachedLandmarksTimestamp = localStorage.getItem('gulf_dubai_landmarks_timestamp')

      if (cachedTimestamp && Date.now() - parseInt(cachedTimestamp) < 10000) {
        triggerReload('focus')
      } else if (cachedLandmarksTimestamp && Date.now() - parseInt(cachedLandmarksTimestamp) < 10000) {
        triggerReload('focus')
      }
    }

    const handleDubaiDataUpdate = () => {
      triggerReload('custom event')
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('dubaiDataUpdated', handleDubaiDataUpdate)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('dubaiDataUpdated', handleDubaiDataUpdate)
    }
  }, [])

  // Load map pins — stale-while-revalidate: show cached pins instantly on
  // refresh (no blank wait), then refresh in the background. Cache is cleared by
  // the version-check helpers above when server/code data changes.
  useEffect(() => {
    const MAPPINS_TTL = 6 * 60 * 60 * 1000 // 6h
    let revalidated = false
    try {
      const cached = localStorage.getItem('gulf_residential_mappins')
      const ts = localStorage.getItem('gulf_residential_mappins_timestamp')
      if (cached && ts) {
        setMapPins(JSON.parse(cached))
        revalidated = Date.now() - parseInt(ts) < MAPPINS_TTL // fresh → skip refetch
      }
    } catch { /* ignore corrupt cache */ }

    if (revalidated) return

    setIsLoadingPins(true)
    fetchResidentialMapPins()
      .then((data) => {
        setMapPins(data)
        try {
          localStorage.setItem('gulf_residential_mappins', JSON.stringify(data))
          localStorage.setItem('gulf_residential_mappins_timestamp', Date.now().toString())
        } catch { /* quota — fine, just won't cache */ }
      })
      .catch((error) => console.error('Error fetching map pins:', error))
      .finally(() => setIsLoadingPins(false))
  }, []) // Load once on mount

  // Filter map pins based on current filters
  const filteredMapPins = useMemo(() => {
    if (!mapPins.length) return []

    return mapPins.filter(pin => {
      // Developer filter
      if (filters.developer && pin.developer !== filters.developer) return false

      // Area filter
      if (filters.area && pin.area !== filters.area) return false

      // Price filters (use minPrice for filtering)
      if (filters.minPrice && (!pin.minPrice || pin.minPrice < filters.minPrice)) return false
      if (filters.maxPrice && pin.minPrice && pin.minPrice > filters.maxPrice) return false

      // Bedroom filters
      if (filters.minBedrooms !== undefined && (!pin.maxBeds || pin.maxBeds < filters.minBedrooms)) return false
      if (filters.maxBedrooms !== undefined && (!pin.minBeds || pin.minBeds > filters.maxBedrooms)) return false

      // Status filter
      if (filters.status && pin.status !== filters.status) return false

      // Completion / handover date filter (交房年份) — also powers FilterDialog's date range pickers.
      // completionDateStart/End are YYYY-MM-DD; compare against the pin's completion date (date part only).
      if (filters.completionDateStart || filters.completionDateEnd) {
        const d = pin.completionDate ? pin.completionDate.slice(0, 10) : null
        if (!d) return false
        if (filters.completionDateStart && d < filters.completionDateStart) return false
        if (filters.completionDateEnd && d > filters.completionDateEnd) return false
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const matchesName = pin.name.toLowerCase().includes(query)
        const matchesDeveloper = pin.developer?.toLowerCase().includes(query)
        const matchesArea = pin.area?.toLowerCase().includes(query)
        if (!matchesName && !matchesDeveloper && !matchesArea) return false
      }

      return true
    })
  }, [mapPins, filters, searchQuery])

  const handleMapBoundsChange = useCallback((bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }, _zoom: number) => {
    setMapBounds(bounds)
  }, [])

  const handleRefreshMetadata = useCallback(async () => {
    setIsRefreshingMetadata(true)
    try {
      const data = await fetchResidentialMapPins()
      setMapPins(data)
    } catch (error) {
      console.error('Error refreshing metadata:', error)
    } finally {
      setIsRefreshingMetadata(false)
    }
  }, [])

  // Handle project pin click — navigate straight to the project detail page.
  // In a collab session the presenter instead opens an in-place detail drawer
  // (so the client sees floor plans etc.), flies to it, and broadcasts the open
  // + tab to viewers. Navigating away would tear down the session.
  const handleProjectClick = useCallback((project: MapPinProject) => {
    if (collabAnyRef.current) {
      // In a live tour, open the detail drawer in-place (navigating would tear
      // down the session). Presenter broadcasts it + flies; viewer opens it
      // locally so the client can freely browse properties too.
      setOpenProjectId(project.id)
      setProjectTab('overview')
      if (collabActiveRef.current) {
        collabSendRef.current.sendSelect('project', project.id, 'overview')
        setFlyToLocation({ lat: project.lat, lng: project.lng, zoom: 15 })
      }
      return
    }
    navigate(`/project/${project.id}`)
  }, [navigate])

  // Handle area click to show area detail dialog (or bottom sheet on mobile)
  const handleAreaClick = useCallback(async (area: DubaiArea) => {
    trackEvent('area_detail', { action: 'open', area_name: area?.name, area_id: area?.id })
    if (collabActiveRef.current) collabSendRef.current.sendSelect('area', area.id)
    setSelectedArea(area)
    setAreaProjects([])
    setIsLoadingAreaProjects(true)

    if (isMobile) {
      setShowAreaSheet(true)
    } else {
      setShowAreaDialog(true)
    }

    try {
      // Filter map pins by area name to get projects in this area
      const areaProjectIds = mapPins
        .filter(pin => pin.area === area.name)
        .map(pin => pin.id)

      if (areaProjectIds.length === 0) {
        setAreaProjects([])
        setIsLoadingAreaProjects(false)
        return
      }

      // Fetch full project details (batch supports max 20)
      const projectDetails = await fetchResidentialProjectsBatch(areaProjectIds.slice(0, 20))
      setAreaProjects(projectDetails)
    } catch (error) {
      console.error('Error fetching area projects:', error)
    } finally {
      setIsLoadingAreaProjects(false)
    }
  }, [isMobile, mapPins])


  // 深链：/?area=Business%20Bay 直接打开该区域的详情弹窗（可分享；也供自动化测试）
  const areaParam = searchParams.get('area')
  const areaParamOpenedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!areaParam || !dubaiAreas.length) return
    if (areaParamOpenedRef.current === areaParam) return
    const target = dubaiAreas.find(
      a => a.name.trim().toLowerCase() === areaParam.trim().toLowerCase()
    )
    if (target) {
      areaParamOpenedRef.current = areaParam
      handleAreaClick(target)
    }
  }, [areaParam, dubaiAreas, handleAreaClick])


  const hasActiveFilters =
    filters.developer ||
    filters.project ||
    filters.area ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.minPriceSqft ||
    filters.maxPriceSqft ||
    filters.minBedrooms ||
    filters.maxBedrooms ||
    filters.minSize ||
    filters.maxSize ||
    filters.launchDateStart ||
    filters.launchDateEnd ||
    filters.completionDateStart ||
    filters.completionDateEnd ||
    filters.minCompletionPercent !== undefined ||
    filters.maxCompletionPercent !== undefined ||
    filters.status ||
    searchQuery

  // Group area projects by developer for mobile bottom sheet
  const areaDevelopers = useMemo(() => {
    if (!areaProjects || areaProjects.length === 0) return []
    const map = new Map<string, { name: string; logoUrl?: string; projectCount: number; projectNames: string[] }>()
    for (const p of areaProjects) {
      const dev = p.developer || 'Unknown'
      if (!map.has(dev)) {
        map.set(dev, { name: dev, logoUrl: p.developerLogoUrl, projectCount: 0, projectNames: [] })
      }
      const entry = map.get(dev)!
      entry.projectCount++
      if (entry.projectNames.length < 5) {
        entry.projectNames.push(p.buildingName || p.projectName || '')
      }
    }
    return Array.from(map.values()).sort((a, b) => b.projectCount - a.projectCount)
  }, [areaProjects])

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 旧白条已停用——搜索改为浮在地图上的 MapSearchOverlay */}
      <div className="hidden" aria-hidden>
        <div className="px-6 py-4">
          <div className="flex flex-col gap-3">
            {/* Search Bar */}
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-5 w-5" />
                <Input
                  type="text"
                  placeholder={t('map:searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-12 text-base"
                />
              </div>
              <Button
                variant="outline"
                className="h-12 px-6"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="h-5 w-5 mr-2" />
                {t('map:filters')}
                {hasActiveFilters && (
                  <span className="ml-2 bg-primary text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
                    !
                  </span>
                )}
              </Button>
              <Button
                variant="ghost"
                className="h-12 px-4"
                onClick={handleRefreshMetadata}
                disabled={isRefreshingMetadata}
                title={t('map:refreshMetadata')}
              >
                <RefreshCw className={`h-5 w-5 ${isRefreshingMetadata ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {/* Active Filters Summary */}
            {hasActiveFilters && !showFilters && (
              <div className="flex flex-wrap gap-2 text-sm">
                {filters.developer && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:developer')}: {filters.developer}
                  </span>
                )}
                {filters.project && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:project')}: {filters.project}
                  </span>
                )}
                {filters.area && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:area')}: {filters.area}
                  </span>
                )}
                {(filters.minPrice || filters.maxPrice) && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {t('map:price')}: {filters.minPrice ? formatPrice(filters.minPrice) : '0'} - {filters.maxPrice ? formatPrice(filters.maxPrice) : '∞'}
                  </span>
                )}
                {filters.minBedrooms !== undefined && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.minBedrooms === 0 ? t('map:studio') : t('map:beds', { count: filters.minBedrooms })}
                  </span>
                )}
                {filters.status && (
                  <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {filters.status === 'under-construction' ? t('common:status.underConstruction') :
                     filters.status === 'upcoming' ? t('common:status.upcoming') : t('common:status.completed')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Map Section - Full Width, edge-to-edge (no card padding, demo/tour friendly) */}
      <div className="flex-1 p-0">
        <div className="h-full overflow-hidden relative">
          <MapViewMapLibre
            ref={tourMapRef}
            flashProjectIds={flashProjectIds}
            // Persistent map: when the user returns to a map route the container
            // un-hides (display:none → flex); tell maplibre to resize so it fills
            // the box again (ResizeObserver alone can miss a display toggle).
            visible={isMapPath(location.pathname, location.search)}
            // Collab hides the browse chrome too (only the CollabBar shows). NOTE:
            // collab keeps tourActive=false so the DOM-marker-hide-on-move logic
            // stays active — remote-driven jumpTo/flyTo fire movestart/moveend and
            // hide the marker sea, exactly the perf behaviour we want during sync.
            chromeless={!!tourCode && !toolsRevealed}
            tourActive={!!tourCode}
            // Live map instance for collab hooks + meter guard (view save/restore).
            onMapReady={handleCollabMapReady}
            // Tour: render ONLY the tour's 2-3 native pins (clickable, with details);
            // not the whole search-result marker sea (which stutters the camera).
            projects={tourCode ? tourPins : filteredMapPins}
            // No bounds-driven re-fetch during a tour: the cinematic camera moves
            // constantly; reacting to it would re-render the whole map each frame.
            onBoundsChange={tourCode ? undefined : handleMapBoundsChange}
            onReady={() => setMapReady(true)}
            onProjectClick={handleProjectClick}
            onAreaClick={handleAreaClick}
            areaMetric={areaMetric}
            dubaiAreas={dubaiAreas}
            dubaiLandmarks={dubaiLandmarks}
            showDubaiLayer
            pois={pois}
            showPois={showPois}
            onPoiClick={setSelectedPoi}
            onStationClick={setSelectedStation}
            onLandmarkClick={setSelectedLandmark}
            flyToLocation={flyToLocation}
            transportGeoJSON={transportGeoJSON}
            showTransport={showTransport}
            voiceMeasure={voiceMeasure}
            onMeasureChange={handleMeasureChange}
            // Collab markup: while a draw tool is active, swallow feature clicks so
            // drawing/placing marks never opens a POI/area/project panel (and
            // closing a panel doesn't re-select the feature underneath).
            disableFeatureClicks={collabActive && draw.tool !== 'none'}
            voiceAmenities={voiceAmenities}
            hideAmenityPanel={!!guidedTour}
          />

          {/* Load overlay — hides the janky first-paint (GL init + building the
              POI/area layers) behind a clean loader, then fades out once the map
              settles. Not shown during a tour (it has its own intro). */}
          {!tourCode && (
            <div
              className={`pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-slate-900 transition-opacity duration-500 ${
                mapReady ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-teal-400" />
                <span className="text-sm font-medium text-white/80">{i18n.language?.startsWith('zh') ? '加载地图…' : 'Loading map…'}</span>
              </div>
            </div>
          )}

          {/* 地图限时:匿名 10min/天 + 未订阅经纪同额度(买家/订阅经纪由服务端心跳豁免;分享页不启用) */}
          <MapMeterGuard
            active={!tourCode && !isCollabViewerPath && isMapPath(location.pathname, location.search)}
            getView={getMeterView}
          />

          {/* Luna Tour: shared session plays over this map; hides search UI below */}
          {tourCode && (
            <TourOverlay
              code={tourCode}
              mapRef={tourMapRef}
              onMeasure={(pts) => setVoiceMeasure(pts ? { points: pts, noFit: true } : null)}
              onAmenities={(p) => setVoiceAmenities(p)}
              onTransit={(on) => setShowTransit(on)}
              onAreaMetric={(m) => setAreaMetric((m as AreaMetric) ?? 'none')}
              onPins={setTourPins}
              onPoiCategory={(category, hide) => handleVoiceMapAction({ type: 'show_pois', category, hide })}
              editMode={tourEditMode}
            />
          )}

          {/* Live-tour entry lives in the 经纪台, not on the map (it deep-links here
              via ?livetour=1 / ?host=code, which handleStartTour + the effects handle). */}

          {/* Collab: mode frame + session bar + share link */}
          {collabActive && (
            <CollabFrame
              role={collabMode === 'presenter' ? 'presenter' : 'viewer'}
              followMode={collab.followMode}
              shareUrl={collabShareUrl}
              onCopyShare={handleCopyShare}
              copied={shareCopied}
            />
          )}

          {/* Collab: the presenter's live cursor — global overlay, shows on the map,
              the project drawer, POI panels… everywhere (Figma-style presence). */}
          {collabMode === 'viewer' && (
            <CollabCursorLayer client={collab.client} active label={collabPeerName || '经纪'} />
          )}

          {/* Collab: map drawing/markup toolbar (pen + eraser), strokes geo-anchored
              and broadcast to everyone in the room. */}
          {collabActive && <CollabDrawToolbar draw={draw} />}

          {/* Collab: presenter onboarding ("share your link to clients") */}
          {collabMode === 'presenter' && presenterCode && !guideDismissed && (
            <CollabPresenterGuide
              shareUrl={collabShareUrl}
              copied={shareCopied}
              onCopyShare={handleCopyShare}
              hasViewer={hasViewer}
              onDismiss={() => setGuideDismissed(true)}
            />
          )}

          {/* Collab: participant dots + chat + Free pill */}
          {collabActive && (
            <CollabBar
              participants={collab.participants}
              messages={collab.messages}
              myConnId={collab.connId}
              myName={collabMode === 'presenter' ? (user?.email?.split('@')[0] || 'Ahmed') : '访客'}
              onSendChat={collab.sendChat}
              voice={voice}
              voicePrompt={collabMode === 'viewer' && presenterVoiceOn}
              isPresenter={collabMode === 'presenter'}
              presenterName={collabPeerName}
              followMode={collab.followMode}
              onDetach={collab.setFree}
              onReturnToPresenter={collab.returnToPresenter}
              offMap={!isMapPath(location.pathname, location.search)}
              onReturnToMap={() => navigate('/')}
              onExit={handleExitCollab}
            />
          )}

          {/* Collab: in-place project detail drawer (synced presenter↔viewer) */}
          {collabActive && openProjectId && (
            <ProjectDetailDialog
              projectId={openProjectId}
              tab={projectTab}
              onTabChange={handleProjectTabChange}
              onClose={handleCloseProject}
            />
          )}

          {/* 区域搜索 + 筛选 pills，浮在地图左上。collab: 经纪和客户都保留全部工具
              (客户要能自己搜/筛/逛 —— 跟随脱离后用 Free 态探索)。
              pad(md~xl)保持上下两行(搜索/筛选),并限宽给右侧紧凑控制卡让位,防 chips 钻到卡下面 */}
          {(!tourCode || toolsRevealed) && (
          <div className="absolute top-3 left-3 md:top-4 md:left-4 z-[1002] flex flex-col items-start gap-2 xl:flex-row max-w-[calc(100vw-200px)] xl:max-w-none">
            <AreaSearch
              onSelect={(a) => {
                if (a.centroid) setFlyToLocation({ lat: a.centroid.lat, lng: a.centroid.lng, zoom: 13 })
              }}
            />
            <MapFilterChips
              filters={filters}
              setFilters={setFilters}
              developers={developers}
            />
          </div>
          )}


          {/* Luna Tour: hide search controls while playing; reveal them on pause */}
          {(!tourCode || toolsRevealed) && (<>
          {/* (移除了移动端「当前指标」指示器:右上指标条已高亮选中项,地图每个区也直接
              显示指标值,这个左上 pill 既冗余又会和筛选/找房助手按钮重叠。) */}

          {/* Mobile/Pad: Right side controls (metrics + POI combined) — 下移给顶部搜索条让位。
              断点 xl(1280):768~1280 的 iPad/窄窗口用桌面展开面板会和左侧筛选条重叠
              (经纪大量用 pad),这套紧凑图标卡在 pad 上刚好。 */}
          <div data-testid="map-mobile-controls" className="absolute top-3 right-3 z-[1000] xl:hidden">
            <div className="bg-white shadow-lg rounded-xl overflow-hidden">
              {/* 市场口径行（全部/期房/现房）——与桌面右上口径筛选同源 state */}
              <div className="flex border-b border-slate-100">
                {(['all', 'offplan', 'ready'] as MarketSegment[]).map((seg, idx) => (
                  <button
                    key={seg}
                    onClick={() => handleSegmentChange(seg)}
                    className={`flex-1 h-7 px-1 text-[11px] font-semibold transition-colors ${
                      marketSegment === seg
                        ? seg === 'all' ? 'bg-slate-700 text-white' : 'bg-violet-600 text-white'
                        : 'text-slate-500'
                    } ${idx > 0 ? 'border-l border-slate-100' : ''}`}
                  >
                    {segmentLabel(seg, (i18n.language || 'en').startsWith('zh'))}
                  </button>
                ))}
              </div>
              {/* Metrics row */}
              <div className="flex border-b border-slate-100">
                {METRIC_OPTIONS.map((option, idx) => {
                  const isActive = areaMetric === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleMetricToggle(option.value)}
                      className={`flex items-center justify-center w-8 h-8 transition-colors ${
                        isActive ? 'bg-primary text-white' : 'text-slate-500'
                      } ${idx > 0 ? 'border-l border-slate-100' : ''}`}
                      title={t(option.labelKey as any)}
                    >
                      <option.Icon className="w-3.5 h-3.5" />
                    </button>
                  )
                })}
              </div>
              {/* 周边 POI:与指标行同款 5 个等宽图标按钮——交通/医院/学校/超市/更多。
                  「更多」开完整 POI 面板(分组选择)。窄屏放得下且和 desktop 对齐。 */}
              <div className="flex">
                <button
                  onClick={toggleTransit}
                  className="flex w-8 h-8 items-center justify-center transition-colors"
                  style={showTransit ? { backgroundColor: '#0891b2', color: 'white' } : { color: '#64748b' }}
                  title={t('map:transit')}
                  aria-label={t('map:transit')}
                >
                  <TrainFront className="w-3.5 h-3.5" />
                </button>
                {QUICK_BUTTONS.map((btn) => {
                  const enabled = enabledPoiCategories.includes(btn.id)
                  return (
                    <button
                      key={btn.id}
                      onClick={() => togglePoiCategory(btn.id)}
                      className="flex w-8 h-8 items-center justify-center border-l border-slate-100 transition-colors"
                      style={enabled ? { backgroundColor: btn.color, color: 'white' } : { color: '#64748b' }}
                      title={t(btn.labelKey as any)}
                      aria-label={t(btn.labelKey as any)}
                    >
                      <btn.Icon className="w-3.5 h-3.5" />
                    </button>
                  )
                })}
                <button
                  onClick={() => setShowPoiPanel(true)}
                  className={`flex w-8 h-8 items-center justify-center border-l border-slate-100 transition-colors ${
                    showPoiPanel ? 'bg-slate-700 text-white' : 'text-slate-600'
                  }`}
                  title={t('map:poi.more')}
                  aria-label={t('map:poi.more')}
                >
                  <MapPin className="w-3.5 h-3.5" />
                </button>
              </div>
              {/* 只有图标分不清选了哪个指标(两个 $ 图标长一样)→ 底部常显一条文字标签:
                  选中时显示指标名,未选时提示可点选,卡片高度稳定不跳动。 */}
              {(() => {
                const active = METRIC_OPTIONS.find(o => o.value === areaMetric)
                return active ? (
                  <div className="flex items-center justify-center gap-1 border-t border-slate-100 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary">
                    <active.Icon className="w-3 h-3" />
                    <span className="whitespace-nowrap">{t(active.labelKey as any)}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center border-t border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-400">
                    {(i18n.language || 'en').startsWith('zh') ? '选择指标' : 'Pick metric'}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Area fly-to removed — now controlled by AI voice assistant */}

          {/* Floating Metric Panel - top-right */}
          <div data-testid="map-metric-panel" className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 z-[1000] hidden xl:block">
            <div className="flex items-center gap-0.5 p-1">
              {/* 市场口径筛选（全部/期房/现房）——切的是 DLD 数据口径，联动全图区域数字与弹窗 */}
              <div className="mr-1 flex items-center rounded-md bg-slate-100 p-0.5">
                {(['all', 'offplan', 'ready'] as MarketSegment[]).map((seg) => (
                  <button
                    key={seg}
                    onClick={() => handleSegmentChange(seg)}
                    className={`rounded px-2 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                      marketSegment === seg
                        ? seg === 'all' ? 'bg-white text-slate-800 shadow-sm' : 'bg-violet-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {segmentLabel(seg, (i18n.language || 'en').startsWith('zh'))}
                  </button>
                ))}
              </div>
              <div className="h-5 w-px bg-slate-200" />
              {METRIC_OPTIONS.map((option) => {
                const isActive = areaMetric === option.value
                return (
                  <button
                    key={option.value}
                    onClick={() => handleMetricToggle(option.value)}
                    className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <option.Icon className="w-3.5 h-3.5" />
                    <span>{t(option.labelKey as any)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Floating POI Panel - below metrics */}
          <div data-testid="map-poi-panel" className="absolute top-16 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-slate-200 z-[1000] hidden xl:block">
            <div className="flex items-center gap-1.5 p-1.5">
              {/* Single Transit toggle */}
              <button
                onClick={toggleTransit}
                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                  showTransit
                    ? 'text-white shadow-sm'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
                style={showTransit ? { backgroundColor: '#0891b2' } : undefined}
              >
                <TrainFront className="w-3.5 h-3.5" />
                <span>{t('map:transit')}</span>
              </button>
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
              {QUICK_BUTTONS.map(btn => {
                const enabled = enabledPoiCategories.includes(btn.id)
                return (
                  <button
                    key={btn.id}
                    onClick={() => togglePoiCategory(btn.id)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                      enabled
                        ? 'text-white shadow-sm'
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                    style={enabled ? { backgroundColor: btn.color } : undefined}
                  >
                    <btn.Icon className="w-3.5 h-3.5" />
                    <span>{t(btn.labelKey as any)}</span>
                  </button>
                )
              })}
              <div className="w-px h-4 bg-slate-200 mx-0.5" />
              <button
                onClick={() => setShowPoiPanel(!showPoiPanel)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                  showPoiPanel ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{t('map:poi.more')}</span>
              </button>
            </div>
          </div>
          </>)}

          {/* POI Full Panel - appears when "More" clicked */}
          {showPoiPanel && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="fixed inset-0 z-[1000]"
                onClick={() => setShowPoiPanel(false)}
              />
              {/* 移动端:底部抽屉(全宽,不挤压顶部控件,与筛选 sheet 一致);桌面:右上浮动卡片 */}
              <div className="fixed inset-x-0 bottom-0 w-full max-h-[65vh] rounded-t-2xl md:absolute md:inset-x-auto md:bottom-auto md:top-28 md:right-4 md:left-auto md:w-[280px] md:max-h-[400px] md:rounded-xl bg-white shadow-xl border border-slate-200/80 z-[1001] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">{t('map:poi.title')}</span>
                </div>
                <button
                  onClick={() => setShowPoiPanel(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Quick actions bar */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/50">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAllPoiCategories(true)}
                    className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                  >
                    {t('map:poi.selectAll')}
                  </button>
                  <button
                    onClick={() => toggleAllPoiCategories(false)}
                    className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 font-medium transition-colors"
                  >
                    {t('map:poi.clear')}
                  </button>
                </div>
              </div>

              {/* Category list */}
              <div className="overflow-y-auto max-h-[44vh] md:max-h-[280px] p-3">
                {POI_GROUPS.map(group => {
                  const groupCategories = POI_CATEGORIES.filter(c => c.group === group.id)
                  if (groupCategories.length === 0) return null

                  return (
                    <div key={group.id} className="mb-4 last:mb-0">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          {t(`map:poi.groups.${group.id}` as any)}
                        </div>
                        <div className="flex-1 h-px bg-slate-100" />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {groupCategories.map(cat => {
                          const isEnabled = enabledPoiCategories.includes(cat.id)
                          return (
                            <button
                              key={cat.id}
                              onClick={() => togglePoiCategory(cat.id)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                isEnabled
                                  ? 'text-white shadow-sm ring-1 ring-white/20'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                              style={isEnabled ? { backgroundColor: cat.color } : undefined}
                            >
                              <span
                                className={`w-2.5 h-2.5 rounded-full ${isEnabled ? 'ring-1 ring-white/30' : ''}`}
                                style={{ backgroundColor: isEnabled ? 'rgba(255,255,255,0.9)' : cat.color }}
                              />
                              <span>{t(`map:poi.categories.${cat.id}` as any)}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {/* Filter Dialog */}
      <FilterDialog
        isOpen={showFilters}
        onClose={() => setShowFilters(false)}
        filters={filters}
        onFiltersChange={setFilters}
        developers={developers}
        areas={areas}
        projects={projects}
      />

      {/* Desktop: Area Detail Dialog */}
      <AreaDetailDialog
        isOpen={showAreaDialog}
        onClose={handleCloseArea}
        segment={marketSegment}
        area={selectedArea}
        projects={areaProjects}
        isLoading={isLoadingAreaProjects}
      />

      {/* POI Info Popup - Mobile: Bottom Sheet, Desktop: Centered Modal */}
      {selectedPoi && (() => {
        const catInfo = getCategoryInfo(selectedPoi.category)
        const color = catInfo?.color || '#6b7280'

        // Enrichment (lazy-loaded). /all payload lacks address/phone/website,
        // so prefer details for those too.
        const d = poiDetails
        const photo = d?.photo_url
        const descZh = d?.description_zh || d?.description
        const hours = d?.opening_hours
        const khda = d?.khda_rating
        const khdaStyle = getKhdaStyle(khda)
        const khdaNote = khdaStyle ? 'KHDA 官方督导评级 · 截至 2023-24 学年' : null
        // Credit label: "Wikipedia" or the source site's domain.
        const photoCreditLabel = d?.photo_credit
          ? (/^wikipedia/i.test(d.photo_credit) ? 'Wikipedia' : d.photo_credit.split('·')[0].trim())
          : null
        // Every POI gets an image: real photo → satellite thumbnail of its
        // location (free, 100% coverage) → emoji tile (if the tile 404s).
        const heroSrc = photo || satelliteThumbUrl(selectedPoi.lat, selectedPoi.lng, 16)
        const heroCredit = photo ? photoCreditLabel : 'Esri 卫星图'
        const addr = d?.address || selectedPoi.address
        const phone = d?.phone || selectedPoi.phone
        const website = d?.website || selectedPoi.website

        return (
          <div className="fixed inset-0 z-[2000]" onClick={() => setSelectedPoi(null)}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

            {/* Mobile: Bottom Sheet */}
            <div className="md:hidden absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom duration-200">
              <div
                className="bg-white rounded-t-2xl shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle bar */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="w-10 h-1 bg-slate-300 rounded-full" />
                </div>

                {/* Content */}
                <div className="px-5 pb-4">
                  {/* Header: thumbnail left + type/title right */}
                  <div className="flex gap-3 mb-3">
                    <div
                      className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${color}22, ${color}0d)` }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-4xl leading-none">{catInfo?.icon}</span>
                      </div>
                      <img
                        src={heroSrc}
                        alt={selectedPoi.name}
                        loading="lazy"
                        className="relative w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: `${color}1f`, color }}
                        >
                          {catInfo?.label || selectedPoi.category}
                        </span>
                        {khdaStyle && (
                          <span
                            title={khdaNote || undefined}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: khdaStyle.bg, color: khdaStyle.text }}
                          >
                            <Award className="w-3 h-3" /> KHDA {khdaStyle.zh}
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-slate-900 leading-tight">
                        {selectedPoi.name}
                      </h3>
                      {selectedPoi.name_ar && (
                        <p className="text-sm text-slate-400 mt-0.5" dir="rtl">
                          {selectedPoi.name_ar}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Description (or loading skeleton) */}
                  {poiDetailsLoading && !d ? (
                    <div className="space-y-2 mt-2 mb-1">
                      <div className="h-3 bg-slate-100 rounded animate-pulse" />
                      <div className="h-3 bg-slate-100 rounded animate-pulse w-4/5" />
                    </div>
                  ) : descZh ? (
                    <p className="text-sm text-slate-700 leading-relaxed mt-1 mb-2">{descZh}</p>
                  ) : null}

                  {addr && (
                    <p className="text-sm text-slate-500 flex items-start gap-1.5 mt-2">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-400" />
                      <span>{addr}</span>
                    </p>
                  )}
                  {hours && (
                    <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1">
                      <Clock className="w-4 h-4 flex-shrink-0 text-slate-400" />
                      <span>{hours}</span>
                    </p>
                  )}
                  {khdaNote && (
                    <p className="text-[10px] text-slate-400 mt-2">{khdaNote}</p>
                  )}
                  {heroCredit && (
                    <p className="text-[10px] text-slate-400 mt-1">© {heroCredit}</p>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-3 gap-px bg-slate-200 border-t border-slate-200">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.lat},${selectedPoi.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                  >
                    <Navigation className="w-5 h-5 text-blue-600" />
                    <span className="text-xs font-medium text-slate-700">{t('map:directionsShort')}</span>
                  </a>
                  {phone ? (
                    <a
                      href={`tel:${phone}`}
                      className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                    >
                      <Phone className="w-5 h-5 text-green-600" />
                      <span className="text-xs font-medium text-slate-700">{t('map:call')}</span>
                    </a>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-4 bg-white opacity-40">
                      <Phone className="w-5 h-5 text-slate-400" />
                      <span className="text-xs font-medium text-slate-400">{t('map:call')}</span>
                    </div>
                  )}
                  {website ? (
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                    >
                      <Globe className="w-5 h-5 text-purple-600" />
                      <span className="text-xs font-medium text-slate-700">{t('map:website')}</span>
                    </a>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 py-4 bg-white opacity-40">
                      <Globe className="w-5 h-5 text-slate-400" />
                      <span className="text-xs font-medium text-slate-400">{t('map:website')}</span>
                    </div>
                  )}
                </div>

                {/* Safe area padding for iOS */}
                <div className="h-safe-area-inset-bottom bg-white" />
              </div>
            </div>

            {/* Desktop: Centered Modal */}
            <div className="hidden md:flex absolute inset-0 items-center justify-center p-4">
              <div
                className="relative bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-md animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Close (overlays photo when present) */}
                <button
                  onClick={() => setSelectedPoi(null)}
                  className="absolute top-3 right-3 z-10 p-2 bg-white/80 hover:bg-white backdrop-blur rounded-full text-slate-500 hover:text-slate-700 transition-colors shadow-sm"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Header: thumbnail left + type/title right */}
                <div className="p-5 pb-3">
                  <div className="flex gap-4 pr-8">
                    <div
                      className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${color}22, ${color}0d)` }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-5xl leading-none">{catInfo?.icon}</span>
                      </div>
                      <img
                        src={heroSrc}
                        alt={selectedPoi.name}
                        loading="lazy"
                        className="relative w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        <span
                          className="text-xs font-semibold px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: `${color}1f`, color }}
                        >
                          {catInfo?.label || selectedPoi.category}
                        </span>
                        {khdaStyle && (
                          <span
                            title={khdaNote || undefined}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                            style={{ backgroundColor: khdaStyle.bg, color: khdaStyle.text }}
                          >
                            <Award className="w-3 h-3" /> KHDA {khdaStyle.zh}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 leading-tight">
                        {selectedPoi.name}
                      </h3>
                      {selectedPoi.name_ar && (
                        <p className="text-sm text-slate-400 mt-0.5" dir="rtl">
                          {selectedPoi.name_ar}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description (or loading skeleton) */}
                {(poiDetailsLoading && !d) || descZh ? (
                  <div className="px-5 pb-2">
                    {poiDetailsLoading && !d ? (
                      <div className="space-y-2 mb-1">
                        <div className="h-3 bg-slate-100 rounded animate-pulse" />
                        <div className="h-3 bg-slate-100 rounded animate-pulse w-4/5" />
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700 leading-relaxed">{descZh}</p>
                    )}
                  </div>
                ) : null}

                {/* Details */}
                {(addr || phone || website || hours) && (
                  <div className="px-5 pb-4 pt-2 space-y-3">
                    {addr && (
                      <div className="flex items-start gap-3">
                        <MapPin className="w-4 h-4 mt-0.5 text-slate-400 flex-shrink-0" />
                        <span className="text-sm text-slate-600">{addr}</span>
                      </div>
                    )}
                    {hours && (
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <span className="text-sm text-slate-600">{hours}</span>
                      </div>
                    )}
                    {phone && (
                      <div className="flex items-center gap-3">
                        <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <a href={`tel:${phone}`} className="text-sm text-blue-600 hover:underline">
                          {phone}
                        </a>
                      </div>
                    )}
                    {website && (
                      <div className="flex items-center gap-3">
                        <Globe className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <a
                          href={website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline truncate"
                        >
                          {website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      </div>
                    )}
                    {khdaNote && (
                      <p className="text-[10px] text-slate-400">{khdaNote}</p>
                    )}
                    {heroCredit && (
                      <p className="text-[10px] text-slate-400">© {heroCredit}</p>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 p-5 pt-2 border-t border-slate-100">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoi.lat},${selectedPoi.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors"
                  >
                    <Navigation className="w-4 h-4" />
                    {t('map:directions')}
                  </a>
                  <button
                    onClick={() => setSelectedPoi(null)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors"
                  >
                    {t('map:close')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Transport Station Popup */}
      {selectedStation && (
        <div className="fixed inset-0 z-[2000]" onClick={() => setSelectedStation(null)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

          {/* Mobile: Bottom Sheet */}
          <div className="md:hidden absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom duration-200">
            <div
              className="bg-white rounded-t-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 bg-slate-300 rounded-full" />
              </div>

              {/* Icon + Category */}
              <div className="flex items-center gap-3 px-5 pb-3">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                  style={{ backgroundColor: selectedStation.color }}
                >
                  <TrainFront className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: selectedStation.color }}
                  >
                    {selectedStation.category === 'metro_stations' ? t('map:station.metro') :
                     selectedStation.category === 'tram_stations' ? t('map:station.tram') : t('map:station.monorail')}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="px-5 pb-4">
                <h3 className="text-xl font-bold text-slate-900 mb-1">
                  {selectedStation.name}
                </h3>
                {selectedStation.nameAr && (
                  <p className="text-base text-slate-500 mb-3" dir="rtl">
                    {selectedStation.nameAr}
                  </p>
                )}
                {selectedStation.line && (
                  <p className="text-sm text-slate-600">
                    {t('map:line', { line: selectedStation.line })}
                  </p>
                )}
              </div>

              {/* Action Button */}
              <div className="grid grid-cols-1 gap-px bg-slate-200 border-t border-slate-200">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.lat},${selectedStation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                >
                  <Navigation className="w-5 h-5 text-blue-600" />
                  <span className="text-xs font-medium text-slate-700">{t('map:directionsShort')}</span>
                </a>
              </div>

              {/* Safe area padding for iOS */}
              <div className="h-safe-area-inset-bottom bg-white" />
            </div>
          </div>

          {/* Desktop: Centered Modal */}
          <div className="hidden md:flex absolute inset-0 items-center justify-center p-4">
            <div
              className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-sm animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="relative p-5 pb-4">
                <button
                  onClick={() => setSelectedStation(null)}
                  className="absolute top-3 right-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                <div className="flex items-start gap-4">
                  <div
                    className="w-14 h-14 rounded-xl flex items-center justify-center shadow-md flex-shrink-0"
                    style={{ backgroundColor: selectedStation.color }}
                  >
                    <TrainFront className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 pt-1">
                    <span
                      className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full text-white mb-2"
                      style={{ backgroundColor: selectedStation.color }}
                    >
                      {selectedStation.category === 'metro_stations' ? t('map:station.metro') :
                       selectedStation.category === 'tram_stations' ? t('map:station.tram') : t('map:station.monorail')}
                    </span>
                    <h3 className="text-xl font-bold text-slate-900 leading-tight">
                      {selectedStation.name}
                    </h3>
                    {selectedStation.nameAr && (
                      <p className="text-sm text-slate-500 mt-1" dir="rtl">
                        {selectedStation.nameAr}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Details */}
              {selectedStation.line && (
                <div className="px-5 pb-4">
                  <div className="flex items-center gap-3">
                    <TrainFront className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-slate-600">{t('map:line', { line: selectedStation.line })}</span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 p-5 pt-2 border-t border-slate-100">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStation.lat},${selectedStation.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  {t('map:directions')}
                </a>
                <button
                  onClick={() => setSelectedStation(null)}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors"
                >
                  {t('map:close')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Landmark Popup — 本地化名称/描述；无实拍图时用 3D 扣图兜底 */}
      {selectedLandmark && (() => {
        const lmLang = i18n.language?.split('-')[0]
        const lmTr = lmLang ? selectedLandmark.translations?.[lmLang] : undefined
        const lmName = lmTr?.name || selectedLandmark.name
        const lmDesc = lmTr?.description || selectedLandmark.description
        const lmSlug = selectedLandmark.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        const hasPhoto = !!selectedLandmark.imageUrl
        const lmImg = selectedLandmark.imageUrl || `/landmarks/${lmSlug}.png`
        const heroImg = hasPhoto ? (
          <img src={lmImg} alt={lmName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900">
            <img src={lmImg} alt={lmName} className="h-[85%] w-auto object-contain drop-shadow-2xl" />
          </div>
        )
        const chips = (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
              {t('map:landmarkBadge')}
            </span>
            {selectedLandmark.yearBuilt && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {t('map:built', { year: selectedLandmark.yearBuilt })}
              </span>
            )}
          </div>
        )
        return (
        <div className="fixed inset-0 z-[2000]" onClick={() => setSelectedLandmark(null)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

          {/* Mobile: Bottom Sheet */}
          <div className="md:hidden absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom duration-200">
            <div
              className="bg-white rounded-t-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle bar */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 bg-slate-300 rounded-full" />
              </div>

              {/* Image */}
              <div className="mx-5 mb-3 h-44 rounded-xl overflow-hidden">
                {heroImg}
              </div>

              {/* Content */}
              <div className="px-5 pb-4">
                {chips}
                <h3 className="mt-2 text-xl font-bold text-slate-900 mb-0.5">
                  {lmName}
                </h3>
                {lmName !== selectedLandmark.name && (
                  <p className="text-sm text-slate-400 mb-2">{selectedLandmark.name}</p>
                )}
                {lmDesc && (
                  <p className="text-sm leading-relaxed text-slate-600 mt-2">
                    {lmDesc}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-px bg-slate-200 border-t border-slate-200">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedLandmark.location.lat},${selectedLandmark.location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                >
                  <Navigation className="w-5 h-5 text-blue-600" />
                  <span className="text-xs font-medium text-slate-700">{t('map:directionsShort')}</span>
                </a>
                {selectedLandmark.websiteUrl ? (
                  <a
                    href={selectedLandmark.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center gap-1.5 py-4 bg-white active:bg-slate-50"
                  >
                    <Globe className="w-5 h-5 text-purple-600" />
                    <span className="text-xs font-medium text-slate-700">{t('map:website')}</span>
                  </a>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 py-4 bg-white opacity-40">
                    <Globe className="w-5 h-5 text-slate-400" />
                    <span className="text-xs font-medium text-slate-400">{t('map:website')}</span>
                  </div>
                )}
              </div>

              <div className="h-safe-area-inset-bottom bg-white" />
            </div>
          </div>

          {/* Desktop: Centered Modal */}
          <div className="hidden md:flex absolute inset-0 items-center justify-center p-4">
            <div
              className="bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-md animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Image */}
              <div className="h-52 w-full overflow-hidden">
                {heroImg}
              </div>

              {/* Header */}
              <div className="relative p-5 pb-3">
                <button
                  onClick={() => setSelectedLandmark(null)}
                  className="absolute top-3 right-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {chips}
                <h3 className="mt-2 text-xl font-bold text-slate-900 leading-tight pr-10">
                  {lmName}
                </h3>
                {lmName !== selectedLandmark.name && (
                  <p className="text-sm text-slate-400 mt-0.5">{selectedLandmark.name}</p>
                )}
              </div>

              {/* Details */}
              <div className="px-5 pb-4">
                {lmDesc && (
                  <p className="text-sm leading-relaxed text-slate-600">
                    {lmDesc}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 p-5 pt-2 border-t border-slate-100">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedLandmark.location.lat},${selectedLandmark.location.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  {t('map:directions')}
                </a>
                {selectedLandmark.websiteUrl && (
                  <a
                    href={selectedLandmark.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Globe className="w-4 h-4" />
                    {t('map:website')}
                  </a>
                )}
                {!selectedLandmark.websiteUrl && (
                  <button
                    onClick={() => setSelectedLandmark(null)}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-sm rounded-lg transition-colors"
                  >
                    {t('map:close')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Mobile: Area Bottom Sheet — taller so it's actually readable on a phone */}
      <MobileBottomSheet
        isOpen={showAreaSheet}
        onClose={handleCloseArea}
        height="88vh"
        title={selectedArea?.name || ''}
        subtitle={!i18n.language?.startsWith('en') ? selectedArea?.translations?.[i18n.language?.split('-')[0] ?? '']?.name : undefined}
        headerImage={(() => {
          const projImg = areaProjects.find((p) => p.primaryImage)?.primaryImage || areaProjects.find((p) => p.images?.[0])?.images?.[0]
          if (projImg) return getImageUrl(projImg, 'thumbnail')
          const c = selectedArea?.boundary ? geomCenter(selectedArea.boundary) : null
          return c ? satelliteThumbUrl(c.lat, c.lng) : null
        })()}
      >
        {isLoadingAreaProjects ? (
          <div className="flex items-center justify-center py-16">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-4 border-blue-600"></div>
          </div>
        ) : selectedArea ? (
          <div className="flex flex-col">
            {/* 区域简介 — 收紧到 2 行,给指标和切换让位 */}
            {(() => {
              const sheetTr = selectedArea.translations?.[i18n.language?.split('-')[0] ?? '']
              const desc = sheetTr?.description || selectedArea.description
              return desc ? <p className="px-4 pt-2 text-sm leading-relaxed text-slate-600 line-clamp-2">{desc}</p> : null
            })()}

            {/* Usage filter — 顶部常驻,一进来就知道当前口径 + 怎么切。横向可滚。 */}
            <div className="px-4 py-2.5 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-slate-100">
              <span className="text-[11px] font-medium text-slate-400 shrink-0">{i18n.language?.startsWith('zh') ? '口径' : 'Usage'}</span>
              {USAGE_FILTER.map((u) => (
                <button
                  key={u.v}
                  onClick={() => setSheetUsage(u.v)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    sheetUsage === u.v ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {i18n.language?.startsWith('zh') ? u.zh : u.en}
                </button>
              ))}
            </div>

            {/* Tabs: 市场行情 | 项目(N) — 项目单独 tab,多了也不挤 */}
            <div className="px-4 flex gap-1 border-b border-slate-100">
              {([
                { id: 'market' as const, label: i18n.language?.startsWith('zh') ? '市场行情' : 'Market' },
                { id: 'projects' as const, label: `${i18n.language?.startsWith('zh') ? '项目' : 'Projects'}${areaDevelopers.reduce((n, d) => n + d.projectCount, 0) ? ` (${areaDevelopers.reduce((n, d) => n + d.projectCount, 0)})` : ''}` },
              ]).map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => setSheetTab(tb.id)}
                  className={`border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    sheetTab === tb.id ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-500'
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>

            <div className="p-4 space-y-4">
              {sheetTab === 'market' ? (
                <>
                  <AreaTrendGrid area={selectedArea} insights={sheetInsights} loading={sheetInsightsLoading} usageActive={sheetUsage !== 'all'} />
                  <AreaRecentTx areaId={selectedArea.id} insights={sheetInsights} loading={sheetInsightsLoading} />
                </>
              ) : areaDevelopers.length > 0 ? (
                <div className="space-y-2">
                  {areaDevelopers.map((dev) => (
                    <div key={dev.name} className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center gap-2.5">
                        {dev.logoUrl ? (
                          <img src={dev.logoUrl} alt={dev.name} className="w-8 h-8 object-contain rounded-lg border border-slate-100" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                            <Building2 className="w-4 h-4 text-slate-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-slate-800 truncate">{dev.name}</div>
                          <div className="text-xs text-slate-500">
                            {t('map:areaDialog.projectCount', { count: dev.projectCount })}
                          </div>
                        </div>
                      </div>
                      {dev.projectNames.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {dev.projectNames.map((name, i) => (
                            <span key={i} className="inline-block px-2 py-0.5 bg-slate-50 text-slate-600 rounded text-[11px] border border-slate-100 truncate max-w-[160px]">
                              {name}
                            </span>
                          ))}
                          {dev.projectCount > 5 && (
                            <span className="inline-block px-2 py-0.5 text-slate-400 text-[11px]">+{dev.projectCount - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-400">
                  {i18n.language?.startsWith('zh') ? '该区域暂无已收录的项目' : 'No projects on record yet'}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </MobileBottomSheet>

      {/* Luna 序列带看（优势 / 环境 / 成交，底部条，自动播放可暂停） */}
      {guidedTour && (
        <GuidedTour
          tour={guidedTour}
          onClose={() => { setGuidedTour(null); setVoiceAmenities(null) }}
          onCamera={(loc) => setFlyToLocation({ lat: loc.lat, lng: loc.lng, zoom: loc.zoom || 14 })}
          onAmenities={(a) => {
            if (!a) { setVoiceAmenities(null); return }
            setVoiceMeasure(null)
            setVoiceAmenities({ center: a.center, centerName: a.centerName, score: a.score, tier: a.tier, spokes: a.spokes || [] })
            const lngs = [a.center[0], ...(a.spokes || []).map(s => s.lng)]
            const lats = [a.center[1], ...(a.spokes || []).map(s => s.lat)]
            setFlyToLocation({
              lat: (Math.min(...lats) + Math.max(...lats)) / 2,
              lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
              bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            })
          }}
        />
      )}
    </div>
  )
}
