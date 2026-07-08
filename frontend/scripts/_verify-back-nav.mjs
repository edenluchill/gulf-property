/** 点 pin → 详情页 → 返回:相机不丢 + URL 仍带 v(临时验证脚本) */
import { chromium } from 'playwright'
// 用真实项目坐标当深链中心,保证视口里有 pin
const pins = (await (await fetch('http://127.0.0.1:3000/api/residential-projects/map-pins')).json()).data
const p = pins.find(x => x.minPrice && x.status !== 'sold-out')
const V = `14.00_${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`
console.log('target pin:', p.name, V)
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 850 } })).newPage()
await page.goto(`http://localhost:5174/?v=${V}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)
const markers = page.locator('.maplibregl-marker')
const n = await markers.count()
let clicked = false
for (let i = 0; i < n; i++) {
  const box = await markers.nth(i).boundingBox()
  // 泪滴中心在视口中央附近的那个(深链中心=项目坐标,pin 就在屏幕中间)
  if (box && Math.abs(box.x + box.width / 2 - 700) < 80 && Math.abs(box.y + box.height / 2 - 425) < 80) {
    await markers.nth(i).click({ position: { x: box.width / 2, y: 20 } })
    clicked = true
    break
  }
}
await page.waitForTimeout(2500)
const onDetail = new URL(page.url()).pathname.startsWith('/project/')
console.log(onDetail ? 'PASS' : 'FAIL', `点 pin 进详情页(clicked=${clicked}) —`, page.url())
await page.goBack()
await page.waitForTimeout(2000)
const u = new URL(page.url())
const cam = await page.evaluate(() => {
  const m = window.__map; const c = m.getCenter()
  return { zoom: m.getZoom(), lat: c.lat, lng: c.lng }
})
const vOk = u.searchParams.get('v') === V
const camOk = Math.abs(cam.zoom - 14) < 0.05 && Math.abs(cam.lat - p.lat) < 0.001
console.log(vOk ? 'PASS' : 'FAIL', '返回后 URL 仍带原 v —', u.search)
console.log(camOk ? 'PASS' : 'FAIL', '返回后相机不丢 —', JSON.stringify(cam))
await browser.close()
process.exit(vOk && camOk && onDetail ? 0 : 1)
