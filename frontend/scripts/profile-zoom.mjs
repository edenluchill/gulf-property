// Evidence-based profiling: capture a CPU profile during a zoom-OUT gesture and
// aggregate self-time per function so we can SEE what blocks the main thread.
// Usage: SHOT_URL=... node scripts/profile-zoom.mjs [in|out]
import { chromium } from 'playwright'

const dir = process.argv[2] || 'out' // 'out' = zoom out, 'in' = zoom in
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' ? true : false })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
const page = await ctx.newPage()
await page.addInitScript(([metric, poiCats]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('map-area-metric', metric)
  if (poiCats) localStorage.setItem('map-poi-categories', poiCats)
}, [process.env.PROFILE_METRIC || 'none', process.env.PROFILE_POI_CATS || ''])
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(13000) // let it fully settle

// If zooming OUT, first zoom IN so there's somewhere to zoom out from.
await page.mouse.move(700, 425)
if (dir === 'out') {
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(350) }
  await page.waitForTimeout(2500)
}

const client = await page.context().newCDPSession(page)
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 80 }) // 80µs = fine
await client.send('Profiler.start')

// the gesture under test
const t0 = Date.now()
for (let i = 0; i < 7; i++) {
  await page.mouse.wheel(0, dir === 'out' ? 320 : -320)
  await page.waitForTimeout(180)
}
await page.waitForTimeout(1500)
const wall = Date.now() - t0

const { profile } = await client.send('Profiler.stop')

// aggregate self-time (µs) per function from samples + timeDeltas
const byNode = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map() // key -> µs
const keyOf = (cf) => {
  const f = cf.functionName || '(anonymous)'
  const u = (cf.url || '').split('/').pop() || cf.url || ''
  return `${f}  @${u}:${cf.lineNumber + 1}`
}
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const dt = profile.timeDeltas[i] || 0
  if (dt <= 0) continue
  total += dt
  const node = byNode.get(profile.samples[i])
  if (!node) continue
  const k = keyOf(node.callFrame)
  self.set(k, (self.get(k) || 0) + dt)
}

const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
console.log(`\n=== ZOOM ${dir.toUpperCase()} — wall ${wall}ms, sampled CPU ${(total / 1000).toFixed(0)}ms ===`)
for (const [k, us] of top) {
  const ms = us / 1000
  const pct = ((us / total) * 100).toFixed(1)
  console.log(`${ms.toFixed(1).padStart(7)}ms  ${pct.padStart(5)}%  ${k}`)
}
await browser.close()
