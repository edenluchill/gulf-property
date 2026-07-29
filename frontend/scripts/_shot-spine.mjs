/** 书脊目录:滚动时高亮/进度条要跟着走。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
p.on('pageerror', e=>console.log('  [pageerror]', String(e).slice(0,140)))
await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))
await p.goto('http://localhost:5174/changelog', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(3200)
await p.screenshot({ path:'shots-changelog/_diary-hero.png', clip:{x:0,y:0,width:1440,height:760} })
const sc = 'const s=document.querySelector(".flex-1.overflow-y-auto");'
for (const [tag, y] of [['a',900],['b',2600],['c',5200]]) {
  await p.evaluate(new Function(sc+'s.scrollTop='+y))
  await p.waitForTimeout(1100)
  await p.screenshot({ path:`shots-changelog/_spine-${tag}.png`, clip:{x:0,y:0,width:900,height:620} })
}
await b.close(); console.log('ok')
