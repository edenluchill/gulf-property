/**
 * Boost POI photo coverage (FREE) by pulling each POI's OWN website hero image.
 *
 * For POIs that still have no photo but DO have a website, fetch the homepage and
 * extract <meta property="og:image"> (or twitter:image). This is the institution's
 * own photo → accurate and free. Only fills photo_url when currently null, so it
 * never overwrites a Wikipedia photo.
 *
 * Run:  npx ts-node scripts/enrich-poi-photos.ts
 *       npx ts-node scripts/enrich-poi-photos.ts --limit 20
 */
import 'dotenv/config'
import pool from '../src/db/pool'

const CATEGORIES = ['school', 'university', 'hospital', 'clinic']
const UA = 'Mozilla/5.0 (compatible; PinzosPropertyBot/1.0; +https://pinzos.com)'
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit')
  return i >= 0 ? parseInt(process.argv[i + 1]) : 0
})()

function pickMeta(html: string, ...keys: string[]): string | null {
  for (const key of keys) {
    // property="og:image" content="..."  OR  content="..." property="og:image"
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i')
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i')
    const m = html.match(re1) || html.match(re2)
    if (m && m[1]) return m[1].trim()
  }
  return null
}

function absolutize(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString()
  } catch {
    return null
  }
}

async function fetchOgImage(website: string): Promise<string | null> {
  let url = website.trim()
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      redirect: 'follow',
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('html')) return null
    const html = (await res.text()).slice(0, 200_000) // head is near the top
    const img = pickMeta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')
    if (!img) return null
    const abs = absolutize(img, res.url || url)
    if (!abs || !/^https?:\/\//i.test(abs)) return null
    // Reject logos/favicons — they make ugly stretched banners. Better no photo.
    if (/(favicon|apple-touch-icon|[/_-]logo[._-]|logo\.\w+(\?|$)|[/_-]icon[._-]|icon\.\w+(\?|$))/i.test(abs)) return null
    return abs
  } catch {
    return null
  }
}

async function main() {
  let q = `
    SELECT p.id, p.name, p.website
    FROM dubai_pois p
    LEFT JOIN dubai_poi_enrichment e ON e.poi_id = p.id
    WHERE p.category = ANY($1::text[]::poi_category[])
      AND p.website IS NOT NULL AND p.website <> ''
      AND (e.photo_url IS NULL)
    ORDER BY p.category, p.name
  `
  if (LIMIT) q += ` LIMIT ${LIMIT}`

  const { rows } = await pool.query(q, [CATEGORIES])
  console.log(`Candidates (website, no photo yet): ${rows.length}\n`)

  let added = 0, miss = 0
  const CONCURRENCY = 6
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (r: any) => {
      const img = await fetchOgImage(r.website)
      if (!img) { miss++; console.log(`  – ${r.name}`); return }
      const domain = (() => { try { return new URL(r.website.startsWith('http') ? r.website : 'https://' + r.website).hostname.replace(/^www\./, '') } catch { return r.website } })()
      // Only fill when still empty (don't clobber a Wikipedia photo from a race).
      await pool.query(
        `INSERT INTO dubai_poi_enrichment (poi_id, photo_url, photo_credit, source, updated_at)
         VALUES ($1, $2, $3, 'website', CURRENT_TIMESTAMP)
         ON CONFLICT (poi_id) DO UPDATE SET
           photo_url = COALESCE(dubai_poi_enrichment.photo_url, EXCLUDED.photo_url),
           photo_credit = CASE WHEN dubai_poi_enrichment.photo_url IS NULL THEN EXCLUDED.photo_credit ELSE dubai_poi_enrichment.photo_credit END,
           updated_at = CURRENT_TIMESTAMP`,
        [r.id, img, domain]
      )
      added++
      console.log(`  ✅ ${r.name} → ${img.slice(0, 70)}`)
    }))
  }

  const total = await pool.query(`SELECT COUNT(photo_url) n FROM dubai_poi_enrichment`)
  console.log(`\nAdded: ${added}, no-og-image: ${miss}. Total POIs with photo now: ${total.rows[0].n}`)
  await pool.end()
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
