/**
 * Luna Tour — runnable smoke test for the TourScript v2 generator (spec §4.2,
 * Phase 0 "心脏切片").
 *
 * ISOLATION: delete the backend/src/luna-tour directory to remove this feature.
 *
 * Usage (run from the backend/ directory):
 *   npx ts-node src/luna-tour/test-tour-generator.ts
 *
 * It pulls 2 real residential_projects rows, computes 5-year ROI with the
 * existing investment-calculator, builds a TourInput (investor / zh / investment
 * focus / 150s) and prints every beat's full narration plus a camera/overlay
 * summary, the total duration, and warnings.
 *
 * residential_projects has no distance/amenity source table here, so distances
 * and amenities are clearly flagged placeholders (placeholder:true) and the
 * prompt tells the model they are approximate.
 */
import pool from '../db/pool'
import {
  calculateInvestment5yr,
  calculatePaybackYears,
} from '../services/investment-calculator'
import { generateTourScript } from './tour-generator'
import {
  TourInput,
  TourProperty,
  Beat,
  Camera,
  Overlay,
} from './tour-script.types'

interface ProjectRow {
  id: string
  project_name: string
  area: string | null
  latitude: string | number | null
  longitude: string | number | null
  min_price: string | number | null
  max_price: string | number | null
  status: string | null
  developer: string | null
}

// Placeholder market assumptions used only to drive the ROI demo. Real values
// would come from area metrics; flagged clearly so nothing is presented as fact.
const PLACEHOLDER_YIELD_PCT = 6.5
const PLACEHOLDER_GROWTH_PCT = 7

function num(v: string | number | null): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function buildProperty(row: ProjectRow): TourProperty {
  const lng = num(row.longitude)!
  const lat = num(row.latitude)!
  const minPrice = num(row.min_price)
  const maxPrice = num(row.max_price)
  const purchasePrice = minPrice ?? maxPrice ?? 0

  const inv = calculateInvestment5yr(
    purchasePrice,
    PLACEHOLDER_YIELD_PCT,
    PLACEHOLDER_GROWTH_PCT
  )
  const payback = calculatePaybackYears(PLACEHOLDER_YIELD_PCT)

  return {
    id: row.id,
    name: row.project_name,
    area: row.area ?? 'Dubai',
    developer: row.developer ?? undefined,
    status: row.status ?? undefined,
    coords: [lng, lat],
    min_price: minPrice,
    max_price: maxPrice,
    investment: inv
      ? {
          buy: inv.purchase_price,
          future: inv.purchase_price + inv.total_profit_5yr,
          years: 5,
          growth_pct: Math.round((inv.total_profit_5yr / inv.purchase_price) * 100),
          yield_pct: PLACEHOLDER_YIELD_PCT,
          payback_years: payback ?? undefined,
        }
      : undefined,
    amenity_score: 90, // placeholder convenience score
    amenity_tier: '优秀',
    distances: [
      { label: '市中心 Downtown', to: [55.2744, 25.1972], distance_km: 12, placeholder: true },
    ],
    amenities: [
      { label: '学校', distance_km: 2, placeholder: true },
      { label: '地铁', distance_km: 3, placeholder: true },
      { label: '商场', distance_km: 4, placeholder: true },
    ],
  }
}

function cameraSummary(c: Camera): string {
  if ('type' in c) {
    if (c.type === 'orbit') {
      return `orbit@${c.at_ms}ms ${c.duration_ms}ms ${c.degrees}° center[${c.center[0]},${c.center[1]}]`
    }
    if (c.type === 'flyover') {
      return `flyover@${c.at_ms}ms ${c.duration_ms}ms [${c.from[0]},${c.from[1]}]→[${c.to[0]},${c.to[1]}]`
    }
    if (c.type === 'push') return `push@${c.at_ms}ms ${c.duration_ms}ms Δzoom ${c.zoom_delta}`
    return `crane@${c.at_ms}ms ${c.duration_ms}ms pitch ${c.pitch ?? '—'} zoom ${c.zoom ?? '—'}`
  }
  return (
    `keyframe@${c.at_ms}ms ${c.duration_ms}ms` +
    (c.center ? ` center[${c.center[0]},${c.center[1]}]` : '') +
    (c.zoom != null ? ` z${c.zoom}` : '') +
    (c.pitch != null ? ` pitch${c.pitch}` : '') +
    (c.bearing != null ? ` bearing${c.bearing}` : '') +
    (c.easing ? ` ${c.easing}` : '')
  )
}

function overlaySummary(o: Overlay): string {
  const base = `${o.type}@${o.at_ms}ms${o.duration_ms != null ? ` ${o.duration_ms}ms` : ''}`
  switch (o.type) {
    case 'title':
      return `${base} "${o.text}"${o.subtitle ? ` / "${o.subtitle}"` : ''}`
    case 'progress_dots':
      return `${base} ${o.active}/${o.total}`
    case 'property_card':
      return `${base} [${o.property_id}]`
    case 'distance_line':
      return `${base} → ${o.label} to[${o.to[0]},${o.to[1]}]`
    case 'amenity_spokes':
      return `${base} score=${o.score}${o.tier ? `(${o.tier})` : ''} center[${o.center[0]},${o.center[1]}]`
    case 'roi_card':
      return `${base} buy=${o.data.buy} future=${o.data.future} +${o.data.growth_pct}%`
    case 'highlight_all_pins':
      return `${base} pins=${o.property_ids.length}`
    case 'favorite_picker':
      return `${base} picks=${o.property_ids.length}`
    case 'cta':
      return `${base} "${o.text ?? o.prefill ?? ''}"`
    default:
      return base
  }
}

function printBeat(label: string, beat: Beat): void {
  console.log(`\n${'-'.repeat(72)}`)
  console.log(
    `${label}  [id=${beat.id}${beat.kind ? ` kind=${beat.kind}` : ''}]  duration=${beat.duration_ms}ms`
  )
  console.log(`narration: ${beat.narration}`)
  if (beat.camera.length) {
    console.log('camera:')
    beat.camera.forEach((c) => console.log(`  - ${cameraSummary(c)}`))
  }
  if (beat.overlays.length) {
    console.log('overlays:')
    beat.overlays.forEach((o) => console.log(`  - ${overlaySummary(o)}`))
  }
}

async function main(): Promise<void> {
  console.log('Fetching 2 real residential_projects from the database...')
  const { rows } = await pool.query<ProjectRow>(
    `SELECT id::text, project_name, area, latitude, longitude, min_price,
            max_price, status, developer
       FROM residential_projects
      WHERE latitude IS NOT NULL AND min_price IS NOT NULL AND min_price > 0
      ORDER BY min_price DESC
      LIMIT 2`
  )

  if (rows.length < 2) {
    console.error(`Only found ${rows.length} usable project(s); need 2. Aborting.`)
    await pool.end()
    process.exit(1)
  }

  const properties = rows.map(buildProperty)
  console.log('\nInput properties (real id/name/coords/price + ROI; placeholder distances/amenities):')
  for (const p of properties) {
    console.log(
      `  ${p.id}\n    ${p.name} | ${p.area} | ${p.developer ?? '-'} | ` +
        `coords[${p.coords[0]},${p.coords[1]}] | price ${p.min_price}-${p.max_price} | ` +
        `5yr: buy ${p.investment?.buy} → ${p.investment?.future} (+${p.investment?.growth_pct}%) | ` +
        `yield ${p.investment?.yield_pct}% | payback ${p.investment?.payback_years}y`
    )
  }

  const input: TourInput = {
    client: { persona: 'investor', name: '陈先生', goal: 'investment', nationality: '香港' },
    config: {
      language: 'zh',
      narrative_focus: 'investment',
      target_seconds: 150,
      banned_phrases: ['抱歉', '对不起', '无法'],
      guardrails: [
        '不要承诺或保证任何回报率或升值',
        '只陈述提供的数字,不要编造任何价格、坐标或距离',
        'placeholder 数据要表达为大致参考,不要当作精确事实',
      ],
    },
    properties,
  }

  console.log('\nGenerating TourScript via Gemini...\n')
  const { script, warnings } = await generateTourScript(input)

  console.log(`TourScript v${script.version} | voice=${script.voice} | language=${script.language} | acts=${script.acts.length}`)
  console.log(`total_ms=${script.total_ms} (target ${input.config.target_seconds * 1000}ms)`)

  printBeat('INTRO', script.intro)
  script.acts.forEach((act, ai) => {
    console.log(`\n${'='.repeat(72)}\nACT ${ai + 1}: ${act.id} (property ${act.property_id})`)
    act.beats.forEach((b, bi) => printBeat(`  ACT${ai + 1} BEAT${bi + 1}`, b))
    if (act.transition_out) {
      console.log(`  transition_out: ${act.transition_out.type} ${act.transition_out.duration_ms}ms`)
    }
  })
  printBeat('OUTRO', script.outro)

  console.log(`\n${'-'.repeat(72)}`)
  if (warnings.length) {
    console.log('WARNINGS:')
    warnings.forEach((w) => console.log(`  ! ${w}`))
  } else {
    console.log('WARNINGS: none — script passed schema + semantic validation on first try.')
  }

  if (process.env.LUNA_DUMP) {
    const fs = require('fs') as typeof import('fs')
    fs.writeFileSync(process.env.LUNA_DUMP, JSON.stringify(script, null, 2))
    console.log(`\nDumped full script JSON to ${process.env.LUNA_DUMP}`)
  }

  await pool.end()
}

main().catch(async (err) => {
  console.error('\nTEST FAILED:', err instanceof Error ? err.message : err)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
