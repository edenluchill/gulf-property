/** 验证 feature-state hover:悬停区域时 fill 变深 + 无控制台报错 + 横扫无长任务 */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'http://localhost:5174/'
const outDir = process.argv[2] || '.'
const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 850 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'vector')
  window.__longtasks = []
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push(e.duration | 0) })
    .observe({ entryTypes: ['longtask'] })
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(13000)

// hover 前后截图对比(悬停一个大区域中心)
await page.mouse.move(300, 700) // 海上,无区域
await page.waitForTimeout(600)
await page.screenshot({ path: `${outDir}/hover-off.png`, clip: { x: 600, y: 300, width: 500, height: 400 } })
await page.mouse.move(850, 500) // 城区某区域
await page.waitForTimeout(600)
await page.screenshot({ path: `${outDir}/hover-on.png`, clip: { x: 600, y: 300, width: 500, height: 400 } })

// 横扫压力:2 秒内扫过几十个区域边界
await page.evaluate(() => { window.__longtasks.length = 0 })
for (let r = 0; r < 4; r++) {
  for (let x = 350; x <= 1350; x += 25) {
    await page.mouse.move(x, 380 + r * 60)
    await page.waitForTimeout(8)
  }
}
const longtasks = await page.evaluate(() => window.__longtasks)
console.log('sweep longtasks(ms):', longtasks.filter((d) => d >= 50).join(' ') || '(none)', '| max:', Math.max(0, ...longtasks))
console.log('console errors:', errors.length ? errors.slice(0, 5) : '(none)')
await browser.close()
