/**
 * 相机深链(?v=)自动验证:
 *  1. 打开首页 → 拖动+滚轮缩放 → 停稳后 URL 应出现 ?v=zoom_lat_lng...
 *  2. 用一个指定的 ?v=(含 pitch/bearing)重新打开 → window.__map(DEV 句柄)
 *     的 zoom/center/pitch/bearing 应与参数一致(容差内)
 * 用法: node scripts/_verify-camera-url.mjs   (需 5174 前端 + 3000 后端)
 */
import { chromium } from 'playwright'

const BASE = process.env.SHOT_URL || 'http://localhost:5174'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures++
}

// ── 1. 移动地图 → URL 出现 ?v= ──────────────────────────────────────────────
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)

check('初始 URL 无 v 参数', !new URL(page.url()).searchParams.has('v'), page.url())

// 拖动 + 缩放
await page.mouse.move(700, 450)
await page.mouse.down()
await page.mouse.move(500, 350, { steps: 10 })
await page.mouse.up()
await page.mouse.wheel(0, -240)
await page.waitForTimeout(1200) // moveend debounce 150ms + 余量

const urlAfterMove = new URL(page.url())
const vParam = urlAfterMove.searchParams.get('v')
check('移动后 URL 带 v 参数', !!vParam, String(vParam))

const camNow = await page.evaluate(() => {
  const m = window.__map
  const c = m.getCenter()
  return { zoom: m.getZoom(), lat: c.lat, lng: c.lng }
})
if (vParam) {
  const [z, lat, lng] = vParam.split('_').map(Number)
  check('v 参数与实际相机一致',
    Math.abs(z - camNow.zoom) < 0.05 && Math.abs(lat - camNow.lat) < 0.001 && Math.abs(lng - camNow.lng) < 0.001,
    `v=${vParam} vs map=${camNow.zoom.toFixed(2)}/${camNow.lat.toFixed(5)}/${camNow.lng.toFixed(5)}`)
}

// ── 2. 带 ?v= 打开 → 相机恢复(含 pitch/bearing) ──────────────────────────
const page2 = await ctx.newPage()
const target = { zoom: 14, lat: 25.18, lng: 55.27, pitch: 60, bearing: -40 }
await page2.goto(`${BASE}/?v=14.00_25.18000_55.27000_60_-40`, { waitUntil: 'domcontentloaded' })
await page2.waitForTimeout(9000)
const cam2 = await page2.evaluate(() => {
  const m = window.__map
  const c = m.getCenter()
  return { zoom: m.getZoom(), lat: c.lat, lng: c.lng, pitch: m.getPitch(), bearing: m.getBearing() }
})
check('深链恢复 zoom/center',
  Math.abs(cam2.zoom - target.zoom) < 0.05 && Math.abs(cam2.lat - target.lat) < 0.001 && Math.abs(cam2.lng - target.lng) < 0.001,
  JSON.stringify(cam2))
check('深链恢复 pitch/bearing',
  Math.abs(cam2.pitch - target.pitch) < 1 && Math.abs(cam2.bearing - target.bearing) < 1,
  `pitch=${cam2.pitch} bearing=${cam2.bearing}`)

// 3D 按钮状态应显示「平视」(= 已处于 3D)
const btn3d = await page2.locator('button[aria-label="切换 3D 倾斜视角"]').textContent()
check('3D 按钮状态与深链俯角一致', (btn3d || '').includes('平视'), `btn=${btn3d}`)

// ── 3. 脏参数不炸:回默认视角 ───────────────────────────────────────────────
const page3 = await ctx.newPage()
await page3.goto(`${BASE}/?v=99_999_999`, { waitUntil: 'domcontentloaded' })
await page3.waitForTimeout(9000)
const cam3 = await page3.evaluate(() => {
  const m = window.__map
  const c = m.getCenter()
  return { zoom: m.getZoom(), lat: c.lat, lng: c.lng }
})
check('脏 v 参数回默认视角', Math.abs(cam3.zoom - 10.115) < 0.2 && Math.abs(cam3.lat - 25.019) < 0.05, JSON.stringify(cam3))

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
