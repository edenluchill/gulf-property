import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, args: ['--disable-web-security'] })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true })).newPage()
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 110)) })
p.on('response', r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().slice(0, 90)}`) })
await p.goto(process.argv[2], { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForTimeout(2500)
await (await p.$('.lt-greet-btn')).click()
await p.waitForTimeout(6000)
await p.evaluate(() => window.__pinzosMap.jumpTo({ center: [55.05, 25.2], zoom: 9.6, pitch: 0, bearing: 0 }))
await p.waitForTimeout(3000)

const read = () => p.evaluate(() => {
  const m = window.__pinzosMap
  const fs = m?.querySourceFeatures?.('lt-ambient-src') || []
  const byIcon = (k) => fs.filter(f => String(f.properties?.icon || '').includes(k)).length
  const sorted = fs.map(f => f.geometry.coordinates.map(x => +x.toFixed(4))).sort((a,b)=>a[0]-b[0])
  return {
    layer: !!m?.getLayer('lt-ambient-life'),
    hasImg: !!m?.hasImage?.('lt-ambient-boat'),
    n: fs.length,
    boats: byIcon('boat'),
    planes: byIcon('plane'),
    first: sorted[0],
    zoom: +m.getZoom().toFixed(1),
  }
})
const a = await read()
await p.waitForTimeout(2500)
const c = await read()
console.log(`图层: ${a.layer ? '✅ 已挂载' : '❌ 没挂上'}  图标: ${a.hasImg ? '✅' : '❌'}  zoom ${a.zoom}`)
console.log(`实体: ${a.n} 个（船 ${a.boats} · 飞机 ${a.planes}）`)
console.log(`第一个: ${a.first} → ${c.first}  ${JSON.stringify(a.first) !== JSON.stringify(c.first) ? '✅ 在动' : '❌ 没动'}`)
console.log(errs.length ? `❌ ${[...new Set(errs)].slice(0,3).join('\n❌ ')}` : '✅ 无 console 错误')
await p.screenshot({ path: 'scripts/_ambient.png' })
await b.close()
