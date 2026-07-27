/**
 * 测距标签验收 —— 距离数字必须落在**线段中点**，且只报距离不报时间。
 *
 * 修的是什么：标签坐标原来写 `coords[Math.floor(coords.length/2)]`，注释还写着「中点」。
 * 对一条只有两个点的直线，`floor(2/2)=1` → 拿到的是**终点** —— 数字永远糊在末端那颗
 * 圆点上（owner 截图里的「17.5 km」压着绿点）。路网折线点多，凑巧看着还行，所以一直没被发现。
 *
 * 这里直接读 maplibre 的 source 数据比像素：标签点到两端的距离应当接近相等。
 *
 * 用法：
 *   VITE_API_URL=https://api.pinzos.com npx vite --port 5174   # 另开终端
 *   node scripts/_shot-measure-label.mjs
 */
import { chromium } from 'playwright'
import fs from 'fs'

const BE = process.env.BE || 'https://api.pinzos.com'
const FE = process.env.FE || 'http://localhost:5174'
const OUT = 'shots-measure'
fs.mkdirSync(OUT, { recursive: true })

let fail = 0
const check = (l, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ' — ' + d : ''}`); if (!ok) fail++ }

const res = await fetch(BE + '/api/collab/rooms', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ahmed' }),
})
const { code } = await res.json()
if (!code) { console.error('建房失败'); process.exit(2) }

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
const ctx = await browser.newContext({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'satellite')
  localStorage.setItem('pz-collab-identity', JSON.stringify({ name: '测试客户' }))
})
await page.goto(`${FE}/t/${code}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(13000)

// 右上工具卡里的「直线测距」
const ruler = page.locator('button[aria-label="直线测距"]').first()
check('找到直线测距按钮', await ruler.count() > 0)
if (await ruler.count() === 0) { await browser.close(); process.exit(1) }
await ruler.click()
await page.waitForTimeout(600)

// 在地图上点两个点（避开右侧工具卡和底部坞）
await page.mouse.click(250, 300); await page.waitForTimeout(500)
await page.mouse.click(600, 520); await page.waitForTimeout(1200)
await page.screenshot({ path: `${OUT}/measure.png` })

// DEV 钩子(MapViewMapLibre 里 `window.__mapInstance = map`),和 _shot-compass 同一个。
const geo = await page.evaluate(() => {
  const m = window.__mapInstance
  if (!m) return { noMap: true }
  const src = m.getStyle().sources
  return { labels: src['measure-labels']?.data, segments: src['measure-line']?.data }
})

// ⚠️ 拿不到实例就**判失败**,不能"跳过检查然后报 PASS" ——
//    那是绿灯里什么都没查,比没有这条检查更糟。
check('拿到 __mapInstance(DEV 钩子)', !geo.noMap, geo.noMap ? '没有钩子 → 这轮什么都没验' : '')
if (!geo.noMap) {
  const lab = geo.labels?.features?.[0]?.geometry?.coordinates
  const line = geo.segments?.features?.[0]?.geometry?.coordinates
  check('画出了一条测距线 + 一个标签', !!lab && !!line, lab ? `label=${lab}` : 'no data')
  if (lab && line) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
    const toStart = d(lab, line[0])
    const toEnd = d(lab, line[line.length - 1])
    const ratio = Math.min(toStart, toEnd) / Math.max(toStart, toEnd)
    check('标签在中点(到两端距离接近相等)', ratio > 0.8,
      `到起点 ${toStart.toFixed(4)} / 到终点 ${toEnd.toFixed(4)} → 比值 ${ratio.toFixed(2)}`)
    const text = geo.labels.features[0].properties.label
    check('标签只报距离,不含时间', !/min|h\d|分钟/.test(text), `「${text}」`)
  }
}

await browser.close()
console.log(fail === 0 ? `\n✅ 通过,截图 ${OUT}/measure.png` : `\n❌ ${fail} 项未通过`)
process.exit(fail === 0 ? 0 : 1)
