/**
 * 手机版口径筛选器视觉验证：iPhone 视口加载地图，截默认态 → 点「期房」→ 再截，
 * 然后点一个区域打开底部 sheet 截图。
 * 用法: node scripts/_shot-mobile-segment.mjs <outPrefix>
 */
import { chromium, devices } from 'playwright'

const prefix = process.argv[2] || 'mob'
const url = 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  locale: 'zh-CN',
})
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-area-metric', 'medianUnitPrice')
  localStorage.setItem('pinzos_market_segment', 'all')
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)
await page.screenshot({ path: `${prefix}-1-default.png` })

// 点移动端控制卡里的「期房」
const controls = page.getByTestId('map-mobile-controls')
await controls.getByRole('button', { name: '期房', exact: true }).click()
await page.waitForTimeout(6000)
await page.screenshot({ path: `${prefix}-2-offplan.png` })

// 点地图中部尝试打开区域底部 sheet（best effort）
await page.mouse.click(195, 420)
await page.waitForTimeout(5000)
await page.screenshot({ path: `${prefix}-3-sheet.png` })

console.log('saved 3 shots with prefix', prefix)
await browser.close()
