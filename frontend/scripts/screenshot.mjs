/**
 * 地图页截图工具（视觉验证用）
 * 用法: node scripts/screenshot.mjs <out.png> [lang] [metric] [wheelSteps] [clip]
 *   lang:       zh-CN | en             (默认 zh-CN)
 *   metric:     none | medianUnitPrice | medianPriceSqft | capitalGrowth | transactionCount | rentalYield
 *   wheelSteps: 正数=放大 N 档(每档一次滚轮), 0=不动 (默认 0)
 *   clip:       x,y,w,h 截取区域（CSS 像素），默认全屏
 * 输出按 deviceScaleFactor=2 渲染，方便看清标签细节。
 */
import { chromium } from 'playwright'

const out = process.argv[2] || 'shot.png'
const lang = process.argv[3] || 'zh-CN'
const metric = process.argv[4] || 'none'
const wheelSteps = Number(process.argv[5] || 0)
const clipArg = process.argv[6] || ''
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.addInitScript(([lang, metric]) => {
  localStorage.setItem('pinzos-lang', lang)
  localStorage.setItem('map-area-metric', metric)
  localStorage.setItem('map-base', 'satellite')
}, [lang, metric])

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)

if (wheelSteps !== 0) {
  await page.mouse.move(750, 440)
  for (let i = 0; i < Math.abs(wheelSteps); i++) {
    await page.mouse.wheel(0, wheelSteps > 0 ? -240 : 240)
    await page.waitForTimeout(900)
  }
  await page.waitForTimeout(3500) // 等瓦片+符号重排
}

let clip
if (clipArg) {
  const [x, y, w, h] = clipArg.split(',').map(Number)
  clip = { x, y, width: w, height: h }
}
await page.screenshot({ path: out, clip })
await browser.close()
console.log('saved:', out)
