/** 直查 feature-state 链路:promoteId 是否生效、mousemove 是否写入 hover 态 */
import { chromium } from 'playwright'

const url = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch({ headless: false, args: ['--window-size=1500,900'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 850 } })).newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)) })
await page.addInitScript(() => {
  localStorage.setItem('pinzos-lang', 'zh-CN')
  localStorage.setItem('map-base', 'vector')
})
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(13000)

const info1 = await page.evaluate(() => {
  const map = window.__map
  if (!map) return { err: 'no __map' }
  const src = map.getSource('areas')
  const feats = map.queryRenderedFeatures([760, 620], { layers: ['area-fills'] })
  const f = feats[0]
  return {
    hasSource: !!src,
    promoteId: src?.promoteId ?? src?._options?.promoteId ?? '(unknown)',
    hit: feats.length,
    featureId: f?.id ?? '(none)',
    propId: f?.properties?.id ?? '(none)',
  }
})
console.log('before hover:', JSON.stringify(info1))

await page.mouse.move(300, 780)
await page.waitForTimeout(300)
await page.mouse.move(760, 620)
await page.waitForTimeout(500)

const info2 = await page.evaluate(() => {
  const map = window.__map
  const feats = map.queryRenderedFeatures([760, 620], { layers: ['area-fills'] })
  const f = feats[0]
  const state = f ? map.getFeatureState({ source: 'areas', id: f.id ?? f.properties?.id }) : null
  return { featureId: f?.id ?? '(none)', state }
})
console.log('after hover:', JSON.stringify(info2))
await browser.close()
