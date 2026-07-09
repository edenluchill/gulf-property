/** 验证:1) 触屏 tap 圆点不再重复显示项目名(dotTip 被清)  2) 卡片开关按钮  3) 详情页 tablet/mobile 收益率徽章 */
import { chromium } from 'playwright'
const browser = await chromium.launch()

let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

// ─── 1) 触屏 tap 圆点:名字只出现一次 ───────────────────────────────
const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await touchCtx.newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'satellite'); localStorage.setItem('map-cards', '0') })
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)

const pins = (await (await fetch('http://127.0.0.1:3000/api/residential-projects/map-pins')).json()).data
const target = pins[0]
await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 13 }), [target.lng, target.lat])
await page.waitForTimeout(900)
const pt = await page.evaluate(([lng, lat]) => {
  const p = window.__map.project([lng, lat])
  const r = window.__map.getCanvas().getBoundingClientRect()
  return { x: r.left + p.x, y: r.top + p.y }
}, [target.lng, target.lat])
// 真·触屏 tap:会先合成 mousemove(旧 bug 弹出 dotTip),再 click
await page.touchscreen.tap(pt.x, pt.y)
await page.waitForTimeout(700)

// dotTip = z-[900] 的悬停名字药丸;修复后应 display:none
const dotTipShown = await page.evaluate(() => {
  const el = document.querySelector('.z-\\[900\\]')
  if (!el) return false
  return getComputedStyle(el).display !== 'none'
})
check('触屏 tap 后悬停名字提示已隐藏(不重复)', !dotTipShown, dotTipShown ? 'dotTip 仍显示 → 名字出现两次' : '')

const nameOccurrences = await page.evaluate((nm) => {
  const key = nm.slice(0, 8)
  let n = 0
  document.querySelectorAll('.maplibregl-marker, .z-\\[900\\]').forEach(el => {
    if ((el.textContent || '').includes(key) && getComputedStyle(el).display !== 'none') n++
  })
  return n
}, target.name)
check('项目名在屏上只出现一次', nameOccurrences === 1, `出现 ${nameOccurrences} 次 (${target.name})`)

await page.screenshot({ path: 'scripts/_shot-dup-name.png' })

// ─── 2) 卡片开关按钮(更明显)───────────────────────────────────────
const toggleInfo = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /卡片|Cards|已隐藏|Hidden|项目|Projects/.test(b.getAttribute('aria-label') || b.textContent || ''))
  if (!btn) return null
  return { label: btn.getAttribute('aria-label'), text: btn.textContent?.trim() }
})
check('卡片开关按钮存在且带明确 aria-label', !!toggleInfo && /隐藏|显示|Hidden|Projects/.test(toggleInfo.label + toggleInfo.text), JSON.stringify(toggleInfo))

// ─── 3) 详情页收益率徽章(tablet 视口)─────────────────────────────
const tabCtx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true })
const dp = await tabCtx.newPage()
await dp.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN') })
// 找一个有 insights.investment 的项目
let withInv = null
for (const p of pins.slice(0, 12)) {
  try {
    const j = await (await fetch(`http://127.0.0.1:3000/api/residential-projects/${p.id}/insights`)).json()
    const ins = j?.data
    if (ins?.investment) { withInv = { p, ins }; break }
  } catch {}
}
check('至少一个项目有 investment insights', !!withInv, withInv ? `${withInv.p.name} 年化 ${withInv.ins.investment.annualized_return_pct}%` : '无')
if (withInv) {
  await dp.goto(`http://localhost:5174/project/${withInv.p.id}`, { waitUntil: 'domcontentloaded' })
  await dp.waitForTimeout(3500)
  const hasBadge = await dp.evaluate(() =>
    [...document.querySelectorAll('span')].some(s => /回报|Yield|5年年化|5yr/.test(s.textContent || '')))
  check('详情页(tablet)显示收益率/回报徽章', hasBadge, withInv.p.name)
  await dp.screenshot({ path: 'scripts/_shot-detail-badges.png', fullPage: false })
}

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
