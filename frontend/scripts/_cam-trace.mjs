import { chromium } from 'playwright'
const URL = process.argv[2] || 'https://www.pinzos.com/?toursession=zteye6'
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 90)) })
await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 })

const cam = () => p.evaluate(() => {
  const m = window.__pinzosMap
  if (!m) return null
  const c = m.getCenter()
  return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), z: +m.getZoom().toFixed(2), p: Math.round(m.getPitch()), b: Math.round(m.getBearing()) }
})
const fmt = (c) => c ? `[${c.lng}, ${c.lat}] z${c.z} pitch${c.p} bearing${c.b}` : '(no map)'

console.log('欢迎页（未点开始）：')
for (let i = 0; i < 4; i++) { console.log(`  +${i * 0.7}s  ${fmt(await cam())}`); await p.waitForTimeout(700) }

const before = await cam()
await (await p.$('.lt-greet-btn')).click()
console.log('\n点「开始」之后：')
for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(500)
  console.log(`  +${((i + 1) * 0.5).toFixed(1)}s  ${fmt(await cam())}`)
}
const after = await cam()
if (before && after) {
  const moved = Math.hypot(after.lng - before.lng, after.lat - before.lat)
  console.log(`\n开场位移: ${(moved * 111).toFixed(2)} km  ${moved * 111 > 0.5 ? '❌ 在平移！' : '✅ 没有平移（只有推近）'}`)
}
console.log(errs.length ? `\n❌ ${[...new Set(errs)].slice(0,4).join('\n❌ ')}` : '\n✅ 无 console 错误')
await b.close()
