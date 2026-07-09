/** 验证 header 内 absolute 下拉不再被收纳行的 overflow-hidden 裁掉 */
import { chromium } from 'playwright'

const base = process.env.SHOT_URL || 'http://localhost:5174'
const outDir = process.argv[2] || '.'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.addInitScript(() => localStorage.setItem('pinzos-lang', 'zh-CN'))

await page.goto(base, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(8000)

// 点语言切换(header 里的 absolute 下拉,与管理下拉同受 overflow 影响)
const lang = page.locator('header button', { hasText: /中|EN/ }).last()
await lang.click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${outDir}/header-dropdown.png`, clip: { x: 700, y: 0, width: 800, height: 400 } })
console.log('saved header-dropdown.png')
await browser.close()
