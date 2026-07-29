/**
 * Luna Tour —— 运镜期间到底是谁在偷主线程？(CDP CPU profile)
 *
 * tour-jitter.mjs 告诉我们「每秒 552ms 花在 long task 上」。这个脚本回答**是谁**：
 * 采样 profiler 跑 N 秒，把 self-time 按函数名聚合排序。
 *
 *   node scripts/tour-profile.mjs                 # 手机 + cpu×4，打生产
 *   node scripts/tour-profile.mjs --secs=25 --cpu=4
 *   node scripts/tour-profile.mjs --url=http://localhost:4173/?toursession=demo
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.split('=').slice(1).join('=') : d
}
const URL = arg('url', `https://www.pinzos.com/?toursession=${arg('code', 'demo')}`)
const SECS = Number(arg('secs', 25))
const CPU = Number(arg('cpu', 4))
const OUT = 'scripts/_tour-jitter'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-renderer-backgrounding', '--use-gl=swiftshader'],
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

console.log(`profiling ${URL}  (${SECS}s, cpu×${CPU})`)
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.locator('.lt-greet-btn').waitFor({ state: 'visible', timeout: 60000 })
await page.waitForTimeout(2500)
await page.locator('.lt-greet-btn').click()
await page.waitForTimeout(1500) // skip the start transient

await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
await page.waitForTimeout(SECS * 1000)
const { profile } = await cdp.send('Profiler.stop')

// aggregate self time per node
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const total = profile.samples.length
for (const id of profile.samples) {
  const n = byId.get(id)
  if (!n) continue
  const f = n.callFrame
  const file = (f.url || '').split('/').pop() || '(inline)'
  const key = `${f.functionName || '(anonymous)'}  @${file}:${f.lineNumber + 1}`
  self.set(key, (self.get(key) || 0) + 1)
}
const durMs = (profile.endTime - profile.startTime) / 1000
const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
console.log(`\n${total} samples over ${durMs.toFixed(0)}ms\n`)
for (const [k, c] of rows) {
  const pctv = ((100 * c) / total).toFixed(1)
  console.log(`${pctv.padStart(5)}%  ${((c / total) * durMs).toFixed(0).padStart(6)}ms  ${k}`)
}
fs.writeFileSync(`${OUT}/profile.cpuprofile`, JSON.stringify(profile))
console.log(`\n→ ${OUT}/profile.cpuprofile (可拖进 Chrome DevTools Performance)`)
await browser.close()
