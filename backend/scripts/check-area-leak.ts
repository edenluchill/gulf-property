/**
 * check-area-leak.ts — forensic "did they copy our area blocks?" checker.
 *
 * WHY this works (natural watermark): our /api/dubai/areas runs the boundaries
 * through ST_SimplifyPreserveTopology(11m) + truncates to 5 decimals. Those exact
 * simplified vertex positions are OURS — they differ from the original DLD/source
 * geometry (denser, more precise, different vertices). So if a suspect dataset
 * contains OUR exact 5-decimal vertices, they scraped OUR endpoint, not the public
 * source. Coincidental overlap of many exact vertices is statistically ~impossible.
 *
 * USAGE:
 *   cd backend
 *   # compare a suspected-stolen geojson against our live endpoint:
 *   npx ts-node scripts/check-area-leak.ts path/to/suspect.geojson
 *   # or against a specific deployment:
 *   AREAS_URL=https://api.pinzos.com/api/dubai/areas npx ts-node scripts/check-area-leak.ts suspect.geojson
 *
 * The suspect file can be: our API shape (array of {boundary}), a GeoJSON
 * FeatureCollection, or a raw geometry array — we just harvest every [lng,lat].
 *
 * Output: overlap % of OUR vertices found in the suspect + a verdict + sample
 * matching coordinates to cite as evidence.
 */
import fs from 'fs'
import https from 'https'
import http from 'http'
import { unseal, utcDateStr } from '../src/services/seal'

const AREAS_URL = process.env.AREAS_URL || 'https://api.pinzos.com/api/dubai/areas'
const PRECISION = 5 // must match AREA_COORD_DIGITS in dubai-areas-landmarks.ts

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    lib.get(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

/** Our /dubai/areas is sealed (services/seal). Unseal it (try today then yesterday UTC). */
function fetchOurAreas(buf: Buffer): any {
  const yesterday = utcDateStr(new Date(Date.now() - 86400000))
  for (const date of [utcDateStr(), yesterday]) {
    try { return JSON.parse(unseal(buf, date).toString()) } catch { /* try previous day */ }
  }
  // last resort: maybe it's still plain JSON (older deployment)
  return JSON.parse(buf.toString())
}

/** Recursively harvest every [lng,lat] pair from any nested coordinate structure. */
function harvestCoords(node: any, out: Set<string>): void {
  if (Array.isArray(node)) {
    // a coordinate pair = [number, number]
    if (node.length >= 2 && typeof node[0] === 'number' && typeof node[1] === 'number') {
      out.add(`${node[0].toFixed(PRECISION)},${node[1].toFixed(PRECISION)}`)
      return
    }
    for (const child of node) harvestCoords(child, out)
  } else if (node && typeof node === 'object') {
    // dig into common containers: boundary, geometry, coordinates, features, geometries
    for (const key of ['boundary', 'geometry', 'coordinates', 'features', 'geometries']) {
      if (node[key] != null) harvestCoords(node[key], out)
    }
    // our API shape: top-level is an array of area objects with .boundary (handled above)
  }
}

function coordSet(data: any): Set<string> {
  const out = new Set<string>()
  harvestCoords(data, out)
  return out
}

;(async () => {
  const suspectPath = process.argv[2]
  if (!suspectPath) {
    console.error('Usage: npx ts-node scripts/check-area-leak.ts <suspect.geojson>')
    process.exit(1)
  }

  console.log(`Fetching our fingerprint from: ${AREAS_URL}`)
  const ours = coordSet(fetchOurAreas(await fetchBuffer(AREAS_URL)))
  console.log(`  our distinct vertices (${PRECISION}-decimal): ${ours.size}`)

  const suspectRaw = JSON.parse(fs.readFileSync(suspectPath, 'utf8'))
  const suspect = coordSet(suspectRaw)
  console.log(`  suspect distinct vertices: ${suspect.size}`)

  let hits = 0
  const samples: string[] = []
  for (const v of ours) {
    if (suspect.has(v)) {
      hits++
      if (samples.length < 8) samples.push(v)
    }
  }
  const pct = ours.size ? (hits / ours.size) * 100 : 0

  console.log(`\n── RESULT ─────────────────────────────`)
  console.log(`  exact-vertex overlap: ${hits}/${ours.size}  (${pct.toFixed(1)}% of OUR vertices appear in suspect)`)
  console.log(`  matching sample coords: ${samples.join('  ') || '(none)'}`)
  console.log(`\n  Verdict:`)
  if (pct >= 50) {
    console.log(`  🔴 STRONG evidence of copying. ${pct.toFixed(0)}% of our SIMPLIFIED vertices`)
    console.log(`     match exactly — these are artifacts of OUR simplification, not the`)
    console.log(`     public source. Coincidence at this scale is statistically negligible.`)
    console.log(`     → Usable for DMCA / legal claim. Save this output + both datasets.`)
  } else if (pct >= 10) {
    console.log(`  🟠 PARTIAL overlap. Could be selective copying of some areas, or they`)
    console.log(`     simplified the same source similarly. Investigate the matching areas.`)
  } else {
    console.log(`  🟢 No meaningful overlap — likely independent/original geometry.`)
  }
  console.log(`────────────────────────────────────────`)
})().catch((e) => { console.error('error:', e.message); process.exit(1) })
