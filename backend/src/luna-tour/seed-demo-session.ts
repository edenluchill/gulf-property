/**
 * Luna Tour — Phase 0 heart-slice seed.
 *
 * Seeds ONE hardcoded, publishable demo session (share_code = 'demo') so the
 * frontend `/v/demo` watch page has a real TourScript v2 + property snapshots to
 * play. This is the go/no-go fixture for §1's "震撼 3 分钟".
 *
 * ISOLATION: writes only to lt_* tables. Re-running is idempotent — it deletes
 * any prior share_code='demo' session (cascade) and a fresh one. Delete the
 * backend/src/luna-tour directory + run luna-tour-teardown.sql to remove
 * everything.
 *
 * Usage (from backend/):
 *   npx ts-node src/luna-tour/seed-demo-session.ts
 *   FORCE_REGEN=1 npx ts-node src/luna-tour/seed-demo-session.ts   # re-run Gemini
 *
 * It reuses 3 real residential_projects rows + investment-calculator for ROI,
 * then calls generateTourScript (Gemini). residential_projects has no
 * distance/amenity source table, so those facts are flagged placeholders and the
 * `to` endpoints are small offsets near each building (so the on-map laser lines
 * render locally rather than shooting across the city).
 */
import type { PoolClient } from 'pg'
import pool from '../db/pool'
import {
  calculateInvestment5yr,
  calculatePaybackYears,
} from '../services/investment-calculator'
import { generateTourScript } from './tour-generator'
import { TourInput, TourProperty } from './tour-script.types'

const SHARE_CODE = 'demo'
const DEMO_AGENT_EMAIL = 'demo-agent@luna.tour'

// Placeholder market assumptions — drive the ROI demo only, flagged clearly.
const PLACEHOLDER_YIELD_PCT = 6.5
const PLACEHOLDER_GROWTH_PCT = 7

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
  primary_image: string | null
  project_images: unknown
}

function num(v: string | number | null): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

// Real amenity categories + scoring (mirrors voice-assistant-tools'
// analyze_area_amenities so narration, drawn lines and the convenience score all
// come from the SAME real dubai_pois data — no placeholders).
const AMENITY_SPECS = [
  { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5, weight: 0.25 },
  { cat: 'school', zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6, weight: 0.2 },
  { cat: 'mall', zh: '商场', emoji: '🛍️', ideal: 3, zero: 8, weight: 0.2 },
  { cat: 'hospital', zh: '医院', emoji: '🏥', ideal: 2, zero: 10, weight: 0.2 },
  { cat: 'supermarket', zh: '超市', emoji: '🛒', ideal: 1, zero: 4, weight: 0.15 },
] as const

interface NearbyHit {
  category: string
  name: string
  km: number
  lng: number
  lat: number
}

function tierOf(score100: number): string {
  return score100 >= 75 ? '优秀' : score100 >= 55 ? '良好' : score100 >= 35 ? '一般' : '偏远'
}

/** Nearest real POI per category around a property (PostGIS on dubai_pois). */
async function fetchNearby(client: PoolClient, lng: number, lat: number): Promise<{
  distances: NonNullable<TourProperty['distances']>
  amenities: NonNullable<TourProperty['amenities']>
  score: number
  tier: string
}> {
  const cats = AMENITY_SPECS.map((s) => s.cat)
  const { rows } = await client.query<{ category: string; name: string; km: string; lng: string; lat: string }>(
    `SELECT DISTINCT ON (category) category, name,
            ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)/1000 AS km,
            ST_X(location::geometry) AS lng, ST_Y(location::geometry) AS lat
       FROM dubai_pois
      WHERE category = ANY($3::text[]::poi_category[])
      ORDER BY category, ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) ASC`,
    [lng, lat, cats]
  )
  const byCat = new Map<string, NearbyHit>()
  rows.forEach((r) =>
    byCat.set(r.category, {
      category: r.category,
      name: r.name,
      km: Number(parseFloat(r.km).toFixed(2)),
      lng: parseFloat(r.lng),
      lat: parseFloat(r.lat),
    })
  )

  let score = 0
  const amenities: NonNullable<TourProperty['amenities']> = []
  const distances: NonNullable<TourProperty['distances']> = []
  for (const s of AMENITY_SPECS) {
    const hit = byCat.get(s.cat)
    if (!hit) continue
    const sub = Math.max(0, Math.min(1, (s.zero - hit.km) / (s.zero - s.ideal)))
    score += s.weight * sub
    amenities.push({ label: s.zh, distance_km: hit.km })
    distances.push({ label: `${s.emoji} ${s.zh}（${hit.name}）`, to: [hit.lng, hit.lat], distance_km: hit.km })
  }
  const score100 = Math.round(score * 100)
  return { distances, amenities, score: score100, tier: tierOf(score100) }
}

function buildProperty(
  row: ProjectRow,
  real: { distances: NonNullable<TourProperty['distances']>; amenities: NonNullable<TourProperty['amenities']>; score: number; tier: string }
): TourProperty {
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

  const imgs = Array.isArray(row.project_images) ? (row.project_images as unknown[]) : []
  const image =
    row.primary_image ?? (typeof imgs[0] === 'string' ? (imgs[0] as string) : undefined)

  return {
    id: row.id,
    name: row.project_name,
    area: row.area ?? 'Dubai',
    developer: row.developer ?? undefined,
    image,
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
    amenity_score: real.score,
    amenity_tier: real.tier,
    distances: real.distances,
    amenities: real.amenities,
  }
}

async function fetchProjects(): Promise<ProjectRow[]> {
  // Prefer 3 projects in DISTINCT areas so the city flyover transitions read as
  // real travel across Dubai, not 3 towers next door.
  const { rows } = await pool.query<ProjectRow>(
    `SELECT DISTINCT ON (area) id::text, project_name, area, latitude, longitude,
            min_price, max_price, status, developer, primary_image, project_images
       FROM residential_projects
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND min_price IS NOT NULL AND min_price > 500000
        AND area IS NOT NULL
      ORDER BY area, min_price DESC`
  )
  // Pick 3 spread across the price range for variety.
  const sorted = rows
    .filter((r) => num(r.latitude) && num(r.longitude))
    .sort((a, b) => (num(b.min_price) ?? 0) - (num(a.min_price) ?? 0))
  if (sorted.length < 3) return sorted
  const pick = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]]
  return pick
}

async function main(): Promise<void> {
  const client = await pool.connect()
  try {
    console.log('1/5  Fetching 3 real residential_projects (distinct areas)...')
    const rows = await fetchProjects()
    if (rows.length < 3) {
      throw new Error(`Need 3 usable projects, found ${rows.length}.`)
    }
    const properties: TourProperty[] = []
    for (const row of rows) {
      const real = await fetchNearby(client, num(row.longitude)!, num(row.latitude)!)
      properties.push(buildProperty(row, real))
    }
    properties.forEach((p) =>
      console.log(
        `     • ${p.name} | ${p.area} | coords[${p.coords}] | ` +
          `${p.investment?.buy}→${p.investment?.future} (+${p.investment?.growth_pct}%)`
      )
    )

    // ---- demo agent (find-or-create) ----
    console.log('2/5  Ensuring demo agent + client...')
    const agentRes = await client.query<{ id: string }>(
      `INSERT INTO lt_agents (email, display_name, phone, whatsapp, photo_url, brand, onboarding_done)
       VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [
        DEMO_AGENT_EMAIL,
        'David Chen',
        '+971500000000',
        '971500000000',
        'https://i.pravatar.cc/200?img=12',
        JSON.stringify({
          title: 'Emaar 认证顾问',
          whatsapp: '971500000000',
          accent: '#00E0B8',
        }),
      ]
    )
    const agentId = agentRes.rows[0].id

    const existingClient = await client.query<{ id: string }>(
      `SELECT id FROM lt_clients WHERE agent_id=$1 AND name=$2 LIMIT 1`,
      [agentId, '陈先生']
    )
    let clientId = existingClient.rows[0]?.id
    if (!clientId) {
      const clientRow = await client.query<{ id: string }>(
        `INSERT INTO lt_clients (agent_id, name, nationality, preferred_language, goal, budget_min, budget_max)
         VALUES ($1,$2,$3,'zh','invest_both',1000000,5000000)
         RETURNING id`,
        [agentId, '陈先生', '香港']
      )
      clientId = clientRow.rows[0].id
    }

    // ---- generate TourScript (or reuse if present and not forced) ----
    const input: TourInput = {
      client: { persona: 'investor', name: '陈先生', goal: 'investment', nationality: '香港' },
      config: {
        language: 'zh',
        narrative_focus: 'investment',
        target_seconds: 165,
        banned_phrases: ['抱歉', '对不起', '无法'],
        guardrails: [
          '不要承诺或保证任何回报率或升值',
          '只陈述提供的数字,不要编造任何价格、坐标或距离',
          '距离和配套来自真实地图数据,可直接、自然地陈述(如「步行到地铁约 X 公里」)',
        ],
      },
      properties,
    }

    console.log('3/5  Generating TourScript via Gemini (may take ~10s)...')
    const { script, warnings } = await generateTourScript(input)
    if (warnings.length) warnings.forEach((w) => console.log(`     ! ${w}`))
    console.log(
      `     ✓ script v${script.version} total_ms=${script.total_ms} acts=${script.acts.length}`
    )

    // ---- upsert session (delete prior 'demo' cascade, then insert) ----
    console.log('4/5  Writing session + properties + script...')
    await client.query('BEGIN')
    await client.query(`DELETE FROM lt_demo_sessions WHERE share_code=$1`, [SHARE_CODE])

    const theme = { map_style: 'dark', accent: '#00E0B8', captions: true }
    const sessionRes = await client.query<{ id: string }>(
      `INSERT INTO lt_demo_sessions
         (agent_id, client_id, title, share_code, status, effective_config,
          data_as_of, theme, is_published, published_at)
       VALUES ($1,$2,$3,$4,'published',$5,CURRENT_DATE,$6,true,now())
       RETURNING id`,
      [
        agentId,
        clientId ?? null,
        'David 为陈先生精选的 3 个家',
        SHARE_CODE,
        JSON.stringify(input.config),
        JSON.stringify(theme),
      ]
    )
    const sessionId = sessionRes.rows[0].id

    for (let i = 0; i < properties.length; i++) {
      const p = properties[i]
      // Snapshot carries EVERYTHING the frontend overlays need — zero client compute.
      const snapshot = {
        name: p.name,
        developer: p.developer,
        image: p.image,
        area: p.area,
        status: p.status,
        coords: p.coords,
        min_price: p.min_price,
        max_price: p.max_price,
        investment: p.investment,
        amenity_score: p.amenity_score,
        amenity_tier: p.amenity_tier,
        distances: p.distances,
        amenities: p.amenities,
      }
      await client.query(
        `INSERT INTO lt_session_properties
           (session_id, project_id, sort_order, snapshot)
         VALUES ($1,$2,$3,$4)`,
        [sessionId, p.id, i, JSON.stringify(snapshot)]
      )
    }

    await client.query(
      `INSERT INTO lt_tour_scripts (session_id, language, voice, script, total_ms)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (session_id, language)
       DO UPDATE SET script = EXCLUDED.script, total_ms = EXCLUDED.total_ms`,
      [sessionId, script.language, script.voice, JSON.stringify(script), script.total_ms]
    )

    await client.query('COMMIT')

    console.log('5/5  Done.')
    console.log(`\n  ✅ Seeded. Open the watch page at:  /v/${SHARE_CODE}`)
    console.log(`     session_id = ${sessionId}`)
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('\nSEED FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
