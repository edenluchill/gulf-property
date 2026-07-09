/**
 * 指北针验证截图:2D正北 → 旋转 → 3D+旋转 → 点「正北」复位
 * 用法: node scripts/_shot-compass.mjs [outDir]
 * 依赖 DEV 的 window.__map 句柄驱动相机,截右上工具卡区域。
 */
import { chromium } from 'playwright'

const outDir = process.argv[2] || 'shots-compass'
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-area-metric', 'none')
  localStorage.setItem('map-base', 'vector')
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)

// 左上搜索栈 + 罗盘区域
const clip = { x: 0, y: 0, width: 420, height: 260 }

const cam = async (opts) => {
  await page.evaluate((o) => window.__map?.jumpTo(o), opts)
  await page.waitForTimeout(800)
}
const needleTransform = () =>
  page.evaluate(() => {
    const btn = document.querySelector('[aria-label="指北针,点击回正北"]')
    return btn?.querySelector('span')?.style.transform || '(missing)'
  })

// 1. 初始 2D 正北
await page.screenshot({ path: `${outDir}/1-north-2d.png`, clip })
console.log('initial transform:', await needleTransform())

// 2. 旋转 60°(2D)
await cam({ bearing: 60 })
await page.screenshot({ path: `${outDir}/2-bearing60-2d.png`, clip })
console.log('bearing60 transform:', await needleTransform())

// 3. 3D + 旋转(pitch 60 bearing -45)
await cam({ bearing: -45, pitch: 60 })
await page.screenshot({ path: `${outDir}/3-bearing-45-pitch60.png`, clip })
console.log('3d transform:', await needleTransform())

// 4. 点「正北」按钮 → bearing 应回 0(pitch 保留)
await page.click('[aria-label="指北针,点击回正北"]')
await page.waitForTimeout(1200)
const bearing = await page.evaluate(() => window.__map?.getBearing())
const pitch = await page.evaluate(() => window.__map?.getPitch())
await page.screenshot({ path: `${outDir}/4-after-reset.png`, clip })
console.log('after reset: bearing =', bearing, 'pitch =', pitch, 'transform:', await needleTransform())

await browser.close()
console.log('done →', outDir)
