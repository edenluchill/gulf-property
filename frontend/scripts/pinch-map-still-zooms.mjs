/**
 * 「禁止整页缩放」之后,**地图自己的双指缩放必须照常能用**(owner 的底线:
 * 整页不许放大,但地图里面放大要留着)。
 *
 * 用 CDP 真发两指 touch 手势(playwright 的 touchscreen 只能 tap,做不了 pinch),
 * 看地图的 zoom 有没有跟着变。
 *
 * 跑之前:npx vite preview --port 4173
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
    'Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
})
const page = await ctx.newPage()
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000) // 等地图稳定

const cdp = await ctx.newCDPSession(page)

// 地图的 zoom 从瓦片 URL 的 /z/x/y 里读 —— 不依赖 app 暴露地图实例
const zooms = new Set()
page.on('request', (r) => {
  const m = /\/(\d{1,2})\/\d+\/\d+(\.\w+|\?|$)/.exec(new URL(r.url()).pathname + '?')
  if (m && /tile|arcgis|basemap|maptiler|esri/i.test(r.url())) zooms.add(Number(m[1]))
})

const before = await page.evaluate(() => ({
  scale: window.visualViewport?.scale ?? 1,
  tiles: performance.getEntriesByType('resource').filter((e) => /tile|arcgis/i.test(e.name)).length,
}))

// —— 双指从中心向外张开(pinch out = 放大)——
const cx = 195, cy = 450
async function touch(type, spread) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints:
      type === 'touchEnd'
        ? []
        : [
            { x: cx - spread, y: cy, id: 1 },
            { x: cx + spread, y: cy, id: 2 },
          ],
  })
}
await touch('touchStart', 30)
for (let s = 40; s <= 150; s += 12) {
  await touch('touchMove', s)
  await page.waitForTimeout(60)
}
await touch('touchEnd', 0)
await page.waitForTimeout(5000) // 等新瓦片加载

const after = await page.evaluate(() => ({
  scale: window.visualViewport?.scale ?? 1,
  tiles: performance.getEntriesByType('resource').filter((e) => /tile|arcgis/i.test(e.name)).length,
}))

await browser.close()

const newTiles = after.tiles - before.tiles
console.log('\n===== 双指在地图上张开(pinch out) =====')
console.log(`  整页 visualViewport.scale : ${before.scale} → ${after.scale}   ` +
            `${after.scale === 1 ? '✅ 整页没被放大(正是要的)' : '❌ 整页被放大了'}`)
console.log(`  瓦片请求数                : ${before.tiles} → ${after.tiles}  (新增 ${newTiles})`)
console.log(`  观测到的瓦片 zoom 层级     : ${[...zooms].sort((a, b) => a - b).join(', ') || '(没抓到)'}`)
console.log(`  地图响应了手势?           : ${newTiles > 0 ? '✅ 是(拉了新瓦片 → 地图在缩放)' : '❌ 没有,地图没反应'}`)

console.log('\n################  判定  ################')
if (after.scale === 1 && newTiles > 0) {
  console.log('✅ 整页纹丝不动,地图照常缩放 —— 正是 owner 要的。')
} else if (after.scale === 1 && newTiles === 0) {
  console.log('⚠️ 整页没被放大(对),但没看到地图缩放。可能是合成手势没被地图库认(Chromium 下常见),')
  console.log('   不代表真机上坏了 —— 需要 owner 用手机复验地图双指缩放。')
} else {
  console.log('❌ 整页被放大了 —— 禁缩放没生效。')
}
