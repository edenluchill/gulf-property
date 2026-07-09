import { chromium } from 'playwright'
const out = process.argv[2], vp = process.argv[3]==='m' ? {width:390,height:844} : {width:1280,height:860}
const tag = process.argv[3]==='m' ? 'm' : 'd'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)))
await p.addInitScript(() => { localStorage.setItem('pinzos-lang','zh-CN'); localStorage.setItem('map-base','satellite') })
await p.goto('http://localhost:5173/map', { waitUntil:'domcontentloaded', timeout:60000 })
await p.waitForTimeout(9000)
// fetch tour payload from backend tool endpoint
const tour = await p.evaluate(async () => {
  const r = await fetch('http://localhost:3000/api/voice/tools/execute', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ toolName:'present_place', params:{ area_name:'Dubai Marina' } }) })
  const j = await r.json(); return j.mapAction?.tour
})
if (!tour) { console.log('NO TOUR'); await b.close(); process.exit(1) }
await p.evaluate((t) => window.__lunaGuidedTour(t), tour)
await p.waitForTimeout(1500)
// pause to freeze
const pause = p.locator('button[title="Pause"]'); if (await pause.count()) await pause.click()
await p.waitForTimeout(800)
await p.screenshot({ path: `${out}/tour-${tag}-1adv.png` })
// next → environment
let nx = p.locator('button', { hasText: '下一步' }); await nx.click(); await p.waitForTimeout(2500)
await p.screenshot({ path: `${out}/tour-${tag}-2env.png` })
// next → transactions
nx = p.locator('button', { hasText: '下一步' }); await nx.click(); await p.waitForTimeout(2000)
await p.screenshot({ path: `${out}/tour-${tag}-3tx.png` })
console.log('pageerrors:', errs.length, errs[0]||'')
await b.close()
