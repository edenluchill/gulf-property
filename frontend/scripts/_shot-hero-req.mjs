import { chromium } from 'playwright'
const b = await chromium.launch()
for (const [tag, vp] of [['desktop',{width:1440,height:900}],['phone',{width:414,height:896}]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  p.on('pageerror', e=>console.log('  [pageerror]', String(e).slice(0,140)))
  await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))
  await p.goto('http://localhost:5174/changelog', { waitUntil:'domcontentloaded' })
  await p.waitForTimeout(3500)
  await p.screenshot({ path:`shots-changelog/_heroreq-${tag}.png`, clip:{x:0,y:0,width:vp.width,height:Math.min(940,vp.height)} })
  await ctx.close()
}
await b.close(); console.log('ok')
