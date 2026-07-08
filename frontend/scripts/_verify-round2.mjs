/** 第二轮改进综合验证:付款筛选 / hover tooltip / 贴边卡 / UI禁区 / unit mix / 报告PDF按钮 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'satellite') })
let failures = 0
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failures++ }

// ── 地图:付款筛选 ──
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const payChip = page.locator('button', { hasText: '付款' }).first()
check('付款 chip 存在', await payChip.count() > 0)
await payChip.click()
await page.waitForTimeout(400)
const opt = page.locator('button', { hasText: /^60\/40$/ }).first()
check('60/40 选项存在', await opt.count() > 0)
const dotsBefore = await page.evaluate(() => window.__map.querySourceFeatures('project-dots-src').length)
await opt.click()
await page.waitForTimeout(1200)
const dotsAfter = await page.evaluate(() => window.__map.querySourceFeatures('project-dots-src').length)
check('选 60/40 后圆点变少(筛选生效)', dotsAfter < dotsBefore, `before=${dotsBefore} after=${dotsAfter}`)
// 清除筛选
await page.locator('button', { hasText: '清除' }).first().click()
await page.waitForTimeout(800)

// ── hover tooltip:找一个没卡的项目圆点,悬停出名字 ──
const pins = (await (await fetch('http://127.0.0.1:3000/api/residential-projects/map-pins')).json()).data
const shown = await page.evaluate(() => [...document.querySelectorAll('.maplibregl-marker')].map(m => m.textContent || ''))
// 找「当前视口内且没有卡片」的圆点(jumpTo居中会让它自动得卡,tooltip就被正确抑制)
const hidden = await page.evaluate((pins) => {
  const m = window.__map, r = m.getCanvas().getBoundingClientRect()
  const texts = [...document.querySelectorAll('.maplibregl-marker')].map(x => x.textContent || '')
  for (const p of pins) {
    if (texts.some(t => t.includes(p.name.slice(0, 10)))) continue
    const pt = m.project([p.lng, p.lat])
    if (pt.x > 60 && pt.x < r.width - 60 && pt.y > 120 && pt.y < r.height - 60) {
      // 圆点必须裸露(没被别的卡片/地标 DOM 压住),否则鼠标事件到不了画布
      const el = document.elementFromPoint(r.left + pt.x, r.top + pt.y)
      if (el && el.tagName === 'CANVAS')
        return { name: p.name, x: r.left + pt.x, y: r.top + pt.y }
    }
  }
  return null
}, pins)
if (hidden) {
  const pt = { x: hidden.x, y: hidden.y }
  await page.mouse.move(pt.x, pt.y)
  await page.waitForTimeout(400)
  const tipText = await page.evaluate(() => {
    const tips = [...document.querySelectorAll('div')].filter(d => d.style.willChange === 'transform' && d.style.display === 'block')
    return tips.map(t => t.textContent).join('|')
  })
  check('悬停圆点出名字提示', tipText.includes(hidden.name.slice(0, 8)), `tip="${tipText}" expect~"${hidden.name}"`)
} else {
  check('存在被隐藏的项目(供tooltip测试)', false)
}

// ── UI禁区:所有可见卡片矩形不与右上面板(x>W-270,y<230)相交 ──
const overlaps = await page.evaluate(() => {
  const W = window.innerWidth
  const cards = [...document.querySelectorAll('.maplibregl-marker')]
  let bad = 0
  for (const c of cards) {
    const r = c.getBoundingClientRect()
    const txt = c.textContent || ''
    // 只认项目卡(第二行必有 起/售罄/待定);地标扣图不归卡片禁区管
    if (!/起 |From |已售罄|SOLD OUT|价格待定|Price TBA/.test(txt)) continue
    if (r.width < 60) continue
    if (r.right > W - 270 && r.top < 230) bad++
  }
  return bad
})
check('无卡片钻进右上控制面板区', overlaps === 0, `overlap=${overlaps}`)

// ── 详情页 unit mix ──
const withUnits = pins.find(p => p.name === '113 RESIDENCES') || pins[0]
await page.goto(`http://localhost:5174/project/${withUnits.id}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const mixVisible = await page.locator('text=户型构成').count()
check('详情页显示户型构成', mixVisible > 0, withUnits.name)

// ── 报告页 PDF 按钮 ──
await page.goto('http://localhost:5174/r/vzqee6', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
check('报告页有保存PDF按钮', await page.locator('button', { hasText: '保存 PDF' }).count() > 0)

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
