/** 每条建议的独立页面:列表标题可点 → 详情页有固定链接、楼层默认展开、可复制链接。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
let fail=0
const check=(l,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!ok)fail++}
const ctx = await b.newContext({ viewport:{width:1280,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
p.on('pageerror', e=>{console.log('  [pageerror]',String(e).slice(0,160)); fail++})
await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))

await p.goto('http://localhost:5174/requests', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(2800)
const link = p.locator('a[href^="/requests/"]').first()
check('列表里标题是跳详情页的链接', await link.count()>0)
const href = await link.getAttribute('href')
await link.click()
await p.waitForTimeout(2500)
check('点进去 URL 变成单条地址', p.url().includes(href), p.url())
const txt = await p.evaluate(()=>document.body.innerText)
check('详情页展示了这条建议', /地图区域transaction/.test(txt))
check('详情页楼层默认展开(有回复框或「还没有回复」)', /还没有回复|说点什么|登录后可以回复/.test(txt))
check('详情页有复制链接按钮', /复制链接/.test(txt))
check('详情页有返回全部建议的链接', await p.locator('a[href="/requests"]').count()>0)
check('页面标题用了建议本身', /地图区域transaction/.test(await p.title()), await p.title())
await p.screenshot({ path:'shots-changelog/_request-detail.png', clip:{x:0,y:0,width:1280,height:700} })

await p.goto('http://localhost:5174/requests/999999', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(2200)
check('不存在的 id 显示「找不到」而不是白屏', /找不到这条建议/.test(await p.evaluate(()=>document.body.innerText)))
await ctx.close(); await b.close()
console.log(fail===0?'\n✅ 全部通过':`\n❌ ${fail} 项未通过`)
process.exit(fail===0?0:1)
