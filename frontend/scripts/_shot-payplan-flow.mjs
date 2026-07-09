/** 端到端:详情页选户型→改价→生成分享→打开客户页 */
import { chromium } from 'playwright'

const base = process.env.SHOT_URL || 'http://localhost:5174'
const projectId = process.argv[2] || '4879dabf-a25d-494d-bd42-e16287bf2adf'
const outDir = process.argv[3] || '.'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.addInitScript(() => localStorage.setItem('pinzos-lang', 'zh-CN'))

await page.goto(`${base}/project/${projectId}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
await page.getByRole('tab', { name: /付款计划|Payment/i }).first().click()
await page.waitForTimeout(1500)

// 选 2 居
await page.getByRole('button', { name: /^2 居/ }).first().click()
await page.waitForTimeout(500)

// 改成实际报价 2,888,000
const input = page.locator('input[inputmode="numeric"]').first()
await input.click()
await input.fill('2888000')
await page.waitForTimeout(500)

// 生成分享链接
await page.getByRole('button', { name: /生成分享链接|Create share link/ }).click()
await page.waitForTimeout(3000)
const link = await page.locator('a[href*="/pp/"]').first().getAttribute('href')
console.log('share link:', link)

// 截分享区块
const shareBox = page.locator('a[href*="/pp/"]').first()
await shareBox.scrollIntoViewIfNeeded()
await page.screenshot({ path: `${outDir}/payplan-flow-agent.png` })

// 打开客户页
await page.goto(link, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.screenshot({ path: `${outDir}/payplan-flow-client.png`, fullPage: true })
console.log('done')
await browser.close()
