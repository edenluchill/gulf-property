/** 复现 Eden 的图层状态(vector+metric+现房+交通/学校POI),抓 longtask + CPU top */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'https://www.pinzos.com/'
const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 850 } })).newPage()

await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'vector')
  localStorage.setItem('map-area-metric', 'medianUnitPrice')
  // longtask 观察器,尽早装上
  window.__longtasks = []
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__longtasks.push({ t: e.startTime | 0, d: e.duration | 0 })
  }).observe({ entryTypes: ['longtask'] })
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(14000)

// 开 现房 segment + 交通/学校 POI
await page.getByRole('button', { name: '现房' }).first().click().catch(() => console.log('no 现房 btn'))
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /交通/ }).first().click().catch(() => console.log('no 交通 btn'))
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /学校/ }).first().click().catch(() => console.log('no 学校 btn'))
await page.waitForTimeout(2500)

await page.evaluate(() => { window.__longtasks.length = 0 })
const client = await page.context().newCDPSession(page)
await client.send('Profiler.enable')
await client.send('Profiler.setSamplingInterval', { interval: 200 })
await client.send('Profiler.start')

// 拖动 6 次 + 滚轮缩放进出 2 轮(贴近"移动时一卡一卡")
for (let i = 0; i < 6; i++) {
  const dx = i % 2 === 0 ? 400 : -400
  await page.mouse.move(700, 450)
  await page.mouse.down()
  for (let s = 1; s <= 12; s++) {
    await page.mouse.move(700 + (dx * s) / 12, 450, { steps: 1 })
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
}
for (let z = 0; z < 2; z++) {
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(200) }
  await page.waitForTimeout(600)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(200) }
  await page.waitForTimeout(600)
}

const { profile } = await client.send('Profiler.stop')
const longtasks = await page.evaluate(() => window.__longtasks)

console.log('=== LONG TASKS (>50ms) during pan+zoom ===')
console.log(longtasks.filter((t) => t.d >= 50).map((t) => `${t.d}ms`).join(' ') || '(none)')
console.log('count>=100ms:', longtasks.filter((t) => t.d >= 100).length, ' max:', Math.max(0, ...longtasks.map((t) => t.d)), 'ms')

const dt = profile.timeDeltas || []
const samples = profile.samples || []
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]))
const selfMicros = new Map()
for (let i = 0; i < samples.length; i++) selfMicros.set(samples[i], (selfMicros.get(samples[i]) || 0) + (dt[i] || 0))
const rows = [...selfMicros.entries()]
  .map(([id, us]) => {
    const f = nodeById.get(id)?.callFrame || {}
    return { name: f.functionName || '(anonymous)', url: (f.url || '').split('/').pop(), line: f.lineNumber, ms: us / 1000 }
  })
  .sort((a, b) => b.ms - a.ms).slice(0, 25)
console.log('=== TOP SELF-TIME (ms) ===')
for (const r of rows) console.log(r.ms.toFixed(0).padStart(6), r.name.slice(0, 58).padEnd(60), `${r.url}:${r.line}`)

await browser.close()
