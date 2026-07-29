/** /changelog 五语言验收:文案不能剩中文/英文兜底,阿拉伯要 RTL。 */
import { chromium } from 'playwright'
import fs from 'fs'
const OUT='shots-changelog'; fs.mkdirSync(OUT,{recursive:true})
const FE = process.env.FE || 'http://localhost:5174'
const b = await chromium.launch()
let fail=0
const check=(l,ok,d='')=>{console.log(`  ${ok?'PASS':'FAIL'}  ${l}${d?' — '+d:''}`); if(!ok)fail++}

// 每个语言:一个必现的标题词 + 一条内容片段
const CASES = [
  ['zh-CN','更新历史','实时带看'],
  ['en',"What's new",'live-tour'],
  ['fr','Nouveautés','visite en direct'],
  ['ru','Что нового','живого показа'],
  ['ar','ما الجديد','الجولة المباشرة'],
]
for (const [lang, titleWord, bodyWord] of CASES) {
  const ctx = await b.newContext({ viewport:{width:1280,height:900}, deviceScaleFactor:2 })
  const p = await ctx.newPage()
  p.on('pageerror', e=>{ console.log('  [pageerror]', String(e).slice(0,120)); fail++ })
  await p.addInitScript((l)=>localStorage.setItem('pinzos-lang',l), lang)
  await p.goto(FE+'/changelog', { waitUntil:'domcontentloaded' })
  await p.waitForTimeout(3200)
  const txt = await p.evaluate(()=>document.body.innerText)
  check(`${lang}: 标题本地化`, txt.includes(titleWord), titleWord)
  check(`${lang}: 内容本地化`, txt.includes(bodyWord), bodyWord)
  if (lang !== 'zh-CN') check(`${lang}: 没有中文残留`, !/[一-龥]/.test(txt.replace(/Pinzos/g,'')))
  if (lang === 'ar') check('ar: 页面为 RTL', await p.evaluate(()=>document.documentElement.dir)==='rtl')
  await p.screenshot({ path:`${OUT}/_lang-${lang}.png`, clip:{x:0,y:0,width:1280,height:700} })
  await ctx.close()
}
await b.close()
console.log(fail===0?`\n✅ 五语言全部通过`:`\n❌ ${fail} 项未通过`)
process.exit(fail===0?0:1)
