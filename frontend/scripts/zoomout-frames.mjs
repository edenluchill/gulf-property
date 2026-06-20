// Frame-jank during a zoom-OUT (zoom in first, then measure zooming out).
import { chromium } from 'playwright'
const url = process.env.SHOT_URL || 'http://localhost:5174/'
const pois = process.env.POIS === '0' ? '[]' : null
const browser = await chromium.launch({ headless: process.env.HEADED !== '1' ? true : false })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('map-area-metric', 'none')
}, )
if (pois) await page.addInitScript(() => localStorage.setItem('pinzos-poi-categories', '[]'))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(13000)
// zoom in to a deep level first
await page.mouse.move(700, 425)
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(320) }
await page.waitForTimeout(2500)
// start frame timer, then zoom OUT continuously
await page.evaluate(() => {
  window.__f = []; let last = performance.now()
  const tick = (t) => { window.__f.push(t - last); last = t; window.__r = requestAnimationFrame(tick) }
  window.__r = requestAnimationFrame(tick)
})
for (let i = 0; i < 7; i++) { await page.mouse.wheel(0, 320); await page.waitForTimeout(150) }
await page.waitForTimeout(1200)
const r = await page.evaluate(() => {
  cancelAnimationFrame(window.__r)
  const f = window.__f.filter((d) => d > 0)
  const slow = f.filter((d) => d > 24).length
  const worst = [...f].sort((a, b) => b - a).slice(0, 5).map((x) => Math.round(x))
  return { n: f.length, slow, avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length), worst }
})
console.log(`zoom-out frames: ${r.n} | slow(>24ms): ${r.slow} | avg ${r.avg}ms | worst ${JSON.stringify(r.worst)}`)
await browser.close()
