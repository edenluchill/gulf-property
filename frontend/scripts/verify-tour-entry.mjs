import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
const PROD = process.argv.includes('--prod')  // 打线上;不带就用本地 dist
const root = path.resolve('dist')
const b = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] })
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' })
const p = await ctx.newPage()
await p.addInitScript(v => { try { localStorage.setItem('app-visitor-id', v) } catch {} }, 'ce2a07df-7273-4992-af45-eda9d385f164')
if (!PROD) await p.route('https://www.pinzos.com/**', async r => {
  const rel = new URL(r.request().url()).pathname
  const f = path.join(root, rel === '/' ? '/index.html' : rel)
  if (path.extname(rel) && fs.existsSync(f)) return r.fulfill({ path: f })
  return r.fulfill({ path: path.join(root, 'index.html') })
})
// 关键验收:?toursession= 的请求要带 X-Share-Code(否则匿名客户看一场就烧掉地图额度)
const api = []   // {path, hdr, onTourUrl}
p.on('request', r => {
  if (!r.url().includes('api.pinzos.com')) return
  api.push({ path: new URL(r.url()).pathname, hdr: !!r.headers()['x-share-code'], onTour: p.url().includes('toursession') })
})
let q429 = 0
p.on('response', r => { if (r.status() === 429) q429++ })

await p.goto('https://www.pinzos.com/tours', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForSelector('a[href*="toursession"]', { timeout: 30000 })
console.log('① /tours 列出了导览卡  ✅')
await p.click('a[href*="toursession"]')
await p.waitForTimeout(1500)
console.log('② 点卡片后 URL =', new URL(p.url()).search)
await p.waitForSelector('.lt-greet-btn', { timeout: 60000 })
console.log('③ 欢迎页出现（导览加载成功） ✅')
await p.locator('.lt-greet-btn').click()
await p.waitForTimeout(6000)
const state = await p.evaluate(() => ({
  playing: !!document.querySelector('.lt-subtitle, .lt-ov-card, .lt-chapters'),
  zoom: window.__pinzosMap ? +window.__pinzosMap.getZoom().toFixed(2) : null,
}))
console.log('④ 开始播放:', state.playing ? '✅' : '❌', ' 地图 zoom =', state.zoom)
// 只有这些前缀被 mapMeter 计量(见 backend/src/index.ts)。
// /api/luna/public/* 不计量,所以它的 /event(sendBeacon,带不了自定义头)和 /img 不算问题。
const METERED = ['/api/dubai', '/api/dubai-pois', '/api/residential-projects', '/api/transport', '/api/custom-routes', '/api/market']
const onTour = api.filter(x => x.onTour && METERED.some(m => x.path.startsWith(m)))
const withHdr = onTour.filter(x => x.hdr)
console.log(`⑤ 在 ?toursession= 页面上的**计量**请求 ${onTour.length} 个，带 X-Share-Code 的 ${withHdr.length} 个 ` +
  (onTour.length && withHdr.length === onTour.length ? '✅ 全部豁免' : '❌ 有请求会烧额度'))
for (const x of onTour.filter(x => !x.hdr)) console.log('     ✗ 无豁免头:', x.path)
console.log('⑥ 429（额度用尽）:', q429 === 0 ? '0 ✅' : q429 + ' ❌')
await p.screenshot({ path: 'scripts/_tours-shots/phone-playing.png' })
await b.close()
