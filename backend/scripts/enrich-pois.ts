/**
 * Enrich Dubai POIs with FREE data: photo + bilingual description.
 *
 * Sources (no paid APIs, no Google):
 *   1. Wikipedia geosearch (by exact POI coords) + pageimages/extracts
 *      → real photo (CC BY-SA, credited) + factual extract when the POI has an article.
 *   2. Gemini (gemini-3.5-flash) → concise zh+en description.
 *      Grounded on the Wikipedia extract when available; otherwise a careful
 *      generic description that does NOT invent ratings/facilities.
 *
 * Writes to dubai_poi_enrichment (UPSERT). Re-runnable.
 *
 * Scope: schools / universities / hospitals / clinics (the categories buyers care about).
 *
 * Run:  npx ts-node scripts/enrich-pois.ts            (skips already-enriched)
 *       npx ts-node scripts/enrich-pois.ts --force     (re-do all)
 *       npx ts-node scripts/enrich-pois.ts --limit 20  (test on a few)
 */
import 'dotenv/config'
import pool from '../src/db/pool'
import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const MODEL = 'gemini-3.5-flash'

const CATEGORIES = ['school', 'university', 'hospital', 'clinic']
const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const UA = 'PinzosPropertyBot/1.0 (https://pinzos.com; data enrichment)'

const FORCE = process.argv.includes('--force')
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i >= 0 ? parseInt(process.argv[i + 1]) : 0
})()

interface PoiRow {
  id: string
  name: string
  name_ar: string | null
  category: string
  address: string | null
  lat: number
  lng: number
}

interface WikiHit {
  extract: string
  photo_url: string | null
  photo_credit: string | null
}

// ---- name matching ---------------------------------------------------------
// Drop generic words AND "al"/"el" — they're the Dubai equivalent of "the" and
// cause false matches (e.g. "Al Barsha" area matching "Al Noor Training Centre").
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(al|el|the|of|and|for|school|college|university|hospital|clinic|polyclinic|medical|health|centre|center|training|building|tower|international|private|dubai|uae)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Returns {score, inter}: containment score + count of shared meaningful tokens. */
function tokenOverlap(a: string, b: string): { score: number; inter: number } {
  const sa = new Set(normalize(a).split(' ').filter(Boolean))
  const sb = new Set(normalize(b).split(' ').filter(Boolean))
  if (!sa.size || !sb.size) return { score: 0, inter: 0 }
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return { score: inter / Math.min(sa.size, sb.size), inter }
}

async function wikiJson(params: Record<string, string>): Promise<any> {
  const url = `${WIKI_API}?${new URLSearchParams({ format: 'json', ...params })}`
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`wiki ${res.status}`)
  return res.json()
}

/** Find the best-matching nearby Wikipedia article for a POI. */
async function findWikipedia(poi: PoiRow): Promise<WikiHit | null> {
  try {
    // 1. Articles within 1km of the POI coords.
    const geo = await wikiJson({
      action: 'query',
      list: 'geosearch',
      gscoord: `${poi.lat}|${poi.lng}`,
      gsradius: '1000',
      gslimit: '15',
    })
    const candidates: { pageid: number; title: string; dist: number }[] =
      (geo?.query?.geosearch || []).map((g: any) => ({ pageid: g.pageid, title: g.title, dist: g.dist }))
    if (!candidates.length) return null

    // 2. Pick best by name overlap (proximity already guaranteed < 1km).
    //    Require a strong containment score AND ≥1 shared *meaningful* token, so
    //    a nearby area/landmark article never gets attached to an unrelated POI.
    let best: { pageid: number; title: string; score: number; inter: number } | null = null
    for (const c of candidates) {
      const { score, inter } = tokenOverlap(poi.name, c.title)
      if (!best || score > best.score) best = { pageid: c.pageid, title: c.title, score, inter }
    }
    if (!best || best.score < 0.6 || best.inter < 1) return null // require a solid name match

    // 3. Fetch extract + photo + Wikidata short description for the matched page.
    const det = await wikiJson({
      action: 'query',
      pageids: String(best.pageid),
      prop: 'extracts|pageimages|info|pageterms',
      inprop: 'url',
      wbptterms: 'description',
      exintro: '1',
      explaintext: '1',
      piprop: 'original|thumbnail',
      pithumbsize: '800',
    })
    const page: any = Object.values(det?.query?.pages || {})[0]
    if (!page) return null

    // Reject PLACES (areas/communities/metro stations/roads). POIs are often
    // named after their neighbourhood, which would otherwise false-match the
    // area's Wikipedia article (e.g. "Al Qusais Health Centre" → "Al Qusais").
    const shortDesc: string = (page.terms?.description?.[0] || '').toLowerCase()
    const PLACE_RE = /\b(neighbou?rhood|community|locality|suburb|district|quarter|town|village|region|settlement|street|road|metro|station|island|residential|development|area of)\b/
    if (shortDesc && PLACE_RE.test(shortDesc)) return null

    const photo = page.original?.source || page.thumbnail?.source || null
    const extract = (page.extract || '').trim()
    if (!photo && !extract) return null

    return {
      extract: extract.slice(0, 1200),
      photo_url: photo,
      photo_credit: photo ? `Wikipedia · ${page.fullurl || `https://en.wikipedia.org/?curid=${best.pageid}`}` : null,
    }
  } catch (e: any) {
    console.log(`    wiki err ${poi.name}: ${String(e.message || e).slice(0, 80)}`)
    return null
  }
}

// ---- description generation ------------------------------------------------
async function genDescription(poi: PoiRow, wikiExtract: string | null): Promise<{ zh: string; en: string } | null> {
  const ctx = [
    `Name: ${poi.name}`,
    poi.name_ar ? `Arabic name: ${poi.name_ar}` : null,
    `Type: ${poi.category}`,
    poi.address ? `Address: ${poi.address}` : null,
    wikiExtract ? `\nReference (Wikipedia, summarize from this — do not copy verbatim):\n${wikiExtract}` : null,
  ].filter(Boolean).join('\n')

  const grounded = !!wikiExtract
  const prompt = `You write short, factual descriptions of Dubai points-of-interest for a property-buying app used by Chinese investors and families. The reader is deciding whether to live near this place.

${ctx}

Write a 1-3 sentence description of what this ${poi.category} is and who it serves${grounded ? ', summarizing the reference above' : ''}. Focus on what a home buyer cares about (e.g. for a school: curriculum/age range/reputation if known; for a hospital: specialties/size if known).
${grounded
    ? 'Only use facts present in the reference. Do NOT add ratings or numbers not in the reference.'
    : 'You do NOT have detailed information about this specific place. Write a careful, general description based ONLY on its name and type. Do NOT invent ratings, student counts, founding years, specialties, fees, or accreditations. If the name implies a curriculum (e.g. "British", "American", "Indian") you may note that.'}
Never write an apology or "information not available". Keep it natural.

Return STRICT JSON: {"zh": "<简体中文版, 1-3句>", "en": "<English version, 1-3 sentences>"}`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      })
      const parsed = JSON.parse(res.text || '')
      if (parsed.zh && parsed.en) return { zh: String(parsed.zh).trim(), en: String(parsed.en).trim() }
    } catch (e: any) {
      console.log(`    gemini retry ${attempt + 1}: ${String(e.message || e).slice(0, 100)}`)
      await new Promise(r => setTimeout(r, 2500))
    }
  }
  return null
}

// ---- main ------------------------------------------------------------------
async function processOne(poi: PoiRow, idx: number, total: number): Promise<'done' | 'failed'> {
  const wiki = await findWikipedia(poi)
  const desc = await genDescription(poi, wiki?.extract || null)
  if (!desc) {
    console.log(`  ❌ [${idx}/${total}] ${poi.name}`)
    return 'failed'
  }

  const source = wiki ? 'wikipedia+gemini' : 'gemini'
  await pool.query(
    `INSERT INTO dubai_poi_enrichment
       (poi_id, description, description_zh, photo_url, photo_credit, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (poi_id) DO UPDATE SET
       description = EXCLUDED.description,
       description_zh = EXCLUDED.description_zh,
       photo_url = EXCLUDED.photo_url,
       photo_credit = EXCLUDED.photo_credit,
       source = EXCLUDED.source,
       updated_at = CURRENT_TIMESTAMP`,
    [poi.id, desc.en, desc.zh, wiki?.photo_url || null, wiki?.photo_credit || null, source]
  )

  console.log(`  ✅ [${idx}/${total}] ${poi.name}${wiki?.photo_url ? ' 📷' : ''} → ${desc.zh.slice(0, 40)}…`)
  return 'done'
}

async function main() {
  let q = `
    SELECT p.id, p.name, p.name_ar, p.category::text AS category, p.address,
           ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng
    FROM dubai_pois p
    ${FORCE ? '' : 'LEFT JOIN dubai_poi_enrichment e ON e.poi_id = p.id'}
    WHERE p.category = ANY($1::text[]::poi_category[])
    ${FORCE ? '' : 'AND e.poi_id IS NULL'}
    ORDER BY p.category, p.name
  `
  if (LIMIT) q += ` LIMIT ${LIMIT}`

  const { rows } = await pool.query(q, [CATEGORIES])
  const pois: PoiRow[] = rows.map(r => ({ ...r, lat: Number(r.lat), lng: Number(r.lng) }))
  console.log(`Target POIs: ${pois.length} (force=${FORCE}, limit=${LIMIT || 'none'})\n`)

  let done = 0, failed = 0
  const CONCURRENCY = 4
  for (let i = 0; i < pois.length; i += CONCURRENCY) {
    const batch = pois.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((p, j) => processOne(p, i + j + 1, pois.length)))
    done += results.filter(r => r === 'done').length
    failed += results.filter(r => r === 'failed').length
  }

  const withPhoto = await pool.query(
    `SELECT COUNT(*)::int AS n FROM dubai_poi_enrichment WHERE photo_url IS NOT NULL`
  )
  console.log(`\nDone: ${done}, failed: ${failed}. Total rows with photo: ${withPhoto.rows[0].n}`)
  await pool.end()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
