import { chromium } from 'playwright'
const SCRATCH = process.env.SCRATCH
const browser = await chromium.launch()
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
await m.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'satellite') })
await m.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })
await m.waitForTimeout(12000)
let fail = 0
const check = (n, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!ok) fail++ }

check('轨道有卡片', await m.evaluate(() => document.querySelectorAll('.pinzos-carousel-card').length) === 22)
check('地图无浮动卡', await m.evaluate(() => [...document.querySelectorAll('.maplibregl-marker')].filter(x=>/起|From|价格待定/.test(x.textContent||'')).length) === 0)

// 记录初始相机中心
const c0 = await m.evaluate(() => { const c = window.__map.getCenter(); return {lng:c.lng, lat:c.lat} })

// 滑轨道:scrollBy 到第 4 张
await m.evaluate((step) => {
  const el = document.querySelector('.pinzos-carousel-card').parentElement
  el.scrollTo({ left: step * 3, behavior: 'instant' })
  el.dispatchEvent(new Event('scroll'))
}, 280)
await m.waitForTimeout(900)
// 高亮圆点应出现(project-dots-active filter 命中一个 id)
const activeFilter = await m.evaluate(() => window.__map.getFilter('project-dots-active'))
check('滑动后高亮圆点激活', Array.isArray(activeFilter) && activeFilter[2] !== '__none__', JSON.stringify(activeFilter))
// 地图应已推到新中心
const c1 = await m.evaluate(() => { const c = window.__map.getCenter(); return {lng:c.lng, lat:c.lat} })
check('滑动后地图跟随移动', Math.abs(c1.lng-c0.lng) > 0.0001 || Math.abs(c1.lat-c0.lat) > 0.0001, `Δlng=${(c1.lng-c0.lng).toFixed(4)} Δlat=${(c1.lat-c0.lat).toFixed(4)}`)
await m.screenshot({ path: SCRATCH + '/carousel-active.png' })

// 点当前居中卡 → 若已 active 则进详情;先确认它 active,再点
const activeCard = await m.evaluate(() => {
  const el = document.querySelector('.pinzos-carousel-card').parentElement
  const cards = [...el.querySelectorAll('.pinzos-carousel-card')]
  const mid = el.scrollLeft + el.clientWidth/2
  let best=null, bd=1e9
  for (const c of cards) { const cx = c.offsetLeft + c.offsetWidth/2; const d=Math.abs(cx-mid); if(d<bd){bd=d;best=c} }
  const r = best.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, cid: best.getAttribute('data-cid') }
})
// 第一次点=激活(已居中卡应已是active);再点一次进详情
await m.mouse.click(activeCard.x, activeCard.y)
await m.waitForTimeout(600)
await m.mouse.click(activeCard.x, activeCard.y)
await m.waitForTimeout(1800)
check('点居中卡进详情页', new URL(m.url()).pathname.startsWith('/project/'), m.url())

await browser.close()
console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail?1:0)
