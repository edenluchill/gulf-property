/** 拖动平移卡顿定位:headed + CDP CPU profile,聚合 self-time Top30 */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'https://www.pinzos.com/'
const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 850 } })).newPage()

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(14000) // 地图+数据完全就绪

const client = await page.context().newCDPSession(page)
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 200 })
await client.send('Profiler.start')

// 连续拖动平移 10 次(不缩放)
for (let i = 0; i < 10; i++) {
  const dx = i % 2 === 0 ? 420 : -420
  await page.mouse.move(700, 450)
  await page.mouse.down()
  for (let s = 1; s <= 12; s++) {
    await page.mouse.move(700 + (dx * s) / 12, 450 + (i % 3) * 8, { steps: 1 })
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(350)
}

const { profile } = await client.send('Profiler.stop')

// 聚合 self time
const dt = profile.timeDeltas || []
const samples = profile.samples || []
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
const selfMicros = new Map()
for (let i = 0; i < samples.length; i++) {
  const t = dt[i] || 0
  selfMicros.set(samples[i], (selfMicros.get(samples[i]) || 0) + t)
}
const rows = [...selfMicros.entries()]
  .map(([id, us]) => {
    const n = nodeById.get(id)
    const f = n?.callFrame || {}
    const url = (f.url || '').split('/').pop()
    return { name: f.functionName || '(anonymous)', url, line: f.lineNumber, ms: us / 1000 }
  })
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 30)

console.log('=== TOP SELF-TIME (ms) during pan ===')
for (const r of rows) console.log(r.ms.toFixed(0).padStart(6), r.name.slice(0, 60).padEnd(62), `${r.url}:${r.line}`)

await browser.close()
