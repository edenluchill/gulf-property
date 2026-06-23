/**
 * 移动端地图页截图（验证移动布局 / 指标渲染）。桌面版见 screenshot.mjs。
 * 用法: node scripts/screenshot-mobile.mjs <out.png> [lang] [metric] [device]
 *   SHOT_URL=https://www.pinzos.com node scripts/screenshot-mobile.mjs prod.png zh-CN netYield "iPhone SE"
 *   lang:   zh-CN | en          (默认 zh-CN)
 *   metric: none | netYield | rentalYield | ...（写入 localStorage map-area-metric）
 *   device: 任一 playwright 设备名（默认 iPhone 13；用户最窄屏用 "iPhone SE" = 375）
 */
import { chromium, devices } from 'playwright'

const out = process.argv[2] || 'shot-mobile.png'
const lang = process.argv[3] || 'zh-CN'
const metric = process.argv[4] || 'none'
const device = process.argv[5] || 'iPhone 13'
const url = process.env.SHOT_URL || 'http://localhost:5174/'

const browser = await chromium.launch()
const ctx = await browser.newContext({ ...(devices[device] || devices['iPhone 13']) })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.addInitScript(([lang, metric]) => {
  localStorage.setItem('pinzos-lang', lang)
  localStorage.setItem('map-area-metric', metric)
  localStorage.setItem('map-base', 'satellite')
}, [lang, metric])

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)
const clipArg = process.env.SHOT_CLIP // "x,y,w,h" in CSS px, optional
let clip
if (clipArg) { const [x, y, w, h] = clipArg.split(',').map(Number); clip = { x, y, width: w, height: h } }
await page.screenshot({ path: out, clip })
await browser.close()
console.log('saved:', out)
