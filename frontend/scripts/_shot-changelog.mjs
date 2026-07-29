/** 更新历史页视觉验收:hero / 滚动后细导航条 / 提建议弹窗(未登录) —— 桌面+手机。 */
import { chromium } from 'playwright'
import fs from 'fs'
const OUT='shots-changelog'; fs.mkdirSync(OUT,{recursive:true})
const FE = process.env.FE || 'http://localhost:5174'
const b = await chromium.launch()
let fail=0
const check=(l,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!ok)fail++}

for (const [tag, vp] of [['desktop',{width:1280,height:900}],['phone',{width:414,height:896}]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  p.on('pageerror', e => { console.log('  [pageerror]', String(e).slice(0,140)); fail++ })
  await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))
  await p.goto(FE+'/changelog', { waitUntil:'domcontentloaded' })
  await p.waitForTimeout(3000)
  await p.screenshot({ path:`${OUT}/_hero-${tag}.png`, clip:{x:0,y:0,width:vp.width,height:Math.min(700,vp.height)} })

  // 页尾不该再有一组「打开地图/了解 Pinzos」
  const bodyTxt = await p.evaluate(()=>document.body.innerText)
  const openMapCount = (bodyTxt.match(/打开地图/g)||[]).length
  check(`${tag}: 「打开地图」只出现一次(在 hero)`, openMapCount === 1, `出现 ${openMapCount} 次`)

  // 滚下去 → 细导航条贴顶
  // ⚠️ app 根是 h-screen overflow-hidden —— **window 从来不滚**,真正的滚动容器是
  //    页面根那个 .overflow-y-auto。window.scrollTo 在这个站里是死代码(memory 有记)。
  await p.evaluate(()=>{ const sc=document.querySelector('.flex-1.overflow-y-auto'); if(sc) sc.scrollTop=1400 })
  await p.waitForTimeout(900)
  const stickyVisible = await p.locator('button:has-text("提建议")').first().isVisible().catch(()=>false)
  check(`${tag}: 滚动后顶部细导航条出现`, stickyVisible)
  await p.screenshot({ path:`${OUT}/_sticky-${tag}.png`, clip:{x:0,y:0,width:vp.width,height:220} })

  // 未登录点「提建议」→ 弹窗能打开,并提示要登录
  await p.locator('button:has-text("提建议")').first().click()
  await p.waitForTimeout(700)
  const modalTxt = await p.evaluate(()=>document.body.innerText)
  check(`${tag}: 未登录也能打开提建议弹窗`, /提一个功能建议/.test(modalTxt))
  check(`${tag}: 弹窗里说明要登录`, /登录并提交|需要登录/.test(modalTxt))
  await p.screenshot({ path:`${OUT}/_modal-${tag}.png` })
  await ctx.close()
}
await b.close()
console.log(fail===0?`\n✅ 全部通过,截图在 ${OUT}/`:`\n❌ ${fail} 项未通过`)
process.exit(fail===0?0:1)
