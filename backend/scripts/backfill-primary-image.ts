/**
 * Backfill residential_projects.primary_image from each project's own brochure
 * gallery (project_images). Picks the LARGEST image by bytes — photographic renders
 * (exterior / lifestyle) are much heavier than text/brand/floor-plan pages, so size
 * is a decent "is this a real photo" heuristic. Uses the developer's own brochure
 * images (legal, correct building) — no web scraping.
 *
 * Only fills projects whose primary_image is empty; never overwrites an existing one.
 * Dry-run by default; pass --apply to write.
 *
 *   npx ts-node scripts/backfill-primary-image.ts          # dry run
 *   npx ts-node scripts/backfill-primary-image.ts --apply  # write
 */
import { config } from 'dotenv'
import { Client } from 'pg'
import { resolve } from 'path'
config({ path: resolve(__dirname, '../.env') })

const APPLY = process.argv.includes('--apply')
const MAX_CANDIDATES = 12 // cap HEAD requests per project

async function sizeOf(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    const n = parseInt(r.headers.get('content-length') || '0', 10)
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

async function run() {
  const client = new Client({
    host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  })
  await client.connect()
  const { rows } = await client.query(
    `SELECT id, project_name, project_images
       FROM residential_projects
      WHERE verified = true
        AND (primary_image IS NULL OR primary_image = '')
        AND array_length(project_images, 1) > 0`
  )
  console.log(`${rows.length} projects need a primary_image\n`)

  let filled = 0
  for (const p of rows) {
    const candidates: string[] = (p.project_images || []).slice(0, MAX_CANDIDATES)
    const sizes = await Promise.all(candidates.map(sizeOf))
    let best = -1, bestSize = -1
    sizes.forEach((s, i) => { if (s > bestSize) { bestSize = s; best = i } })
    if (best < 0 || bestSize <= 0) { console.log(`SKIP  ${p.project_name} — no fetchable image`); continue }
    const pick = candidates[best]
    const page = pick.replace(/^.*\/images\//, '')
    console.log(`PICK  ${p.project_name.padEnd(38)} ${page}  (${Math.round(bestSize / 1024)}KB, #${best + 1}/${candidates.length})`)
    if (APPLY) {
      await client.query(`UPDATE residential_projects SET primary_image = $1 WHERE id = $2`, [pick, p.id])
      filled++
    }
  }
  console.log(`\n${APPLY ? `✅ filled ${filled} projects` : 'DRY RUN — pass --apply to write'}`)
  await client.end()
}
run().catch(e => { console.error(e); process.exit(1) })
