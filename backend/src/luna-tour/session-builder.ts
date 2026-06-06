/**
 * Luna Tour — reusable session builder.
 *
 * Core logic shared by the demo seed and the parameterized generator: given a
 * set of residential project ids + an agent/client/config, it fetches real
 * facts (coords/price/image + real nearest POIs + 5yr ROI), runs the AI
 * TourScript generator, and writes lt_demo_sessions + lt_session_properties +
 * lt_tour_scripts. Lets an agent generate a tour for ANY properties, not just
 * the hardcoded demo.
 *
 * ISOLATION: only lt_* writes + read of residential_projects/dubai_pois. Delete
 * the luna-tour directory to remove.
 */
import type { PoolClient } from 'pg'
import pool from '../db/pool'
import {
  calculateInvestment5yr,
  calculatePaybackYears,
} from '../services/investment-calculator'
import { generateTourScript } from './tour-generator'
import { generateSessionAudio } from './audio-pipeline'
import { TourInput, TourProperty, TourConfig } from './tour-script.types'

const PLACEHOLDER_YIELD_PCT = 6.5
const PLACEHOLDER_GROWTH_PCT = 7

const AMENITY_SPECS = [
  { cat: 'metro_station', zh: '地铁', emoji: '🚇', ideal: 1.5, zero: 5, weight: 0.25 },
  { cat: 'school', zh: '学校', emoji: '🏫', ideal: 1.5, zero: 6, weight: 0.2 },
  { cat: 'mall', zh: '商场', emoji: '🛍️', ideal: 3, zero: 8, weight: 0.2 },
  { cat: 'hospital', zh: '医院', emoji: '🏥', ideal: 2, zero: 10, weight: 0.2 },
  { cat: 'supermarket', zh: '超市', emoji: '🛒', ideal: 1, zero: 4, weight: 0.15 },
] as const

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

function tierOf(score100: number): string {
  return score100 >= 75 ? '优秀' : score100 >= 55 ? '良好' : score100 >= 35 ? '一般' : '偏远'
}

interface NearbyResult {
  distances: NonNullable<TourProperty['distances']>
  amenities: NonNullable<TourProperty['amenities']>
  score: number
  tier: string
}

async function fetchNearby(client: PoolClient, lng: number, lat: number): Promise<NearbyResult> {
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
  const byCat = new Map(rows.map((r) => [r.category, r]))
  let score = 0
  const amenities: NearbyResult['amenities'] = []
  const distances: NearbyResult['distances'] = []
  for (const s of AMENITY_SPECS) {
    const hit = byCat.get(s.cat)
    if (!hit) continue
    const km = Number(parseFloat(hit.km).toFixed(2))
    const sub = Math.max(0, Math.min(1, (s.zero - km) / (s.zero - s.ideal)))
    score += s.weight * sub
    amenities.push({ label: s.zh, distance_km: km })
    distances.push({ label: `${s.emoji} ${s.zh}（${hit.name}）`, to: [parseFloat(hit.lng), parseFloat(hit.lat)], distance_km: km })
  }
  const score100 = Math.round(score * 100)
  return { distances, amenities, score: score100, tier: tierOf(score100) }
}

function buildProperty(row: ProjectRow, real: NearbyResult): TourProperty {
  const lng = num(row.longitude)!
  const lat = num(row.latitude)!
  const minPrice = num(row.min_price)
  const maxPrice = num(row.max_price)
  const purchasePrice = minPrice ?? maxPrice ?? 0
  const inv = calculateInvestment5yr(purchasePrice, PLACEHOLDER_YIELD_PCT, PLACEHOLDER_GROWTH_PCT)
  const payback = calculatePaybackYears(PLACEHOLDER_YIELD_PCT)
  const imgs = Array.isArray(row.project_images) ? (row.project_images as unknown[]) : []
  const image = row.primary_image ?? (typeof imgs[0] === 'string' ? (imgs[0] as string) : undefined)

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

export interface CreateSessionInput {
  shareCode: string
  /** residential_projects ids, in tour order (2-4 recommended) */
  projectIds: string[]
  title: string
  agentId: string
  clientId?: string | null
  client?: TourInput['client']
  config?: Partial<TourConfig>
  theme?: Record<string, unknown>
  /** Wait for narration audio to finish before resolving. CLI passes true; the
   *  HTTP path leaves it false so the request returns fast (audio backfills). */
  awaitAudio?: boolean
}

export interface CreateSessionResult {
  sessionId: string
  shareCode: string
  totalMs: number
  acts: number
  warnings: string[]
  /** true if audio generation was kicked off (in background unless awaitAudio) */
  audioStarted: boolean
  /** left→right tour structure node labels: 开场 → 各楼盘 → 结尾 (for the UI) */
  stops: string[]
  /** number of narrated beats audio will be generated for (progress denominator) */
  audioTotal: number
}

const DEFAULT_CONFIG: TourConfig = {
  language: 'zh',
  narrative_focus: 'investment',
  target_seconds: 165,
  banned_phrases: ['抱歉', '对不起', '无法'],
  guardrails: [
    '不要承诺或保证任何回报率或升值',
    '只陈述提供的数字,不要编造任何价格、坐标或距离',
    '距离和配套来自真实地图数据,可直接、自然地陈述(如「步行到地铁约 X 公里」)',
  ],
}

/**
 * Build + persist a full Luna Tour session for arbitrary properties.
 * Idempotent on shareCode (deletes a prior session with the same code).
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  if (!input.projectIds.length) throw new Error('projectIds is empty')
  const client = await pool.connect()
  try {
    // fetch the chosen projects (preserve caller order)
    const { rows } = await client.query<ProjectRow>(
      `SELECT id::text, project_name, area, latitude, longitude, min_price, max_price,
              status, developer, primary_image, project_images
         FROM residential_projects
        WHERE id = ANY($1::uuid[]) AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      [input.projectIds]
    )
    const byId = new Map(rows.map((r) => [r.id, r]))
    const ordered = input.projectIds.map((id) => byId.get(id)).filter((r): r is ProjectRow => !!r)
    if (ordered.length < 2) {
      throw new Error(`Need ≥2 usable projects with coords; got ${ordered.length} of ${input.projectIds.length}`)
    }

    const properties: TourProperty[] = []
    for (const row of ordered) {
      const real = await fetchNearby(client, num(row.longitude)!, num(row.latitude)!)
      properties.push(buildProperty(row, real))
    }

    const config: TourConfig = { ...DEFAULT_CONFIG, ...input.config }
    const tourInput: TourInput = {
      client: input.client ?? {},
      config,
      properties,
    }

    const { script, warnings } = await generateTourScript(tourInput)

    const theme = input.theme ?? { map_style: 'dark', accent: '#00E0B8', captions: true }
    await client.query('BEGIN')
    await client.query(`DELETE FROM lt_demo_sessions WHERE share_code=$1`, [input.shareCode])

    const sessionRes = await client.query<{ id: string }>(
      `INSERT INTO lt_demo_sessions
         (agent_id, client_id, title, share_code, status, effective_config,
          data_as_of, theme, is_published, published_at)
       VALUES ($1,$2,$3,$4,'published',$5,CURRENT_DATE,$6,true,now())
       RETURNING id`,
      [input.agentId, input.clientId ?? null, input.title, input.shareCode, JSON.stringify(config), JSON.stringify(theme)]
    )
    const sessionId = sessionRes.rows[0].id

    for (let i = 0; i < properties.length; i++) {
      const p = properties[i]
      const snapshot = {
        name: p.name, developer: p.developer, image: p.image, area: p.area, status: p.status,
        coords: p.coords, min_price: p.min_price, max_price: p.max_price, investment: p.investment,
        amenity_score: p.amenity_score, amenity_tier: p.amenity_tier, distances: p.distances, amenities: p.amenities,
      }
      await client.query(
        `INSERT INTO lt_session_properties (session_id, project_id, sort_order, snapshot)
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

    // Pre-generate narration audio (one voice = Aoede). This is HEAVY (per-beat
    // Gemini TTS + R2 upload for 11+ beats → 60–120s), so by default we do NOT
    // block the HTTP response on it — otherwise the request exceeds Cloudflare's
    // ~100s proxy timeout and the browser sees "Failed to fetch". The session is
    // already fully playable (the engine falls back to browser TTS for any beat
    // whose audio_url isn't ready yet) and audio_url backfills as clips finish.
    // CLI callers pass awaitAudio:true to wait. Done after COMMIT so a TTS hiccup
    // can never roll back a valid session.
    const audioJob = generateSessionAudio(sessionId)
      .then((audio) =>
        console.log(
          `[luna] audio for ${input.shareCode}: ${audio.ready}/${audio.total} ready` +
            (audio.failed ? `, ${audio.failed} failed` : '')
        )
      )
      .catch((err) => console.warn('[luna] audio pre-generation skipped:', err instanceof Error ? err.message : err))
    if (input.awaitAudio) await audioJob

    return {
      sessionId,
      shareCode: input.shareCode,
      totalMs: script.total_ms,
      acts: script.acts.length,
      warnings,
      audioStarted: true,
      stops: ['开场', ...properties.map((p) => p.name), '结尾'],
      audioTotal: 1 + script.acts.reduce((n, a) => n + a.beats.length, 0) + 1,
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
  }
}

/** Find-or-create an agent by email; returns its id. */
export async function ensureAgent(opts: {
  email: string
  displayName: string
  phone?: string
  whatsapp?: string
  photoUrl?: string
  brand?: Record<string, unknown>
}): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO lt_agents (email, display_name, phone, whatsapp, photo_url, brand, onboarding_done)
     VALUES ($1,$2,$3,$4,$5,$6,true)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [opts.email, opts.displayName, opts.phone ?? null, opts.whatsapp ?? null, opts.photoUrl ?? null, JSON.stringify(opts.brand ?? {})]
  )
  return res.rows[0].id
}
