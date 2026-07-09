/** 右上控制卡改版三档验证:414(收起/展开/拖动自动收起)/1180/1440 */
import { chromium } from 'playwright'

const base = process.env.SHOT_URL || 'http://localhost:5174'
const outDir = process.argv[2] || '.'
const browser = await chromium.launch()

async function shot(width, height, name, actions) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.addInitScript(() => { localStorage.setItem('pinzos-lang', 'zh-CN'); localStorage.setItem('map-base', 'vector') })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(11000)
  if (actions) await actions(page)
  await page.screenshot({ path: `${outDir}/${name}.png` })
  console.log('saved', name)
  await ctx.close()
}

// 手机 414:默认收起
await shot(414, 850, 'ctl-414-collapsed')
// 手机 414:点开展开
await shot(414, 850, 'ctl-414-expanded', async (p) => {
  await p.tap('button:has-text("图层")').catch(() => p.click('[data-testid="map-mobile-controls"] button'))
  await p.waitForTimeout(800)
})
// 手机 414:展开后拖地图 → 自动收起
await shot(414, 850, 'ctl-414-autocollapse', async (p) => {
  await p.tap('button:has-text("图层")').catch(() => {})
  await p.waitForTimeout(600)
  await p.mouse.move(200, 500); await p.mouse.down()
  for (let s = 1; s <= 8; s++) { await p.mouse.move(200 - 15 * s, 500, { steps: 1 }); await p.waitForTimeout(16) }
  await p.mouse.up()
  await p.waitForTimeout(800)
})
// pad 1180
await shot(1180, 820, 'ctl-1180')
// 桌面 1440
await shot(1440, 850, 'ctl-1440')

await browser.close()
