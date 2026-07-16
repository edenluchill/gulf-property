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

/**
 * 推轨 —— **原地**推近/拉远（中心不动）。
 *
 * 摄影师的 dolly。一段旁白如果只是「站着不动」,画面就死了;轻轻推进去,
 * 观众的注意力会跟着走。这是最便宜、也最有效的动能。
 */
export const CameraPushSchema = z.object({
  type: z.literal('push'),
  at_ms: z.number().min(0),
  /** 正数 = 推近,负数 = 拉远。一般 0.4 ~ 1.2 */
  zoom_delta: z.number().min(-4).max(4),
  duration_ms: z.number().min(0),
})

/**
 * 升降 —— **原地**改变俯仰/高度（中心不动）。
 *
 * 摄影师的 crane。从贴地的仰视缓缓抬到俯瞰,或者反过来压下去 ——
 * 它讲的是「这栋楼有多高」「这片地有多大」,而不只是移动。
 */
export const CameraCraneSchema = z.object({
  type: z.literal('crane'),
  at_ms: z.number().min(0),
  /** 目标俯仰角（0=正俯视, 60=贴地感）。省略 = 不变 */
  pitch: z.number().min(0).max(75).optional(),
  /** 目标 zoom。省略 = 不变 */
  zoom: z.number().min(0).max(24).optional(),
  duration_ms: z.number().min(0),
})

export const CameraSchema = z.union([
  CameraOrbitSchema,
  CameraFlyoverSchema,
  CameraPushSchema,
  CameraCraneSchema,
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

/**
 * 户型卡 —— 「你能买到什么」。
 *
 * ⚠️ 这个 overlay **只带引用，不带数字**：户型的面积/价格/户型图由前端从
 * property snapshot 里读。故意的 —— 只要让模型往 overlay 里填数字，它就会编
 * （roi_card 那次已经证明过了）。它能决定的只有「讲哪个项目、重点讲几房」。
 */
export const UnitCardOverlaySchema = OverlayBase.extend({
  type: z.literal('unit_card'),
  property_id: z.string(),
  /** 重点高亮的卧室数（跟客户画像匹配的那个）。给 null 就平铺全部。 */
  focus_bedrooms: z.preprocess(
    (v) => (typeof v === 'number' ? v : undefined),
    z.number().optional()
  ),
})

/**
 * 邻居对比卡 —— 地理套利那一拍。
 *
 * ⚠️ 和 unit_card 一样:**overlay 里不带任何数字**,前端从 property snapshot 的
 *    area_context 读真数据。只要让模型往 overlay 里填数字,它就会编。
 */
export const AreaCompareOverlaySchema = OverlayBase.extend({
  type: z.literal('area_compare'),
  property_id: z.string(),
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
  UnitCardOverlaySchema,
  AreaCompareOverlaySchema,
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
  /**
   * 每个项目的叙事阶段。
   *   arrival   到达
   *   life      周边生活
   *   homes     户型 —— 客户终于知道自己能买到什么
   *   arbitrage **地理套利** —— 「我为什么该买这里，而不是走路 5 分钟外的那个区」
   *   weakness  **它的短板** —— 主动说出输在哪，然后**立刻用真数据反驳**（接种）
   *   numbers   投资数字
   * 后三个都**只在有真数据时才有**；没有就整拍不讲。
   */
  kind: z.enum(['arrival', 'life', 'homes', 'arbitrage', 'weakness', 'numbers']).optional(),
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
  /**
   * ⚠️ **容忍 null。** 模型经常用 `null` 表示「没有转场」,而 `.optional()` 只接受
   *    「字段缺席」—— 一个 null 就让**整个剧本 schema parse 失败,一次生成(含重试)
   *    全部作废**(实测:`acts.2.transition_out: expected object, received null`)。
   *
   *    同类坑已经踩过一次(cta 的 `agent` 字段回了 `true`)。**凡是可选字段,
   *    都要能吃 null** —— 别让一个 null 炸掉一次几十秒、几千 token 的生成。
   */
  transition_out: z.preprocess((v) => (v == null ? undefined : v), TransitionSchema.optional()),
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
  /**
   * 展示文案（含 emoji + 品类 + 可能的专名）。**只用来显示,永远别拿它做判断** ——
   * 它会随 tour 语言变。要认品类请用 `cat`。
   */
  label: string
  /**
   * 结构化品类,与 dubai_pois.category 同源。这才是稳定的数据键。
   * optional:**DB 里的历史 session 没有这个字段**,消费方必须留兜底。
   */
  cat?: 'metro_station' | 'school' | 'mall' | 'hospital' | 'supermarket'
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

/**
 * 一个户型（按卧室数聚合）。
 *
 * ⚠️ **客户要买的是户型，不是项目。** 整场 tour 之前一句户型都没有 —— 说了半天
 * 区域涨幅和地铁距离，客户还是不知道自己能买到什么。
 *
 * 数据来自 project_unit_types（真实户型表，带户型图）。没有的项目就**不讲这一拍**，
 * 绝不编。
 */
export interface TourPropertyUnit {
  bedrooms: number
  /**
   * @deprecated 后端不再产这个字段 —— 它以前写死 `lang==='en' ? 'Studio'/'N Bed' : '开间'/'N 房'`,
   * 只有 en 一个分支,ar/ru/fr 全部穿透成中文。现在交前端按 `bedrooms` 用 t() 渲染。
   * 仍标 optional 是因为 **DB 里的历史 session 的 jsonb 还带着它**(读出来会有值)。
   * 新代码别读它;要显示户型名请用 bedrooms。
   */
  label?: string
  /** 该卧室数下的户型个数 */
  variants: number
  /** 最小建面（sqft）—— 「X 房从 Y 尺起」 */
  area_sqft?: number
  /** 该卧室数下的最低价 */
  price_from?: number
  floor_plan_image?: string
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
  /** 真实户型（按卧室数聚合）。没有户型数据时整个字段缺席 —— 那就少讲一拍。 */
  units?: TourPropertyUnit[]
  /**
   * 区域对比（地理套利 + 能被反驳的短板）。
   * 目标区或邻居的成交量过不了门槛 → 整个字段缺席 → 这两拍不讲（宁可少一拍，不能用噪音说话）。
   */
  area_context?: {
    self: AreaStatsLite
    neighbors: AreaStatsLite[]
    weakness: { claim: string; rebuttal: string } | null
  }
}

export interface AreaStatsLite {
  name: string
  distance_km: number
  growth_pct: number
  yield_pct: number
  price_sqm: number
  transactions: number
}

export interface TourInput {
  client: TourClient
  config: TourConfig
  properties: TourProperty[]
}
