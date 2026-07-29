/**
 * Luna Tour —— 运镜期间地图上到底挂着多少层？(每帧 zoom 变一点，maplibre 就要把
 * **每一层**的 zoom 插值 paint/layout 属性重算一遍：`_render → update → recalculate
 * → possiblyEvaluate`。层越多、zoom 插值越多，每帧越贵。)
 *
 *   node scripts/tour-layers.mjs [--dist=dist] [--at=12]
 */
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const TOUR_URL = arg('url', `https://www.pinzos.com/?toursession=${arg('code', 'demo')}`)
const DIST = arg('dist', '')
const AT = Number(arg('at', 12))

const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
if (DIST) {
  const root = path.resolve(DIST)
  const origin = new URL(TOUR_URL).origin
  await page.route(`${origin}/**`, async (route) => {
    const rel = new URL(route.request().url()).pathname
    const file = path.join(root, rel === '/' ? '/index.html' : rel)
    if (path.extname(rel) && fs.existsSync(file)) return route.fulfill({ path: file })
    return route.fulfill({ path: path.join(root, 'index.html') })
  })
}
await page.goto(TOUR_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.locator('.lt-greet-btn').waitFor({ state: 'visible', timeout: 60000 })
await page.waitForTimeout(2000)
await page.locator('.lt-greet-btn').click()
await page.waitForTimeout(AT * 1000)

const info = await page.evaluate(() => {
  const m = window.__pinzosMap
  const style = m.getStyle()
  const hasZoomInterp = (v) => JSON.stringify(v ?? null).includes('"zoom"')
  const rows = style.layers.map((l) => {
    const zp = Object.entries(l.paint || {}).filter(([, v]) => hasZoomInterp(v)).map(([k]) => k)
    const zl = Object.entries(l.layout || {}).filter(([, v]) => hasZoomInterp(v)).map(([k]) => k)
    let feats = null
    try {
      const src = l.source && m.getSource(l.source)
      if (src && src._data) feats = (src._data.features || []).length
    } catch { /* raster/vector */ }
    return { id: l.id, type: l.type, source: l.source, feats, zoomPaint: zp, zoomLayout: zl }
  })
  // how many features are actually rendered right now
  let rendered = 0
  try { rendered = m.queryRenderedFeatures().length } catch { /* ignore */ }
  const countIn = (id) => {
    try {
      return m.queryRenderedFeatures({ layers: [id] }).length
    } catch {
      return -1 // 图层不存在
    }
  }
  return {
    count: style.layers.length,
    rows,
    rendered,
    sources: Object.keys(style.sources),
    // owner 明确要求 tour 里**永远**显示的东西 —— 每次改运镜/图层都要确认它们还在
    landmarks: countIn('host-landmarks-sym'),
    areaFills: countIn('area-fills'),
    areaLabels: countIn('area-label-text'),
    pins: countIn('lt-props-sym'),
  }
})

console.log(`\n运镜中 (t=${AT}s):  ${info.count} 层 · ${info.sources.length} 源 · 当前渲染要素 ${info.rendered}\n`)
let zoomDep = 0
for (const r of info.rows) {
  const z = [...r.zoomPaint, ...r.zoomLayout]
  if (z.length) zoomDep++
  console.log(
    `  ${r.id.padEnd(30)} ${r.type.padEnd(11)} ${String(r.feats ?? '-').padStart(5)}要素` +
      (z.length ? `  ⚠️ zoom插值: ${z.join(', ')}` : '')
  )
}
console.log(
  `\n画面里:项目 pin ${info.pins} · 地标 ${info.landmarks} · 区域填充 ${info.areaFills} · 区域标签 ${info.areaLabels}` +
    `   (pin/地标 = owner 要求必须一直在,别改没了)`
)
console.log(`带 zoom 插值属性的层: ${zoomDep} / ${info.count}  ← 每帧都要 recalculate 这些`)
await browser.close()
