/** 更新历史页视觉验收:中英 × 手机/桌面。 */
import { chromium } from 'playwright'
import fs from 'fs'
const OUT = 'shots-changelog'; fs.mkdirSync(OUT, { recursive: true })
const FE = process.env.FE || 'http://localhost:5174'
const browser = await chromium.launch()
let fail = 0
for (const [lang, vp] of [['zh-CN', { width: 390, height: 900 }], ['en', { width: 1280, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0, 140)); fail++ })
  await page.addInitScript((l) => localStorage.setItem('pinzos-lang', l), lang)
  await page.goto(`${FE}/changelog`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  const txt = await page.evaluate(() => document.body.innerText)
  const ok = txt.length > 300 && /2026/.test(txt)
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${lang} ${vp.width}px — ${txt.replace(/\s+/g, ' ').slice(0, 70)}`)
  if (!ok) fail++
  await page.screenshot({ path: `${OUT}/${lang}-${vp.width}.png`, fullPage: true })
  await ctx.close()
}
await browser.close()
console.log(fail === 0 ? `\n✅ 通过,截图在 ${OUT}/` : `\n❌ ${fail} 项未通过`)
process.exit(fail === 0 ? 0 : 1)
