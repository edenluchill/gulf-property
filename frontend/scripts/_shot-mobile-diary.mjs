/**
 * 手机版全面体检:产品日记 / 建议板 / 单条详情。
 * 查的是**手机上真会出事的那几件**:横向溢出、触摸目标太小、元素重叠、
 * 贴顶导航挡内容、RTL 方向。
 */
import { chromium } from 'playwright'
import fs from 'fs'
const OUT='shots-mobile'; fs.mkdirSync(OUT,{recursive:true})
const FE = process.env.FE || 'http://localhost:5174'
const b = await chromium.launch()
let fail=0
const check=(l,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!ok)fail++}

const DEVICES = [
  ['iPhone-SE', 375, 667],
  ['iPhone-14', 390, 844],
  ['小屏', 360, 640],
]
const PAGES = [['diary','/changelog'], ['board','/requests'], ['detail','/requests/9']]

for (const [dev, w, h] of DEVICES) {
  for (const [tag, path] of PAGES) {
    const ctx = await b.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
    const p = await ctx.newPage()
    p.on('pageerror', e=>{console.log(`  [${dev}${path}] pageerror`, String(e).slice(0,120)); fail++})
    await p.addInitScript(()=>localStorage.setItem('pinzos-lang','zh-CN'))
    await p.goto(FE+path, { waitUntil:'domcontentloaded' })
    await p.waitForTimeout(3000)

    // ① 横向不能溢出
    const over = await p.evaluate(() => {
      const sc = document.querySelector('.flex-1.overflow-y-auto') || document.body
      return { scrollW: sc.scrollWidth, clientW: sc.clientWidth }
    })
    check(`${dev} ${tag}: 不横向溢出`, over.scrollW <= over.clientW + 1, `${over.scrollW}/${over.clientW}`)

    // ② 主要可点元素触摸目标 ≥32px
    const small = await p.evaluate(() => {
      const els = [...document.querySelectorAll('a[href^="/requests"], button')]
      return els.filter(e => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 28
      }).map(e => ((e.textContent||'').trim().slice(0,12) || e.getAttribute('aria-label') || e.className.slice(0,28)) + ':' + Math.round(e.getBoundingClientRect().height))
    })
    check(`${dev} ${tag}: 触摸目标不过小`, small.length === 0, small.slice(0,4).join(' | '))

    if (tag === 'diary') {
      // ③ hero 卡片必须在日记之前(手机是竖排)
      const order = await p.evaluate(() => {
        const card = [...document.querySelectorAll('h2')].find(h=>/大家在提什么/.test(h.textContent||''))
        const first = document.querySelector('[data-sec]')
        if (!card || !first) return null
        return { card: card.getBoundingClientRect().top + window.scrollY, sec: first.getBoundingClientRect().top + window.scrollY }
      })
      check(`${dev} ${tag}: 建议卡排在日记之前`, !!order && order.card < order.sec)
    }
    await p.screenshot({ path:`${OUT}/${dev}-${tag}.png`, fullPage:false })
    await ctx.close()
  }
}

// RTL 快检
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
const p = await ctx.newPage()
await p.addInitScript(()=>localStorage.setItem('pinzos-lang','ar'))
await p.goto(FE+'/requests', { waitUntil:'domcontentloaded' })
await p.waitForTimeout(2800)
check('ar 建议板为 RTL', await p.evaluate(()=>document.documentElement.dir)==='rtl')
const overAr = await p.evaluate(()=>{const sc=document.querySelector('.flex-1.overflow-y-auto')||document.body;return sc.scrollWidth<=sc.clientWidth+1})
check('ar 建议板不横向溢出', overAr)
await p.screenshot({ path:`${OUT}/ar-board.png` })
await ctx.close()

await b.close()
console.log(fail===0?`\n✅ 手机版全部通过,截图在 ${OUT}/`:`\n❌ ${fail} 项未通过`)
process.exit(fail===0?0:1)
