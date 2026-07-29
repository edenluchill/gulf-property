import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { reportFunnelStep } from '../lib/telemetry'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import type { Map as MaplibreMap } from 'maplibre-gl'
import MapViewMapLibre, { AreaMetric, TransportStation } from '../components/MapViewMapLibre'
import {
  TIMELINE_METRICS, valueAt, formatMonth, yearTicks,
  type TimelineMetric, type AreaMonthly,
} from '../lib/map/timeline'
import type { MapTourHandle } from '../luna-tour/map/mapTourHandle'  // Luna Tour (isolated)
import { createMapTourHandle } from '../luna-tour/map/mapTourHandle'  // Luna Tour (isolated)
import { createAmbientLife } from '../luna-tour/map/ambientLife'  // Luna Tour 氛围层:海上的船 + 天上的飞机 (isolated)
import TourOverlay from '../luna-tour/TourOverlay'  // Luna Tour (isolated)
import { useTourMode } from '../luna-tour/TourModeContext'  // Luna Tour (isolated)
// Luna collaborative tour (isolated co-presence layer). Delete collab/ to remove.
import { useCollab, type CollabMode } from '../luna-tour/collab/useCollab'
import CollabBar from '../luna-tour/collab/CollabBar'
import CollabVideo from '../luna-tour/collab/CollabVideo'
import CollabFrame from '../luna-tour/collab/CollabFrame'
import { DockItem, DockBaseRowItem, DOCK_ORDER } from '../components/BottomDock'
import ProjectDetailDialog from '../luna-tour/collab/ProjectDetailDialog'
import { useCollabVoice } from '../luna-tour/collab/useCollabVoice'
import { chimeJoin, chimeLeave, unlockChimes } from '../luna-tour/collab/chime'
import { createCollabRoom, getCollabRoom, identifyCollab } from '../luna-tour/collab/collabApi'
import CollabPresenterGuide from '../luna-tour/collab/CollabPresenterGuide'
import CollabIdentityGate from '../luna-tour/collab/CollabIdentityGate'
import CollabCursorLayer from '../luna-tour/collab/CollabCursorLayer'
import { useCollabDraw } from '../luna-tour/collab/useCollabDraw'
import { useCollabMapState, type CollabMapState } from '../luna-tour/collab/useCollabMapState'
import { useAuth } from '../contexts/AuthContext'
import { API_BASE_URL } from '../lib/config'
import MapFilterChips from '../components/MapFilterChips'
import MapSearch from '../components/MapSearch'
import FilterDialog from '../components/FilterDialog'
import AreaDetailDialog, { type AreaTab } from '../components/AreaDetailDialog'
import GuidedTour from '../components/GuidedTour'
import MobileBottomSheet from '../components/MobileBottomSheet'
import { getImageUrl } from '../lib/image-utils'
import { trackEvent } from '../lib/track'
import { satelliteThumbUrl, geomCenter } from '../lib/map/tiles'
import { useAreaInsights, AreaTrendGrid, AreaRecentTx, AreaPlaceSearch, type AreaPlaceSel } from '../components/AreaInsightsPanel'
import { MarketSegment, loadSavedSegment, saveSegment, segmentLabel } from '../lib/marketSegment'
import { MetricPeriodKey, loadSavedPeriod, savePeriod, periodLabel } from '../lib/metricPeriod'
import { PeriodSelector } from '../components/PeriodSelector'
import { PropertyFilters, DubaiArea, DubaiLandmark } from '../types'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import {
  Search, SlidersHorizontal, RefreshCw, Building2, MapPin, X,
  DollarSign, TrendingUp, BarChart3, Percent,
  Cross, GraduationCap, TrainFront, Phone, Globe, Navigation, ShoppingCart,
  Clock, Award, Play, Pause, Home
} from 'lucide-react'
import { useDubaiPois, PoiCategory, POI_CATEGORIES, POI_GROUPS, Poi, PoiDetails, getCategoryInfo, fetchPoiDetails } from '../hooks/useDubaiPois'
import { MapAction } from '../hooks/voice-assistant'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import MapCompassButton from '../components/MapCompassButton'
import { GuidedTourPayload } from '../hooks/voice-assistant/types'
import { useVoiceAssistantContext } from '../contexts/VoiceAssistantContext'
import { formatPrice } from '../lib/utils'
import { formatMoneyCompact } from '../lib/money'
import { isMapPath } from '../lib/isMapPath'
import { parseCameraParam, serializeCameraParam } from '../lib/map/cameraUrl'
import MapMeterGuard, { readMapResumeView } from '../components/MapMeterGuard'
import {
  fetchResidentialMapPins,
  fetchResidentialProjectsBatch,
  fetchDubaiAreas,
  fetchDubaiLandmarks,
  fetchCustomRoutesGeoJSON,
  fetchDataVersion,
  fetchAllAreaAppreciation,
  fetchAreaMonthly,
  AllAreaAppreciation,
  TransportGeoJSON,
  MapPinProject,
  MapSuggestion
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
// 文案走 `t('map:usage.<v>')` —— 这里曾内嵌 { zh, en } 两版,ar/ru/fr 全落到英文。
const USAGE_FILTER = ['all', 'residential', 'commercial', 'hospitality', 'industrial', 'other']

// 时间轴指标 → 图标。与 METRIC_OPTIONS 用同一套图标,保证「同图标=同指标」。
const TIMELINE_METRIC_ICONS: Record<TimelineMetric, typeof DollarSign> = {
  medianUnitPrice: DollarSign,
  medianPriceSqft: DollarSign,
  growth: TrendingUp,
  transactionCount: BarChart3,
  rentalYield: Percent,
  medianRent: Home,
}

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
/**
 * KHDA 督导评级 → 配色 + 翻译键。
 *
 * ⚠️ 这里原本只有 `zh` 一个字段,渲染处还写死 `KHDA {khdaStyle.zh}` **不分语言**
 * → 英文/阿语用户的地图上赫然写着「KHDA 卓越」。现在只出 `key`,文案走
 * `t('map:khda.<key>')`;认不出的评级 key=null → 原样显示 DLD 给的英文原值。
 */
function getKhdaStyle(rating?: string): { bg: string; text: string; key: string | null } | null {
  if (!rating) return null
  const r = rating.trim().toLowerCase()
  const map: Record<string, { bg: string; text: string; key: string }> = {
    'outstanding': { bg: '#047857', text: '#fff', key: 'outstanding' },
    'very good': { bg: '#059669', text: '#fff', key: 'veryGood' },
    'good': { bg: '#2563eb', text: '#fff', key: 'good' },
    'acceptable': { bg: '#d97706', text: '#fff', key: 'acceptable' },
    'weak': { bg: '#dc2626', text: '#fff', key: 'weak' },
    'very weak': { bg: '#991b1b', text: '#fff', key: 'veryWeak' },
  }
  return map[r] || { bg: '#475569', text: '#fff', key: null }
}

export default function MapPage() {
  const { t, i18n } = useTranslation(['map', 'common', 'misc'])
  // 运行时拼的键(khda.* / usage.*)→ t 收成字面量联合类型,必须 cast
  const tk = t as (k: string, o?: Record<string, unknown>) => string
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
  // Viewer session is STICKY: captured from /t/:code, then KEPT across in-app
  // navigation (and reloads, via sessionStorage) so a client roaming the real app
  // never drops the tour. Cleared only on explicit exit. (Presenter already
  // survives nav via state + ?host, so it stays as-is.)
  const [viewerCode, setViewerCode] = useState<string | undefined>(() => {
    try { return sessionStorage.getItem('collabViewerCode') || undefined } catch { return undefined }
  })
  const linkOpenReportedRef = useRef(false)
  useEffect(() => {
    if (isCollabViewerPath && pathCode) {
      // 漏斗第 1 步:客户点开了分享链接。只报一次(ref 守卫)——
      // 这一步是整个漏斗的分母,重复上报会把后面每一步的转化率都算低。
      if (!linkOpenReportedRef.current) {
        linkOpenReportedRef.current = true
        reportFunnelStep('collab.join', 'link_open')
      }
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
  // 客户身份门(S2):viewer 进带看前先填称呼(+ 选填联系方式),否则不连 WS
  // (useCollab 的 enabled 已加 !!name)。填过就记住(sessionStorage),跨页/刷新不再问。
  const [viewerName, setViewerName] = useState<string>(() => {
    try { return sessionStorage.getItem('collabViewerName') || '' } catch { return '' }
  })

  const collabMode: CollabMode = viewerCode ? 'viewer' : presenterCode ? 'presenter' : 'browse'
  const collabCode = viewerCode || presenterCode
  const collabActive = collabMode !== 'browse'
  const [shareCopied, setShareCopied] = useState(false)
  // In-collab project detail drawer (synced presenter↔viewer; never navigates).
  const [openProjectId, setOpenProjectId] = useState<string | null>(null)
  const [projectTab, setProjectTab] = useState('overview')
  const openProjectIdRef = useRef<string | null>(null)
  useEffect(() => { openProjectIdRef.current = openProjectId }, [openProjectId])
  // 区域面板的 tab/口径/选中区 —— 广播回调要读最新值(闭包会捕获旧的)。
  // state 声明在下面(要等 selectedArea),这里只占 ref 位。
  const areaTabRef = useRef<AreaTab>('sales')
  const areaUsageRef = useRef('all')
  const selectedAreaRef = useRef<DubaiArea | null>(null)
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

  /**
   * 氛围层 —— 海上的船 + 天上的飞机。**只在 tour 期间跑。**
   *
   * 一张静止的卫星图是一张照片;有船在海上走、有飞机掠过,它才是一座正在运转的城市 ——
   * 而客户要买的正是这座城市的一部分。
   *
   * 纯 GL symbol layer + 15Hz 定时器,零 React、零 DOM marker
   * (DOM marker 会压垮 GPU —— 那个坑踩过了)。
   */
  useEffect(() => {
    if (!tourCode) return
    const life = createAmbientLife({ getMap: getCollabMap })
    // 等地图 style 真的就绪再启动(start 里也有 isStyleLoaded 兜底,这里只是别空转)
    const t = window.setTimeout(() => life.start(), 800)
    return () => {
      window.clearTimeout(t)
      life.stop()
    }
  }, [tourCode, getCollabMap])

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
  const keyboardInset = useKeyboardInset()   // 手机软键盘高度,给底部搜索 dock 让位
  const [liveMap, setLiveMap] = useState<MaplibreMap | null>(null)  // 给指北针按钮订阅相机
  const [searchOpen, setSearchOpen] = useState(false)                // 手机:搜索默认收成一颗图标
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

  // 资本增值周期(与 AreaBlock 共用同一 localStorage key → 两处天然同步)。
  const [apprPeriod, setApprPeriod] = useState<MetricPeriodKey>(loadSavedPeriod)
  const [showPeriodPop, setShowPeriodPop] = useState(false)
  const changeApprPeriod = (k: MetricPeriodKey) => { setApprPeriod(k); savePeriod(k) }
  // 支持"时间窗口"的指标(全部 5 个地图指标)。
  const metricHasPeriod = areaMetric !== 'none'
  // 全区各周期全指标 —— 选了任意指标就取,一次取回,切周期/口径/指标不重取。
  const [areaApprMap, setAreaApprMap] = useState<AllAreaAppreciation | null>(null)
  useEffect(() => {
    if (!metricHasPeriod || areaApprMap) return
    let alive = true
    fetchAllAreaAppreciation().then(d => { if (alive && d) setAreaApprMap(d) })
    return () => { alive = false }
  }, [metricHasPeriod, areaApprMap])
  // ───────────────── 时间轴模式 ─────────────────
  // 独立「模式」而非又一个指标开关:进入后接管区域着色、并**隐藏**顶部控制卡/
  // 搜索 dock/工具卡。这样年份与「指标周期」两个正交时间维度不会同屏打架,也绕开了
  // 「上控制卡加一行就得同步改下工具卡 top-[124px]/[164px]」那条栽过两次的耦合。
  // 数据一次全取(≈200 区 × 6 年,很小),切年零请求 —— 见 lib/map/timeline.ts 文件头。
  const [timelineOn, setTimelineOn] = useState(false)
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('medianRent')
  /** 月轴上的帧位置(下标,不是年份)。连续拖动就是改它。 */
  const [timelineIdx, setTimelineIdx] = useState(0)
  const [monthlyData, setMonthlyData] = useState<AreaMonthly | null>(null)
  const [timelinePlaying, setTimelinePlaying] = useState(false)
  useEffect(() => {
    if (!timelineOn || monthlyData) return
    let alive = true
    fetchAreaMonthly().then((d: AreaMonthly | null) => {
      if (!alive || !d?.months?.length) return
      setMonthlyData(d)
      setTimelineIdx(d.months.length - 1)   // 默认停在最新
    })
    return () => { alive = false }
  }, [timelineOn, monthlyData])
  // 播放:每 140ms 前进一个月(67 帧约 9 秒放完),走到头停住 —— 不循环,
  // 循环会让人以为数据在抖。
  useEffect(() => {
    if (!timelinePlaying || !monthlyData) return
    const id = setTimeout(() => {
      setTimelineIdx(i => {
        if (i >= monthlyData.months.length - 1) { setTimelinePlaying(false); return i }
        return i + 1
      })
    }, 140)
    return () => clearTimeout(id)
  }, [timelinePlaying, timelineIdx, monthlyData])
  // 标签帧**滞后**于填充帧 140ms。
  // 填充色走 feature-state(每帧 ~180 次微秒级调用,可以帧帧跟手);标签是 layout
  // 属性读不到 feature-state,只能重建那个点 source + 让 symbol 图层重排碰撞检测。
  // 拖动时让标签只在停下后排一次 —— 观感是「颜色瞬间跟手、数字随后落位」。
  const [labelIdx, setLabelIdx] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setLabelIdx(timelineIdx), 140)
    return () => clearTimeout(id)
  }, [timelineIdx])
  const timelineProp = useMemo(
    () => (timelineOn && monthlyData
      ? { index: timelineIdx, labelIndex: labelIdx, metric: timelineMetric, data: monthlyData }
      : null),
    [timelineOn, monthlyData, timelineIdx, labelIdx, timelineMetric]
  )
  const exitTimeline = () => { setTimelineOn(false); setTimelinePlaying(false) }

  // 地图专用区域数组:选了指标时,把每区的指标值覆盖成所选周期+口径的窗口值,
  // 着色/标签随周期变。只喂给地图层,不动原 dubaiAreas(弹窗 selectedArea 仍取
  // 原数组,见 handleAreaClick)。undefined = 该区该周期样本不足 → 灰色。
  const mapAreas = useMemo(() => {
    if (!metricHasPeriod || !areaApprMap) return dubaiAreas
    return dubaiAreas.map(a => {
      const m = areaApprMap.areas[a.id]?.[marketSegment]?.[apprPeriod]
      if (!m) return { ...a, medianUnitPrice: undefined, medianPriceSqm: undefined, capitalAppreciation: undefined, transactionCount: undefined, rentalYield: undefined }
      return {
        ...a,
        medianUnitPrice: m.unitPrice ?? undefined,
        medianPriceSqm: m.priceSqm ?? undefined,
        capitalAppreciation: m.growth ?? undefined,
        transactionCount: m.count,
        rentalYield: m.yield ?? undefined,
      }
    })
  }, [dubaiAreas, metricHasPeriod, areaApprMap, marketSegment, apprPeriod])


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
  /**
   * 项目卡片显示开关 —— 提到这一层,因为**实时带看要把它同步给客户**
   *(owner:「关闭/打开项目显示时也不会 sync 到 client side」)。
   * 普通地图行为不变:MapViewMapLibre 只在收到 override 时才交出控制权。
   */
  const [showCards, setShowCards] = useState<boolean>(() => localStorage.getItem('map-cards') !== '0')
  // 底图也提上来 —— 同理,带看时要同步给客户
  const [baseMap, setBaseMap] = useState<'vector' | 'satellite' | 'dark'>(
    () => ((localStorage.getItem('map-base') as 'vector' | 'satellite' | 'dark') || 'satellite')
  )

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

      /**
       * 🔴 **这个 case 以前根本不存在 —— 静默失败了很久。**
       *
       * `highlight_areas` 由 compare_areas / compare_market / check_affordability
       * 三个工具发出，类型定义里有、VoiceAssistantContext 的「要跳回地图」清单里也有，
       * 但**这个 switch 里没有对应分支** → 客户被导航回地图，然后什么都不发生。
       * Luna 说着「这几个区更适合你的预算」，地图纹丝不动。
       *
       * 现在：把区名解析成坐标，镜头框住这几个区，客户至少看得到 Luna 在说哪里。
       * （真正的多边形高亮是后续优化；先把「完全没反应」变成「看得见」。）
       */
      case 'highlight_areas':
        if (Array.isArray(action.areas) && action.areas.length) {
          void (async () => {
            const pts: [number, number][] = []
            await Promise.all(
              action.areas!.slice(0, 6).map(async (name) => {
                try {
                  const r = await fetch(`${API_BASE_URL}/api/ai/areas/match?q=${encodeURIComponent(name)}`)
                  const d = await r.json()
                  // 只用**确定匹配**的区。歧义/查无此区就跳过 —— 框到错的地方
                  // 比不动更糟，那等于用镜头给一个错误答案背书。
                  if (d?.status === 'matched' && d.area?.lat != null && d.area?.lng != null) {
                    pts.push([Number(d.area.lng), Number(d.area.lat)])
                  }
                } catch { /* 单个区失败不影响其他 */ }
              })
            )
            if (!pts.length) return
            const lngs = pts.map(p => p[0])
            const lats = pts.map(p => p[1])
            if (pts.length === 1) {
              setFlyToLocation({ lat: lats[0], lng: lngs[0], zoom: 12 })
            } else {
              setFlyToLocation({
                lat: (Math.min(...lats) + Math.max(...lats)) / 2,
                lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
                bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              })
            }
          })()
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

        // tab 是 "tab|usage" 的复合串(见 broadcastAreaSub)。经纪只是切了个 tab 时
        // 别重新 flyTo —— 否则每点一下 tab 相机就抖一下。
        if (tab) {
          const [t, u] = tab.split('|')
          if (t === 'sales' || t === 'rentals' || t === 'projects') setAreaTab(t)
          if (u) setAreaUsage(u)
        }
        const isNewArea = String(selectedAreaRef.current?.id ?? '') !== String(id)
        if (!isNewArea) return // 同一个区域,只是 tab/口径变了 → 不重开、不飞

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

  // 经纪切区域面板的 tab / 口径 → 客户跟着切。
  // 复用 select 的 tab 字段(协议不动),编码成 "tab|usage" 的复合串。
  const broadcastAreaSub = useCallback((tab: AreaTab, usage: string) => {
    const id = selectedAreaRef.current?.id
    if (collabActiveRef.current && id) {
      collabSendRef.current.sendSelect('area', String(id), `${tab}|${usage}`)
    }
  }, [])
  const handleAreaTabChange = useCallback((tab: AreaTab) => {
    setAreaTab(tab)
    broadcastAreaSub(tab, areaUsageRef.current)
  }, [broadcastAreaSub])
  const handleAreaUsageChange = useCallback((usage: string) => {
    setAreaUsage(usage)
    broadcastAreaSub(areaTabRef.current, usage)
  }, [broadcastAreaSub])
  // 移动 sheet 的两档 → canonical 三档(market 落到 sales;移动端本就不区分成交/租金)
  const handleSheetTabChange = useCallback((t: 'market' | 'projects') => {
    handleAreaTabChange(t === 'projects' ? 'projects' : 'sales')
  }, [handleAreaTabChange])
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
      if (a?.type === '__collab_voice_request') {
        // 买家想通话(经纪端处理):
        //   • 还没开 → connect() 自动接通(它有经纪 email,账记对)
        //   • 已经开 → connect() 是 no-op,但必须**重播 voice-on**,让那个后进房、
        //     presenterVoiceOn 还是 false 的买家知道通话开着 → 触发它自动 join。
        if (collabModeRef.current === 'presenter') {
          voiceConnectRef.current?.()
          if (voiceStatusRef.current === 'live') {
            collabSendRef.current.sendMapAction({ type: '__collab_voice', on: true })
          }
        }
        return
      }
      handleVoiceMapAction(action as MapAction)
    },
    [handleVoiceMapAction]
  )

  const collab = useCollab({
    mode: collabMode,
    code: collabCode,
    name: collabMode === 'presenter' ? (user?.email?.split('@')[0] || 'Ahmed') : viewerName,
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
    if (area.medianUnitPrice) lines.push(`${t('misc:median')} ${formatMoneyCompact(area.medianUnitPrice, i18n.language)}`)
    if (area.rentalYield) lines.push(`${t('misc:yield')} ${area.rentalYield.toFixed(1)}%`)
    if (area.transactionCount) lines.push(`${t('misc:deals')} ${area.transactionCount.toLocaleString('en-US')}`)
    return lines.join('\n')
  }, [dubaiAreas, i18n.language])

  // Map drawing / markup (pen / arrow / text / pin / circle), geo-anchored +
  // broadcast to the room. Circle uses getAreaInfoAtPoint for draw-to-query.
  //
  // 两种场景共用同一个引擎:
  //   • collab 带看 → client 已连,画的东西广播给客户(collabActive)
  //   • 登录经纪单机 → client 为 null(broadcast 空转),线下当面在 homepage 画图谈单
  // 匿名买家不给画笔(界面保持干净)。tour 播放/collab viewer 路径不启用单机画笔。
  const canSoloDraw = !!user && !tourCode && !collabActive && !isCollabViewerPath
  const drawEnabled = collabActive || canSoloDraw
  const draw = useCollabDraw({ getMap: getCollabMap, client: collab.client, active: drawEnabled, getAreaInfo: getAreaInfoAtPoint })

  /**
   * 🔴 **地图状态同步** —— 指标热力图 / 筛选 / 项目显示 / 地铁线。
   *
   * 之前只有相机、光标、画笔在同步,**地图的「状态」根本没进协议** ——
   * 经纪切了增长率、筛了交房日期,客户看到的还是原样。
   * **两个人在看不同的地图,而经纪以为在讲同一张。**
   *
   * 复用协议里现成的 `mapAction` 通用通道(画笔也在用)—— 不动协议、不动服务器。
   * 只有经纪广播,客户只听。
   */
  const applyRemoteMapState = useCallback((st: CollabMapState) => {
    if (st.areaMetric !== undefined) setAreaMetric(st.areaMetric as AreaMetric)
    if (st.filters !== undefined) setFilters(st.filters as PropertyFilters)
    if (st.showCards !== undefined) setShowCards(st.showCards)
    if (st.showTransit !== undefined) setShowTransit(st.showTransit)
    // POI 品类(学校/医院/商场/地铁站…)—— 经纪点亮「学校」是为了讲学区,
    // 客户屏幕上却一个学校都没有,那这段话就是空的。
    if (st.poiCategories !== undefined) setEnabledPoiCategories(st.poiCategories as PoiCategory[])
    if (st.baseMap !== undefined) setBaseMap(st.baseMap as 'vector' | 'satellite' | 'dark')
    // 时间轴三件套必须一起跟 —— 只跟开关不跟年份,客户看到的就是另一年的图。
    if (st.timelineOn !== undefined) setTimelineOn(st.timelineOn)
    if (st.timelineMetric !== undefined) setTimelineMetric(st.timelineMetric as TimelineMetric)
    if (st.timelineIdx !== undefined) setTimelineIdx(st.timelineIdx)
  }, [])

  const mapStateSync = useCollabMapState({
    client: collab.client,
    active: collabActive,
    isPresenter: collabMode === 'presenter',
    onRemote: applyRemoteMapState,
  })

  // 经纪这边任一状态变了 → 广播。hook 内部会去重(没变就不发)。
  useEffect(() => {
    if (collabMode !== 'presenter') return
    mapStateSync.broadcast({
      areaMetric,
      filters: filters as unknown as Record<string, unknown>,
      showCards,
      showTransit,
      poiCategories: enabledPoiCategories,
      baseMap,
      timelineOn,
      timelineIdx,
      timelineMetric,
    })
  }, [collabMode, mapStateSync, areaMetric, filters, showCards, showTransit, enabledPoiCategories, baseMap,
      timelineOn, timelineIdx, timelineMetric])

  // 带看结束 → 清掉这场画的所有标注 + 测距尺。
  //
  // 地图是**常驻**的(挂在 Layout,display:none 隐藏而非卸载 —— 见 memory:
  // persistent-map-architecture),所以 marks 不会随路由卸载而消失:上一场画的圈
  // 会一直留在图层里,下次进地图还看得见。必须在 collabActive true→false 时手动清。
  // 覆盖两条退出路径:经纪「结束」和客户「退出」(两者都会让 collabActive 变 false)。
  const wasCollabActive = useRef(false)
  useEffect(() => {
    if (wasCollabActive.current && !collabActive) {
      draw.clearAll()
      setVoiceMeasure(null)
    }
    wasCollabActive.current = collabActive
  }, [collabActive, draw])

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
    connId: collab.connId,   // 派生稳定 Agora uid → 说话高亮能对回参与者
  })
  // viewer learns the presenter has voice on (proactive "join voice" prompt)
  const [presenterVoiceOn, setPresenterVoiceOn] = useState(false)

  // ── 买家主动发起语音(raise hand)+ 大入口一键接通 ──────────────────────────
  //
  // owner:「买家想主动说话却只能等经纪开」。现在买家点大按钮:
  //   • 已有通话 → 直接加入(join)
  //   • 还没通话 → 通过 WS 给经纪发「想通话」信号,经纪端**自动接通**(账仍记经纪头上,
  //     因为是经纪的客户端调 /start),买家这边等 presenterVoiceOn 翻真就自动 join。
  // 经纪端也能收到,不用先动手 —— 买家想聊就聊得上。
  const [voiceRequesting, setVoiceRequesting] = useState(false)
  const voiceConnectRef = useRef<() => void>(() => {})
  voiceConnectRef.current = voice.connect
  const voiceStatusRef = useRef(voice.status)
  voiceStatusRef.current = voice.status
  const collabModeRef = useRef(collabMode)
  collabModeRef.current = collabMode

  const requestOrJoinVoice = useCallback(() => {
    unlockChimes()  // 这是用户手势 —— 顺手解锁 iOS 音频
    if (voice.status === 'live' || voice.status === 'connecting') return
    // 🔴 直接先试着加入(经纪已在通话 → /viewer-token 立刻给票就进,能看到摄像头)。
    //    **不要**只看 presenterVoiceOn —— 后进房的客户可能错过了「语音已开」那一次广播,
    //    presenterVoiceOn 还是 false,但通话其实开着,直接 connect 就能进。
    //    同时给经纪发「想通话」兜底:经纪还没开 → 收到自动接通;已经开了 → 重播 voice-on。
    voice.connect()
    setVoiceRequesting(true)
    collabSendRef.current.sendMapAction({ type: '__collab_voice_request' })
  }, [voice])

  // 有人进/出带看 → 轻轻一声(owner:「进来了有提示音」)。prev>0 才响,避免自己
  // 首次进房时把在场的人一次性响一遍。
  const prevPartCountRef = useRef(0)
  useEffect(() => {
    if (!collabActive) { prevPartCountRef.current = collab.participants.length; return }
    const n = collab.participants.length
    const prev = prevPartCountRef.current
    if (n > prev && prev > 0) chimeJoin()
    else if (n < prev && n > 0) chimeLeave()
    prevPartCountRef.current = n
  }, [collab.participants.length, collabActive])

  // 经纪已接通 → 买家自动 join;不再显示「接通中」
  useEffect(() => {
    if (presenterVoiceOn && voiceRequesting && voice.status !== 'live' && voice.status !== 'connecting') {
      setVoiceRequesting(false)
      voice.connect()
    }
  }, [presenterVoiceOn, voiceRequesting, voice])
  useEffect(() => { if (voice.status === 'live') setVoiceRequesting(false) }, [voice.status])
  // 经纪不在线/没接通 → 别让买家一直卡在「接通中」。12s 兜底,按钮回来可重试。
  useEffect(() => {
    if (!voiceRequesting) return
    const t = setTimeout(() => setVoiceRequesting(false), 12000)
    return () => clearTimeout(t)
  }, [voiceRequesting])
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

  // 🔴 后进房的客户会**错过**上面那次一次性广播 → 它以为经纪没开语音(按钮显示
  //    「和 XX 语音通话」而不是「接听」),也就看不到经纪的摄像头。所以只要经纪在通话,
  //    有人进/出房就**补广播一次** voice-on,让新来的知道通话开着、能加入看视频。
  useEffect(() => {
    if (collabMode === 'presenter' && voice.status === 'live') {
      collabSendRef.current.sendMapAction({ type: '__collab_voice', on: true })
    }
  }, [collab.participants.length, collabMode, voice.status])

  // The other party's display name for the session bar / Free pill.
  const collabPeerName = useMemo(() => {
    const peer = collab.participants.find((p) =>
      collabMode === 'presenter' ? p.role === 'viewer' : p.role === 'presenter'
    )
    return peer?.name
  }, [collab.participants, collabMode])

  /**
   * 开一场带看:建房 + 进 presenter 模式。**任何登录经纪都能开**。
   *
   * 权限由**后端**判(collab.ts 的 checkCredits('live_tours') → minPlan=agent),
   * 没权限返回 402 + 中文提示。前端不再自己判 —— 之前这里挂着 isOwner 门,
   * 结果是普通付费经纪点「开始带看」什么也不发生(静默停在地图上)。
   */
  const [tourError, setTourError] = useState<string | null>(null)
  const handleStartTour = useCallback(async () => {
    setTourError(null)
    try {
      // 一场一码:每次开始带看都新建随机 code(不再用「按经纪派生的稳定 code」)。
      // 上一场的链接不会复用到这一场 → 上一位客户拿旧链接进不来(防偷听)。
      // ?host=code 存的是「当次这场」的 code:刷新/断线重连仍复活同一场房间。
      const { code } = await createCollabRoom(user?.email?.split('@')[0] || undefined)
      setPresenterCode(code)
      /**
       * ⚠️ **一次写完** —— 设 host **并且**删掉 livetour。
       *
       * 之前这两件事分在两个 effect 里各调一次 setSearchParams,互相覆盖 ——
       * 结果 URL 常常同时留着 `livetour=1` 和 `host=xxx`(owner 那条链接就是),
       * 于是**下一次刷新又会去走「自动开一场」那条路**。
       */
      setSearchParams((prev) => {
        const n = new URLSearchParams(prev)
        n.set('host', code)
        n.delete('livetour')
        return n
      }, { replace: true })
    } catch (e) {
      // ⚠️ 绝不静默失败(铁律:权限 UI 不静默)。createCollabRoom 已经把后端的
      // 中文提示(含升级引导)抛出来了 —— 显示给他,别只写进 console。
      console.error('[collab] failed to create room', e)
      setTourError(e instanceof Error ? e.message : '开始带看失败，请重试')
    }
  }, [user?.email, setSearchParams])

  // Presenter refresh / deep-link (?host=code): re-enter presenter mode and rejoin
  // the existing room (no new room created). Runs once.
  const hostResumedRef = useRef(false)
  useEffect(() => {
    if (hostResumedRef.current) return
    const host = searchParams.get('host')
    // 登录即可复活自己的 presenter 会话(不再是 owner-only)。房间是否真的属于他、
    // 有没有权限,后端 WS hello 会判。
    if (!host || !user || viewerCode || presenterCode) return
    hostResumedRef.current = true
    setPresenterCode(host)
  }, [searchParams, user, viewerCode, presenterCode])

  /**
   * 经纪台深链(/?livetour=1)→ 自动开一场带看。
   *
   * ⚠️ 这里**曾经**挂着 `!isOwner` 的门 —— 于是普通付费经纪从经纪台点「开一场
   * 实时带看」,跳到地图后**什么也不发生**(静默停在首页)。带看是核心功能,
   * 却对除 owner 外的所有人不可用。权限交给后端(minPlan=agent → 402 带中文提示)。
   */
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current) return
    if (searchParams.get('livetour') !== '1') return
    if (!user || collabActive || presenterCode) return  // 等 auth 解析出来再开

    /**
     * 🔴 **URL 里已经有 ?host= → 这是「刷新/断线重连」,绝不能新建房间。**
     *
     * owner 实测:「经纪在一个 live tour session 里不小心断了或者按了刷新,
     *              **会创建新 room 而不是 join 回原本买家在的 room**。」
     *
     * 根因是一个 React 状态竞态。刷新时 URL 上 `livetour=1` 和 `host=FUPSU` 都在:
     *   1. 上面那个「复活 presenter」的 effect 先跑 → setPresenterCode('FUPSU')
     *      —— 但 **setState 是异步的,这一轮还没生效**
     *   2. 本 effect 在**同一轮**接着跑 → 读到的 presenterCode 还是 undefined
     *      → 判定「还没开始」→ **开了一间新房**
     *
     * 于是:**客户还在老房间里,经纪自己跑到新房间去了** —— 两个人从此看不见对方。
     *
     * 修:**别信还没刷新的 state,信 URL。** URL 上有 host 就是在复活,不是在开新场。
     */
    if (searchParams.get('host')) {
      autoStartedRef.current = true      // 别再跑;复活交给上面那个 effect
      const next = new URLSearchParams(searchParams)
      next.delete('livetour')            // 清掉,免得下次刷新又走这条路
      setSearchParams(next, { replace: true })
      return
    }

    autoStartedRef.current = true
    void handleStartTour()
  }, [searchParams, user, collabActive, presenterCode, handleStartTour, setSearchParams])

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
      // 通知服务端结束这场带看:删房 + 踢掉所有 viewer,旧链接立即失效(不再等 10min 空房 GC)。
      collab.endTour()
      setPresenterCode(undefined)
      // drop ?host so a later refresh doesn't rejoin the ended tour
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('host'); return n }, { replace: true })
    }
  }, [viewerCode, location.pathname, navigate, setSearchParams, collab])

  // 客户身份门提交(S2):记住称呼(→ 连 WS 用真名)+ 选填联系方式上报后端(供报告/跟进)。
  const handleViewerIdentify = useCallback((name: string, phone: string, whatsapp: string) => {
    // 漏斗第 2 步。这道门是**最可疑的流失点** —— 2026-07-13 现场那批房间大部分
    // peak_participants=1(客户压根没进来),而经纪分不清「没点」和「卡住了」。
    reportFunnelStep('collab.join', 'identity_submit')
    setViewerName(name)
    try { sessionStorage.setItem('collabViewerName', name) } catch { /* ignore */ }
    if (viewerCode && (phone || whatsapp)) {
      void identifyCollab(viewerCode, { name, phone: phone || undefined, whatsapp: whatsapp || undefined })
    }
  }, [viewerCode])

  // viewer:带看被结束/踢出/链接失效后点「知道了」→ 退出会话回地图(不再重连不存在的房间)。
  const handleEndedAck = useCallback(() => {
    setViewerCode(undefined)
    try { sessionStorage.removeItem('collabViewerCode') } catch { /* ignore */ }
    if (location.pathname.startsWith('/t/')) navigate('/')
  }, [location.pathname, navigate])

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
    setLiveMap(map)   // 指北针按钮(收在左上筛选卡里)要订阅 rotate/pitch
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

  // 相机深链恢复:App 首挂载时解析一次 ?v=(地图非受控,只喂 initialViewState)。
  // ref 而非 state:值终生不变,不参与任何渲染更新。登录回跳的 resume flyTo
  // (上面)在地图加载后才触发,天然覆盖深链视角,优先级正确。
  const initialCameraRef = useRef(
    isMapPath(window.location.pathname, window.location.search)
      ? parseCameraParam(window.location.search)
      : null
  )

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
  // DEV 探针:区域图层排障用(0 个多边形时先看这里是数据没到还是渲染没接上)
  if (import.meta.env.DEV) (window as any).__mapDiag = { areas: dubaiAreas.length, mapAreas: mapAreas.length, segment: marketSegment }
  // 区域面板的子状态(tab + 口径)—— **canonical,跨设备统一,collab 同步的线格式**。
  //
  // ⚠️ 桌面 dialog 有三个 tab(成交/租金/项目),移动 sheet 只有两个(市场/项目)。
  // 而主力场景恰恰是「经纪 iPad(桌面版) 带客户手机(移动版)」—— 两边渲染的是不同组件、
  // 不同 tab 集合。所以必须有**一套 canonical 值**上线,两端各自映射,否则「经纪切到
  // 成交,客户手机没反应」。canonical 取桌面的三档(信息量最大,移动端向下合并)。
  //
  // 映射:desktop sales|rentals → mobile 市场;desktop projects → mobile 项目。
  const [areaTab, setAreaTab] = useState<AreaTab>('sales')
  const [areaUsage, setAreaUsage] = useState('all')
  useEffect(() => { setAreaTab('sales'); setAreaUsage('all') }, [selectedArea?.id])
  useEffect(() => { areaTabRef.current = areaTab }, [areaTab])
  useEffect(() => { areaUsageRef.current = areaUsage }, [areaUsage])
  useEffect(() => { selectedAreaRef.current = selectedArea }, [selectedArea])
  const sheetTab: 'market' | 'projects' = areaTab === 'projects' ? 'projects' : 'market'
  // 移动 sheet 的「在本区内搜楼盘/楼栋」下钻（桌面同款，状态各自持有）
  const [sheetPlace, setSheetPlace] = useState<AreaPlaceSel | null>(null)
  useEffect(() => { setSheetPlace(null) }, [selectedArea?.id])
  // 移动端 sheet 的区域洞察（桌面 dialog 内部自取，后端缓存去重）
  const { insights: sheetInsights, loading: sheetInsightsLoading } = useAreaInsights(
    showAreaSheet ? selectedArea?.id : undefined, areaUsage, marketSegment
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
  // (付款结构档位选项已随「付款计划」筛选一起移除 —— 2026-07-11 用户要求;
  //  付款结构本身仍在项目详情/报价单里展示,只是不再作为地图筛选维度。)
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

      // 付款结构档位("80/20" 建设期/交付,后端从 payment_plan 推导)
      if (filters.paymentPlan && pin.paymentPlan !== filters.paymentPlan) return false

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

  // ── 相机深链(?v=zoom_lat_lng[_pitch_bearing]) ───────────────────────────
  // 相机停稳(150ms debounce,MapViewMapLibre 内)后把视角写进 URL,任何地图
  // 视角可直接复制分享。走 history.replaceState:不经 React Router,零重渲染
  // 零导航;只在纯地图路由('/'、'/map')写——/v/ /t/ 分享链接和 ?toursession
  // 的 URL 是会话链接,不能被相机参数污染。
  const handleCameraIdle = useCallback((cam: { lng: number; lat: number; zoom: number; pitch: number; bearing: number }) => {
    const { pathname, search, hash } = window.location
    if (pathname !== '/' && pathname !== '/map') return
    const params = new URLSearchParams(search)
    if (params.has('toursession')) return
    params.set('v', serializeCameraParam(cam))
    window.history.replaceState(window.history.state, '', `${pathname}?${params.toString()}${hash}`)
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


  /**
   * 搜索框选中一条 —— 「打一个区域名,直接把你带过去」。
   *
   * 以前这里只有一句 setFlyToLocation:地图静静飞过去,不高亮、不开弹窗,
   * 没有任何「到了」的反馈。付费经纪 slavynchuk94@ 2026-07-29 的原话是
   * "Would be great if we can type an area and it straight away brings you there" ——
   * 他要的不是镜头位移,是**落地**。所以现在选中就等价于在地图上点了那个区 /
   * 那个楼盘:飞过去 + 打开详情。
   */
  const handleSearchSelect = useCallback((s: MapSuggestion) => {
    trackEvent('search', { kind: `map_${s.kind}`, query: s.name.trim() })
    if (s.centroid) {
      setFlyToLocation({ lat: s.centroid.lat, lng: s.centroid.lng, zoom: s.kind === 'area' ? 13 : 15 })
    }
    if (s.kind === 'area') {
      const area = dubaiAreas.find(a => String(a.id) === String(s.id))
      if (area) handleAreaClick(area)
      return
    }
    // 楼盘:走和点图钉完全一样的路径(collab 时开就地抽屉并广播,平时跳详情页)
    const pin = mapPins.find(p => String(p.id) === String(s.id))
    if (pin) handleProjectClick(pin)
    else navigate(`/project/${s.id}`)
  }, [dubaiAreas, mapPins, handleAreaClick, handleProjectClick, navigate])

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
                <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-slate-400 h-5 w-5" />
                <Input
                  type="text"
                  placeholder={t('map:searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-10 h-12 text-base"
                />
              </div>
              <Button
                variant="outline"
                className="h-12 px-6"
                onClick={() => setShowFilters(!showFilters)}
              >
                <SlidersHorizontal className="h-5 w-5 me-2" />
                {t('map:filters')}
                {hasActiveFilters && (
                  <span className="ms-2 bg-primary text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
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
            // 相机深链:停稳才写 URL(150ms debounce 同拍),tour 时相机每帧都
            // 在动且 URL 是会话链接,禁写。
            onCameraIdle={tourCode ? undefined : handleCameraIdle}
            initialView={initialCameraRef.current ?? undefined}
            onReady={() => setMapReady(true)}
            onProjectClick={handleProjectClick}
            onAreaClick={handleAreaClick}
            areaMetric={areaMetric}
            timeline={timelineProp}
            onEnterTimeline={() => setTimelineOn(true)}
            dubaiAreas={mapAreas}
            dubaiLandmarks={dubaiLandmarks}
            showDubaiLayer
            pois={pois}
            // 🔴 tour 期间关掉**通用 POI 图标层**（那几十个铺满屏幕的蓝圈）——
            //    它们把项目 pin 完全淹没了，而且跟这场带看没有关系。
            //
            //    ⚠️ 这不是"把配套藏起来"：讲到「距地铁 0.91 公里」时，剧本用
            //    `distance_line` / `amenity_spokes` overlay **只画那一条线、只亮那一个站**
            //    （life beat 里本来就有）。只有需要的时候才亮，亮的也只是那一个 ——
            //    而不是把全城几十个 POI 一直摊在客户脸上。
            //
            //    3D 地标 / 区域色块 / 地铁线图层**不受影响**（owner 要保留）。
            // 时间轴模式一并收起 POI 图标层 —— 理由同项目卡:几十个蓝圈盖住色块。
            showPois={showPois && !tourCode && !timelineOn}
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
            disableFeatureClicks={drawEnabled && draw.tool !== 'none'}
            // 画笔按钮进右上工具卡(和测距/路线并排),选中后底部弹调色板 —— 不再是
            // 会跟工具卡打架的右缘 FAB。登录经纪/带看有,匿名买家没有。
            draw={drawEnabled ? draw : null}
            // 带看时项目卡片开关由 MapPage 掌管(要同步给客户);平时组件自己管
            showCardsOverride={collabActive ? showCards : undefined}
            onShowCardsChange={setShowCards}
            baseMapOverride={collabActive ? baseMap : undefined}
            onBaseMapChange={setBaseMap}
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
                <span className="text-sm font-medium text-white/80">{t('misc:loadingMap')}</span>
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
            <CollabCursorLayer client={collab.client} active label={collabPeerName || '经纪'} getMap={getCollabMap} />
          )}

          {/* 画笔 UI 已并入地图右上工具卡(见 MapViewMapLibre 的 draw prop):铅笔按钮
              和测距/路线并排,选中后底部弹调色板。collab 与登录经纪单机共用,不再单独
              浮一个右缘 FAB(那个会和工具卡重叠)。 */}

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

          {/* S2 客户身份门:viewer 没填称呼 → 先填名(+选填联系方式)才连 WS 进带看 */}
          {collabMode === 'viewer' && !viewerName.trim() && !collab.endedReason && (
            <CollabIdentityGate
              presenterName={collabPeerName}
              defaultName={user?.user_metadata?.full_name || ''}
              onEnter={handleViewerIdentify}
            />
          )}

          {/* viewer:带看被结束 / 被踢 / 链接失效 → 全屏提示,不再白屏/傻等 */}
          {collabMode === 'viewer' && collab.endedReason && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={handleEndedAck}>
              <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-2xl">👋</div>
                <h3 className="text-lg font-bold text-slate-900">
                  {collab.endedReason === 'kicked' ? '你已离开本次带看' : '本次带看已结束'}
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  {collab.endedReason === 'kicked'
                    ? '经纪已将你移出这场带看。'
                    : collab.endedReason === 'not_found'
                      ? '这条链接已失效,或带看已经结束了。'
                      : '经纪结束了这场带看,感谢参与!'}
                </p>
                <button onClick={handleEndedAck} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                  知道了
                </button>
              </div>
            </div>
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
              onRequestVoice={requestOrJoinVoice}
              voiceRequesting={voiceRequesting}
              speakingUids={voice.speakingUids}
              isPresenter={collabMode === 'presenter'}
              presenterName={collabPeerName}
              followMode={collab.followMode}
              onDetach={collab.setFree}
              onReturnToPresenter={collab.returnToPresenter}
              offMap={!isMapPath(location.pathname, location.search)}
              onReturnToMap={() => navigate('/')}
              onExit={handleExitCollab}
              onKick={collabMode === 'presenter' ? collab.kick : undefined}
            />
          )}

          {/* 开带看失败(未订阅 / 积分不足 / 网络)—— **绝不静默**。
              后端 402 的中文提示直接显示,带升级入口。 */}
          {tourError && (
            <div className="fixed left-1/2 top-20 z-[2200] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2">
              <div className="flex items-start gap-2.5 rounded-xl bg-white px-4 py-3 shadow-2xl ring-1 ring-slate-200">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700">!</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-slate-800">{tourError}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => { setTourError(null); void handleStartTour() }}
                      className="text-xs font-semibold text-emerald-600 hover:underline"
                    >
                      重试
                    </button>
                    <button onClick={() => navigate('/agent/billing')} className="text-xs font-semibold text-slate-600 hover:underline">
                      查看套餐
                    </button>
                  </div>
                </div>
                <button onClick={() => setTourError(null)} className="shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Collab: 带看视频画中画。经纪 = 本地预览(要看得见镜头对没对准沙盘),
              客户 = 经纪的画面。经纪一关摄像头,track 变 null → 整个窗消失。 */}
          {collabActive && (
            <CollabVideo
              local={voice.localVideo}
              remote={voice.remoteVideo}
              flipping={voice.flipping}
              isPresenter={collabMode === 'presenter'}
              viewers={voice.videoViewers}
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
          {(!tourCode || toolsRevealed) && !timelineOn && (<>
          {/* 左上:筛选。手机(<md)竖排贴左边缘一列,每个筛选项直接可点(不再是「筛选」
              单按钮开抽屉 —— 2026-07-11 用户要求手机和桌面一样即点即用),popover 往右
              飞出,地图中间不被压。md+ 保持搜索在上、chips 横排在下。 */}
          <div className="absolute top-3 start-2 md:top-4 md:start-4 z-[1002] flex flex-col items-start gap-2 xl:flex-row max-w-[calc(100vw-200px)] xl:max-w-none">
            <div className="hidden md:block">
              <MapSearch onSelect={handleSearchSelect} />
            </div>
            <MapFilterChips
              filters={filters}
              setFilters={setFilters}
              developers={developers}
              leading={<div className="md:hidden"><MapCompassButton map={liveMap} variant="chip" /></div>}
            />
          </div>

          {/* 指北针(pad/桌面):维持原来的独立圆盘,不跟着手机版缩进筛选卡 —— 2026-07-11。
              md 左上是搜索+筛选两行(~108px)→ top-[116px];xl 单行(~56px)→ top-[72px]。
              ⚠️ 搜索框长高/变矮就要同步挪这里(2026-07-29 搜索框字号 xs→sm,+4px)。 */}
          <div className="pointer-events-none absolute start-4 top-[116px] z-[1000] hidden md:block xl:top-[72px]">
            <div className="pointer-events-auto">
              <MapCompassButton map={liveMap} variant="disc" />
            </div>
          </div>

          {/* 手机:搜索沉到底部(拇指区),结果向上展开。默认只是一颗圆钮(不常年占一条),
              点开才铺成一行 —— 2026-07-11 用户要求。

              🔴 **落位交给底部坞**(BottomDock),这里不再自己写 `fixed bottom:76+keyboardInset`。
              以前它和坞里的画笔条/带看底栏在同一条带上各算各的 → 一点画笔就被压住
              (owner 2026-07-27 截图)。现在它就是坞里的一行,排在带看底栏之上。
              收起 / 展开是**两种落位**(owner 2026-07-27:「search bar 应该再下面一点?
              在 navigation bar 正上方」):
              • 收起 = 一颗 40px 圆钮 → 挤进**最底那一行**,贴左,和带看底栏并排。
                独占一行等于白吃一条(右边一大片空),而手机底部本来就只剩三行。
                并排后它就真的贴在 app 导航正上方了。
              • 展开 = 要铺满宽度 → 自己占一行(order=search),排在底栏**之上**,
                否则会盖住「结束/语音」。键盘弹起靠 marginBottom 把它和上面整摞顶起来。
              • 右侧 Luna 药丸的让位由坞统一算(见 BottomDock 的 lunaVisible) */}
          {searchOpen ? (
            <DockItem order={DOCK_ORDER.search} className="w-full md:hidden">
              <div style={{ marginBottom: keyboardInset }} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <MapSearch
                    autoFocus
                    onSelect={(s) => { handleSearchSelect(s); setSearchOpen(false) }}
                  />
                </div>
                <button
                  onClick={() => setSearchOpen(false)}
                  aria-label={t('common:close', { defaultValue: 'Close' })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white/95 text-slate-500 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm transition-transform active:scale-90"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </DockItem>
          ) : (
            <DockBaseRowItem anchor="start" className="md:hidden">
              <button
                onClick={() => setSearchOpen(true)}
                aria-label={t('misc:mapSearch.placeholder')}
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/95 text-slate-600 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm transition-transform active:scale-90"
              >
                <Search className="h-4 w-4" />
              </button>
            </DockBaseRowItem>
          )}
          </>)}


          {/* Luna Tour: hide search controls while playing; reveal them on pause */}
          {(!tourCode || toolsRevealed) && !timelineOn && (<>
          {/* (移除了移动端「当前指标」指示器:右上指标条已高亮选中项,地图每个区也直接
              显示指标值,这个左上 pill 既冗余又会和筛选/找房助手按钮重叠。) */}

          {/* 右上控制卡(市场口径 + 指标 + POI):全断点统一用这张紧凑卡
              (2026-07-05 起桌面也用,原 xl 展开长条已删——用户反馈紧凑卡更好看)。
              手机(<md)整体缩一号常开(试过收纳药丸,用户反馈药丸本身占地方又
              不好看,尺寸缩小后不需要收纳)。 */}
          {/* 视觉:圆角 pill + 有意留白(不再是满铺色块+1px hairline 的"白缝拼贴"),
              按钮 active:scale 按压反馈,选中态带柔和同色投影。 */}
          {/* 卡片宽度锁死(w-[184px]/md w-[212px]):以前是内容撑宽,切到英文所有文案变长
              → 卡跟着变宽、口径 tab 还折行,整块 UI 抖一下且很难看(2026-07-11 用户反馈)。
              现在 5 个图标按钮的行决定了宽度,文字一律 nowrap + 截断,中英文一样宽。 */}
          <div data-testid="map-mobile-controls" className="absolute top-2 end-2 z-[1000] w-[148px] md:w-[212px]">
            <div className="flex flex-col gap-1 rounded-2xl bg-white/95 p-1 md:p-1.5 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm">
              {/* 市场口径行（全部/期房/现房）——与桌面右上口径筛选同源 state。
                  三等分 + 不折行:英文 "Off-plan" 比中文长得多,不锁死就会换行。 */}
              <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-slate-100 p-0.5">
                {(['all', 'offplan', 'ready'] as MarketSegment[]).map((seg) => (
                  <button
                    key={seg}
                    onClick={() => handleSegmentChange(seg)}
                    className={`min-w-0 truncate whitespace-nowrap rounded-md px-0.5 py-0.5 tracking-tight md:px-1 md:py-1 md:tracking-normal text-[9px] md:text-[11px] font-semibold transition-all duration-150 active:scale-90 ${
                      marketSegment === seg
                        ? seg === 'all' ? 'bg-slate-700 text-white shadow-sm' : 'bg-violet-600 text-white shadow-sm shadow-violet-600/30'
                        : 'text-slate-500 hover:bg-white/70'
                    }`}
                  >
                    {segmentLabel(seg)}
                  </button>
                ))}
              </div>
              {/* Metrics row(卡宽固定,5 颗按钮均分铺满) */}
              <div className="flex justify-between gap-1">
                {METRIC_OPTIONS.map((option) => {
                  const isActive = areaMetric === option.value
                  return (
                    <button
                      key={option.value}
                      onClick={() => handleMetricToggle(option.value)}
                      className={`flex items-center justify-center w-6 h-6 md:w-8 md:h-8 rounded-lg transition-all duration-150 active:scale-90 ${
                        isActive ? 'bg-primary text-white shadow-sm shadow-primary/40' : 'text-slate-500 hover:bg-slate-100'
                      }`}
                      title={t(option.labelKey as any)}
                    >
                      <option.Icon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </button>
                  )
                })}
              </div>
              {/* 周边 POI:与指标行同款 5 个等宽图标按钮——交通/医院/学校/超市/更多。
                  「更多」开完整 POI 面板(分组选择)。窄屏放得下且和 desktop 对齐。 */}
              <div className="flex justify-between gap-1">
                <button
                  onClick={toggleTransit}
                  className="flex w-6 h-6 md:w-8 md:h-8 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 hover:bg-slate-100"
                  style={showTransit ? { backgroundColor: '#0891b2', color: 'white', boxShadow: '0 1px 6px -1px rgba(8,145,178,0.5)' } : { color: '#64748b' }}
                  title={t('map:transit')}
                  aria-label={t('map:transit')}
                >
                  <TrainFront className="w-3 h-3 md:w-3.5 md:h-3.5" />
                </button>
                {QUICK_BUTTONS.map((btn) => {
                  const enabled = enabledPoiCategories.includes(btn.id)
                  return (
                    <button
                      key={btn.id}
                      onClick={() => togglePoiCategory(btn.id)}
                      className="flex w-6 h-6 md:w-8 md:h-8 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 hover:bg-slate-100"
                      style={enabled ? { backgroundColor: btn.color, color: 'white', boxShadow: `0 1px 6px -1px ${btn.color}80` } : { color: '#64748b' }}
                      title={t(btn.labelKey as any)}
                      aria-label={t(btn.labelKey as any)}
                    >
                      <btn.Icon className="w-3 h-3 md:w-3.5 md:h-3.5" />
                    </button>
                  )
                })}
                <button
                  onClick={() => setShowPoiPanel(true)}
                  className={`flex w-6 h-6 md:w-8 md:h-8 items-center justify-center rounded-lg transition-all duration-150 active:scale-90 ${
                    showPoiPanel ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  title={t('map:poi.more')}
                  aria-label={t('map:poi.more')}
                >
                  <MapPin className="w-3 h-3 md:w-3.5 md:h-3.5" />
                </button>
              </div>
              {/* 只有图标分不清选了哪个指标(两个 $ 图标长一样)→ 底部常显一条文字标签:
                  选中时显示指标名,未选时提示可点选,卡片高度稳定不跳动。
                  ⚠️ 时间轴入口刻意塞进**这一行**(而不是新起一行):控制卡每加一行,
                  下面工具卡的 top-[124px]/[164px] 就得跟着重算并三档截图 —— 那条耦合
                  已经栽过两次。横向挤进已有行 = 卡高不变 = 零风险。 */}
              {(() => {
                const active = METRIC_OPTIONS.find(o => o.value === areaMetric)
                // 租金回报永远是"现有房源出租"的全口径数据(期房自己没有租金),
                // 选了期房/现房口径时标注清楚,免得读成"期房的ROI"。
                const zhL = (i18n.language || 'en').startsWith('zh')
                const yieldCaveat = active?.value === 'rentalYield' && marketSegment !== 'all'
                  ? (zhL ? ' · 现楼出租参考' : ' · existing stock')
                  : ''
                return active ? (
                  // 任意指标都可点标签开周期 popover:附当前周期,不加行高(不触发
                  // 下方工具卡 top 重排铁律)。所有 5 个指标都按所选时间窗口重算。
                  <button
                    type="button"
                    onClick={() => setShowPeriodPop(v => !v)}
                    className="flex w-full items-center justify-center gap-1 rounded-lg bg-primary/10 px-2 py-0.5 md:py-1 text-[10px] md:text-[11px] font-semibold text-primary transition active:scale-95"
                  >
                    <active.Icon className="w-3 h-3 shrink-0" />
                    <span className="truncate whitespace-nowrap">{t(active.labelKey as any)} · {periodLabel(apprPeriod, zhL)}{yieldCaveat}</span>
                    <span className="shrink-0 opacity-70">▾</span>
                  </button>
                ) : (
                  <div className="flex items-center justify-center rounded-lg bg-slate-50 px-2 py-0.5 md:py-1 text-[10px] md:text-[11px] font-medium text-slate-400">
                    {t('misc:pickMetric')}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* 指标时间范围 popover —— 从控制卡底部「<指标>·近1年 ▾」标签点开。
              浮层在控制卡左侧空白处,不改任何卡片高度(不触发工具卡 top 铁律)。 */}
          {showPeriodPop && metricHasPeriod && (
            <>
              <div className="fixed inset-0 z-[1000]" onClick={() => setShowPeriodPop(false)} />
              <div className="absolute top-2 end-[164px] md:end-[224px] z-[1001] w-[200px] rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-slate-900/[0.06] backdrop-blur-sm">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {t('misc:metricTimeRange')}
                </div>
                <PeriodSelector
                  value={apprPeriod}
                  onChange={changeApprPeriod}
                  zh={(i18n.language || 'en').startsWith('zh')}
                />
                <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-400">
                  {t('misc:allMetricsRecomputeOver')}
                </div>
              </div>
            </>
          )}

          {/* Area fly-to removed — now controlled by AI voice assistant */}
          {/* (原桌面 xl 展开长条 metric/POI 面板已删——全断点统一上面的紧凑卡) */}
          </>)}

          {/* ───────── 时间轴条(模式内唯一可操作的东西) ─────────
              手机必须用 fixed 不能用 absolute:MobileNav/Luna 都是 fixed 贴可见视口底边,
              而地图容器在 h-screen(=100vh)里 —— 手机浏览器的 100vh 是「工具栏收起时」
              的大视口,用 absolute 贴容器底会压住导航栏(同搜索 dock 那条实锤)。
              nav h-16(64px) → 76px 起,和搜索 dock 同一基线。 */}
          {timelineOn && (
            <div
              className="fixed inset-x-2 z-[1002] md:inset-x-auto md:start-1/2 md:w-[560px] md:-translate-x-1/2"
              style={{ bottom: 76 }}
            >
              <div className="rounded-2xl bg-white/95 p-2.5 shadow-xl ring-1 ring-slate-900/[0.06] backdrop-blur-sm">
                {/* 第一行:指标切换 + 退出 */}
                <div className="mb-2 flex items-center gap-1">
                  {/* 6 个指标用图标而非文字:文字标签在 414px 上放不下 6 个,
                      且图标与右上角控制卡同一套语言(同图标=同指标)。当前选中的是什么,
                      由下面那行 caption 文字说明,不必再在按钮上重复。 */}
                  <div className="flex min-w-0 flex-1 justify-between gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    {TIMELINE_METRICS.map(m => {
                      const Icon = TIMELINE_METRIC_ICONS[m]
                      const active = timelineMetric === m
                      return (
                        <button
                          key={m}
                          onClick={() => setTimelineMetric(m)}
                          title={t(`map:timeline.metric.${m}` as any)}
                          aria-label={t(`map:timeline.metric.${m}` as any)}
                          className={`flex h-7 flex-1 items-center justify-center rounded-md transition-all duration-150 active:scale-90 ${
                            active ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:bg-white/70'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={exitTimeline}
                    aria-label={t('common:close', { defaultValue: 'Close' })}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 active:scale-90"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {!monthlyData ? (
                  <div className="py-2 text-center text-[11px] text-slate-400">{t('common:loading', { defaultValue: 'Loading…' })}</div>
                ) : (
                  <>
                    {/* 第二行:播放 + 连续拖动条。
                        67 个月用离散按钮放不下,必须是 range —— 而且「慢慢拖着看变化」
                        本来就要连续输入。onChange 每一步只改 index,着色走 feature-state,
                        不重建任何数据(见 lib/map/timeline.ts 铁律 1)。 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const last = monthlyData.months.length - 1
                          if (!timelinePlaying && timelineIdx >= last) setTimelineIdx(0)
                          setTimelinePlaying(p => !p)
                        }}
                        aria-label={t(timelinePlaying ? 'map:timeline.pause' : 'map:timeline.play')}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition active:scale-90"
                      >
                        {timelinePlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <input
                          type="range"
                          min={0}
                          max={monthlyData.months.length - 1}
                          step={1}
                          value={timelineIdx}
                          onChange={e => { setTimelinePlaying(false); setTimelineIdx(Number(e.target.value)) }}
                          aria-label={t('map:timeline.enter')}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-primary
                                     [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                                     [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md"
                        />
                        {/* 年份刻度 —— 67 格不打刻度根本看不出拖到哪年了 */}
                        <div className="relative mt-1 h-3">
                          {yearTicks(monthlyData.months).map(tk => (
                            <button
                              key={tk.year}
                              onClick={() => { setTimelinePlaying(false); setTimelineIdx(tk.index) }}
                              className="absolute -translate-x-1/2 text-[9px] tabular-nums text-slate-400 transition hover:text-primary"
                              style={{ left: `${(tk.index / (monthlyData.months.length - 1)) * 100}%` }}
                            >
                              {tk.year}
                            </button>
                          ))}
                        </div>
                      </div>
                      <span className="w-[68px] shrink-0 text-end text-[11px] font-semibold tabular-nums text-slate-700 md:w-[80px] md:text-xs">
                        {formatMonth(monthlyData.months[timelineIdx], i18n.language || 'en')}
                      </span>
                    </div>
                    {/* 第三行:口径说明 + 覆盖度。**必须常显** —— 时间轴最容易被误读成
                        「全城都有数」,实际上样本不足的区是灰的;而且这里是滚动窗口值,
                        不是当月值,不写清楚就是在误导。 */}
                    <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[9px] md:text-[10px] leading-tight text-slate-400">
                      <span className="truncate">{t(`map:timeline.caption.${timelineMetric}` as any)}</span>
                      <span className="shrink-0 tabular-nums">
                        {t('map:timeline.coverage', {
                          count: Object.keys(monthlyData.areas)
                            .filter(id => valueAt(monthlyData, id, timelineMetric, timelineIdx) != null).length
                        })}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}


          {/* POI Full Panel - appears when "More" clicked */}
          {showPoiPanel && (
            <>
              {/* Backdrop to close on outside click */}
              <div
                className="fixed inset-0 z-[1000]"
                onClick={() => setShowPoiPanel(false)}
              />
              {/* 移动端:底部抽屉(全宽,不挤压顶部控件,与筛选 sheet 一致);桌面:右上浮动卡片 */}
              <div className="fixed inset-x-0 bottom-0 w-full max-h-[65vh] rounded-t-2xl md:absolute md:inset-x-auto md:bottom-auto md:top-[172px] md:end-4 md:start-auto md:w-[280px] md:max-h-[400px] md:rounded-xl bg-white shadow-xl border border-slate-200/80 z-[1001] overflow-hidden">
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

      {/* Desktop: Area Detail Dialog.
          collab 时 tab/口径受控 → 经纪切「成交」,客户手机的 sheet 也跟着切。 */}
      <AreaDetailDialog
        isOpen={showAreaDialog}
        onClose={handleCloseArea}
        segment={marketSegment}
        area={selectedArea}
        projects={areaProjects}
        isLoading={isLoadingAreaProjects}
        tab={areaTab}
        usage={areaUsage}
        onTabChange={handleAreaTabChange}
        onUsageChange={handleAreaUsageChange}
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
        // key 认不出(DLD 出了新档位)→ 原样显示它给的英文原值,别显示空白
        const khdaLabel = khdaStyle ? (khdaStyle.key ? tk(`khda.${khdaStyle.key}`) : khda) : null
        const khdaNote = khdaStyle ? tk('khda.note') : null
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
                            <Award className="w-3 h-3" /> KHDA {khdaLabel}
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
                  className="absolute top-3 end-3 z-10 p-2 bg-white/80 hover:bg-white backdrop-blur rounded-full text-slate-500 hover:text-slate-700 transition-colors shadow-sm"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Header: thumbnail left + type/title right */}
                <div className="p-5 pb-3">
                  <div className="flex gap-4 pe-8">
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
                            <Award className="w-3 h-3" /> KHDA {khdaLabel}
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
                  className="absolute top-3 end-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
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
                  className="absolute top-3 end-3 p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {chips}
                <h3 className="mt-2 text-xl font-bold text-slate-900 leading-tight pe-10">
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
              <span className="text-[11px] font-medium text-slate-400 shrink-0">{t('misc:usage2')}</span>
              {USAGE_FILTER.map((u) => (
                <button
                  key={u}
                  onClick={() => handleAreaUsageChange(u)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    areaUsage === u ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {tk(`map:usage.${u}`)}
                </button>
              ))}
            </div>

            {/* Tabs: 市场行情 | 项目(N) — 项目单独 tab,多了也不挤 */}
            <div className="px-4 flex gap-1 border-b border-slate-100">
              {([
                { id: 'market' as const, label: t('misc:market') },
                { id: 'projects' as const, label: `${t('misc:projects2')}${areaDevelopers.reduce((n, d) => n + d.projectCount, 0) ? ` (${areaDevelopers.reduce((n, d) => n + d.projectCount, 0)})` : ''}` },
              ]).map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => handleSheetTabChange(tb.id)}
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
                  <AreaTrendGrid area={selectedArea} insights={sheetInsights} loading={sheetInsightsLoading} usageActive={areaUsage !== 'all'} />
                  {/* 在本区内搜楼盘/楼栋(桌面弹窗同款) */}
                  <AreaPlaceSearch areaId={selectedArea.id} value={sheetPlace} onChange={setSheetPlace} compact />
                  <AreaRecentTx areaId={selectedArea.id} areaName={selectedArea.name} insights={sheetInsights}
                                loading={sheetInsightsLoading} place={sheetPlace} usage={areaUsage} />
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
                  {t('misc:noProjectsOnRecord2')}
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
