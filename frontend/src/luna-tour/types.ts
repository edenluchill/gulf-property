/**
 * Luna Tour — frontend types.
 *
 * ISOLATION: the whole feature lives under frontend/src/luna-tour/. Delete the
 * directory + the one `/v/:code` <Route> line in App.tsx to remove it.
 *
 * These mirror backend/src/luna-tour/tour-script.types.ts (TourScript v2). Kept
 * as plain TS (no zod) — the backend already validated before persisting.
 */

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
export type LngLat = [number, number]
/** 配套品类,与后端 AMENITY_SPECS.cat / dubai_pois.category 同源。 */
export type TourAmenityCat = 'metro_station' | 'school' | 'mall' | 'hospital' | 'supermarket'

export interface CameraKeyframe {
  at_ms: number
  center?: LngLat
  zoom?: number
  pitch?: number
  bearing?: number
  duration_ms: number
  easing?: Easing
}
export interface CameraOrbit {
  type: 'orbit'
  at_ms: number
  center: LngLat
  degrees: number
  duration_ms: number
}
export interface CameraFlyover {
  type: 'flyover'
  at_ms: number
  from: LngLat
  to: LngLat
  duration_ms: number
}
/** 原地推近/拉远（dolly）—— 中心不动，只有 zoom 在走。 */
export interface CameraPush {
  type: 'push'
  at_ms: number
  zoom_delta: number
  duration_ms: number
}
/** 原地升降（crane）—— 改俯仰/高度，中心不动。 */
export interface CameraCrane {
  type: 'crane'
  at_ms: number
  pitch?: number
  zoom?: number
  duration_ms: number
}
export type Camera = CameraKeyframe | CameraOrbit | CameraFlyover | CameraPush | CameraCrane

export interface TitleOverlay {
  type: 'title'
  at_ms: number
  duration_ms?: number
  text: string
  subtitle?: string
}
export interface ProgressDotsOverlay {
  type: 'progress_dots'
  at_ms: number
  duration_ms?: number
  total: number
  active: number
}
export interface PropertyCardOverlay {
  type: 'property_card'
  at_ms: number
  duration_ms?: number
  property_id: string
  fields?: string[]
}
export interface DistanceLineOverlay {
  type: 'distance_line'
  at_ms: number
  duration_ms?: number
  property_id?: string
  to: LngLat
  label: string
  anim?: 'draw'
}
export interface AmenitySpokesOverlay {
  type: 'amenity_spokes'
  at_ms: number
  duration_ms?: number
  property_id?: string
  center: LngLat
  score: number
  tier?: string
  spokes?: { label: string; distance_km: number }[]
  anim?: 'pop'
}
export interface RoiCardOverlay {
  type: 'roi_card'
  at_ms: number
  duration_ms?: number
  property_id?: string
  anim?: 'countup'
  data: {
    buy: number
    future: number
    years: number
    growth_pct: number
    yield_pct?: number
  }
}
/**
 * 户型卡 —— 「你能买到什么」。
 *
 * ⚠️ overlay 里**故意不带任何数字**：面积/价格/户型图全部从 PropertySnapshot.units
 * 里读（真实的 project_unit_types 数据）。剧本只能决定「讲哪个项目、重点几房」——
 * 只要让模型往 overlay 里填数字，它就会编。
 */
/** 邻居对比卡(地理套利)。**不带数字** —— 前端从 snapshot 的 area_context 读真数据。 */
export interface AreaCompareOverlay {
  type: 'area_compare'
  at_ms: number
  duration_ms?: number
  property_id: string
}
export interface UnitCardOverlay {
  type: 'unit_card'
  at_ms: number
  duration_ms?: number
  property_id: string
  focus_bedrooms?: number
}
export interface HighlightAllPinsOverlay {
  type: 'highlight_all_pins'
  at_ms: number
  duration_ms?: number
  property_ids: string[]
}
export interface FavoritePickerOverlay {
  type: 'favorite_picker'
  at_ms: number
  duration_ms?: number
  property_ids: string[]
}
export interface CtaOverlay {
  type: 'cta'
  at_ms: number
  duration_ms?: number
  agent?: string
  channel?: string
  prefill?: string
  text?: string
}
export interface MediaOverlay {
  type: 'media'
  at_ms: number
  duration_ms?: number
  media_kind: 'video' | 'image'
  url: string
  caption?: string
  fit?: 'cover' | 'contain'
}
export type Overlay =
  | TitleOverlay
  | ProgressDotsOverlay
  | PropertyCardOverlay
  | DistanceLineOverlay
  | AmenitySpokesOverlay
  | RoiCardOverlay
  | UnitCardOverlay
  | AreaCompareOverlay
  | HighlightAllPinsOverlay
  | FavoritePickerOverlay
  | CtaOverlay
  | MediaOverlay

export interface Beat {
  id: string
  kind?: 'arrival' | 'life' | 'homes' | 'arbitrage' | 'weakness' | 'numbers'
  narration: string
  audio_url?: string
  duration_ms: number
  camera: Camera[]
  overlays: Overlay[]
}
export interface Transition {
  type: 'flyover' | 'cut'
  duration_ms: number
  narration?: string | null
}
export interface Act {
  id: string
  property_id: string
  beats: Beat[]
  transition_out?: Transition
  /** E3 — a non-property stop (beach / landmark / any place). When set (and
   *  property_id is empty), the camera flies to place.coords and no property card
   *  shows; the beat carries its own narration + optional media. */
  place?: { name: string; coords: LngLat }
}
export interface TourTheme {
  map_style?: string
  accent?: string
  captions?: boolean
}
export interface TourScript {
  version: 2
  voice: string
  language: string
  total_ms: number
  theme?: TourTheme
  intro: Beat
  acts: Act[]
  outro: Beat
}

// ---- API payload from GET /api/luna/public/v/:code ----

export interface PropertySnapshot {
  name: string
  developer?: string
  image?: string
  area?: string
  status?: string
  coords: LngLat
  min_price?: number
  max_price?: number
  investment?: {
    buy: number
    future: number
    years: number
    growth_pct: number
    yield_pct?: number
    payback_years?: number
  }
  amenity_score?: number
  amenity_tier?: string
  /** label = 展示文案(随 tour 语言变,只用来显示);cat = 结构化品类,判断请用它。 */
  distances?: { label: string; cat?: TourAmenityCat; to: LngLat; distance_km: number; placeholder?: boolean }[]
  amenities?: { label: string; distance_km: number; placeholder?: boolean }[]
  /** 真实户型(按卧室数聚合)。没有户型数据的项目整个字段缺席 —— 那就不讲这一拍。 */
  units?: TourUnit[]
  /** 区域对比(地理套利 + 能被反驳的短板)。成交量过不了门槛 → 缺席 → 那两拍不讲。 */
  area_context?: {
    self: AreaStats
    neighbors: AreaStats[]
    weakness: { claim: string; rebuttal: string } | null
  }
}

export interface AreaStats {
  name: string
  distance_km: number
  growth_pct: number
  yield_pct: number
  price_sqm: number
  transactions: number
}

/** 一个户型(按卧室数聚合)。客户要买的是户型,不是「项目」。 */
export interface TourUnit {
  bedrooms: number
  label: string
  variants: number
  area_sqft?: number
  price_from?: number
  floor_plan_image?: string
}

export interface SessionProperty {
  id: string
  project_id: string | null
  sort_order: number
  agent_pitch?: string | null
  emphasis?: Record<string, unknown>
  snapshot: PropertySnapshot
}

export interface TourAgent {
  name: string
  photo_url?: string | null
  phone?: string | null
  whatsapp?: string | null
  brand?: Record<string, unknown> | null
}

export interface WatchPayload {
  session: {
    id: string
    title: string
    share_code: string
    theme?: TourTheme
    data_as_of?: string | null
    og_image_url?: string | null
    reveal_snapshot_url?: string | null
    client_name?: string | null
  }
  agent: TourAgent
  properties: SessionProperty[]
  script: TourScript
  voice: string
  language: string
}

/** Real amenity radial payload — same shape the voice assistant feeds the map
 *  (voiceAmenities). Built from real nearby POIs, not placeholders. */
export interface AmenitySpoke {
  category: string
  label: string
  emoji: string
  name: string
  lng: number
  lat: number
  distanceKm: number
}
export interface AmenityPayload {
  center: [number, number]
  centerName: string
  score: number
  tier: string
  spokes: AmenitySpoke[]
}

/** E1 — real, citable DLD market evidence (mirrors backend evidence.ts). */
export interface MarketEvidence {
  granularity: 'project' | 'area'
  scope: string
  window_days: number
  window_end: string
  volume: number
  median_psf: number | null
  comparables: { date: string; rooms: string | null; psf: number; worth: number; is_offplan: boolean }[]
  source: { label: string; url: string; as_of: string }
  disclaimer: string
}

/** A flattened, absolute-timed segment used by the playback engine. */
export interface Segment {
  /** stable key: 'intro' | act index+beat id | 'outro' */
  key: string
  beat: Beat
  /** absolute start time on the master timeline (ms) */
  start_ms: number
  /** the act this segment belongs to (-1 for intro/outro) */
  actIndex: number
  /** property id in focus for this segment, if any */
  propertyId?: string
  /** resolved focus coords (property OR place); camera/pulse use this */
  focusCoords?: LngLat
}
