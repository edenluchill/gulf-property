/**
 * Luna Tour — TourScript v2 generator (spec §4.2).
 *
 * ISOLATION: delete the whole backend/src/luna-tour directory to remove this
 * feature. This module only uses the @google/genai SDK + the local types; it
 * touches no app routes or existing services.
 *
 * Pipeline:
 *   1. Build a strict prompt from TourInput (narration in config.language;
 *      numbers only from input.properties; banned phrases + guardrails honored;
 *      arrival -> life -> numbers per property; total ~ target_seconds).
 *   2. Ask Gemini for JSON (PRIMARY_MODEL, fallback FALLBACK_MODEL).
 *   3. zod-parse + programmatic validation (timing within beats, references in
 *      input, total within ±20% of target). On failure, feed the errors back
 *      to the model and retry once.
 */
import { GoogleGenAI } from '@google/genai'
import {
  TourScript,
  TourScriptSchema,
  TourInput,
  TourProperty,
  Beat,
  Overlay,
} from './tour-script.types'

// Model names kept as top-level constants so they are trivial to swap.
const PRIMARY_MODEL = 'gemini-3.5-flash'    // GA 旗舰(2026-05)。gemini-3-flash 是 404,3-flash-preview 已废弃
const FALLBACK_MODEL = 'gemini-3.1-flash-lite'  // 别掉回 2.5(全系 2026-10-16 关停)

const TOTAL_DURATION_TOLERANCE = 0.2 // ±20% of target_seconds

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function propertyFacts(p: TourProperty): string {
  const lines: string[] = []
  lines.push(`- id: ${p.id}`)
  lines.push(`  name: ${p.name}`)
  lines.push(`  area: ${p.area}`)
  if (p.developer) lines.push(`  developer: ${p.developer}`)
  if (p.status) lines.push(`  status: ${p.status}`)
  lines.push(`  coords (lng,lat): [${p.coords[0]}, ${p.coords[1]}]`)
  if (p.min_price != null) lines.push(`  min_price: ${p.min_price}`)
  if (p.max_price != null) lines.push(`  max_price: ${p.max_price}`)
  if (p.investment) {
    const i = p.investment
    lines.push(
      `  investment (5yr): buy ${i.buy} -> future ${i.future} over ${i.years} yrs | ` +
        `growth ${i.growth_pct}%` +
        (i.yield_pct != null ? ` | yield ${i.yield_pct}%` : '') +
        (i.payback_years != null ? ` | payback ${i.payback_years} yrs` : '')
    )
  }
  if (p.amenity_score != null) {
    lines.push(
      `  amenity_score: ${p.amenity_score}${p.amenity_tier ? ` (${p.amenity_tier})` : ''}`
    )
  }
  if (p.distances?.length) {
    for (const d of p.distances) {
      lines.push(
        `  distance: "${d.label}" = ${d.distance_km} km, to [${d.to[0]}, ${d.to[1]}]` +
          `${d.placeholder ? ' [PLACEHOLDER — approximate, do not state as exact]' : ''}`
      )
    }
  }
  if (p.amenities?.length) {
    for (const a of p.amenities) {
      lines.push(
        `  amenity: "${a.label}" = ${a.distance_km} km` +
          `${a.placeholder ? ' [PLACEHOLDER]' : ''}`
      )
    }
  }
  return lines.join('\n')
}

function buildPrompt(input: TourInput, repairNote?: string): string {
  const { client, config, properties } = input
  const targetMs = config.target_seconds * 1000
  const banned = config.banned_phrases?.length
    ? config.banned_phrases.join(', ')
    : '(none)'
  const guardrails = config.guardrails?.length
    ? config.guardrails.map((g, i) => `${i + 1}. ${g}`).join('\n')
    : '(none)'
  const facts = properties.map(propertyFacts).join('\n')
  const ids = properties.map((p) => p.id).join(', ')

  /**
   * ⭐ 开场机位 —— **算给它，别让它猜**。
   *
   * demo 实测：intro 的 center 是**第一个项目**的坐标，而三个项目分散在整个迪拜
   * （d3 在东北、Palm Central 在西南）—— 所以开场根本看不到全局，客户不知道自己在哪儿。
   * 而 zoom 是 10（LLM 拍脑袋定的），跟项目的实际分布没有任何关系。
   *
   * establishing shot 的全部意义就是「先让他看见自己在哪儿」。这是纯几何，
   * LLM 算不好也不该由它算。
   */
  const lngs = properties.map((p) => p.coords[0])
  const lats = properties.map((p) => p.coords[1])
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spanDeg = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats))
  // 经验值：让整个项目群 + 一点余量落在画面里。跨度越大，zoom 越小。
  const introZoom =
    spanDeg > 0.30 ? 9.6 :
    spanDeg > 0.18 ? 10.2 :
    spanDeg > 0.10 ? 10.9 :
    spanDeg > 0.05 ? 11.6 : 12.4
  const establishing =
    `ESTABLISHING SHOT (use these EXACT values for the intro's first keyframe — they are\n` +
    `computed to fit ALL properties on screen; do NOT invent your own):\n` +
    `  center: [${cLng.toFixed(5)}, ${cLat.toFixed(5)}]\n` +
    `  zoom: ${introZoom}   (the intro may push in to ~${(introZoom + 1.2).toFixed(1)}, no further)\n` +
    `  pitch: 45, bearing: 0`
  const clientLabel =
    [client.name && `name=${client.name}`, client.persona && `persona=${client.persona}`,
      client.goal && `goal=${client.goal}`, client.nationality && `nationality=${client.nationality}`]
      .filter(Boolean)
      .join(', ') || '(generic buyer)'

  return [
    'You are Luna, a cinematic real-estate tour director. You produce ONE',
    'TourScript v2 JSON object that drives a map-based guided video tour.',
    '',
    `CLIENT: ${clientLabel}.`,
    `LANGUAGE: write ALL narration strings in "${config.language}".`,
    `NARRATIVE FOCUS: lean the story toward "${config.narrative_focus}".`,
    `TARGET TOTAL DURATION: about ${config.target_seconds} seconds (${targetMs} ms).`,
    '',
    'HARD DATA RULES (must follow exactly):',
    '- Use ONLY the coordinates, prices, distances and investment numbers given',
    '  below. NEVER invent or estimate any number, coordinate, price, distance',
    '  or percentage. If a figure is not provided, do not mention it.',
    '- Items tagged [PLACEHOLDER] are approximate references — speak of them',
    '  loosely (e.g. "about a few minutes away"), never as precise facts.',
    '- Every camera "center"/"to"/"from" coordinate must appear in the data',
    `  below. Every overlay property_id / property_ids value must be among: ${ids}.`,
    '- For each property produce exactly three beats in order: kind="arrival",',
    '  then kind="life", then kind="numbers". Wrap each property in one act with',
    '  that property\'s id as the act "property_id".',
    `- BANNED PHRASES (must never appear in any narration): ${banned}.`,
    '- GUARDRAILS (must respect):',
    guardrails,
    '',
    'STRUCTURE (TourScript v2):',
    '{ "version": 2, "voice": "Aoede", "language": <lang>, "total_ms": <int>,',
    '  "theme": { "map_style": "dark", "accent": "#00E0B8", "captions": true },',
    '  "intro": <Beat>, "acts": [ <Act>... ], "outro": <Beat> }',
    'Act = { "id", "property_id", "beats": [<Beat>...], "transition_out"?:',
    '  { "type":"flyover"|"cut", "duration_ms", "narration": null } }',
    'Beat = { "id", "kind"?, "narration", "duration_ms", "camera": [...], "overlays": [...] }',
    '',
    'CAMERA entries are either keyframes',
    '  { "at_ms", "center":[lng,lat], "zoom", "pitch", "bearing", "duration_ms", "easing" }',
    'or motions',
    '  { "type":"orbit", "at_ms", "center":[lng,lat], "degrees", "duration_ms" }',
    '  { "type":"flyover", "at_ms", "from":[lng,lat], "to":[lng,lat], "duration_ms" }.',
    'easing ∈ linear | easeIn | easeOut | easeInOut.',
    '',
    'OVERLAY types (each has "at_ms" and usually "duration_ms"):',
    '  title { text, subtitle? }',
    '  progress_dots { total, active }',
    '  property_card { property_id, fields? }',
    '  distance_line { property_id?, to:[lng,lat], label, anim:"draw" }',
    '  amenity_spokes { property_id?, center:[lng,lat], score, tier?, spokes?:[{label,distance_km}], anim:"pop" }',
    '  roi_card { property_id?, anim:"countup", data:{ buy, future, years, growth_pct, yield_pct? } }',
    '  highlight_all_pins { property_ids:[...] }',
    '  favorite_picker { property_ids:[...] }',
    '  cta { text?, agent?, channel?, prefill? }',
    '',
    'TIMING RULES:',
    '- Inside every beat each camera/overlay must satisfy',
    '  at_ms >= 0 AND at_ms + duration_ms <= beat.duration_ms.',
    '- total_ms MUST equal the sum of intro.duration_ms + every act beat',
    '  duration_ms + outro.duration_ms (transition_out durations are NOT summed).',
    `- total_ms must be within ±${Math.round(TOTAL_DURATION_TOLERANCE * 100)}% of ${targetMs} ms.`,
    '',
    'CAMERA GRAMMAR (hard rules — a wandering camera is the #1 thing that makes',
    'this feel like a tech demo instead of a sales tour):',
    '- ⛔ NO camera motion may exceed 4000 ms. Ever. A long flight over empty',
    '  desert teaches the viewer NOTHING — it is dead air. If two points are far',
    '  apart, use a SHORT flyover (≤4000 ms) — the path auto-zooms out, that IS',
    '  the "up over the city and back down" move. Do not stretch it.',
    '- ⛔ orbit degrees must be ≤ 120 and duration ≤ 4000 ms. A 180° 7-second orbit',
    '  around an off-plan plot is 7 seconds of staring at sand.',
    '- Move the camera ONLY when the spatial relationship IS the message (going to',
    '  a place, showing how close the metro is). NEVER move the camera while the',
    '  narration is explaining a NUMBER — hold still and let them read.',
    '- Vary beat lengths. Do NOT make every beat the same length; that metronome',
    '  rhythm is exactly what makes it feel like software instead of film.',
    '',
    'CAMERA GRAMMAR (cont.):',
    '- ⛔ NEVER rotate `bearing` between keyframes. Keep bearing CONSTANT within a',
    '  beat. A slowly rotating map reads as aimless drifting and teaches nothing —',
    '  it is the single most amateurish thing a map tour can do. When you genuinely',
    '  want to circle a building, use an explicit `orbit` motion instead.',
    '- The intro must PUSH IN (zoom increases), not spin. Distance travelled is the',
    '  message; rotation is not.',
    '',
    establishing,
    '',
    'COMPOSITION GUIDANCE:',
    '- intro: start at the ESTABLISHING SHOT above (a keyframe with duration_ms: 0,',
    '  so it cuts there instantly), then push in slightly. Title overlay with the',
    '  client name, progress_dots, and highlight_all_pins.',
    '- arrival beat: ONE short flyover (≤4000 ms) to the property, then a SHORT',
    '  orbit (≤120°, ≤4000 ms).',
    '  ⭐ The property_card overlay MUST have at_ms = 0 — it appears the INSTANT',
    '  the beat starts, and stays for the whole beat. The viewer must never be',
    '  looking at a moving map with no information on screen.',
    '- life beat: distance_line / amenity_spokes overlays for that property. The',
    '  camera MAY fly to the amenity (metro/school) and back — that is exactly the',
    '  case where motion carries the message. Keep each leg ≤4000 ms.',
    '- numbers beat: roi_card overlay, at_ms = 0. Camera HOLDS STILL (no motion at',
    '  all, or a very slow ≤4000 ms drift). Numbers are read, not flown over.',
    '- outro: pull back, highlight_all_pins + favorite_picker + cta.',
    '',
    'PROPERTY DATA:',
    facts,
    '',
    repairNote
      ? `PREVIOUS ATTEMPT WAS INVALID. Fix EXACTLY these problems and regenerate:\n${repairNote}`
      : '',
    '',
    'Return ONLY the TourScript JSON object. No markdown fences, no commentary.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return (fenced ? fenced[1] : trimmed).trim()
}

async function callModel(prompt: string): Promise<unknown> {
  let lastErr: unknown
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const resp = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      })
      const text = resp.text ?? ''
      if (!text.trim()) throw new Error('empty response')
      return JSON.parse(stripJsonFence(text))
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(
    `Gemini generation failed for both ${PRIMARY_MODEL} and ${FALLBACK_MODEL}: ` +
      (lastErr instanceof Error ? lastErr.message : String(lastErr))
  )
}

// ---------------------------------------------------------------------------
// Programmatic validation (beyond zod shape)
// ---------------------------------------------------------------------------

function overlayPropertyRefs(o: Overlay): string[] {
  if ('property_id' in o && o.property_id) return [o.property_id]
  if ('property_ids' in o && o.property_ids) return o.property_ids
  return []
}

/**
 * ⭐ 镜头硬约束 —— **在代码里 clamp，不要指望 prompt**。
 *
 * 实测 demo 的 arrival beat：flyover **8000ms** + orbit **180° / 7000ms**。
 * 也就是说客户到了一个项目，先看 8 秒钟的飞行（画面里是一片模糊的沙地），
 * 再绕着一栋**还没盖的楼**转 7 秒。**卡片要到第 8 秒才出现**。
 * 15 秒里有 8 秒是纯粹的虚无。
 *
 * 规则（依据见 docs/reports/2026-07-12-buyer-commitment-guided-tour-research.md §6）：
 *   · 任何镜头运动 ≤ 4000ms（Cesium 给**每一次**飞行的硬上限是 3 秒）
 *   · orbit ≤ 120°（180° 是在绕着空地转圈）
 *   · **property_card / roi_card 一律 at_ms = 0** —— 观众绝不能对着一张移动的、
 *     没有任何信息的地图发呆
 *
 * LLM 会违反 prompt。代码不会。
 */
/**
 * 🔴 转场飞行 ≤ 2 秒（owner 2026-07-12 定）。
 *
 * 跨项目的 flyover 会走 van Wijk 的最优曲线 —— 它**自动拉高再落下**。
 * 从 113 RESIDENCES 飞到 Palm Central 跨了半个迪拜，于是就成了
 * 「**弹远又弹近**」，而中间那几秒画面里什么信息都没有。压到 2 秒。
 */
const MAX_CAM_MS = 2000

// 🔴 **到了目的地不要再转圈**（owner 明确抱怨「到了目的点在旋转」）。
//    arrival 之后跟一个 orbit，镜头绕着一栋**还没盖的楼**转 —— 客户已经到了，
//    他要看的是信息，不是继续晕。orbit 在 clampCinematography 里被整个丢弃。

export function clampCinematography(beat: Beat): void {
  // 🔴 **keyframe 之间不许转 bearing。**
  //
  // demo 的开场实测：center 完全不变、zoom 10→11.8（几乎没动），而 bearing
  // **0 → 15 → 30 → 45**，转了 12 秒。看起来就是地图在原地莫名其妙地打转/漂移
  // —— 而它什么信息都没传达。LLM 加它纯粹是觉得「有电影感」。
  //
  // 依据（research §6）：van Wijk 的最优路径只管 2D 平移+缩放，bearing 是被硬贴上去的
  // 线性插值 —— 它会变成一个**和运镜竞争的运动**。真正要绕圈时用 orbit（那是显式的、
  // 有语义的动作：绕着这个项目看一圈）。keyframe 里的 bearing 漂移只会让人晕。
  //
  // 做法：整个 beat 的 bearing 锁定为第一个 keyframe 的值。orbit 不受影响。
  const firstKf = beat.camera.find((c) => 'bearing' in c && typeof (c as { bearing?: number }).bearing === 'number')
  const lockedBearing = firstKf ? (firstKf as unknown as { bearing: number }).bearing : undefined

  // orbit 整个丢弃（MAX_ORBIT_DEG = 0）—— 到了目的地就别再转了
  beat.camera = beat.camera.filter((c) => (c as unknown as { type?: string }).type !== 'orbit')

  for (const c of beat.camera) {
    if (c.duration_ms > MAX_CAM_MS) c.duration_ms = MAX_CAM_MS
    const anyC = c as unknown as { bearing?: number }
    if (lockedBearing !== undefined && typeof anyC.bearing === 'number') {
      anyC.bearing = lockedBearing
    }
  }
  for (const o of beat.overlays) {
    // 信息卡从第一帧就在 —— 它是这一拍的主角,不是迟到的注脚
    if ((o.type === 'property_card' || o.type === 'roi_card') && o.at_ms > 0) {
      const wanted = beat.duration_ms - 0
      o.duration_ms = Math.min(o.duration_ms ?? wanted, wanted)
      o.at_ms = 0
    }
  }
}

function withinBeat(beat: Beat): string[] {
  const errs: string[] = []
  const limit = beat.duration_ms
  for (const c of beat.camera) {
    const end = c.at_ms + c.duration_ms
    if (end > limit) {
      errs.push(
        `beat "${beat.id}": camera at_ms(${c.at_ms})+duration(${c.duration_ms})=${end} exceeds beat duration ${limit}`
      )
    }
  }
  for (const o of beat.overlays) {
    const end = o.at_ms + (o.duration_ms ?? 0)
    if (end > limit) {
      errs.push(
        `beat "${beat.id}": overlay "${o.type}" at_ms(${o.at_ms})+duration(${o.duration_ms ?? 0})=${end} exceeds beat duration ${limit}`
      )
    }
  }
  return errs
}

/** Returns a list of validation errors. Empty list = valid. */
export function validateTourScript(
  script: TourScript,
  input: TourInput
): string[] {
  const errors: string[] = []
  const validIds = new Set(input.properties.map((p) => p.id))
  const allBeats: Beat[] = [
    script.intro,
    ...script.acts.flatMap((a) => a.beats),
    script.outro,
  ]

  // ⭐ 先 clamp 再校验 —— 修掉 LLM 的运镜（8 秒飞行、180° 绕圈、迟到 8 秒的卡片），
  //    而不是把它当成错误退回去重试（那样只是白烧一次 LLM 调用，它下次照样犯）。
  for (const beat of allBeats) clampCinematography(beat)

  for (const act of script.acts) {
    if (!validIds.has(act.property_id)) {
      errors.push(`act "${act.id}": unknown property_id "${act.property_id}"`)
    }
  }

  let summed = 0
  for (const beat of allBeats) {
    summed += beat.duration_ms
    errors.push(...withinBeat(beat))
    for (const o of beat.overlays) {
      for (const ref of overlayPropertyRefs(o)) {
        if (!validIds.has(ref)) {
          errors.push(
            `beat "${beat.id}": overlay "${o.type}" references unknown property_id "${ref}"`
          )
        }
      }
    }
  }

  if (summed !== script.total_ms) {
    errors.push(
      `total_ms (${script.total_ms}) != sum of beat durations (${summed})`
    )
  }

  const targetMs = input.config.target_seconds * 1000
  const low = targetMs * (1 - TOTAL_DURATION_TOLERANCE)
  const high = targetMs * (1 + TOTAL_DURATION_TOLERANCE)
  if (script.total_ms < low || script.total_ms > high) {
    errors.push(
      `total_ms (${script.total_ms}) outside ±${Math.round(
        TOTAL_DURATION_TOLERANCE * 100
      )}% of target (${targetMs}); allowed ${Math.round(low)}–${Math.round(high)}`
    )
  }

  const banned = input.config.banned_phrases ?? []
  for (const beat of allBeats) {
    for (const phrase of banned) {
      if (phrase && beat.narration.includes(phrase)) {
        errors.push(
          `beat "${beat.id}": narration contains banned phrase "${phrase}"`
        )
      }
    }
  }

  return errors
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function parseAndValidate(
  raw: unknown,
  input: TourInput
): { script?: TourScript; errors: string[] } {
  const parsed = TourScriptSchema.safeParse(raw)
  if (!parsed.success) {
    const errs = parsed.error.issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`
    )
    return { errors: errs }
  }
  const semantic = validateTourScript(parsed.data, input)
  return { script: parsed.data, errors: semantic }
}

export async function generateTourScript(
  input: TourInput
): Promise<{ script: TourScript; warnings: string[] }> {
  const warnings: string[] = []

  const firstRaw = await callModel(buildPrompt(input))
  const first = parseAndValidate(firstRaw, input)
  if (first.script && first.errors.length === 0) {
    return { script: first.script, warnings }
  }

  // Retry once, feeding the parse/validation errors back to the model.
  warnings.push(
    `first attempt had ${first.errors.length} issue(s), retried: ${first.errors.join('; ')}`
  )
  const repairNote = first.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  const secondRaw = await callModel(buildPrompt(input, repairNote))
  const second = parseAndValidate(secondRaw, input)

  if (second.script && second.errors.length === 0) {
    return { script: second.script, warnings }
  }

  if (second.script) {
    // Shape valid but semantics still off — return it with loud warnings so the
    // caller (and the demo go/no-go gate) can judge rather than silently fail.
    warnings.push(
      `retry still has ${second.errors.length} validation issue(s): ${second.errors.join('; ')}`
    )
    return { script: second.script, warnings }
  }

  throw new Error(
    `TourScript failed schema parse after retry. Issues: ${second.errors.join('; ')}`
  )
}
