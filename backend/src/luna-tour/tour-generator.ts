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
    'COMPOSITION GUIDANCE:',
    '- intro: cinematic city swoop (a keyframe with high pitch), a title overlay',
    '  with the client name, progress_dots, and highlight_all_pins.',
    '- arrival beat: flyTo + orbit around the property; property_card overlay.',
    '- life beat: distance_line / amenity_spokes overlays for that property.',
    '- numbers beat: roi_card overlay using that property\'s investment numbers.',
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
