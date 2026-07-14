import { chromium } from 'playwright'
const URL = process.argv[2] || 'https://www.pinzos.com/v/demo'
// 本地验证生产构建时要打生产 API → 关掉同源策略(仅测试用)
const b = await chromium.launch({
  headless: true,
  args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process'],
})
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true })).newPage()
await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 })
await p.waitForTimeout(2000)
await (await p.$('.lt-greet-btn')).click()

const samples = []
const t0 = Date.now()
while (Date.now() - t0 < 150000) {
  const c = await p.evaluate(() => {
    const m = window.__pinzosMap
    if (!m) return null
    const ce = m.getCenter()
    return { z: +m.getZoom().toFixed(2), lng: +ce.lng.toFixed(3), lat: +ce.lat.toFixed(3), b: Math.round(m.getBearing()) }
  })
  if (c) samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1), ...c })
  await p.waitForTimeout(400)
}
await b.close()

// 找出每一次「先出后进」的抛高
let minZ = 99, maxZ = 0
for (const s of samples) { minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z) }
console.log(`zoom 范围: ${minZ} → ${maxZ}`)
console.log(`bearing 变化: ${[...new Set(samples.map(s => s.b))].join(', ')}`)

// 打印 zoom 曲线（每个样本一个 bar）
console.log('\nzoom 曲线（每 0.4s 一格，← 越左越远）:')
for (let i = 0; i < samples.length; i += 3) {
  const s = samples[i]
  const bar = '█'.repeat(Math.max(0, Math.round((s.z - 9) * 3)))
  console.log(`  ${String(s.t).padStart(5)}s  z${String(s.z).padStart(5)} ${bar}`)
}
