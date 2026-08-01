/**
 * Luna Tour —— **画面到底哪几秒是死的。**
 *
 * owner 反复说「还是经常有停顿，镜头不转」。之前我是靠猜:改一处、看一眼、觉得好像好了。
 * 这个脚本把它变成一张逐秒的表:每一秒相机在屏幕上走了多少像素、当前是哪一拍。
 * 连续多少秒低于阈值 = 一段「死画面」，直接列出来。
 *
 *   node scripts/tour-stillness.mjs [--code=p-xxx] [--dist=dist] [--secs=130]
 *
 * 判读:
 *   • < 2 px/s   —— 肉眼就是**静止**（❌ 死画面）
 *   • 2–8 px/s   —— 很慢但看得出在动（⚠️ 勉强）
 *   • > 8 px/s   —— 明确在动
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const arg = (k, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${k}=`))
  return h ? h.split('=').slice(1).join('=') : d
}
const CODE = arg('code', 'p-binghatti-aquarise')
const TOUR_URL = `https://www.pinzos.com/?toursession=${CODE}`
const DIST = arg('dist', '')
const SECS = Number(arg('secs', 130))
const W = 390

const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11'] })
const ctx = await browser.newContext({
  viewport: { width: W, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
await page.addInitScript((v) => {
  try {
    localStorage.setItem('app-visitor-id', v)
  } catch {
    /* ignore */
  }
}, arg('visitor', 'ce2a07df-7273-4992-af45-eda9d385f164'))
if (DIST) {
  const root = path.resolve(DIST)
  await page.route('https://www.pinzos.com/**', async (r) => {
    const rel = new URL(r.request().url()).pathname
    const f = path.join(root, rel === '/' ? '/index.html' : rel)
    if (path.extname(rel) && fs.existsSync(f)) return r.fulfill({ path: f })
    return r.fulfill({ path: path.join(root, 'index.html') })
  })
}

await page.goto(TOUR_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.locator('.lt-greet-btn').waitFor({ state: 'visible', timeout: 60000 })
await page.waitForTimeout(2500)
await page.locator('.lt-greet-btn').click()

/** 每 250ms 采一次相机 + 当前字幕/卡片，事后按秒聚合。 */
const samples = []
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < SECS) {
  const s = await page.evaluate(() => {
    const m = window.__pinzosMap
    if (!m) return null
    const c = m.getCenter()
    const poi = document.querySelector('.lt-poi-cat')
    const card = document.querySelector('.lt-ov-card .lt-card-name')
    const units = document.querySelector('.lt-ov-units')
    const title = document.querySelector('.lt-ov-title')
    return {
      lng: c.lng, lat: c.lat, z: m.getZoom(), b: m.getBearing(), p: m.getPitch(),
      beat: poi ? `周边:${poi.textContent}` : units ? '户型' : title ? '开场' : card ? '落地' : '—',
      done: !!document.querySelector('.lt-bigbtn'),
    }
  })
  if (s) samples.push({ t: (Date.now() - t0) / 1000, ...s })
  if (s?.done) break
  await page.waitForTimeout(250)
}
await browser.close()

/** 两个相机状态之间画面移动了多少像素（同 TimelineEngine 的 screenDistPx）。 */
function px(a, b) {
  const per = (256 * Math.pow(2, a.z)) / 360
  const cos = Math.max(0.1, Math.cos((a.lat * Math.PI) / 180))
  const pan = Math.hypot((b.lng - a.lng) * per, ((b.lat - a.lat) * per) / cos)
  const rot = (Math.abs(b.b - a.b) * Math.PI * (W / 2)) / 180
  const zoom = Math.abs(b.z - a.z) * (W / 2) * Math.LN2
  const tilt = (Math.abs(b.p - a.p) * Math.PI * (W / 2)) / 180
  return pan + rot + zoom + tilt
}

// 逐秒聚合
const perSec = []
for (let s = 0; s < Math.ceil(samples[samples.length - 1]?.t ?? 0); s++) {
  const win = samples.filter((x) => x.t >= s && x.t < s + 1)
  if (win.length < 2) continue
  let moved = 0
  for (let i = 1; i < win.length; i++) moved += px(win[i - 1], win[i])
  perSec.push({ s, moved, beat: win[win.length - 1].beat })
}

console.log(`\n  秒 | 移动px/s | 拍`)
let dead = []
const runs = []
for (const r of perSec) {
  const bar = '█'.repeat(Math.min(40, Math.round(r.moved / 2)))
  const flag = r.moved < 2 ? '❌' : r.moved < 8 ? '⚠️ ' : '  '
  console.log(`${String(r.s).padStart(4)} | ${r.moved.toFixed(1).padStart(8)} ${flag}| ${r.beat.padEnd(12)} ${bar}`)
  if (r.moved < 2) dead.push(r)
  else if (dead.length) { runs.push(dead); dead = [] }
}
if (dead.length) runs.push(dead)

console.log(`\n════ 死画面（连续 <2px/s）════`)
const bad = runs.filter((r) => r.length >= 2)
if (!bad.length) console.log('  ✅ 没有连续两秒以上不动的地方')
for (const r of bad) {
  console.log(`  ❌ ${r[0].s}s–${r[r.length - 1].s + 1}s（${r.length} 秒）  在「${r[0].beat}」`)
}
const slow = perSec.filter((r) => r.moved >= 2 && r.moved < 8).length
console.log(`\n总计 ${perSec.length} 秒:静止 ${perSec.filter((r) => r.moved < 2).length}s · 勉强 ${slow}s · 明确在动 ${perSec.filter((r) => r.moved >= 8).length}s`)
