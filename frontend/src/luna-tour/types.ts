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
export type Camera = CameraKeyframe | CameraOrbit | CameraFlyover

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
  | HighlightAllPinsOverlay
  | FavoritePickerOverlay
  | CtaOverlay
  | MediaOverlay

export interface Beat {
  id: string
  kind?: 'arrival' | 'life' | 'numbers'
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
  distances?: { label: string; to: LngLat; distance_km: number; placeholder?: boolean }[]
  amenities?: { label: string; distance_km: number; placeholder?: boolean }[]
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
