// 手机模拟参数下的 zoom 帧间隔测量：对比 dsf=1 vs dsf=3（DevTools 手机模拟的差别）。
// 用法: HEADED=1 SHOT_URL=https://pinzos.com node scripts/_zoom-frames-mobile.mjs <dsf>
import { chromium } from 'playwright'

const dsf = Number(process.argv[2] || 3)
const url = process.env.SHOT_URL || 'https://pinzos.com'

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: dsf,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('map-area-metric', 'capitalGrowth')
  localStorage.setItem('map-poi-categories', '["school"]')
})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(14000)

// 记录 zoom 手势期间的 rAF 帧间隔
await page.evaluate(() => {
  const w = window
  w.__frames = []
  let last = performance.now()
  const loop = (t) => { w.__frames.push(t - last); last = t; w.__rafId = requestAnimationFrame(loop) }
  w.__rafId = requestAnimationFrame(loop)
})
await page.mouse.move(215, 460)
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(400) }
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(400) }
await page.waitForTimeout(1000)

const frames = await page.evaluate(() => { cancelAnimationFrame(window.__rafId); return window.__frames })
const sorted = [...frames].sort((a, b) => a - b)
const q = (p) => sorted[Math.floor(sorted.length * p)]
const long = frames.filter(f => f > 100).length
console.log(`dsf=${dsf} frames=${frames.length} p50=${q(0.5).toFixed(0)}ms p95=${q(0.95).toFixed(0)}ms p99=${q(0.99).toFixed(0)}ms max=${Math.max(...frames).toFixed(0)}ms >100ms帧=${long}`)
await browser.close()
