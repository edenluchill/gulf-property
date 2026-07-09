/**
 * Collab markup tools visual verification (arrow / text / pin / circle / undo).
 * Usage: SHOT_URL=http://localhost:5174/t/<code> node scripts/_draw-verify.mjs out.png
 * Opens the collab viewer, opens the markup toolbar, exercises each tool on the
 * map, and screenshots the result. Local WS may not connect — marks still render
 * locally, which is what we're verifying.
 */
import { chromium } from 'playwright'

const out = process.argv[2] || 'draw.png'
const url = process.env.SHOT_URL
if (!url) { console.error('set SHOT_URL to a /t/<code> url'); process.exit(1) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', (m) => { const t = m.text(); if (/error|draw|mark/i.test(t)) console.log('[console]', t.slice(0, 200)) })

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(13000) // map load + areas fetch

const openBtn = page.getByTitle('画笔 / 标记')
await openBtn.click()
await page.waitForTimeout(500)

// helper: pick a tool by its title
const pick = async (title) => { await page.getByTitle(title, { exact: true }).click(); await page.waitForTimeout(250) }
const drag = async (x1, y1, x2, y2) => {
  await page.mouse.move(x1, y1); await page.mouse.down()
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2); await page.mouse.move(x2, y2)
  await page.mouse.up(); await page.waitForTimeout(400)
}

// pen
await pick('画笔')
await drag(500, 300, 620, 360)
// arrow
await pick('箭头')
await drag(560, 500, 700, 430)
// circle (draw-to-query)
await pick('圈选(出区域数据)')
await drag(760, 430, 850, 500)
// pin
await pick('图钉标记')
await page.mouse.click(640, 620); await page.waitForTimeout(400)
// text
await pick('文字标签')
await page.mouse.click(470, 430); await page.waitForTimeout(400)
await page.keyboard.type('2028通地铁')
await page.keyboard.press('Enter')
await page.waitForTimeout(600)

await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
