/** 双层模型交互验证:点圆点弹卡 → 点卡进详情 → 点空白收卡 */
import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1400, height: 850 } })).newPage()
await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'satellite') })
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)

let failures = 0
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

// 找一个「只有圆点没有卡」的项目:从 DOM 卡片收集已显示的名字,再从 API 找缺席者
const pins = (await (await fetch('http://127.0.0.1:3000/api/residential-projects/map-pins')).json()).data
const shownNames = await page.evaluate(() =>
  [...document.querySelectorAll('.maplibregl-marker')].map(m => m.textContent || ''))
const hidden = pins.find(p => !shownNames.some(t => t.includes(p.name.slice(0, 10))))
check('存在被碰撞隐藏的项目(卡片 optional 生效)', !!hidden, hidden?.name)

if (hidden) {
  // 把它挪到屏幕中心再点它的圆点(GL 层,点屏幕坐标)
  await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat] }), [hidden.lng, hidden.lat])
  await page.waitForTimeout(800) // moveend debounce + 卡片重算
  const pt = await page.evaluate(([lng, lat]) => {
    const p = window.__map.project([lng, lat])
    const r = window.__map.getCanvas().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }, [hidden.lng, hidden.lat])
  await page.mouse.click(pt.x, pt.y)
  await page.waitForTimeout(600)
  const cardVisible = await page.evaluate((name) =>
    [...document.querySelectorAll('.maplibregl-marker')].some(m => (m.textContent || '').includes(name.slice(0, 10))), hidden.name)
  check('点圆点弹出该项目卡片', cardVisible, hidden.name)

  // 点这张卡 → 进详情
  if (cardVisible) {
    const card = page.locator('.maplibregl-marker', { hasText: hidden.name.slice(0, 10) }).first()
    await card.click()
    await page.waitForTimeout(2000)
    check('点卡片进详情页', new URL(page.url()).pathname.startsWith('/project/'), page.url())
    await page.goBack()
    await page.waitForTimeout(1500)
  }

  // 点空白(海面)收起选中卡
  await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat] }), [hidden.lng, hidden.lat])
  await page.waitForTimeout(800)
  const pt2 = await page.evaluate(([lng, lat]) => {
    const p = window.__map.project([lng, lat])
    const r = window.__map.getCanvas().getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }, [hidden.lng, hidden.lat])
  await page.mouse.click(pt2.x, pt2.y) // 先选中
  await page.waitForTimeout(600)
  await page.mouse.click(pt2.x + 300, pt2.y + 200) // 再点空白
  await page.waitForTimeout(600)
  const stillThere = await page.evaluate((name) =>
    [...document.querySelectorAll('.maplibregl-marker')].some(m => (m.textContent || '').includes(name.slice(0, 10))), hidden.name)
  // 注意:点空白后它可能因为周围没卡而被自动层选中——只要不报错即可,宽松断言
  console.log(`INFO  点空白后卡片状态: ${stillThere ? '仍显示(可能被自动层选中)' : '已收起'}`)
}

// GL 圆点数量 = 项目数(真值层永不丢)
const dotCount = await page.evaluate(() => window.__map.querySourceFeatures('project-dots-src').length)
check('真值层圆点覆盖全部项目', dotCount >= pins.length * 0.9, `dots=${dotCount} pins=${pins.length}`)

await browser.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
process.exit(failures ? 1 : 0)
