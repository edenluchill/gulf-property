/** 空态时 hero 那张卡必须看起来像个入口(而不是一行灰字)。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
for (const [tag,vp] of [['desktop',{width:1440,height:900}],['phone',{width:414,height:896}]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  p.on('pageerror', e=>console.log('  [pageerror]', String(e).slice(0,140)))
  await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))
  await p.goto('http://localhost:5174/changelog', { waitUntil:'domcontentloaded' })
  await p.waitForTimeout(3200)
  await p.screenshot({ path:`shots-changelog/_empty-${tag}.png`, clip:{x:0,y:0,width:vp.width,height:Math.min(720,vp.height)} })
  // 打开弹窗看副标题没了
  await p.locator('button:has-text("写第一条"), button:has-text("提一个功能建议")').first().click()
  await p.waitForTimeout(700)
  const txt = await p.evaluate(()=>document.body.innerText)
  console.log(`  ${tag}: 弹窗还有那句废话? ${/公开列出/.test(txt) ? 'YES(没删干净)' : 'NO ✓'}`)
  await p.screenshot({ path:`shots-changelog/_modal2-${tag}.png` })
  await ctx.close()
}
await b.close(); console.log('ok')
