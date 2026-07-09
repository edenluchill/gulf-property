// pad 验证:More Details 信息面板不被底部导航压 + 点图进 Lightbox。
// 用法: MSYS_NO_PATHCONV=1 node scripts/_shot-sheet-lightbox.mjs <outPrefix> <projectId>
import { chromium } from 'playwright'

const prefix = process.argv[2] || 'sheet'
const pid = process.argv[3]
const base = process.env.SHOT_URL || 'http://localhost:5174'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN') })
await page.goto(`${base}/project/${pid}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(7000)

// 打开 More Details 信息面板
const more = page.getByText('More Details').first()
if (await more.count()) {
  await more.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${prefix}-info-sheet.png` })
  // 关闭
  await page.keyboard.press('Escape').catch(() => {})
  await page.mouse.click(590, 100)
  await page.waitForTimeout(800)
}

// 点第一张图进 Lightbox
const img = page.locator('img[alt*=" - 1"]').first()
if (await img.count()) {
  await img.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${prefix}-lightbox.png` })
}
console.log('saved sheet/lightbox shots')
await browser.close()
