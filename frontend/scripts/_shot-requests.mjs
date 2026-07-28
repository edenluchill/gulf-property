import { chromium } from 'playwright'
const b = await chromium.launch()
for (const [tag, vp, lang] of [['desktop',{width:1280,height:900},'zh-CN'],['phone',{width:414,height:896},'zh-CN']]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript((l)=>localStorage.setItem('pinzos-lang',l), lang)
  await p.goto('http://localhost:5174/changelog', { waitUntil:'domcontentloaded' })
  await p.waitForTimeout(3500)
  await p.screenshot({ path: `shots-changelog/_hero-${tag}.png`, clip:{x:0,y:0,width:vp.width,height:Math.min(760,vp.height)} })
  await p.locator('[data-sec="requests"]').scrollIntoViewIfNeeded()
  await p.waitForTimeout(700)
  // 展开第一条的楼层
  await p.locator('button:has-text("条回复")').first().click().catch(()=>{})
  await p.waitForTimeout(1200)
  await p.screenshot({ path: `shots-changelog/_requests-${tag}.png` })
  await ctx.close()
}
await b.close(); console.log('ok')
