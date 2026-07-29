/**
 * 周期 popover + Header 短标题的三档验证。
 * 用法: node scripts/_shot-period-pop.mjs [outDir]
 *
 * 盯两件事:
 *  1. popover 有没有压到左侧筛选栏 —— 用 boundingBox 直接算重叠,不靠肉眼
 *  2. header 的「更新历史」按钮有没有把 logo 挤到换行
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const outDir = process.argv[2] || 'shots-period'
const url = process.env.SHOT_URL || 'http://localhost:5173/'
mkdirSync(outDir, { recursive: true })

const VIEWPORTS = [
  { name: '367', width: 367, height: 762, mobile: true },   // owner 截图那档
  { name: '414', width: 414, height: 896, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
]

const browser = await chromium.launch()
let fails = 0

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2, hasTouch: vp.mobile, isMobile: vp.mobile,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[pageerror ${vp.name}]`, String(e).slice(0, 200)))
  await page.addInitScript(() => {
    localStorage.setItem('pinzos-lang', 'en')
    localStorage.setItem('map-area-metric', 'rentalYield')
    localStorage.setItem('metric-period', '6m')     // 短周期 → 顺带看那条告警
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(11000)

  await page.screenshot({ path: `${outDir}/${vp.name}-0-header.png`, clip: { x: 0, y: 0, width: vp.width, height: 120 } })

  const trigger = page.locator('[data-testid="map-mobile-controls"] button:has-text("▾")').first()
  if (!(await trigger.count())) { console.log(`${vp.name}: ❌ 找不到周期入口`); fails++; await ctx.close(); continue }
  await trigger.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${outDir}/${vp.name}-1-period-open.png` })

  // 重叠判据:popover 的左边缘必须在左侧筛选栏的右边缘之外
  const geo = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="map-mobile-controls"]')
    const pop = card?.querySelector(':scope > div:last-child')
    // 左上那摞(筛选 chips / 指北针)
    const rail = document.querySelector('.absolute.top-3.start-2, .absolute.top-4.start-4')
      || document.querySelectorAll('[class*="start-2"], [class*="start-4"]')[0]
    const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) } : null }
    return { pop: r(pop), rail: r(rail), vw: innerWidth }
  })
  const ok = geo.pop && geo.rail && geo.pop.l >= geo.rail.r
  if (!ok) fails++
  console.log(`${vp.name}: popover x=[${geo.pop?.l},${geo.pop?.r}] 高${geo.pop?.h}  左栏右缘=${geo.rail?.r}  ${ok ? '✅ 不重叠' : '❌ 压住左栏'}`)

  await ctx.close()
}
await browser.close()
console.log(fails === 0 ? '\n✅ 全过' : `\n❌ ${fails} 处失败`)
process.exit(fails === 0 ? 0 : 1)
