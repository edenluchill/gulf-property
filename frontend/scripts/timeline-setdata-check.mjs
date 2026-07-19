/**
 * 时间轴的**核心架构断言**:切年不能触发 areas source 的 setData。
 *
 *   node scripts/_timeline-setdata-check.mjs
 *
 * 时间轴「不卡」的全部本钱就是这一条:所有年份的颜色/文案在加载时一次烤进
 * feature properties,切年只改 paint/layout 表达式的 key(O(1))。一旦有人把
 * timeline.year 加回 useMemo 的依赖数组,就会退化成每格重传 200+ 个多边形。
 *
 * 帧耗时在 headless 软件 GL 里噪声极大(空闲基线就 40-60ms),量不出这个回归 ——
 * 数 setData 调用次数才是确定性的。
 */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-area-metric', 'none')
  localStorage.setItem('map-base', 'satellite')
})
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(14000)

await page.locator('[title="时间轴"]').first().click()
await page.waitForTimeout(4000)

// 装探针:把 areas source 的 setData 包一层计数
const armed = await page.evaluate(() => {
  const m = window.__mapInstance
  if (!m) return { ok: false, why: '拿不到 __mapInstance(DEV 钩子没生效?)' }
  const src = m.getSource('areas')
  const lbl = m.getSource('area-labels')
  if (!src) return { ok: false, why: '没有 areas source' }
  window.__setDataCalls = { areas: 0, labels: 0 }
  const wrap = (s, key) => {
    const orig = s.setData.bind(s)
    s.setData = (d) => { window.__setDataCalls[key]++; return orig(d) }
  }
  wrap(src, 'areas')
  if (lbl) wrap(lbl, 'labels')
  return { ok: true, features: (src._data?.features || []).length }
})
if (!armed.ok) { console.log('❌ 探针装不上:', armed.why); await browser.close(); process.exit(1) }
console.log(`探针就位 · areas source 有 ${armed.features} 个多边形`)

// 逐年点一遍
const yearBtns = page.locator('button').filter({ hasText: /^20\d\d\*?$/ })
const n = await yearBtns.count()
for (let i = 0; i < n; i++) {
  await yearBtns.nth(i).click()
  await page.waitForTimeout(400)
}
// 等标签防抖落定
await page.waitForTimeout(600)

const calls = await page.evaluate(() => window.__setDataCalls)
console.log(`点了 ${n} 个年份 → setData 调用: areas=${calls.areas} labels=${calls.labels}`)
if (calls.areas === 0 && calls.labels === 0) {
  console.log('✅ 零 setData —— 切年确实只走 paint/layout 表达式，架构成立')
} else {
  console.log('❌ 切年触发了 setData —— 有人把 year 加回 useMemo 依赖了，会随区域数线性变卡')
  process.exitCode = 1
}

// 顺带确认 paint 表达式确实跟着年份换了 key(否则「零 setData」可能只是压根没生效)
const expr = await page.evaluate(() => JSON.stringify(
  window.__mapInstance.getPaintProperty('area-fills', 'fill-color')))
console.log('当前 fill-color 表达式:', expr)

await browser.close()
