/**
 * Visual regression / layout-overlap check (Playwright).
 *
 * Catches the bug class that keeps biting us: floating map controls overlapping
 * each other after a layout change. It loads /map on desktop + mobile, asserts
 * the control panels (metric / POI / usage lens / tools) don't overlap, exercises
 * the usage lens, and saves screenshots. Exit code 1 on any overlap or missing
 * control → run it before shipping any map UI change.
 *
 * Usage:
 *   # dev server must be running (npm run dev), or set SHOT_URL
 *   node scripts/visual-check.mjs [outDir]
 *   SHOT_URL=https://www.pinzos.com node scripts/visual-check.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const BASE = process.env.SHOT_URL || 'http://localhost:5173'
const OUT = process.argv[2] || 'visual-out'
mkdirSync(OUT, { recursive: true })

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
}
// Which control testids must exist + not overlap, per viewport.
const CONTROLS = {
  desktop: ['map-metric-panel', 'map-poi-panel'],
  mobile: ['map-mobile-controls', 'map-mobile-tools'],
}

const overlap = (a, b, tol = 1) =>
  !(a.x + a.width - tol <= b.x || b.x + b.width - tol <= a.x ||
    a.y + a.height - tol <= b.y || b.y + b.height - tol <= a.y)

let failures = 0
const fail = (m) => { console.log(`  ✗ ${m}`); failures++ }
const ok = (m) => console.log(`  ✓ ${m}`)

async function rects(page, ids) {
  const out = {}
  for (const id of ids) {
    const el = page.locator(`[data-testid="${id}"]`).first()
    out[id] = (await el.count()) && (await el.isVisible()) ? await el.boundingBox() : null
  }
  return out
}

async function checkViewport(browser, name) {
  console.log(`\n[${name}]`)
  const ctx = await browser.newContext({ viewport: VIEWPORTS[name], deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  // Force a metric overlay on so the panels + usage lens render.
  await page.addInitScript(() => {
    localStorage.setItem('pinzos-lang', 'zh-CN')
    localStorage.setItem('map-base', 'satellite')
    localStorage.setItem('map-area-metric', 'medianPriceSqft')
  })
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)

  if (errors.length) fail(`${errors.length} console error(s): ${errors[0]}`)
  else ok('no console errors')

  // 1. Every required control is present + visible.
  const ids = CONTROLS[name]
  const boxes = await rects(page, ids)
  for (const id of ids) {
    if (!boxes[id]) fail(`control missing/hidden: ${id}`)
    else ok(`present: ${id}`)
  }

  // 2. No two controls overlap.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = boxes[ids[i]], b = boxes[ids[j]]
      if (a && b && overlap(a, b)) {
        fail(`OVERLAP: ${ids[i]} ⨯ ${ids[j]}`)
      }
    }
  }
  if (ids.every((id) => boxes[id])) ok('no control overlaps')

  await page.screenshot({ path: `${OUT}/map-${name}.png` })

  // 3. Exercise the usage lens (commercial) — must not throw / still no overlap.
  const lens = page.locator(`[data-testid="map-usage-lens"] button`)
  if (await lens.count()) {
    await lens.nth(1).click() // 商业
    await page.waitForTimeout(3500)
    const after = await rects(page, ids)
    let bad = false
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        if (after[ids[i]] && after[ids[j]] && overlap(after[ids[i]], after[ids[j]])) {
          fail(`OVERLAP after usage toggle: ${ids[i]} ⨯ ${ids[j]}`); bad = true
        }
    if (!bad) ok('usage toggle (商业) — no overlap')
    await page.screenshot({ path: `${OUT}/map-${name}-commercial.png` })
  }

  await ctx.close()
}

const browser = await chromium.launch()
for (const name of Object.keys(VIEWPORTS)) await checkViewport(browser, name)
await browser.close()

console.log(`\n${failures === 0 ? '✅ PASS — no regressions' : `❌ FAIL — ${failures} issue(s)`}  (screenshots in ${OUT}/)`)
process.exit(failures === 0 ? 0 : 1)
