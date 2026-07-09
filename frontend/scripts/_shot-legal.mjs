// Screenshot /privacy and /terms (zh + en) from vite preview
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:4173'
const OUT = process.env.OUT || '.'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1180, height: 900 } })

for (const [path, name] of [['/privacy', 'privacy'], ['/terms', 'terms']]) {
  for (const lang of ['zh-CN', 'en']) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.evaluate((l) => localStorage.setItem('pinzos-lang', l), lang)
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${OUT}/${name}-${lang}.png`, fullPage: true })
    console.log(`saved ${name}-${lang}.png`)
  }
}
await browser.close()

