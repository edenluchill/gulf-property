/**
 * Verify the new "交房/Handover" year filter renders correctly.
 *  - Desktop: open the Handover chip popover.
 *  - Mobile: open the filter bottom sheet, scroll to the Handover section.
 * Usage: node scripts/_handover-verify.mjs [lang]
 */
import { chromium } from 'playwright'

const lang = process.argv[2] || 'zh-CN'
const url = 'http://localhost:5174/'
const browser = await chromium.launch()

async function prep(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
  await page.addInitScript((lang) => {
    localStorage.setItem('pinzos-lang', lang)
    localStorage.setItem('map-base', 'streets')
  }, lang)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(9000)
  return page
}

// ---- Desktop ----
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
  const page = await prep(ctx)
  // Handover chip: match by text 交房 / Handover
  const label = lang === 'en' ? 'Handover' : '交房'
  const chip = page.locator(`button:has-text("${label}")`).first()
  if (await chip.count()) {
    await chip.click()
    await page.waitForTimeout(600)
    console.log('desktop: clicked handover chip')
  } else {
    console.log('desktop: handover chip NOT FOUND')
  }
  await page.screenshot({ path: `scripts/_out-handover-desktop-${lang}.png`, clip: { x: 0, y: 0, width: 760, height: 420 } })
  await ctx.close()
}

// ---- Mobile ----
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  const page = await prep(ctx)
  const filterBtn = page.locator(`button:has-text("${lang === 'en' ? 'Filter' : '筛选'}"):visible`).first()
  if (await filterBtn.count()) {
    await filterBtn.click()
    await page.waitForTimeout(700)
    console.log('mobile: opened filter sheet')
    // scroll within the sheet so the Handover section (4th) comes into view
    const label = lang === 'en' ? 'Handover' : '交房'
    const sec = page.getByRole('heading', { name: label }).or(page.locator('section', { hasText: label })).first()
    try { await sec.scrollIntoViewIfNeeded({ timeout: 3000 }) } catch {
      await page.mouse.move(195, 500)
      await page.mouse.wheel(0, 500)
    }
    await page.waitForTimeout(500)
  } else {
    console.log('mobile: filter button NOT FOUND')
  }
  await page.screenshot({ path: `scripts/_out-handover-mobile-${lang}.png` })
  await ctx.close()
}

await browser.close()
console.log('done')
