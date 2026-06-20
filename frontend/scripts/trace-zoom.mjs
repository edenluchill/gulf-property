// DevTools Timeline trace during a zoom gesture, aggregated by event type, so we
// can see exactly which browser work (Style recalc / Layout / Paint / Decode /
// GPU / Composite) eats the main thread. Usage: node scripts/trace-zoom.mjs [in|out]
import { chromium } from 'playwright'
const dir = process.argv[2] || 'out'
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' ? true : false })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('map-area-metric', 'none')
})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(13000)

await page.mouse.move(700, 425)
if (dir === 'out') { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(350) } await page.waitForTimeout(2500) }

const client = await page.context().newCDPSession(page)
const events = []
client.on('Tracing.dataCollected', (d) => { for (const e of d.value) events.push(e) })
await client.send('Tracing.start', {
  categories: 'disabled-by-default-devtools.timeline,devtools.timeline,blink,cc,gpu,loading',
  transferMode: 'ReportEvents',
})
for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, dir === 'out' ? 320 : -320); await page.waitForTimeout(180) }
await page.waitForTimeout(1500)
await client.send('Tracing.end')
await new Promise((r) => setTimeout(r, 1200)) // let dataCollected flush

// aggregate complete ('X') events on the main renderer thread by name
const byName = new Map()
let maxDur = 0, maxName = ''
for (const e of events) {
  if (e.ph !== 'X' || typeof e.dur !== 'number') continue
  byName.set(e.name, (byName.get(e.name) || 0) + e.dur)
  if (e.dur > maxDur) { maxDur = e.dur; maxName = e.name }
}
const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
console.log(`\n=== ZOOM ${dir.toUpperCase()} — timeline events by total duration (µs) ===`)
for (const [name, us] of top) console.log(`${(us / 1000).toFixed(1).padStart(8)}ms  ${name}`)
console.log(`\nsingle worst event: ${(maxDur / 1000).toFixed(1)}ms  (${maxName})`)
await browser.close()
