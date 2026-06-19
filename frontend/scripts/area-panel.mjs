// Open an area detail panel and screenshot it (+ a metric info popover).
// Usage: SHOT_URL=... node scripts/area-panel.mjs out.png [lang]
import { chromium } from 'playwright'
const out = process.argv[2] || 'area.png'
const lang = process.argv[3] || 'zh-CN'
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
await page.addInitScript((lang) => {
  localStorage.setItem('pinzos-lang', lang)
  localStorage.setItem('map-area-metric', 'rentStability')
  localStorage.setItem('map-base', 'satellite')
}, lang)
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(11000)

// zoom in a bit toward the central residential band then probe many land points
await page.mouse.move(900, 460)
for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(800) }
await page.waitForTimeout(2500)

// click land points until an area WITH metrics opens (not the empty-state)
const pts = [
  [950, 430], [1000, 460], [900, 500], [1050, 420], [880, 440],
  [980, 540], [820, 470], [1080, 500], [760, 520], [1020, 380],
]
let opened = false
for (const [x, y] of pts) {
  await page.mouse.click(x, y)
  await page.waitForTimeout(1700)
  opened = await page.evaluate(() => /资本增长|Capital Growth/.test(document.body.innerText))
  if (opened) break
  // close any empty-state dialog before next try
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(400)
}
console.log('dialog opened:', opened)
await page.waitForTimeout(1500)
await page.screenshot({ path: out })
console.log('saved:', out)

// open the rent-stability info popover and capture it
const infoBtns = page.locator('button[aria-label="How it\'s calculated"]')
const n = await infoBtns.count()
let clicked = -1
for (let i = 0; i < n; i++) {
  const b = infoBtns.nth(i)
  if (await b.isVisible()) {
    const box = await b.boundingBox()
    if (box && box.x > 0 && box.x < 1500 && box.y > 0) { await b.click(); clicked = i; break }
  }
}
await page.waitForTimeout(900)
const hasPop = await page.evaluate(() => /中位数|新签|续租|DLD/.test(document.body.innerText))
console.log('info buttons:', n, 'clicked visible idx:', clicked, 'popover text:', hasPop)
await page.screenshot({ path: out.replace('.png', '-info.png') })
await browser.close()
