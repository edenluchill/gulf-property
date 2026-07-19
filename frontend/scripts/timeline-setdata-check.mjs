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
 *
 * ⚠️ 查图层内容一律用 queryRenderedFeatures(地面真相),**别读 source._data** ——
 * 这个 maplibre 版本里 _data 不跟着更新,恒为空。2026-07-19 我照它排查了半天
 * 「区域一个都没渲染」,实际上 199 个多边形一直好好地画着。
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

await page.locator('[aria-label="时间轴"]').first().click()
await page.waitForTimeout(4000)

// 装探针:把 areas source 的 setData 包一层计数
const armed = await page.evaluate(() => {
  const m = window.__mapInstance
  if (!m) return { ok: false, why: '拿不到 __mapInstance(DEV 钩子没生效?)' }
  const src = m.getSource('areas')
  const lbl = m.getSource('area-labels')
  if (!src) return { ok: false, why: '没有 areas source' }
  const rendered = m.queryRenderedFeatures({ layers: ['area-fills'] }).length
  if (!rendered) return { ok: false, why: '地图上一个区域多边形都没渲染' }
  window.__setDataCalls = { areas: 0, labels: 0 }
  const wrap = (s, key) => {
    const orig = s.setData.bind(s)
    s.setData = (d) => { window.__setDataCalls[key]++; return orig(d) }
  }
  wrap(src, 'areas')
  if (lbl) wrap(lbl, 'labels')
  return { ok: true, features: rendered }
})
if (!armed.ok) { console.log('❌ 探针装不上:', armed.why); await browser.close(); process.exit(1) }
console.log(`探针就位 · 地图上渲染了 ${armed.features} 个区域多边形`)

// 拖动条从头拉到尾(模拟真实拖动:连续多帧)
const slider = page.locator('input[type=range]').first()
const n = await slider.count() ? Number(await slider.getAttribute('max')) + 1 : 0
if (!n) { console.log('❌ 找不到时间轴拖动条'); await browser.close(); process.exit(1) }
await slider.focus()
let steps = 0
for (let i = 0; i < Math.min(n - 1, 40); i++) { await page.keyboard.press('ArrowRight'); steps++ }
await page.waitForTimeout(800)   // 等标签防抖落定

const calls = await page.evaluate(() => window.__setDataCalls)
console.log(`共 ${n} 帧,拖了 ${steps} 步 → setData 调用: areas=${calls.areas} labels=${calls.labels}`)
if (calls.areas === 0) {
  console.log('✅ 多边形零 setData —— 拖动只走 feature-state,架构成立')
} else {
  console.log('❌ 拖动触发了多边形 setData —— 有人把帧位置加回 areasGeoJson 依赖了,会随区域数线性变卡')
  process.exitCode = 1
}

// 顺带确认 paint 表达式确实跟着年份换了 key(否则「零 setData」可能只是压根没生效)
const st = await page.evaluate(() => {
  const m = window.__mapInstance
  const fs = m.queryRenderedFeatures({ layers: ['area-fills'] })
  const colors = {}
  let withState = 0
  for (const f of fs) {
    const tc = m.getFeatureState({ source: 'areas', id: f.id })?.tc
    if (tc) { withState++; colors[tc] = (colors[tc] || 0) + 1 }
  }
  return { expr: JSON.stringify(m.getPaintProperty('area-fills', 'fill-color')), total: fs.length, withState, colors }
})
console.log('fill-color 表达式:', st.expr)
console.log(`feature-state 着色: ${st.withState}/${st.total}`, JSON.stringify(st.colors))
if (st.withState !== st.total) {
  console.log('❌ 有多边形没拿到颜色 —— 着色 effect 漏了(检查 feature id 是否为数字)')
  process.exitCode = 1
}

await browser.close()
