/**
 * Luna Tour — TourScript v2 schema (zod) + AI generation input contract.
 *
 * ISOLATION: this whole feature lives under backend/src/luna-tour/. To remove
 * it, delete the entire luna-tour directory — nothing outside it depends on
 * these files.
 *
 * Schema mirrors docs/luna-tour-experience-spec.md §4.1 (TourScript v2) and
 * §4.2 (AI generation contract). Field names match the spec JSONC sample:
 * version=2 (number), total_ms, camera keyframes with easing (easeIn/easeOut/
 * easeInOut/linear) or motions (orbit/flyover), overlay types from the §4.1
 * overlay table, act-level property_id + transition_out, intro/acts/outro.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// §4.1 — Camera (keyframe path | procedural motion)
// ---------------------------------------------------------------------------

const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const

const LngLat = z.tuple([z.number(), z.number()]) // [lng, lat]

/** Explicit camera keyframe relative to the start of its beat. */
export const CameraKeyframeSchema = z.object({
  at_ms: z.number().min(0),
  center: LngLat.optional(),
  zoom: z.number().min(0).max(24).optional(),
  pitch: z.number().min(0).max(85).optional(),
  bearing: z.number().min(-360).max(360).optional(),
  duration_ms: z.number().min(0),
  easing: z.enum(EASINGS).optional(),
})

/** Procedural orbit: slow rotation around a center (spec §1.2 Beat 1). */
export const CameraOrbitSchema = z.object({
  type: z.literal('orbit'),
  at_ms: z.number().min(0),
  center: LngLat,
  degrees: z.number(),
  duration_ms: z.number().min(0),
})

/** Procedural flyover between two points (spec §1.2 transition). */
export const CameraFlyoverSchema = z.object({
  type: z.literal('flyover'),
  at_ms: z.number().min(0),
  from: LngLat,
  to: LngLat,
  duration_ms: z.number().min(0),
})

export const CameraSchema = z.union([
  CameraOrbitSchema,
  CameraFlyoverSchema,
  CameraKeyframeSchema,
])

// ---------------------------------------------------------------------------
// §4.1 — Overlays (animation primitives the playback engine implements)
// ---------------------------------------------------------------------------

export const OVERLAY_TYPES = [
  'title',
  'progress_dots',
  'property_card',
  'distance_line',
  'amenity_spokes',
  'roi_card',
  'highlight_all_pins',
  'favorite_picker',
  'cta',
] as const

const OverlayBase = z.object({
  at_ms: z.number().min(0),
  // duration_ms is optional in the spec for "sticky" overlays (progress_dots,
  // highlight_all_pins, favorite_picker, cta). Default 0 = persists to beat end.
  duration_ms: z.number().min(0).optional(),
})

export const TitleOverlaySchema = OverlayBase.extend({
  type: z.literal('title'),
  text: z.string(),
  subtitle: z.string().optional(),
})

export const ProgressDotsOverlaySchema = OverlayBase.extend({
  type: z.literal('progress_dots'),
  total: z.number().int().min(1),
  active: z.number().int().min(0),
})

export const PropertyCardOverlaySchema = OverlayBase.extend({
  type: z.literal('property_card'),
  property_id: z.string(),
  // cosmetic hint only; the player reads the property snapshot, not this. Fully
  // lenient — the model emits strings/objects/arrays inconsistently here.
  fields: z.any().optional(),
})

export const DistanceLineOverlaySchema = OverlayBase.extend({
  type: z.literal('distance_line'),
  property_id: z.string().optional(),
  to: LngLat,
  label: z.string(),
  anim: z.literal('draw').optional(),
})

export const AmenitySpokesOverlaySchema = OverlayBase.extend({
  type: z.literal('amenity_spokes'),
  property_id: z.string().optional(),
  center: LngLat,
  score: z.number(),
  tier: z.string().optional(),
  spokes: z
    .array(z.object({ label: z.string(), distance_km: z.number().min(0) }))
    .optional(),
  anim: z.literal('pop').optional(),
})

export const RoiCardOverlaySchema = OverlayBase.extend({
  type: z.literal('roi_card'),
  property_id: z.string().optional(),
  anim: z.literal('countup').optional(),
  data: z.object({
    buy: z.number(),
    future: z.number(),
    years: z.number(),
    growth_pct: z.number(),
    yield_pct: z.number().optional(),
  }),
})

export const HighlightAllPinsOverlaySchema = OverlayBase.extend({
  type: z.literal('highlight_all_pins'),
  property_ids: z.array(z.string()),
})

export const FavoritePickerOverlaySchema = OverlayBase.extend({
  type: z.literal('favorite_picker'),
  property_ids: z.array(z.string()),
})

/**
 * ⚠️ `agent` 容忍非字符串。
 *
 * tour-generator **没有用 responseSchema**（只有 responseMimeType + prompt 里的一段
 * 散文描述），所以模型可以自由决定字段类型 —— 实测它给 `agent` 回了个 `true`
 * （它把「要不要显示经纪」理解成了布尔）。这会让**整个剧本 schema parse 失败，
 * 一次生成（含重试）全部作废**。
 *
 * 根治是给 tour-generator 加真正的 responseSchema（全字段 required + 允许 null，
 * 见 docs/reports/2026-07-12-gemini-model-lineup.md）。在那之前先别让一个布尔值
 * 炸掉整场生成 —— agent 名字反正是前端从 session 自己取的，这个字段本来就没在用。
 */
export const CtaOverlaySchema = OverlayBase.extend({
  type: z.literal('cta'),
  agent: z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional()),
  channel: z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional()),
  prefill: z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional()),
  text: z.preprocess((v) => (typeof v === 'string' ? v : undefined), z.string().optional()),
})

// E3 — real footage (sea view / interior) the agent attaches to a beat.
export const MediaOverlaySchema = OverlayBase.extend({
  type: z.literal('media'),
  media_kind: z.enum(['video', 'image']),
  url: z.string(),
  caption: z.string().optional(),
  fit: z.enum(['cover', 'contain']).optional(),
})

export const OverlaySchema = z.discriminatedUnion('type', [
  TitleOverlaySchema,
  ProgressDotsOverlaySchema,
  PropertyCardOverlaySchema,
  DistanceLineOverlaySchema,
  AmenitySpokesOverlaySchema,
  RoiCardOverlaySchema,
  HighlightAllPinsOverlaySchema,
  FavoritePickerOverlaySchema,
  CtaOverlaySchema,
  MediaOverlaySchema,
])

// ---------------------------------------------------------------------------
// §4.1 — Beat / Act / TourScript
// ---------------------------------------------------------------------------

export const BeatSchema = z.object({
  id: z.string(),
  /** arrival | life | numbers — per-property storytelling phase (§1.2). */
  kind: z.enum(['arrival', 'life', 'numbers']).optional(),
  narration: z.string().min(1),
  /** Pre-generated audio URL; empty/absent → browser TTS fallback (§4.5). */
  audio_url: z.string().optional(),
  duration_ms: z.number().min(1),
  camera: z.array(CameraSchema).default([]),
  overlays: z.array(OverlaySchema).default([]),
})

export const TransitionSchema = z.object({
  type: z.enum(['flyover', 'cut']),
  duration_ms: z.number().min(0),
  narration: z.string().nullable().optional(),
})

export const ActSchema = z.object({
  id: z.string(),
  property_id: z.string(),
  beats: z.array(BeatSchema).min(1),
  transition_out: TransitionSchema.optional(),
  // E3 — non-property stop (beach / landmark / any place). property_id is '' then.
  place: z.object({ name: z.string(), coords: LngLat }).optional(),
})

export const ThemeSchema = z.object({
  map_style: z.string().optional(),
  accent: z.string().optional(),
  captions: z.boolean().optional(),
})

export const TourScriptSchema = z.object({
  version: z.literal(2),
  voice: z.string().default('Aoede'),
  language: z.string(),
  total_ms: z.number().min(1),
  theme: ThemeSchema.optional(),
  intro: BeatSchema,
  acts: z.array(ActSchema).min(1),
  outro: BeatSchema,
})

export type CameraKeyframe = z.infer<typeof CameraKeyframeSchema>
export type CameraOrbit = z.infer<typeof CameraOrbitSchema>
export type CameraFlyover = z.infer<typeof CameraFlyoverSchema>
export type Camera = z.infer<typeof CameraSchema>
export type Overlay = z.infer<typeof OverlaySchema>
export type Beat = z.infer<typeof BeatSchema>
export type Act = z.infer<typeof ActSchema>
export type TourScript = z.infer<typeof TourScriptSchema>

// ---------------------------------------------------------------------------
// §4.2 — AI generation input contract (TourInput)
// ---------------------------------------------------------------------------

export interface TourClient {
  name?: string
  goal?: string
  budget?: string | number
  family?: string
  nationality?: string
  preferred_areas?: string[]
  /** Free-form persona label, e.g. "investor". */
  persona?: string
}

export interface TourConfig {
  /** Narration language, e.g. 'zh' | 'en' | 'ar'. */
  language: string
  /** What the story should lean into, e.g. 'investment' | 'lifestyle'. */
  narrative_focus: string
  target_seconds: number
  /** Phrases the narration must never contain. */
  banned_phrases?: string[]
  /** Hard rules the narration must respect (e.g. "no guaranteed returns"). */
  guardrails?: string[]
}

/** Pre-computed 5-year ROI facts (from investment-calculator). */
export interface TourPropertyInvestment {
  buy: number
  future: number
  years: number
  growth_pct: number
  yield_pct?: number
  payback_years?: number
}

export interface TourPropertyDistance {
  label: string
  /** [lng, lat] of the destination. */
  to: [number, number]
  distance_km: number
  /** true when the distance is a placeholder, not a measured value. */
  placeholder?: boolean
}

export interface TourPropertyAmenity {
  label: string
  distance_km: number
  placeholder?: boolean
}

export interface TourProperty {
  /** Stable id used by camera/overlay references inside the script. */
  id: string
  name: string
  developer?: string
  /** cover image URL (for the property card). */
  image?: string
  area: string
  status?: string
  /** [lng, lat]. */
  coords: [number, number]
  min_price?: number
  max_price?: number
  investment?: TourPropertyInvestment
  /** amenity convenience score 0-100 + tier (placeholder allowed). */
  amenity_score?: number
  amenity_tier?: string
  distances?: TourPropertyDistance[]
  amenities?: TourPropertyAmenity[]
}

export interface TourInput {
  client: TourClient
  config: TourConfig
  properties: TourProperty[]
}
