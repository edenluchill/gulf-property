/**
 * 口径筛选器视觉验证：加载地图（可预设口径），截图右上控制区 + 点开一个区域弹窗。
 * 用法: node shot-segment.mjs <out.png> <segment:all|offplan|ready> [clickSegment]
 *   clickSegment: 可选，加载后点击切换到该口径（验证切换联动）
 */
import { chromium } from 'playwright'

const out = process.argv[2] || 'seg.png'
const preset = process.argv[3] || 'all'
const clickSeg = process.argv[4] || ''
const url = 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

await page.addInitScript(([seg]) => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-area-metric', 'medianUnitPrice')
  localStorage.setItem('pinzos_market_segment', seg)
}, [preset])

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)

if (clickSeg) {
  const label = clickSeg === 'offplan' ? '期房' : clickSeg === 'ready' ? '现房' : '全部'
  const panel = page.getByTestId('map-metric-panel')
  await panel.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(5000) // 拉新口径 payload + 重绘标签
}

await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
