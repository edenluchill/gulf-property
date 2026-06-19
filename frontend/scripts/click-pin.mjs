// One-off: zoom in, click the project pin nearest viewport center, screenshot
// the preview card. Usage: SHOT_URL=... node scripts/click-pin.mjs out.png [lang] [zoomSteps]
import { chromium } from 'playwright'

const out = process.argv[2] || 'pin.png'
const lang = process.argv[3] || 'zh-CN'
const zoomSteps = Number(process.argv[4] || 6)
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const mobile = process.env.MOBILE === '1'
const browser = await chromium.launch()
// Narrow viewport flips the app into mobile layout (matchMedia max-width:767);
// we deliberately do NOT set isMobile/touch so plain mouse clicks still work.
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1500, height: 880 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.addInitScript((lang) => {
  localStorage.setItem('pinzos-lang', lang)
  localStorage.setItem('map-area-metric', 'none')
  localStorage.setItem('map-base', 'satellite')
}, lang)

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(11000)

// Find & directly click the nearest project pin's marker element (react-map-gl
// binds a real DOM click listener on it, so el.click() fires onClick regardless
// of what overlaps it). If everything is still clustered, wheel-zoom and retry.
const tryClick = () => page.evaluate(() => {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2
  let best = null, bestD = Infinity
  for (const m of document.querySelectorAll('.maplibregl-marker')) {
    if (!m.querySelector('svg[viewBox="0 0 46 58"]')) continue
    const r = m.getBoundingClientRect()
    const d = (r.left + r.width / 2 - cx) ** 2 + (r.top + r.height / 2 - cy) ** 2
    if (d < bestD) { bestD = d; best = m }
  }
  if (!best) return false
  best.click()
  return true
})

let clicked = false
for (let i = 0; i < zoomSteps && !clicked; i++) {
  clicked = await tryClick()
  if (clicked) break
  const W = await page.evaluate(() => window.innerWidth)
  const H = await page.evaluate(() => window.innerHeight)
  await page.mouse.move(W / 2, H / 2)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(1100)
}
await page.waitForTimeout(2800) // let the card + description fetch render
const hasCard = await page.evaluate(() => /查看详情|View More/.test(document.body.innerText))
console.log('clicked pin:', clicked, '| card visible:', hasCard)

await page.screenshot({ path: out })
console.log('saved:', out)
await browser.close()
