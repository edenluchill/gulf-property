// 付款计划 tab 截图（含 hover 图表出 tooltip）。
// 用法: MSYS_NO_PATHCONV=1 node scripts/_shot-payment.mjs <outPrefix> <projectId> [width]
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'pay'
const pid = process.argv[3]
const width = Number(process.argv[4] || 834)
const base = process.env.SHOT_URL || 'http://localhost:5174'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height: 1100 }, deviceScaleFactor: 2, hasTouch: true })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN') })
await page.goto(`${base}/project/${pid}?tab=payment`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(7000)
await page.screenshot({ path: `${prefix}-payment-${width}.png`, fullPage: false })

// hover 图表第 3 个里程碑命中区
const svg = page.locator('svg[aria-label*="付款时间线"]').first()
const box = await svg.boundingBox()
if (box) {
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${prefix}-payment-hover-${width}.png` })
}
console.log('saved payment shots')
await browser.close()
