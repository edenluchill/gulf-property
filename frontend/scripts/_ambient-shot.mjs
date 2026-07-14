import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, args: ['--disable-web-security'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true })).newPage()
await p.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForTimeout(2500)
await (await p.$('.lt-greet-btn')).click()
await p.waitForTimeout(5000)
// 暂停 tour（点画面）→ 引擎停手，相机才归我
await p.mouse.click(640, 400)
await p.waitForTimeout(1200)
// 看向海面
// 飞到其中一条船跟前
const boat = await p.evaluate(() => {
  const fs = window.__pinzosMap.querySourceFeatures('lt-ambient-src') || []
  const b = fs.find(f => String(f.properties?.icon || '').includes('boat'))
  return b ? b.geometry.coordinates : null
})
console.log('对准一条船:', boat)
await p.evaluate((c) => window.__pinzosMap.jumpTo({ center: c, zoom: 13.5, pitch: 0, bearing: 0 }), boat)
await p.waitForTimeout(3500)
const n = await p.evaluate(() => (window.__pinzosMap.querySourceFeatures('lt-ambient-src') || []).length)
console.log(`画面内氛围要素: ${n}`)
await p.screenshot({ path: 'scripts/_ambient.png' })
await b.close()
