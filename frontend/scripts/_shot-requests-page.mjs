/** 日记页不得再有建议区;/requests 独立页要能浏览/发帖/点赞/跟帖。 */
import { chromium } from 'playwright'
const b = await chromium.launch()
let fail=0
const check=(l,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!ok)fail++}
const ctx = await b.newContext({ viewport:{width:1440,height:900}, deviceScaleFactor:2 })
const p = await ctx.newPage()
p.on('pageerror', e=>{console.log('  [pageerror]',String(e).slice(0,160)); fail++})
await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))

await p.goto('http://localhost:5174/changelog', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(3200)
const diary = await p.evaluate(()=>document.body.innerText)
check('日记页页尾**没有**建议区(搜索框/筛选)', !/搜索建议|待评估\s*\d/.test(diary))
// 书脊里的项就是那些 [data-sec] 跳转按钮;直接数它们
const spine = await p.evaluate(()=>[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim()))
check('日记页书脊里没有「功能建议」项', !spine.some(x=>/功能建议/.test(x)), spine.join(' | ').slice(0,80))
check('日记页 hero 有入口卡', /大家在提什么/.test(diary))
await p.screenshot({ path:'shots-changelog/_diary-nofooter.png', clip:{x:0,y:0,width:1440,height:780} })

// 点 hero 卡上的「看全部」→ 跳新页
const seeAll = p.locator('a[href="/requests"]').first()
check('hero 卡里有跳新页的链接', await seeAll.count()>0)
await p.goto('http://localhost:5174/requests', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(2500)
// ⚠️ placeholder **不在 innerText 里** —— 上一版拿 innerText 找「搜索建议」永远失败(假红灯)
const req = await p.evaluate(()=>document.body.innerText)
const hasSearch = await p.locator('input[placeholder*="搜索建议"]').count()
check('/requests 打得开且有看板', /功能建议/.test(req) && hasSearch>0)
check('/requests 有返回日记的链接', /产品日记/.test(req))
await p.screenshot({ path:'shots-changelog/_requests-page.png', clip:{x:0,y:0,width:1440,height:820} })

// ?new=1 直接弹发帖框
await p.goto('http://localhost:5174/requests?new=1', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(2200)
check('?new=1 直接打开发帖弹窗', await p.locator('input[placeholder*="一句话说清楚"]').count() > 0)
await ctx.close(); await b.close()
console.log(fail===0?'\n✅ 全部通过':`\n❌ ${fail} 项未通过`)
process.exit(fail===0?0:1)
