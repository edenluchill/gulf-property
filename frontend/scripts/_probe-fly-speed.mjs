/**
 * 量 flyTo:(a) 观感速度是否与距离无关 (b) 各档 speed 下的实际时长。
 * 用法: node scripts/_probe-fly-speed.mjs
 *
 * 一致性只在**同一缩放级**的几段之间比(那才是「飞去哪个地方」这句话的意思:
 * 距离变了速度不该变)。跨缩放级的段单独看总时长,别混进一致性判据 ——
 * MapLibre 的路径长度是对数缩放口径,拿「1 级 = 1 屏」去换算本身就是错的,
 * 我第一版就是这么错的,得出「忽快忽慢」的假红灯。
 */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'http://localhost:5173/'
const SPEEDS = [0.6]

// 同为 z13,只有距离不同 —— 一致性就看这四段
const SAME_ZOOM = [
  { name: 'Marina→JBR     0.6km', from: [55.140, 25.080], to: [55.135, 25.077] },
  { name: 'Marina→JLT     2.5km', from: [55.140, 25.080], to: [55.145, 25.070] },
  { name: 'Marina→BizBay   17km', from: [55.140, 25.080], to: [55.263, 25.185] },
  { name: 'Marina→D.South  21km', from: [55.140, 25.080], to: [55.150, 24.895] },
]
// 跨缩放级,只看总时长会不会长到难受
const CROSS_ZOOM = { name: 'z16 Marina→z13 BizBay', from: [55.140, 25.080, 16], to: [55.263, 25.185, 13] }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.addInitScript(() => localStorage.setItem('pinzos-lang', 'en'))
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(11000)

const fly = (from, to, zFrom, zTo, speed) =>
  page.evaluate(async ({ from, to, zFrom, zTo, speed }) => {
    const map = window.__map
    map.jumpTo({ center: from, zoom: zFrom, pitch: 0, bearing: 0 })
    await new Promise((r) => setTimeout(r, 350))
    const p0 = map.project(from), p1 = map.project(to)
    const screens = Math.hypot(p1.x - p0.x, p1.y - p0.y) / map.getCanvas().clientWidth
    const t0 = performance.now()
    const done = new Promise((res) => map.once('moveend', () => res(performance.now() - t0)))
    map.flyTo({ center: to, zoom: zTo, pitch: 0, speed, curve: 1.42, essential: true })
    return { ms: Math.round(await done), screens: +screens.toFixed(2) }
  }, { from, to, zFrom, zTo, speed })

for (const speed of SPEEDS) {
  console.log(`\n════ speed = ${speed} ════`)
  console.log('段落'.padEnd(24), '用时ms', ' 屏数', '每屏ms')
  const per = []
  for (const h of SAME_ZOOM) {
    const r = await fly(h.from, h.to, 13, 13, speed)
    const ps = Math.round(r.ms / Math.max(r.screens, 0.01))
    if (r.screens > 0.2) per.push(ps)      // 极短的一跳被 MapLibre 短路成瞬移,不参与
    console.log(h.name.padEnd(26), String(r.ms).padStart(5), String(r.screens).padStart(6), String(ps).padStart(6))
    await page.waitForTimeout(300)
  }
  const cz = await fly(CROSS_ZOOM.from.slice(0, 2), CROSS_ZOOM.to.slice(0, 2), 16, 13, speed)
  console.log(CROSS_ZOOM.name.padEnd(26), String(cz.ms).padStart(5), '  (跨 3 级,只看总时长)')
  const spread = Math.max(...per) / Math.min(...per)
  console.log(`→ 同级各距离 每屏用时 ${Math.min(...per)}–${Math.max(...per)}ms,差 ${spread.toFixed(2)}× ${spread < 1.25 ? '✅' : '❌'}`)
  await page.waitForTimeout(400)
}

await browser.close()
