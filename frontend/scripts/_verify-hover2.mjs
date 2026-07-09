/** 用 canvas 像素直接验证 hover 高亮生效(hover 前后同一点位颜色应变化) */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 850 } })).newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 160)) })
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'vector')
})
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(13000)

// 找一个大区域内部的点(避开 label/POI):试几个候选点,取 hover 前后像素差最大的
const pts = [[880, 560], [760, 620], [1000, 470], [700, 380]]
for (const [x, y] of pts) {
  await page.mouse.move(300, 780) // 移开(海上)
  await page.waitForTimeout(400)
  const before = await page.screenshot({ clip: { x: x - 2, y: y - 2, width: 4, height: 4 } })
  await page.mouse.move(x, y)
  await page.waitForTimeout(400)
  const after = await page.screenshot({ clip: { x: x - 2, y: y - 2, width: 4, height: 4 } })
  const diff = Buffer.compare(before, after) !== 0
  console.log(`point (${x},${y}): pixel changed = ${diff}`)
}
await browser.close()
