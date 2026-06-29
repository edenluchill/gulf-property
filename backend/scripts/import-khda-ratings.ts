/**
 * Import KHDA official school inspection ratings into dubai_poi_enrichment.
 *
 * Input: a JSON array [{name, rating}, ...] scraped from a public KHDA-ratings
 *        list (whichschooladvisor). Path via argv, default scripts/khda-ratings.json.
 *
 * Matches each rating to our school POIs by fuzzy name (token Jaccard), then
 * writes khda_rating / khda_year / khda_url. Precision-first: only assigns on a
 * strong name match (a wrong rating on a school is worse than none).
 *
 * KHDA scale (6): Outstanding / Very Good / Good / Acceptable / Weak / Very Weak.
 * Inspections paused 2024-25 & 2025-26 → ratings are the 2023-24 cycle snapshot.
 *
 * Run:  npx ts-node scripts/import-khda-ratings.ts [path/to/khda-ratings.json] [--dry]
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import pool from '../src/db/pool'

const KHDA_YEAR = 2024 // 2023-24 inspection cycle
const KHDA_URL = 'https://web.khda.gov.ae/en/About-Us/Whats-New/Dubai-school-inspection-ratings'

const argFile = process.argv.find(a => a.endsWith('.json'))
const FILE = argFile || path.join(__dirname, 'khda-ratings.json')
const DRY = process.argv.includes('--dry')

const VALID = ['Outstanding', 'Very Good', 'Good', 'Acceptable', 'Weak', 'Very Weak']

function canonRating(r: string): string | null {
  const s = r.trim().toLowerCase()
  return VALID.find(v => v.toLowerCase() === s) || null
}

// Normalize a school name to a token set. Strip generic/location words that
// don't change a school's identity (incl. "al"/"dubai" — the local "the").
function tokens(name: string): Set<string> {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(the|of|and|for|a|an|llc|branch|est|fz|fze|dubai|uae|al|el)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return new Set(cleaned.split(' ').filter(Boolean))
}

// Purely-generic descriptors that may differ without changing identity.
// NOTE: keep "primary/high/boys/girls/gems/private/community/academy/college"
// OUT of this set — they distinguish genuinely different schools
// (e.g. Jebel Ali *Primary* vs Jebel Ali School; *GEMS* Winchester vs The Winchester).
const SAFE = new Set(['school', 'international', 'campus', 'private'])

// Match only on exact token-set equality OR a difference made up solely of SAFE
// descriptors with ≥2 shared meaningful tokens. Precision-first: a wrong rating
// on a school is worse than no rating. Returns a sortable confidence or null.
function matchScore(p: Set<string>, k: Set<string>): { inter: number; diff: number } | null {
  let inter = 0
  const diff: string[] = []
  for (const t of new Set([...p, ...k])) {
    if (p.has(t) && k.has(t)) inter++
    else diff.push(t)
  }
  if (diff.length === 0) return { inter, diff: 0 }
  if (inter >= 2 && diff.every(t => SAFE.has(t))) return { inter, diff: diff.length }
  return null
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { name: string; rating: string }[]
  const khda = raw
    .map(r => ({ name: r.name, rating: canonRating(r.rating), tok: tokens(r.name) }))
    .filter(r => r.rating && r.tok.size)
  console.log(`KHDA entries loaded: ${khda.length} (from ${raw.length})`)

  const { rows } = await pool.query(`
    SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
    FROM dubai_pois WHERE category = 'school'
  `)
  console.log(`School POIs: ${rows.length}\n`)

  let matched = 0
  const usedNames = new Set<string>()
  for (const poi of rows) {
    const ptok = tokens(poi.name)
    let best: { rating: string; name: string; inter: number; diff: number } | null = null
    for (const k of khda) {
      const m = matchScore(ptok, k.tok)
      if (!m) continue
      if (!best || m.diff < best.diff || (m.diff === best.diff && m.inter > best.inter))
        best = { rating: k.rating!, name: k.name, inter: m.inter, diff: m.diff }
    }
    if (!best) continue

    matched++
    usedNames.add(best.name)
    console.log(`  ✅ ${poi.name}  →  ${best.rating}  (${best.diff === 0 ? 'exact' : 'diff:' + best.diff} ← "${best.name}")`)
    if (DRY) continue

    await pool.query(
      `INSERT INTO dubai_poi_enrichment (poi_id, khda_rating, khda_year, khda_url, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (poi_id) DO UPDATE SET
         khda_rating = EXCLUDED.khda_rating,
         khda_year = EXCLUDED.khda_year,
         khda_url = EXCLUDED.khda_url,
         updated_at = CURRENT_TIMESTAMP`,
      [poi.id, best.rating, KHDA_YEAR, KHDA_URL]
    )
  }

  const unmatched = khda.filter(k => !usedNames.has(k.name))
  console.log(`\nMatched ${matched}/${rows.length} school POIs.`)
  console.log(`KHDA entries not matched to any POI: ${unmatched.length}`)
  if (unmatched.length) console.log('  e.g. ' + unmatched.slice(0, 12).map(k => k.name).join(' | '))
  if (DRY) console.log('\n(DRY run — nothing written)')
  await pool.end()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
