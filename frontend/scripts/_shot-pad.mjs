// iPad 视口验证：地图控制卡不重叠 + 指标标签常显 + 项目详情走 tablet 滚动布局。
// 用法: node scripts/_shot-pad.mjs <outPrefix> <width> <height> [projectPath]
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'pad'
const width = Number(process.argv[3] || 1180)
const height = Number(process.argv[4] || 820)
const projectPath = process.argv[5] || ''
const base = process.env.SHOT_URL || 'http://localhost:5174'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: true,
})
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('map-area-metric', 'none')
  localStorage.setItem('pinzos_market_segment', 'all')
})

await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)
await page.screenshot({ path: `${prefix}-map-${width}.png` })

if (projectPath) {
  await page.goto(base + projectPath, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  await page.screenshot({ path: `${prefix}-project-${width}.png` })
}
console.log('saved', prefix, width)
await browser.close()
