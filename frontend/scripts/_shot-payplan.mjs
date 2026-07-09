/** 付款计划改版验证截图:分享页 /pp/:code + 详情页付款计划 tab(手机视口) */
import { chromium } from 'playwright'

const base = process.env.SHOT_URL || 'http://localhost:5174'
const code = process.argv[2] || 'gmrp38'
const projectId = process.argv[3] || '4879dabf-a25d-494d-bd42-e16287bf2adf'
const outDir = process.argv[4] || '.'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

// 1) 分享页(客户视角)
await page.goto(`${base}/pp/${code}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.screenshot({ path: `${outDir}/payplan-share.png`, fullPage: true })
console.log('saved payplan-share.png')

// 2) 详情页付款计划 tab(经纪视角)
await page.addInitScript(() => localStorage.setItem('pinzos-lang', 'zh-CN'))
await page.goto(`${base}/project/${projectId}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const tab = page.getByRole('tab', { name: /付款计划|Payment/i }).first()
await tab.click({ timeout: 10000 }).catch(async () => {
  await page.getByText(/付款计划|Payment Plan/i).first().click({ timeout: 5000 }).catch(() => {})
})
await page.waitForTimeout(2500)
await page.screenshot({ path: `${outDir}/payplan-tab.png`, fullPage: true })
console.log('saved payplan-tab.png')

await browser.close()
